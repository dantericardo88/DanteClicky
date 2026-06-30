import { useEffect, useCallback, useRef } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  useCompanionStore,
  type ConversationTurn,
  type ProviderType,
} from "../state/companionStore";
import { useAssemblyAI } from "./useAssemblyAI";
import { useElevenLabs, QUALITY_PRESETS } from "./useElevenLabs";
import { useEmbedding } from "./useEmbedding";
import { captureAllScreens, sortScreens, type CapturedScreen } from "./useScreenCapture";
import {
  buildOpenAIResponsesComputerBody,
  sendOpenAIResponse,
  streamChat,
  type ChatMessage,
  type ToolUseBlock,
} from "../providers/chat";
import { stripPoints } from "../providers/pointParser";
import { assembleRichContext } from "../lib/screenpipe";
import { verifyAction, verifyActionLocal } from "../lib/actionVerifier";
import { summarizeOldTurns, compressSummary } from "../lib/memorySummarizer";
import {
  CONTEXT_SUMMARY_SCHEMA_VERSION,
  SUMMARY_RECOMPRESS_TOKENS,
  buildCompressedContext,
  estimateTokens,
  getCoveredTurnRange,
  mergeRunningSummary,
  type CompressedContextPlan,
} from "../lib/contextCompression";
import { parseUiTree, type UiElement } from "../lib/uiTreeParser";
import { buildSystemPrompt } from "../lib/buildSystemPrompt";
import { isLocalProvider } from "../lib/providerRegistry";
import { getTemporalSnapshotContext } from "../lib/temporalContext";
import { annotateSom, buildSomSystemPromptSection } from "../lib/somAnnotator";
import { matchClickIntent } from "../lib/clickIntent";
import { getAmbientContext } from "./useAmbient";
import {
  buildContextDepthBlock,
  renderMultiScreenOcrContext,
  shouldAttachTemporalVisualHistory,
} from "../lib/contextDepth";
import {
  buildLoopContinuationPrompt,
  classifyAgentActionSafety,
  buildVerificationResultText,
  createPendingComputerAction,
  describeAgentAction,
  extractAgentActionsWithElements,
  hasExecutableAction,
  isComputerActionConfirmation,
  resolveAgentAction,
  type ResolvedAgentAction,
} from "../lib/agentLoop";
import {
  buildOpenAIComputerCallOutput,
  buildClaudeComputerToolResult,
  claudeToolUseToAgentActions,
  extractOpenAIResponseText,
} from "../lib/providerComputerActions";
import { runOpenAIComputerUseLoop } from "../lib/openAIComputerLoop";
import {
  buildPreferenceGuidance,
  inferPreferenceSignal,
  type PreferenceProfile,
} from "../lib/preferenceLearning";
import {
  createClientTurnId,
  preferenceFeedbackQueue,
  shouldUsePreferenceLearning,
} from "../lib/preferenceClient";
import { buildSpeechLanguagePrompt, buildSpeechLanguageStatus, getLanguageConfidenceThreshold, normalizeSpeechLanguageCode, type SpeechLanguageCode } from "../lib/speechLanguages";
import { buildKeytermsForUtterance } from "../lib/voiceContext";
import { cleanupTranscript, selectCleanupModel } from "../lib/sttCleanup";
import {
  captureTelemetryError,
  recordTelemetryEvent,
  recordTelemetryMetric,
  startTelemetrySpan,
  type TelemetryContext,
} from "../lib/telemetry";
import { DEFAULT_WAKE_PHRASE, transcriptContainsWakePhrase } from "../lib/wakeWord";

// Orchestrates the full push-to-talk pipeline:
// hotkey-down → mic on + STT → hotkey-up → screenshot → AI stream → TTS → cursor → idle
// STT backend is selected by the current sttMode:
//   Cloud → AssemblyAI WebSocket real-time
//   Local → whisper-rs offline (transcribe_local Tauri command)

// Maximum number of iterative computer-use loop steps per user request
const MAX_CU_LOOP_STEPS = 10;
// Stop the loop early if this many actions in a row all fail verification
const MAX_CONSECUTIVE_FAILURES = 3;
type PendingHotkeyEvent = "pressed" | "released";

function transcriptLengthBucket(transcript: string): "<80" | "80-500" | "500+" {
  return transcript.length < 80 ? "<80" : transcript.length < 500 ? "80-500" : "500+";
}

/// Determines if ambient context should be injected based on relevance heuristics.
/// Returns true if: (1) user mentions "what am I / was I / earlier / context" or
/// (2) ambient context contains window names that overlap with user utterance keywords.
function isAmbientContextRelevant(utterance: string, context: string): boolean {
  if (!context.trim()) return false;

  const u = utterance.toLowerCase();

  // Explicit trigger words — user explicitly asks for context
  const explicitTriggers = [
    "what am i",
    "what was i",
    "what have i",
    "my screen",
    "i was working",
    "earlier",
    "context",
    "show me what",
    "remind me what",
    "what did i",
  ];
  if (explicitTriggers.some((t) => u.includes(t))) return true;

  // Extract window names from bullet lines (• WindowName: ...)
  const windowMatches = [...context.matchAll(/^•\s+([^:]+):/gm)];
  if (windowMatches.length === 0) return false;

  const windowNames = windowMatches.map((m) =>
    m[1]
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 3)
  );

  // Check if any window name words appear in the user's utterance
  return windowNames.some((words) => words.some((word) => u.includes(word)));
}

// Smart TTS model selector: use multilingual model for non-English, otherwise respect quality preset
export function selectTtsModel(
  speechLanguage: SpeechLanguageCode,
  ttsQuality: "fast" | "balanced" | "max"
): "eleven_flash_v2_5" | "eleven_turbo_v2_5" | "eleven_multilingual_v2" {
  // English speakers can use fast/turbo models for lower latency
  if (speechLanguage === "en" || speechLanguage === "auto") {
    const presets = {
      fast: "eleven_flash_v2_5" as const,
      balanced: "eleven_turbo_v2_5" as const,
      max: "eleven_multilingual_v2" as const,
    };
    return presets[ttsQuality];
  }
  // All non-English languages use the multilingual model for quality
  return "eleven_multilingual_v2";
}

function keyForProvider(
  provider: ProviderType,
  keys: {
    anthropicKey: string;
    openaiKey: string;
    grokKey: string;
    openrouterKey: string;
  },
): string {
  if (provider === "claude") return keys.anthropicKey;
  if (provider === "grok") return keys.grokKey;
  if (provider === "openrouter") return keys.openrouterKey;
  if (provider === "openai") return keys.openaiKey;
  return "";
}

function keyPresenceProvider(provider: ProviderType): "anthropic" | "openai" | "grok" | "openrouter" {
  if (provider === "claude") return "anthropic";
  if (provider === "grok") return "grok";
  if (provider === "openrouter") return "openrouter";
  return "openai";
}

export function useVoice() {
  const {
    voiceState,
    selectedModel,
    anthropicKey,
    openaiKey,
    grokKey,
    openrouterKey,
    apiKeyPresence,
    elevenLabsKey,
    elevenLabsVoiceId,
    elevenLabsCustomVoiceId,
    ttsQuality,
    assemblyAiKey,
    setVoiceState,
    setTranscript,
    setResponse,
    appendResponse,
    pushConversationTurn,
    updateConversationTurnId,
    replaceConversationContext,
    conversationHistory,
    conversationSummary,
    sessionNotes,
    systemPromptOverride,
    maxCuSteps,
    pendingComputerAction,
    memoryEnabled,
    preferenceLearningEnabled,
    memoryRetentionDays,
    incognitoMode,
    speechLanguage,
    speechLanguageDetection,
    sttMode,
    vadEnabled,
    wakeModeEnabled,
    wakePhrase,
    wakeSensitivity,
    moondreamSessionLoaded,
    setCurrentUiElements,
    setConversationSummary,
    setError,
    clearError,
    setLatencyMs,
    setSttMode,
    setWakeStatus,
    setWakeLastDetectedAt,
    setWakeLastTranscript,
    setSpeechLanguageDetection,
    setPendingComputerAction,
    clearPendingComputerAction,
  } = useCompanionStore();

  const sampleRateRef = useRef<number>(44100);
  const summaryHydratedRef = useRef(false);
  const sqliteMemoryRef = useRef("");
  const wakeModeEnabledRef = useRef(wakeModeEnabled);
  const wakePhraseRef = useRef(wakePhrase);
  const wakeSensitivityRef = useRef(wakeSensitivity);
  const vadEnabledRef = useRef(vadEnabled);
  const wakeModelReadyRef = useRef(false);
  const wakeMonitorStartingRef = useRef(false);
  const wakeSegmentInFlightRef = useRef(false);
  const wakeRestartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assemblyAI = useAssemblyAI(assemblyAiKey, speechLanguage);

  // Auto-detect feedback loop: when in auto mode, use detected language for TTS if confidence >= per-language threshold
  const detectedNormalized = speechLanguageDetection?.detectedLanguageCode
    ? normalizeSpeechLanguageCode(speechLanguageDetection.detectedLanguageCode)
    : null;
  const confidenceThreshold = detectedNormalized ? getLanguageConfidenceThreshold(detectedNormalized) : 0.85;
  const effectiveSpeechLanguage: SpeechLanguageCode =
    speechLanguage === "auto" &&
    speechLanguageDetection?.detectedLanguageCode &&
    speechLanguageDetection.languageConfidence !== null &&
    speechLanguageDetection.languageConfidence >= confidenceThreshold
      ? detectedNormalized ?? speechLanguage
      : speechLanguage;

  // Smart TTS model selector: multilingual for non-English, fast/turbo for English
  const selectedTtsModel = selectTtsModel(effectiveSpeechLanguage, ttsQuality);

  // Audio quality parity: multilingual model needs higher quality settings than fast/turbo
  const ttsOutputFormat = selectedTtsModel === "eleven_multilingual_v2"
    ? "mp3_44100_192"  // upgrade from fast's 128 for multilingual quality
    : QUALITY_PRESETS[ttsQuality].outputFormat;
  const ttsLatencyOpt = selectedTtsModel === "eleven_multilingual_v2"
    ? Math.min(QUALITY_PRESETS[ttsQuality].latencyOpt, 3)  // cap at 3 (not 4) for multilingual
    : QUALITY_PRESETS[ttsQuality].latencyOpt;

  const elevenLabs = useElevenLabs(elevenLabsKey, elevenLabsVoiceId, elevenLabsCustomVoiceId, selectedTtsModel, ttsQuality, speechLanguage, ttsOutputFormat, ttsLatencyOpt);
  const { status: embeddingStatus, embed, embedAndSave } = useEmbedding();

  useEffect(() => {
    wakeModeEnabledRef.current = wakeModeEnabled;
    wakePhraseRef.current = wakePhrase;
    wakeSensitivityRef.current = wakeSensitivity;
    vadEnabledRef.current = vadEnabled;
  }, [wakeModeEnabled, wakePhrase, wakeSensitivity, vadEnabled]);

  // Track which STT backend is active; sync from Rust on mount.
  // Settings writes this same store field, so hotkey handling cannot drift.
  useEffect(() => {
    invoke<{ mode: string }>("get_stt_mode")
      .then(({ mode }) => {
        setSttMode(mode === "Local" ? "Local" : "Cloud");
      })
      .catch(() => {});
  }, [setSttMode]);

  useEffect(() => {
    if (summaryHydratedRef.current) return;
    summaryHydratedRef.current = true;
    if (conversationSummary.trim()) return;
    invoke<{ summary: string; schema_version?: number } | null>("get_latest_conversation_summary")
      .then((row) => {
        if (
          row?.summary?.trim() &&
          row.schema_version === CONTEXT_SUMMARY_SCHEMA_VERSION
        ) {
          setConversationSummary(row.summary);
        }
      })
      .catch(() => {});
  }, [conversationSummary, setConversationSummary]);

  // Prune turns older than memoryRetentionDays on mount (0 = keep forever)
  useEffect(() => {
    if (memoryRetentionDays > 0) {
      invoke("prune_old_turns", { olderThanDays: memoryRetentionDays }).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pre-warm AssemblyAI WebSocket on startup so the first PTT has zero connection latency.
  // Query actual device sample rate via Web Audio API rather than using the uninitialized
  // sampleRateRef (which only updates after the first audio chunk arrives).
  useEffect(() => {
    if (!assemblyAiKey || sttMode !== "Cloud") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    timer = setTimeout(() => {
      if (!cancelled) {
        let deviceRate = 44100;
        try {
          const probe = new AudioContext();
          deviceRate = probe.sampleRate;
          probe.close();
        } catch { /* use default */ }
        sampleRateRef.current = deviceRate;
        assemblyAI.preWarm(deviceRate).catch(() => {});
      }
    }, 5_000);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assemblyAiKey, sttMode, speechLanguage]);

  // Forward audio chunks to AssemblyAI only in Cloud mode
  useEffect(() => {
    const unlisten = listen<[string, number]>("audio-chunk", (event) => {
      const [base64, sr] = event.payload;
      sampleRateRef.current = sr;
      const { voiceState } = useCompanionStore.getState();
      if (sttMode === "Cloud" && voiceState === "listening") {
        assemblyAI.sendChunk(base64);
      }
    }).catch(() => () => {});
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [assemblyAI, sttMode]);

  const clearWakeRestartTimer = useCallback(() => {
    if (wakeRestartTimerRef.current !== null) {
      clearTimeout(wakeRestartTimerRef.current);
      wakeRestartTimerRef.current = null;
    }
  }, []);

  const startWakeMonitor = useCallback(async () => {
    if (!wakeModeEnabledRef.current || wakeMonitorStartingRef.current) return;

    const currentState = useCompanionStore.getState();
    if (currentState.voiceState !== "idle" || currentState.wakeStatus === "listening") {
      return;
    }

    wakeMonitorStartingRef.current = true;
    clearWakeRestartTimer();

    try {
      if (!wakeModelReadyRef.current) {
        setWakeStatus("downloading");
        await invoke("download_whisper_model", { languageCode: "en" });
        wakeModelReadyRef.current = true;
      }

      if (!wakeModeEnabledRef.current || useCompanionStore.getState().voiceState !== "idle") {
        return;
      }

      setWakeStatus("starting");
      await invoke("set_vad_enabled", { enabled: true });
      await invoke("start_audio");
      setWakeStatus("listening");
      recordTelemetryEvent("wake_word.monitor_started", {
        sttMode: "Local",
        speechLanguage: "en",
        wakeSensitivity: wakeSensitivityRef.current,
        wakePhraseLength: (wakePhraseRef.current || DEFAULT_WAKE_PHRASE).length,
        localOnly: true,
      });
    } catch (err) {
      console.error("[useVoice] Wake monitor failed:", err);
      captureTelemetryError(err, { route: "wake_word.monitor", sttMode: "Local", speechLanguage: "en" });
      recordTelemetryEvent("wake_word.error", {
        reason: "monitor_start_failed",
        sttMode: "Local",
        speechLanguage: "en",
        localOnly: true,
      });
      const msg = err instanceof Error ? err.message : String(err);
      setWakeStatus("error");
      setError(`Wake word unavailable: ${msg.slice(0, 120)}`);
    } finally {
      wakeMonitorStartingRef.current = false;
    }
  }, [clearWakeRestartTimer, setError, setWakeStatus]);

  const scheduleWakeMonitorRestart = useCallback((delayMs = 250) => {
    clearWakeRestartTimer();
    wakeRestartTimerRef.current = setTimeout(() => {
      startWakeMonitor().catch(() => {});
    }, delayMs);
  }, [clearWakeRestartTimer, startWakeMonitor]);

  const stopWakeMonitor = useCallback(async () => {
    clearWakeRestartTimer();
    wakeSegmentInFlightRef.current = false;
    if (useCompanionStore.getState().voiceState === "idle") {
      await invoke("stop_audio").catch(() => {});
    }
    if (!vadEnabledRef.current) {
      await invoke("set_vad_enabled", { enabled: false }).catch(() => {});
    }
    setWakeStatus("off");
  }, [clearWakeRestartTimer, setWakeStatus]);

  const handleHotkeyDown = useCallback(async () => {
    if (useCompanionStore.getState().voiceState !== "idle") return;
    elevenLabs.warmUp(); // pre-warm AudioContext before mic starts
    const span = startTelemetrySpan("voice.hotkey_down", {
      provider: selectedModel.provider,
      modelId: selectedModel.modelId,
      sttMode,
      speechLanguage,
    });

    // Clear any previous error at the start of each new session
    clearError();

    // Read API key state from the live store at call time rather than from the
    // stale closure — useCallback deps include objects that change every render
    // (assemblyAI, elevenLabs), so the closure can lag behind store updates.
    const liveState = useCompanionStore.getState();
    const apiKey = keyForProvider(selectedModel.provider, {
      anthropicKey: liveState.anthropicKey,
      openaiKey: liveState.openaiKey,
      grokKey: liveState.grokKey,
      openrouterKey: liveState.openrouterKey,
    });
    const providerKeyPresenceKey = keyPresenceProvider(selectedModel.provider);
    const livePresence = liveState.apiKeyPresence;
    const providerKeyReady =
      isLocalProvider(selectedModel.provider) ||
      Boolean(apiKey) ||
      Boolean(livePresence[providerKeyPresenceKey]);
    console.log("[voice] hotkey-down: provider=%s model=%s isLocal=%s apiKey(len)=%d presenceKey=%s presence=%s → ready=%s",
      selectedModel.provider, selectedModel.modelId,
      isLocalProvider(selectedModel.provider),
      apiKey?.length ?? 0,
      providerKeyPresenceKey,
      livePresence[providerKeyPresenceKey],
      providerKeyReady,
    );
    if (!providerKeyReady) {
      recordTelemetryEvent("voice.start.blocked", {
        reason: "missing_api_key",
        provider: selectedModel.provider,
      });
      span.end({ blocked: "missing_api_key" });
      setError(`No API key for ${selectedModel.provider} — add one in Settings ⚙ to start talking`);
      return;
    }
    // Block early if Cloud STT is selected but no AssemblyAI key is configured.
    // Failing here avoids a confusing "Listening" flash followed by a buried error.
    if (sttMode === "Cloud" && !assemblyAiKey.trim()) {
      setError('Speech recognition needs a key. Go to Settings → Voice and either add an AssemblyAI key for Cloud STT, or download the local Whisper model to use offline.');
      span.end({ blocked: "no_assemblyai_key" });
      return;
    }

    setVoiceState("listening");
    setTranscript("");
    setResponse("");

    try {
      // Cloud mode: open AssemblyAI WebSocket before starting mic
      if (sttMode === "Cloud") {
        // Gather voice context for hotword biasing. Failures here are non-fatal —
        // we still connect (with no keyterms) rather than block the user from speaking.
        let focusedWindowTitle: string | null = null;
        try {
          focusedWindowTitle = await invoke<string>("get_active_window_title");
        } catch { /* keyterms degrade gracefully */ }
        const recentTurnTexts = conversationHistory
          .slice(-12)
          .map((t) => `${t.userPrompt ?? ""}\n${t.assistantResponse ?? ""}`);
        const personalDictionary = useCompanionStore.getState().personalDictionary ?? [];
        const keyterms = buildKeytermsForUtterance({
          focusedWindowTitle,
          personalDictionary,
          recentTurns: recentTurnTexts,
        });
        recordTelemetryEvent("stt.assemblyai.keyterms", {
          count: keyterms.length,
          hasWindowTitle: focusedWindowTitle !== null,
          hasPersonalDictionary: personalDictionary.length > 0,
        });
        await assemblyAI.connect(sampleRateRef.current, { keyterms });
      }
      await invoke("start_audio");
      span.end({ started: true });
    } catch (err) {
      console.error("[useVoice] Failed to start voice pipeline:", err);
      captureTelemetryError(err, { route: "voice.hotkey_down", sttMode, provider: selectedModel.provider });
      span.fail(err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("401") || msg.toLowerCase().includes("unauthorized") || msg.toLowerCase().includes("assemblyai")) {
        setError("AssemblyAI connection failed: check your AssemblyAI key. No local fallback was attempted.");
      } else {
        const languageStatus = buildSpeechLanguageStatus(speechLanguage, sttMode);
        const fallbackHint =
          sttMode === "Cloud" && languageStatus.recommendedMode === "Local"
            ? " No local fallback was attempted; switch to Local Whisper for this language."
            : "";
        setError(`Failed to start microphone: ${msg.slice(0, 100)}${fallbackHint}`);
      }
      setVoiceState("idle");
    }
  }, [
    anthropicKey,
    openaiKey,
    grokKey,
    openrouterKey,
    apiKeyPresence,
    selectedModel,
    assemblyAI,
    elevenLabs,
    sttMode,
    speechLanguage,
    setVoiceState,
    setTranscript,
    setResponse,
    setError,
    clearError,
  ]);

  const handleHotkeyUp = useCallback(async () => {
    if (useCompanionStore.getState().voiceState === "idle") {
      await invoke("stop_audio").catch(() => {});
      return;
    }
    const turnSpan = startTelemetrySpan("voice.turn", {
      provider: selectedModel.provider,
      modelId: selectedModel.modelId,
      sttMode,
      speechLanguage,
      memoryEnabled,
      preferenceLearningEnabled,
      incognitoMode,
    });
    const turnContext = turnSpan.context;
    await invoke("stop_audio");

    let transcript: string;

    if (sttMode === "Cloud") {
      setVoiceState("processing");
      transcript = assemblyAI.disconnect();
      const detection = assemblyAI.getLastLanguageDetection();
      const status = buildSpeechLanguageStatus(speechLanguage, "Cloud");
      setSpeechLanguageDetection({
        mode: "Cloud",
        selectedLanguage: speechLanguage,
        detectedLanguageCode: detection?.languageCode ?? null,
        languageConfidence: detection?.confidence ?? null,
        statusLabel: detection
          ? `detected ${detection.languageCode.toUpperCase()}${typeof detection.confidence === "number" ? ` (${Math.round(detection.confidence * 100)}%)` : ""}`
          : status.confidenceLabel,
      });

      // LLM cleanup pass — closes the perceptual gap to dictation-grade STT.
      // Optimistic UI: show the raw transcript first, then overwrite when
      // the polished version arrives. Falls back to raw on any failure.
      const cleanupState = useCompanionStore.getState();
      if (cleanupState.sttCleanupMode !== "off" && transcript.trim().length > 0) {
        setTranscript(transcript);
        const cleanupModel = selectCleanupModel({
          anthropic: Boolean(cleanupState.anthropicKey),
          openai: Boolean(cleanupState.openaiKey),
          grok: Boolean(cleanupState.grokKey),
        });
        if (cleanupModel) {
          let focusedWindowTitle: string | null = null;
          try {
            focusedWindowTitle = await invoke<string>("get_active_window_title");
          } catch { /* graceful */ }
          const cleaned = await cleanupTranscript({
            rawTranscript: transcript,
            mode: cleanupState.sttCleanupMode,
            provider: cleanupModel.provider,
            modelId: cleanupModel.modelId,
            personalDictionary: cleanupState.personalDictionary,
            focusedWindowTitle,
            languageHint: detection?.languageCode ?? speechLanguage,
          });
          if (cleaned.applied) {
            transcript = cleaned.transcript;
          }
          recordTelemetryEvent(
            "stt.cleanup.summary",
            {
              applied: cleaned.applied,
              reason: cleaned.reason,
              latencyMs: cleaned.latencyMs,
            },
            turnContext,
          );
        }
      }
    } else {
      // Local mode: run Whisper on the accumulated PCM buffer
      setVoiceState("processing");
      try {
        transcript = await invoke<string>("transcribe_local", { languageCode: speechLanguage });
        const status = buildSpeechLanguageStatus(speechLanguage, "Local");
        setSpeechLanguageDetection({
          mode: "Local",
          selectedLanguage: speechLanguage,
          detectedLanguageCode: speechLanguage === "auto" ? null : speechLanguage,
          languageConfidence: speechLanguage === "auto" ? null : 1,
          statusLabel: status.confidenceLabel,
        });
      } catch (err) {
        console.error("[useVoice] Local transcription failed:", err);
        captureTelemetryError(err, { route: "voice.local_transcription", speechLanguage }, turnContext);
        turnSpan.fail(err, { stage: "local_transcription" });
        const msg = err instanceof Error ? err.message : String(err);
        const fallbackHint = assemblyAiKey
          ? " No cloud fallback was attempted; switch STT mode to Cloud if you want AssemblyAI instead."
          : " Add an AssemblyAI key to use cloud STT as an alternative.";
        setResponse(`Whisper error: ${msg.slice(0, 120)}.${fallbackHint}`);
        setVoiceState("responding");
        invoke("show_overlay").catch(() => {});
        setTimeout(() => {
          setVoiceState("idle");
          invoke("hide_overlay");
        }, 5000);
        return;
      }
    }

    setTranscript(transcript);
    recordTelemetryEvent("voice.stt.completed", {
      sttMode,
      speechLanguage,
      transcriptLengthBucket: transcript.length < 80 ? "<80" : transcript.length < 500 ? "80-500" : "500+",
    }, turnContext);

    console.log("[voice] transcript result: len=%d, value=%s", transcript.length, JSON.stringify(transcript.slice(0, 80)));
    if (!transcript.trim()) {
      console.warn("[voice] transcript is empty — aborting (nothing to send to LLM)");
      setVoiceState("idle");
      return;
    }

    const previousTurn = useCompanionStore.getState().conversationHistory.at(-1);
    const inferredSignal = inferPreferenceSignal(transcript);
    if (inferredSignal && previousTurn) {
      preferenceFeedbackQueue.recordForTurn(
        { id: previousTurn.id, clientTurnId: previousTurn.clientTurnId },
        { signal: inferredSignal.signal, reason: inferredSignal.reason, rawText: transcript },
        { memoryEnabled, preferenceLearningEnabled, incognitoMode }
      ).catch(() => {});
      if (inferredSignal.signal === "manual_preference") {
        emit("preference-saved-ack", {}).catch(() => {});
      }
    }

    try {
      const screens = await captureAllScreens(turnContext);
      const sorted = sortScreens(screens);
      const primaryScreen = sorted[0];
      let images = sorted.map((s) => s.data);

      setVoiceState("responding");
      await invoke("show_overlay");

      if (pendingComputerAction) {
        const confirmation = isComputerActionConfirmation(transcript);
        if (confirmation === "cancel") {
          clearPendingComputerAction();
          const message = "cancelled that paused action.";
          setResponse(message);
          elevenLabs.queueSentence(message);
          await emit("cu-confirmation-cancelled", {
            resume_id: pendingComputerAction.id,
            action: describeAgentAction(pendingComputerAction.action),
          });
          setVoiceState("idle");
          setTimeout(() => invoke("hide_overlay"), 1500);
          return;
        }

        if (confirmation === "confirm") {
          const capturedPending = pendingComputerAction;
          clearPendingComputerAction();
          const verification = await executeConfirmedPendingAction(capturedPending.action);
          const message = verification.success
            ? `confirmed. ${verification.explanation || "the action ran."}`
            : `i tried it, but verification is unsure: ${verification.explanation}`;
          setResponse(message);
          elevenLabs.queueSentence(message);
          await emit("cu-confirm-action", {
            resume_id: capturedPending.id,
            action: describeAgentAction(capturedPending.action),
            success: verification.success,
          });

          // Resume the agent loop from fresh screen state after the confirmed action.
          // This preserves multi-step agentic tasks across safety gates — the AI
          // re-observes the screen and decides whether further steps are needed.
          if (verification.success && selectedModel.provider === "claude" && apiKeyPresence["anthropic"]) {
            const freshScreens = sortScreens(await captureAllScreens(turnContext));
            if (freshScreens.length > 0) {
              await runComputerUseAgentLoop({
                initialResponse: "",
                initialNativeToolUses: [],
                initialScreens: freshScreens,
                transcript: capturedPending.originalTask,
                selectedProvider: selectedModel.provider,
                selectedModelId: selectedModel.modelId,
                conversationSummary,
                sessionNotes,
                systemPromptOverride,
                speechLanguagePrompt: buildSpeechLanguagePrompt(speechLanguage),
                maxCuSteps,
                uiElements: useCompanionStore.getState().currentUiElements,
                setCurrentUiElements: useCompanionStore.getState().setCurrentUiElements,
                sqliteMemory: sqliteMemoryRef.current,
                ambientContext: await (async () => {
                  if (!useCompanionStore.getState().ambientMode) return "";
                  const raw = await getAmbientContext(10);
                  return isAmbientContextRelevant(capturedPending.originalTask, raw) ? raw : "";
                })(),
                moondreamSessionLoaded,
                appendResponse,
                setError,
                setPendingComputerAction,
                telemetryContext: turnContext,
              });
            }
          }

          if (
            verification.success &&
            selectedModel.provider === "openai" &&
            capturedPending.resume?.provider === "openai" &&
            capturedPending.resume.previousResponseId &&
            capturedPending.resume.providerCallId &&
            primaryScreen
          ) {
            const freshScreens = sortScreens(await captureAllScreens(turnContext));
            const freshPrimary = freshScreens[0] ?? primaryScreen;
            const afterShot = await invoke<string>("capture_primary");
            const resumedResponse = await sendOpenAIResponse(
              buildOpenAIResponsesComputerBody({
                model: selectedModel.modelId,
                input: [
                  buildOpenAIComputerCallOutput(
                    capturedPending.resume.providerCallId,
                    afterShot
                  ),
                ],
                screenWidth: freshPrimary.width,
                screenHeight: freshPrimary.height,
                previousResponseId: capturedPending.resume.previousResponseId,
              }),
              turnContext
            );
            const [freshOcrText, { uiTreeText: freshUiTreeText, annotatedScreens: somFreshScreens }] = await Promise.all([
              readOcrText(freshPrimary),
              readUiTreeWithSom(freshScreens.length > 0 ? freshScreens : sorted),
            ]);
            const resumedLoop = await runOpenAIComputerUseLoop({
              initialResponse: resumedResponse,
              initialScreens: somFreshScreens,
              originalTask: capturedPending.originalTask,
              maxSteps: MAX_CU_LOOP_STEPS,
              screenContext: `${freshOcrText}\n${freshUiTreeText}`,
              createResponse: (body) =>
                sendOpenAIResponse(
                buildOpenAIResponsesComputerBody({
                  model: selectedModel.modelId,
                  input: body.input as Array<Record<string, unknown>>,
                  screenWidth: freshPrimary.width,
                  screenHeight: freshPrimary.height,
                  previousResponseId: body.previous_response_id as string | undefined,
                }),
                turnContext
              ),
              executeAction: executeResolvedAgentAction,
              capturePrimaryScreen: () => invoke<string>("capture_primary"),
              refreshScreenContext: async () => {
                const refreshedScreens = sortScreens(await captureAllScreens(turnContext));
                const refreshedPrimary = refreshedScreens[0] ?? freshPrimary;
                const [refreshedOcrText, { uiTreeText: refreshedUiTreeText, annotatedScreens }] =
                  await Promise.all([
                    readOcrText(refreshedPrimary),
                    readUiTreeWithSom(refreshedScreens.length > 0 ? refreshedScreens : somFreshScreens),
                  ]);
                return {
                  screens: annotatedScreens,
                  screenContext: `${refreshedOcrText}\n${refreshedUiTreeText}`,
                };
              },
            });

            if (resumedLoop.pendingConfirmation) {
              setPendingComputerAction(resumedLoop.pendingConfirmation);
              setError(
                `Action paused: ${resumedLoop.pendingConfirmation.reason}. Say "confirm" to continue or "cancel" to stop.`
              );
            }
            if (resumedLoop.finalText) {
              appendResponse(`\n\n${resumedLoop.finalText}`);
              elevenLabs.queueSentence(resumedLoop.finalText);
            }
          }

          setVoiceState("idle");
          setTimeout(() => invoke("hide_overlay"), 3000);
          return;
        }
      }

      // Enrich the system prompt with Screenpipe screen memory.
      // Silently ignored if Screenpipe is not running.
      let memoryContext = "";
      try {
        memoryContext = await assembleRichContext(transcript, images);
      } catch {
        // Screenpipe unavailable — continue without memory context
      }

      // OCR every current monitor so secondary-screen text does not disappear
      // from the prompt when the user is working across displays.
      let ocrText = await readOcrTextForScreens(sorted);

      // UIAutomation tree + Set-of-Mark image annotation
      // Draws numbered bounding boxes on the screenshot before sending to the AI so
      // the model can visually identify elements by number instead of guessing coords.
      let uiTreeText = "";
      let parsedSomElements: UiElement[] = [];
      try {
        const rawElements = await invoke<Array<{
          name: string; role: string;
          x: number; y: number; width: number; height: number;
          enabled: boolean; checked: string | null; value: string | null;
          expanded: string | null; focused: boolean;
          selected: boolean | null; automation_id: string | null; scroll_pct: number | null;
        }>>("get_ui_tree");
        if (rawElements.length >= 3 && primaryScreen) {
          // Annotate screenshot with numbered bounding boxes
          const somResult = await annotateSom(
            primaryScreen.data,
            rawElements,
            primaryScreen.width,
            primaryScreen.height,
            primaryScreen.label ?? "screen1"
          );
          // Build uiTreeText from sorted SoM elements so parseUiTree IDs match image box numbers
          uiTreeText = buildSomSystemPromptSection(somResult.elements);
          // Replace raw primary screenshot with annotated version for the AI
          images = images.map((img, i) => (i === 0 ? somResult.annotatedBase64 : img));
          // Parse and save elements so [ELEM:N] refs can be resolved in the agent loop
          parsedSomElements = parseUiTree(uiTreeText);
          setCurrentUiElements(parsedSomElements);
        } else if (rawElements.length < 3 && primaryScreen && moondreamSessionLoaded) {
          // UIAutomation found no/few elements (Electron, games, WebViews) — try local vision VQA
          try {
            const focusedDesc = await invoke<string>("moondream_vqa", {
              jpeg_b64: primaryScreen.data,
              question: "What UI element is currently focused or highlighted? Describe its type, label, and approximate position.",
            });
            if (focusedDesc) {
              uiTreeText = `[vision fallback] ${focusedDesc}`;
            }

            // Click-intent grounding: when the user's transcript names a specific
            // clickable target ("click the X", "tap submit"), ask the vision model
            // for normalized coordinates and append them as a [POINT] hint the LLM
            // can copy verbatim. This is the production caller for moondream_point_query.
            const clickIntent = matchClickIntent(transcript);
            if (clickIntent) {
              try {
                const [px, py] = await invoke<[number, number]>("moondream_point_query", {
                  jpeg_b64: primaryScreen.data,
                  query: clickIntent,
                });
                const x1024 = Math.round(Math.max(0, Math.min(1, px)) * 1024);
                const y1024 = Math.round(Math.max(0, Math.min(1, py)) * 1024);
                const safeLabel = clickIntent.replace(/[\[\]]/g, "");
                uiTreeText = `${uiTreeText}\n[vision-grounded target "${safeLabel}" at POINT:${x1024},${y1024}:${safeLabel}:screen1]`;
              } catch {
                // point_query parse failure or model error — non-fatal, raw screenshot still works
              }
            }
          } catch {
            // Vision optional — continue with raw screenshot
          }
        }
      } catch {
        // UIAutomation or canvas unavailable — graceful fallback: raw screenshot sent, no boxes
      }

      // Pull cross-session memory from SQLite.
      let sqliteMemory = "";
      if (memoryEnabled && !incognitoMode) try {
        type TurnRow = { id: number; user_prompt: string; assistant_response: string; created_at: string };
        type ScoredTurnRow = TurnRow & { score: number };

        const recentPromise = invoke<TurnRow[]>("get_recent_turns", { limit: 3 });

        // Three-tier semantic query: API embedding → WASM embedding → FTS5 keyword.
        // minScore: 0.15 — low enough to recall cross-topic turns for new users,
        // high enough to drop pure noise. Relevance labels tell the AI how to weight each result.
        const relevantPromise = openaiKey
          ? invoke<number[]>("generate_embedding", { text: transcript, apiKey: openaiKey })
              .then((queryEmbedding) =>
                invoke<ScoredTurnRow[]>("search_semantic", { queryEmbedding, limit: 5, minScore: 0.15 })
              )
              .catch(() =>
                embeddingStatus === "ready"
                  ? embed(transcript)
                      .then((qe) => invoke<ScoredTurnRow[]>("search_semantic", { queryEmbedding: qe, limit: 5, minScore: 0.15 }))
                      .catch(() => invoke<TurnRow[]>("search_history", { query: transcript, limit: 3 }).catch(() => []))
                  : invoke<TurnRow[]>("search_history", { query: transcript, limit: 3 }).catch(() => [])
              )
          : embeddingStatus === "ready"
            ? embed(transcript)
                .then((queryEmbedding) =>
                  invoke<ScoredTurnRow[]>("search_semantic", { queryEmbedding, limit: 5, minScore: 0.15 })
                )
                .catch(() =>
                  invoke<TurnRow[]>("search_history", { query: transcript, limit: 3 }).catch(() => [])
                )
            : invoke<TurnRow[]>("search_history", { query: transcript, limit: 3 }).catch(() => []);

        type SessionMetaRow = { date_key: string; label: string | null; summary: string | null };
        const [recent, relevant, sessionMetaRows] = await Promise.all([
          recentPromise,
          relevantPromise,
          invoke<SessionMetaRow[]>("get_session_meta").catch(() => [] as SessionMetaRow[]),
        ]);
        const sessionMetaMap = new Map(sessionMetaRows.map((r) => [r.date_key, r]));
        const seen = new Set<string>();
        const combined = [...recent, ...relevant].filter((t) => {
          const key = t.created_at + t.user_prompt;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        if (combined.length > 0) {
          const relevanceLabel = (score: number) =>
            score >= 0.7 ? "[highly relevant]" : score >= 0.4 ? "[related]" : "[loosely related]";
          sqliteMemory = combined
            .slice(0, 5)
            .map((t) => {
              const dateKey = t.created_at.slice(0, 10);
              const meta = sessionMetaMap.get(dateKey);
              const sessionFrame = meta?.label
                ? `From session "${meta.label}" (${dateKey})`
                : meta?.summary
                ? `From session on ${dateKey} — ${meta.summary}`
                : `From session on ${dateKey}`;
              const relevanceTag = "score" in t ? ` ${relevanceLabel((t as ScoredTurnRow).score)}` : "";
              return `[${sessionFrame}]${relevanceTag} you: ${t.user_prompt} → me: ${t.assistant_response}`;
            })
            .join("\n");
        }
      } catch {
        // DB unavailable — continue without cross-session memory
      } // end memoryEnabled guard

      // Preference learning: inject a derived user model plus liked/disliked examples.
      if (memoryEnabled && preferenceLearningEnabled && !incognitoMode) try {
        const profile = await invoke<PreferenceProfile>("get_preference_profile", { limit: 6 });
        const preferenceGuidance = buildPreferenceGuidance(profile);
        if (preferenceGuidance) {
          sqliteMemory = sqliteMemory
            ? `${sqliteMemory}\n\n${preferenceGuidance}`
            : preferenceGuidance;
        }
      } catch {
        // DB unavailable - continue without preference data.
      }

      // Memory digest — extracted facts about the user across all sessions
      if (memoryEnabled && !incognitoMode) try {
        type DigestFactRow = { id: number; fact: string; category: string; confidence: number };
        const facts = await invoke<DigestFactRow[]>("get_digest_facts", { limit: 10 });
        if (facts.length > 0) {
          const digestText = facts.map((f) => `• ${f.fact}`).join("\n");
          sqliteMemory = `[memory digest — facts about you]\n${digestText}\n\n${sqliteMemory}`;
        }
      } catch {
        // DB unavailable — continue without digest
      }

      sqliteMemoryRef.current = sqliteMemory;

      let ambientContext = "";
      if (useCompanionStore.getState().ambientMode) {
        const rawAmbient = await getAmbientContext(10);
        ambientContext = isAmbientContextRelevant(transcript, rawAmbient) ? rawAmbient : "";
      }

      // Dim 13/16: attach a bounded recent visual-history pack only for
      // temporal/contextual utterances. Text-only providers still get the
      // keyframe timeline, while multimodal providers also see up to 3 thumbs.
      let temporalContext = "";
      let temporalImageKeyframes: number[] = [];
      try {
        const temporalPacket = await getTemporalSnapshotContext({
          maxKeyframes: 24,
          maxChars: 1200,
          maxImages:
            selectedModel.supportsVision && shouldAttachTemporalVisualHistory(transcript)
              ? 3
              : 0,
        });
        temporalContext = temporalPacket.text;
        temporalImageKeyframes = temporalPacket.imageKeyframes;
        if (selectedModel.supportsVision && temporalPacket.images.length > 0) {
          images = [...images, ...temporalPacket.images];
        }
      } catch {
        temporalContext = "";
        temporalImageKeyframes = [];
      }

      const contextDepth = buildContextDepthBlock({
        screens: sorted,
        temporalImageKeyframes,
      });

      const compressedContext = await prepareCompressedContext({
        provider: selectedModel.provider,
        modelId: selectedModel.modelId,
        anthropicKey,
        openaiKey,
        grokKey,
        openrouterKey,
        conversationSummary,
        turns: conversationHistory,
        currentUserPrompt: transcript,
        memoryContext,
        sqliteMemory,
        ocrText,
        uiTreeText,
        sessionNotes,
        systemPromptOverride,
        imageCount: images.length,
        supportsVision: selectedModel.supportsVision,
      });
      if (compressedContext.summaryChanged) {
        replaceConversationContext({
          summary: compressedContext.conversationSummary,
          turns: compressedContext.retainedTurns,
        });
        persistConversationSummary(
          compressedContext,
          selectedModel.provider,
          selectedModel.modelId
        );
      }

      memoryContext = compressedContext.blocks.memoryContext;
      sqliteMemory = compressedContext.blocks.sqliteMemory;
      ocrText = compressedContext.blocks.ocrText;
      uiTreeText = compressedContext.blocks.uiTreeText;

      let fullResponse = "";
      // Sentence-pipelining: flush TTS as each sentence arrives rather than waiting
      // for the full response. Sentence boundaries: [.!?] followed by whitespace.
      let sentenceBuffer = "";
      const SENTENCE_END = /[.!?]\s/;
      // Action log: collects every successfully executed computer-use action this
      // turn (from native Claude/OpenAI loops). Summarised into the saved assistant
      // text so the next turn sees what was actually done, not just final narration.
      const executedActionLog: string[] = [];
      const speechLanguagePrompt = buildSpeechLanguagePrompt(speechLanguage);

      function flushSentence(text: string) {
        const clean = stripPoints(text).trim();
        if (clean) elevenLabs.queueSentence(clean);
      }

      const t0 = Date.now();
      let firstToken = true;
      let nativeStopReason = "end_turn";
      const nativeToolUses: ToolUseBlock[] = [];
      const systemPrompt = buildSystemPrompt({
        memoryContext,
        sqliteMemory,
        ocrText,
        uiTreeText,
        conversationSummary: compressedContext.conversationSummary,
        sessionNotes,
        systemPromptOverride,
        contextDepth,
        ambientContext,
        temporalContext,
        speechLanguagePrompt,
        screenWidth: primaryScreen?.width, screenHeight: primaryScreen?.height,
        numScreens: sorted.length,
      });
      const initialScreenContext = `${ocrText}\n${uiTreeText}`;

      const chatOpts = {
        provider: selectedModel.provider,
        modelId: selectedModel.modelId,
        systemPrompt,
        screenWidth: primaryScreen?.width,
        screenHeight: primaryScreen?.height,
        messages: [
          ...compressedContext.retainedTurns.flatMap((t) => [
            { role: "user" as const, content: t.userPrompt },
            { role: "assistant" as const, content: t.assistantResponse },
          ]),
          { role: "user" as const, content: transcript },
        ],
        images: selectedModel.supportsVision ? images : [],
        telemetryContext: turnContext,
        onToolUse: (toolUse: ToolUseBlock) => {
          nativeToolUses.push(toolUse);
        },
        onStopReason: (stopReason: string) => {
          nativeStopReason = stopReason;
        },
        onChunk: (chunk: string) => {
          if (firstToken) {
            const firstTokenMs = Date.now() - t0;
            setLatencyMs(firstTokenMs);
            recordTelemetryMetric("voice.first_token_ms", firstTokenMs, {
              provider: selectedModel.provider,
              modelId: selectedModel.modelId,
            }, turnContext);
            firstToken = false;
          }
          appendResponse(chunk);
          fullResponse += chunk;
          sentenceBuffer += chunk;
          let idx = sentenceBuffer.search(SENTENCE_END);
          while (idx !== -1) {
            flushSentence(sentenceBuffer.slice(0, idx + 1));
            sentenceBuffer = sentenceBuffer.slice(idx + 2);
            idx = sentenceBuffer.search(SENTENCE_END);
          }
        },
      };

      const useOpenAINativeComputerLoop =
        selectedModel.provider === "openai" &&
        !!primaryScreen &&
        sorted.length === 1 &&
        supportsOpenAIComputerUse(selectedModel.modelId);

      // Retry once on rate-limit (429) or transient server error (5xx)
      console.log("[voice] calling LLM: provider=%s model=%s useOpenAINativeLoop=%s",
        selectedModel.provider, selectedModel.modelId, useOpenAINativeComputerLoop);
      try {
        if (useOpenAINativeComputerLoop && primaryScreen) {
          const initialOpenAIResponse = await sendOpenAIResponse(
            buildOpenAIResponsesComputerBody({
              model: selectedModel.modelId,
              input: buildOpenAIComputerPrompt({
                systemPrompt,
                conversationHistory: compressedContext.retainedTurns,
                transcript,
              }),
              screenWidth: primaryScreen.width,
              screenHeight: primaryScreen.height,
            }),
            turnContext
          );
          const firstTokenMs = Date.now() - t0;
          setLatencyMs(firstTokenMs);
          recordTelemetryMetric("voice.first_token_ms", firstTokenMs, {
            provider: selectedModel.provider,
            modelId: selectedModel.modelId,
          }, turnContext);
          firstToken = false;

          const initialText = extractOpenAIResponseText(initialOpenAIResponse);
          if (initialText) {
            appendResponse(initialText);
            fullResponse += initialText;
            sentenceBuffer += initialText;
          }

          const openAILoopResult = await runOpenAIComputerUseLoop({
            initialResponse: initialOpenAIResponse,
            initialScreens: sorted,
            originalTask: transcript,
            maxSteps: MAX_CU_LOOP_STEPS,
            screenContext: initialScreenContext,
            createResponse: (body) =>
              sendOpenAIResponse(
                buildOpenAIResponsesComputerBody({
                  model: selectedModel.modelId,
                  input: body.input as Array<Record<string, unknown>>,
                  screenWidth: primaryScreen.width,
                  screenHeight: primaryScreen.height,
                  previousResponseId: body.previous_response_id as string | undefined,
                }),
                turnContext
              ),
            executeAction: async (action) => {
              await emit("cu-step", {
                label: describeAgentAction(action),
                max_steps: MAX_CU_LOOP_STEPS,
                safety_tier: 0,
              });
              const beforeShot = await invoke<string>("capture_primary");
              await executeResolvedAgentAction(action);
              await delay(400);
              const afterShot = await invoke<string>("capture_primary");
              const verification = moondreamSessionLoaded
                ? await verifyActionLocal(beforeShot, afterShot, describeAgentAction(action))
                : await verifyAction(beforeShot, afterShot, describeAgentAction(action));
              if (verification.success) {
                executedActionLog.push(describeAgentAction(action));
              }
              await emit("action-verify-result", {
                success: verification.success,
                label: action.label,
                explanation: verification.explanation,
              });
            },
            capturePrimaryScreen: () => invoke<string>("capture_primary"),
            refreshScreenContext: async () => {
              const freshScreens = sortScreens(await captureAllScreens(turnContext));
              const freshPrimary = freshScreens[0];
              const [freshOcrText, { uiTreeText: freshUiTreeText, annotatedScreens }] =
                await Promise.all([
                  readOcrText(freshPrimary),
                  readUiTreeWithSom(freshScreens.length > 0 ? freshScreens : sorted),
                ]);
              return {
                screens: annotatedScreens,
                screenContext: `${freshOcrText}\n${freshUiTreeText}`,
              };
            },
          });

          nativeStopReason = `openai_${openAILoopResult.status}`;
          if (openAILoopResult.status === "blocked") {
            setError(`Action blocked: ${openAILoopResult.blockedReason ?? "computer-use safety policy"}`);
            await emit("cu-safety-blocked", {
              provider: "openai",
              reason: openAILoopResult.blockedReason,
            });
          } else if (openAILoopResult.pendingConfirmation) {
            setPendingComputerAction(openAILoopResult.pendingConfirmation);
            setError(
              `Action paused: ${openAILoopResult.pendingConfirmation.reason}. Say "confirm" to continue or "cancel" to stop.`
            );
            await emit("cu-confirmation-required", {
              action: describeAgentAction(openAILoopResult.pendingConfirmation.action),
              tier: 3,
              reason: openAILoopResult.pendingConfirmation.reason,
            });
          }

          if (openAILoopResult.finalText && openAILoopResult.finalText !== initialText) {
            const separator = fullResponse ? "\n\n" : "";
            appendResponse(`${separator}${openAILoopResult.finalText}`);
            fullResponse += `${separator}${openAILoopResult.finalText}`;
            sentenceBuffer += `${separator}${openAILoopResult.finalText}`;
          }
        } else {
          await streamChat(chatOpts);
        }
      } catch (firstErr) {
        const msg = String(firstErr);
        const isRateLimit = msg.includes("429") || msg.toLowerCase().includes("rate limit") || msg.toLowerCase().includes("too many");
        const isTransient = msg.includes("502") || msg.includes("503") || msg.includes("504") || msg.toLowerCase().includes("network") || msg.toLowerCase().includes("fetch failed");
        if (isRateLimit || isTransient) {
          // For rate limits, wait 2s; for transient errors, retry immediately
          if (isRateLimit) await new Promise<void>((r) => setTimeout(r, 2000));
          // Reset incremental state before retry
          fullResponse = "";
          sentenceBuffer = "";
          firstToken = true;
          setResponse("");
          if (useOpenAINativeComputerLoop) {
            throw firstErr;
          }
          await streamChat(chatOpts);
        } else {
          // Non-retryable error — classify and surface helpful message
          const friendlyMsg =
            msg.includes("401") || msg.toLowerCase().includes("unauthorized") || msg.toLowerCase().includes("invalid x-api-key")
              ? `Invalid API key for ${selectedModel.provider} — check Settings ⚙`
              : msg.includes("403")
              ? `Access denied — verify your ${selectedModel.provider} API key permissions`
              : msg.toLowerCase().includes("model") && msg.toLowerCase().includes("not found")
              ? `Model ${selectedModel.modelId} not found or not available on your plan`
              : msg.slice(0, 140);
          throw new Error(friendlyMsg);
        }
      }
      void nativeStopReason;

      const cleanResponse = stripPoints(fullResponse);
      // If computer-use executed actions this turn, prepend a hidden-style summary
      // so subsequent turns see what was actually done (not just final narration).
      // Without this, the model's "Done!" reply loses all tool context across turns.
      const persistedAssistant = executedActionLog.length > 0
        ? `[Actions taken: ${executedActionLog.join("; ")}]\n\n${cleanResponse}`
        : cleanResponse;
      const completedTurn = {
        clientTurnId: createClientTurnId(),
        userPrompt: transcript,
        assistantResponse: persistedAssistant,
        detectedLang: effectiveSpeechLanguage !== "auto" ? effectiveSpeechLanguage : undefined,
      };

      // Store clean text in history (no [POINT:] tags)
      const turnIndex = useCompanionStore.getState().conversationHistory.length;
      pushConversationTurn(completedTurn);

      // Persist to SQLite + generate semantic embedding in background (non-blocking).
      // Skipped entirely when incognito mode is active.
      // Tier 1: OpenAI API embedding (reliable, requires key).
      // Tier 2: WASM embedding (offline, degrades gracefully if WebView2 WASM crashes).
      if (!incognitoMode) {
        invoke<number>("save_turn", {
          user: transcript,
          assistant: persistedAssistant,
          screenshotB64: null,
        })
          .then((turnId) => {
            updateConversationTurnId(turnIndex, turnId);
            preferenceFeedbackQueue
              .flushTurnId(completedTurn.clientTurnId!, turnId, useCompanionStore.getState())
              .catch(() => {});
            const combinedText = `${transcript} ${persistedAssistant}`;
            if (openaiKey) {
              invoke<number[]>("generate_embedding", { text: combinedText, apiKey: openaiKey })
                .then((embedding) => invoke("save_embedding", { turnId, embedding }))
                .catch(() => embedAndSave(turnId, transcript, persistedAssistant));
            } else {
              embedAndSave(turnId, transcript, persistedAssistant);
            }
          })
          .catch(() => {});

        // Background consolidation: every 5 turns, extract facts into memory digest
        if (memoryEnabled) {
          void (async () => {
            try {
              const count = await invoke<number>("db_turn_count");
              if (count % 5 === 0) {
                const { runConsolidation } = await import("../lib/memoryConsolidation");
                await runConsolidation({
                  anthropicKey,
                  openaiKey,
                  modelId: selectedModel.modelId,
                  provider: selectedModel.provider,
                });
              }
            } catch { /* never block the main response path */ }
          })();
        }
      }

      // Auto-summarize when history exceeds ~6000 tokens (~24000 chars) OR 10 turns.
      // Token estimate: chars / 4. Background — does not block the response.
      const completedHistory = [...compressedContext.retainedTurns, completedTurn];
      void prepareCompressedContext({
        provider: selectedModel.provider,
        modelId: selectedModel.modelId,
        anthropicKey,
        openaiKey,
        grokKey,
        openrouterKey,
        conversationSummary: compressedContext.conversationSummary,
        turns: completedHistory,
        currentUserPrompt: "",
        memoryContext: "",
        sqliteMemory: "",
        ocrText: "",
        uiTreeText: "",
        sessionNotes,
        systemPromptOverride,
        imageCount: 0,
        supportsVision: false,
      }).then((maintenanceContext) => {
        if (!maintenanceContext.summaryChanged) return;
        replaceConversationContext({
          summary: maintenanceContext.conversationSummary,
          turns: maintenanceContext.retainedTurns,
        });
        persistConversationSummary(
          maintenanceContext,
          selectedModel.provider,
          selectedModel.modelId
        );
      });

      if (primaryScreen && selectedModel.provider === "claude" && apiKeyPresence["anthropic"]) {
        await runComputerUseAgentLoop({
          initialResponse: fullResponse,
          initialNativeToolUses: nativeToolUses,
          initialScreens: sorted,
          transcript,
          selectedProvider: selectedModel.provider,
          selectedModelId: selectedModel.modelId,
          conversationSummary: compressedContext.conversationSummary,
          sessionNotes,
          systemPromptOverride,
          speechLanguagePrompt,
          maxCuSteps,
          initialScreenContext,
          uiElements: parsedSomElements,
          setCurrentUiElements,
          sqliteMemory,
          ambientContext,
          moondreamSessionLoaded,
          appendResponse,
          setError,
          setPendingComputerAction,
          telemetryContext: turnContext,
          actionLog: executedActionLog,
        });
      }

      // Flush any remaining text that didn't end at a sentence boundary
      flushSentence(sentenceBuffer);
      recordTelemetryEvent("voice.turn.completed", {
        provider: selectedModel.provider,
        modelId: selectedModel.modelId,
        sttMode,
        speechLanguage: effectiveSpeechLanguage,
        responseLengthBucket: cleanResponse.length < 500 ? "<500" : cleanResponse.length < 2_000 ? "500-2k" : "2k+",
      }, turnContext);
      turnSpan.end({
        provider: selectedModel.provider,
        modelId: selectedModel.modelId,
        sttMode,
        speechLanguage: effectiveSpeechLanguage,
      });
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      console.error("[voice] AI pipeline FAILED. provider=%s model=%s error=%s",
        selectedModel.provider, selectedModel.modelId, rawMsg);
      captureTelemetryError(err, { route: "voice.ai_pipeline", provider: selectedModel.provider, modelId: selectedModel.modelId }, turnContext);
      turnSpan.fail(err, { stage: "ai_pipeline" });
      const msg = rawMsg;
      setError(msg || "AI request failed");
      setVoiceState("idle");
      return;
    }
    setVoiceState("idle");
    setTimeout(() => invoke("hide_overlay"), 8000);
  }, [
    assemblyAI,
    elevenLabs,
    selectedModel,
    anthropicKey,
    openaiKey,
    grokKey,
    openrouterKey,
    apiKeyPresence,
    sttMode,
    speechLanguage,
    conversationHistory,
    conversationSummary,
    sessionNotes,
    pendingComputerAction,
    memoryEnabled,
    preferenceLearningEnabled,
    incognitoMode,
    setCurrentUiElements,
    setVoiceState,
    setTranscript,
    setResponse,
    appendResponse,
    pushConversationTurn,
    replaceConversationContext,
    setConversationSummary,
    setLatencyMs,
    setError,
    setSpeechLanguageDetection,
    setPendingComputerAction,
    clearPendingComputerAction,
    embed,
    embedAndSave,
    embeddingStatus,
  ]);

  const handleWakeSegmentComplete = useCallback(async () => {
    if (!wakeModeEnabledRef.current || wakeSegmentInFlightRef.current) return;
    if (useCompanionStore.getState().voiceState !== "idle") return;

    wakeSegmentInFlightRef.current = true;
    clearWakeRestartTimer();
    setWakeStatus("checking");

    try {
      await invoke("stop_audio");
      const transcript = await invoke<string>("transcribe_local", { languageCode: "en" });
      setWakeLastTranscript(transcript);

      const phrase = wakePhraseRef.current.trim() || DEFAULT_WAKE_PHRASE;
      const matched = transcriptContainsWakePhrase(transcript, phrase, wakeSensitivityRef.current);
      const telemetryProps = {
        sttMode: "Local",
        speechLanguage: "en",
        wakeSensitivity: wakeSensitivityRef.current,
        wakePhraseLength: phrase.length,
        transcriptLengthBucket: transcriptLengthBucket(transcript),
        localOnly: true,
      };

      if (matched) {
        setWakeLastDetectedAt(Date.now());
        setWakeStatus("armed");
        recordTelemetryEvent("wake_word.detected", telemetryProps);
        await invoke("show_overlay").catch(() => {});
        await handleHotkeyDown();
        if (useCompanionStore.getState().voiceState === "idle") {
          scheduleWakeMonitorRestart(500);
        }
      } else {
        recordTelemetryEvent("wake_word.rejected", telemetryProps);
        scheduleWakeMonitorRestart(250);
      }
    } catch (err) {
      console.error("[useVoice] Wake phrase check failed:", err);
      captureTelemetryError(err, { route: "wake_word.segment", sttMode: "Local", speechLanguage: "en" });
      recordTelemetryEvent("wake_word.error", {
        reason: "segment_check_failed",
        sttMode: "Local",
        speechLanguage: "en",
        localOnly: true,
      });
      setWakeStatus("error");
      scheduleWakeMonitorRestart(1_500);
    } finally {
      wakeSegmentInFlightRef.current = false;
    }
  }, [
    clearWakeRestartTimer,
    handleHotkeyDown,
    scheduleWakeMonitorRestart,
    setWakeLastDetectedAt,
    setWakeLastTranscript,
    setWakeStatus,
  ]);

  useEffect(() => {
    let cancelled = false;
    const unlistenDown = listen("hotkey-pressed", handleHotkeyDown).catch(() => () => {});
    const unlistenUp = listen("hotkey-released", handleHotkeyUp).catch(() => () => {});
    Promise.all([unlistenDown, unlistenUp])
      .then(async () => {
        if (cancelled) return;
        const pendingHotkeyEvents = await invoke<PendingHotkeyEvent[]>("drain_pending_hotkey_events").catch(() => []);
        if (cancelled) return;
        for (const pendingEvent of pendingHotkeyEvents) {
          if (pendingEvent === "pressed") {
            await handleHotkeyDown();
          } else {
            await handleHotkeyUp();
          }
        }
      })
      .catch(() => {});
    // VAD auto-stop: when VAD is enabled in audio.rs, end-of-speech fires this
    // event and we treat it exactly like a hotkey release.
    const unlistenVad = listen("vad-end-of-speech", () => {
      const { voiceState } = useCompanionStore.getState();
      if (voiceState === "listening") {
        handleHotkeyUp();
      } else if (voiceState === "idle" && wakeModeEnabledRef.current) {
        handleWakeSegmentComplete();
      }
    }).catch(() => () => {});
    // cpal stream errors (USB mic unplugged, WASAPI exclusive-mode loss) emit
    // mic-stream-error from audio.rs. Without recovery the UI stays in "listening"
    // forever — reset state and surface a clear error.
    const unlistenMicErr = listen<string>("mic-stream-error", (e) => {
      const { voiceState } = useCompanionStore.getState();
      invoke("stop_audio").catch(() => {});
      setVoiceState("idle");
      setError(`Microphone disconnected: ${String(e.payload).slice(0, 100)}. Check your mic and try again.`);
      void voiceState;
    }).catch(() => () => {});
    return () => {
      cancelled = true;
      unlistenDown.then((fn) => fn());
      unlistenUp.then((fn) => fn());
      unlistenVad.then((fn) => fn());
      unlistenMicErr.then((fn) => fn());
    };
  }, [handleHotkeyDown, handleHotkeyUp, handleWakeSegmentComplete, setVoiceState, setError]);

  useEffect(() => {
    if (wakeModeEnabled) return;
    stopWakeMonitor().catch(() => {});
  }, [stopWakeMonitor, wakeModeEnabled]);

  useEffect(() => {
    if (!wakeModeEnabled || voiceState !== "idle") return;
    const timer = setTimeout(() => {
      startWakeMonitor().catch(() => {});
    }, 250);
    return () => clearTimeout(timer);
  }, [startWakeMonitor, voiceState, wakeModeEnabled]);

  // Allow DanteAgents (via ws-speak event) to trigger TTS
  useEffect(() => {
    const unlisten = listen<string>("ws-speak", (event) => {
      const text = event.payload;
      if (text?.trim()) {
        elevenLabs.queueSentence(text.trim());
      }
    }).catch(() => () => {});
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [elevenLabs]);

  // PendingActionCard UI confirm/cancel — emitted by the button clicks in CompanionPanel.
  // This is the bridge that makes the card buttons actually execute the action.
  useEffect(() => {
    let unlistenConfirm: (() => void) | undefined;
    let unlistenCancel: (() => void) | undefined;

    listen("pending-action-ui-confirm", async () => {
      const state = useCompanionStore.getState();
      const captured = state.pendingComputerAction;
      if (!captured) return;

      state.clearPendingComputerAction();
      const verification = await executeConfirmedPendingAction(captured.action);
      state.setVerificationResult({ success: verification.success, explanation: verification.explanation });
      setTimeout(() => useCompanionStore.getState().setVerificationResult(null), 4000);
      const msg = verification.success
        ? `confirmed. ${verification.explanation || "done."}`
        : `tried it — ${verification.explanation}`;
      state.setResponse(msg);
      elevenLabs.queueSentence(msg);

      if (verification.success && state.selectedModel.provider === "claude" && state.apiKeyPresence?.["anthropic"]) {
        const freshScreens = sortScreens(await captureAllScreens());
        if (freshScreens.length > 0) {
          await runComputerUseAgentLoop({
            initialResponse: "",
            initialNativeToolUses: [],
            initialScreens: freshScreens,
            transcript: captured.originalTask,
            selectedProvider: state.selectedModel.provider,
            selectedModelId: state.selectedModel.modelId,
            conversationSummary: state.conversationSummary,
            sessionNotes: state.sessionNotes,
            systemPromptOverride: state.systemPromptOverride,
            speechLanguagePrompt: buildSpeechLanguagePrompt(state.speechLanguage),
            maxCuSteps: state.maxCuSteps,
            uiElements: state.currentUiElements,
            setCurrentUiElements: state.setCurrentUiElements,
            sqliteMemory: sqliteMemoryRef.current,
            appendResponse: state.appendResponse,
            setError: state.setError,
            setPendingComputerAction: state.setPendingComputerAction,
            ambientContext: await (async () => {
              if (!useCompanionStore.getState().ambientMode) return "";
              const raw = await getAmbientContext(10);
              return isAmbientContextRelevant(captured.originalTask, raw) ? raw : "";
            })(),
            moondreamSessionLoaded: state.moondreamSessionLoaded,
          });
        }
      }

      if (
        verification.success &&
        state.selectedModel.provider === "openai" &&
        captured.resume?.provider === "openai" &&
        captured.resume.previousResponseId &&
        captured.resume.providerCallId
      ) {
        const freshScreens = sortScreens(await captureAllScreens());
        const freshPrimary = freshScreens[0];
        if (freshPrimary) {
          const afterShot = await invoke<string>("capture_primary");
          const resumedResponse = await sendOpenAIResponse(
            buildOpenAIResponsesComputerBody({
              model: state.selectedModel.modelId,
              input: [
                buildOpenAIComputerCallOutput(
                  captured.resume.providerCallId,
                  afterShot
                ),
              ],
              screenWidth: freshPrimary.width,
              screenHeight: freshPrimary.height,
              previousResponseId: captured.resume.previousResponseId,
            })
          );
          const [freshOcrText, { uiTreeText: freshUiTreeText, annotatedScreens: somFreshScreens }] =
            await Promise.all([
              readOcrText(freshPrimary),
              readUiTreeWithSom(freshScreens),
            ]);
          const resumedLoop = await runOpenAIComputerUseLoop({
            initialResponse: resumedResponse,
            initialScreens: somFreshScreens,
            originalTask: captured.originalTask,
            maxSteps: state.maxCuSteps,
            screenContext: `${freshOcrText}\n${freshUiTreeText}`,
            createResponse: (body) =>
              sendOpenAIResponse(
                buildOpenAIResponsesComputerBody({
                  model: state.selectedModel.modelId,
                  input: body.input as Array<Record<string, unknown>>,
                  screenWidth: freshPrimary.width,
                  screenHeight: freshPrimary.height,
                  previousResponseId: body.previous_response_id as string | undefined,
                })
              ),
            executeAction: executeResolvedAgentAction,
            capturePrimaryScreen: () => invoke<string>("capture_primary"),
            refreshScreenContext: async () => {
              const refreshedScreens = sortScreens(await captureAllScreens());
              const refreshedPrimary = refreshedScreens[0] ?? freshPrimary;
              const [refreshedOcrText, { uiTreeText: refreshedUiTreeText, annotatedScreens }] =
                await Promise.all([
                  readOcrText(refreshedPrimary),
                  readUiTreeWithSom(refreshedScreens.length > 0 ? refreshedScreens : somFreshScreens),
                ]);
              return {
                screens: annotatedScreens,
                screenContext: `${refreshedOcrText}\n${refreshedUiTreeText}`,
              };
            },
          });

          if (resumedLoop.status === "blocked") {
            state.setError(`Action blocked: ${resumedLoop.blockedReason ?? "computer-use safety policy"}`);
            await emit("cu-safety-blocked", {
              provider: "openai",
              reason: resumedLoop.blockedReason,
            });
          } else if (resumedLoop.pendingConfirmation) {
            state.setPendingComputerAction(resumedLoop.pendingConfirmation);
            state.setError(
              `Action paused: ${resumedLoop.pendingConfirmation.reason}. Say "confirm" to continue or "cancel" to stop.`
            );
          }
          if (resumedLoop.finalText) {
            state.appendResponse(`\n\n${resumedLoop.finalText}`);
            elevenLabs.queueSentence(resumedLoop.finalText);
          }
        }
      }

      state.setVoiceState("idle");
      setTimeout(() => invoke("hide_overlay").catch(() => {}), 3000);
    }).then((fn) => { unlistenConfirm = fn; }).catch(() => {});

    listen("pending-action-ui-cancel", () => {
      const state = useCompanionStore.getState();
      state.clearPendingComputerAction();
      state.setVoiceState("idle");
      invoke("hide_overlay").catch(() => {});
    }).then((fn) => { unlistenCancel = fn; }).catch(() => {});

    return () => {
      unlistenConfirm?.();
      unlistenCancel?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elevenLabs]);

  // On startup (or when OpenAI key is first set): background-index historical turns
  // so semantic recall works immediately, not just for turns created this session.
  // Batches of 5 with 300ms gaps — stays well within OpenAI's 3000 RPM rate limit.
  useEffect(() => {
    if (!openaiKey) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    type IndexTurnRow = { id: number; user_prompt: string; assistant_response: string; created_at: string };
    const BATCH_SIZE = 5;
    const runDeferredIndex = async () => {
      try {
        const unembedded = await invoke<IndexTurnRow[]>("get_unembedded_turns", { limit: 200 });
        for (let i = 0; i < unembedded.length; i += BATCH_SIZE) {
          if (cancelled) break;
          const batch = unembedded.slice(i, i + BATCH_SIZE);
          await Promise.all(
            batch.map(async (turn) => {
              try {
                const combinedText = `${turn.user_prompt} ${turn.assistant_response}`;
                const embedding = await invoke<number[]>("generate_embedding", { text: combinedText, apiKey: openaiKey });
                await invoke("save_embedding", { turnId: turn.id, embedding });
              } catch { /* best-effort: single-turn failure does not stop batch */ }
            })
          );
          if (i + BATCH_SIZE < unembedded.length && !cancelled) {
            await new Promise<void>((r) => setTimeout(r, 300));
          }
        }
      } catch { /* non-fatal */ }
    };
    timer = setTimeout(() => {
      runDeferredIndex();
    }, 10_000);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [openaiKey]);

  // WASM path: background-index when offline model becomes ready and no OpenAI key is set.
  // Sequential within each batch — WASM embedder is single-threaded.
  useEffect(() => {
    if (openaiKey || embeddingStatus !== "ready") return;
    let cancelled = false;
    type IndexTurnRow = { id: number; user_prompt: string; assistant_response: string; created_at: string };
    const BATCH_SIZE = 5;
    (async () => {
      try {
        const unembedded = await invoke<IndexTurnRow[]>("get_unembedded_turns", { limit: 200 });
        for (let i = 0; i < unembedded.length; i += BATCH_SIZE) {
          if (cancelled) break;
          const batch = unembedded.slice(i, i + BATCH_SIZE);
          for (const turn of batch) {
            if (cancelled) break;
            try {
              await embedAndSave(turn.id, turn.user_prompt, turn.assistant_response);
            } catch { /* best-effort */ }
          }
          if (i + BATCH_SIZE < unembedded.length && !cancelled) {
            await new Promise<void>((r) => setTimeout(r, 200));
          }
        }
      } catch { /* non-fatal */ }
    })();
    return () => { cancelled = true; };
  }, [openaiKey, embeddingStatus, embedAndSave]);
}

interface PreparedCompressedContext extends CompressedContextPlan {
  summaryChanged: boolean;
}

interface PrepareCompressedContextInput {
  provider: ProviderType;
  modelId: string;
  anthropicKey: string;
  openaiKey: string;
  grokKey: string;
  openrouterKey: string;
  conversationSummary: string;
  turns: ConversationTurn[];
  currentUserPrompt: string;
  memoryContext: string;
  sqliteMemory: string;
  ocrText: string;
  uiTreeText: string;
  sessionNotes: string;
  systemPromptOverride: string;
  imageCount?: number;
  supportsVision?: boolean;
}

async function prepareCompressedContext(
  input: PrepareCompressedContextInput
): Promise<PreparedCompressedContext> {
  const initialPlan = buildCompressedContext(input);
  if (!initialPlan.shouldCompress || initialPlan.turnsToSummarize.length === 0) {
    return { ...initialPlan, summaryChanged: false };
  }

  const summaryUpdate = await summarizeOldTurns(initialPlan.turnsToSummarize, {
    provider: input.provider,
    modelId: input.modelId,
    anthropicKey: input.anthropicKey,
    openaiKey: input.openaiKey,
    grokKey: input.grokKey,
    openrouterKey: input.openrouterKey,
  });
  let nextSummary = mergeRunningSummary(input.conversationSummary, summaryUpdate);
  if (estimateTokens(nextSummary) > SUMMARY_RECOMPRESS_TOKENS) {
    nextSummary =
      (await compressSummary(nextSummary, {
        provider: input.provider,
        modelId: input.modelId,
        anthropicKey: input.anthropicKey,
        openaiKey: input.openaiKey,
        grokKey: input.grokKey,
        openrouterKey: input.openrouterKey,
      })) ?? nextSummary;
  }

  const finalPlan = buildCompressedContext({
    ...input,
    turns: initialPlan.retainedTurns,
    conversationSummary: nextSummary,
  });

  return {
    ...finalPlan,
    conversationSummary: nextSummary,
    retainedTurns: initialPlan.retainedTurns,
    turnsToSummarize: initialPlan.turnsToSummarize,
    estimatedTokensBefore: initialPlan.estimatedTokensBefore,
    summaryChanged: nextSummary.trim() !== input.conversationSummary.trim(),
  };
}

function persistConversationSummary(
  context: PreparedCompressedContext,
  provider: ProviderType,
  modelId: string
) {
  if (!context.conversationSummary.trim()) return;
  const { coveredTurnStartId, coveredTurnEndId } = getCoveredTurnRange(
    context.turnsToSummarize
  );
  void invoke("save_conversation_summary", {
    summary: context.conversationSummary,
    coveredTurnStartId,
    coveredTurnEndId,
    estimatedTokensBefore: context.estimatedTokensBefore,
    estimatedTokensAfter: context.estimatedTokensAfter,
    provider,
    model: modelId,
    schemaVersion: context.schemaVersion,
  }).catch(() => {});
}

interface RunComputerUseAgentLoopOptions {
  initialResponse: string;
  initialNativeToolUses: ToolUseBlock[];
  initialScreens: CapturedScreen[];
  transcript: string;
  selectedProvider: string;
  selectedModelId: string;
  conversationSummary: string;
  sessionNotes: string;
  systemPromptOverride?: string;
  speechLanguagePrompt?: string;
  maxCuSteps?: number;
  initialScreenContext?: string;
  uiElements?: UiElement[];
  setCurrentUiElements?: (elements: UiElement[]) => void;
  sqliteMemory?: string;
  ambientContext?: string;
  moondreamSessionLoaded?: boolean;
  appendResponse: (chunk: string) => void;
  setError: (msg: string) => void;
  setPendingComputerAction: (pending: ReturnType<typeof createPendingComputerAction>) => void;
  telemetryContext?: TelemetryContext;
  /**
   * Optional mutable sink. Each successfully executed action's human-readable
   * description (`describeAgentAction`) is pushed here. The caller summarises
   * the array into the persisted assistant turn so the next turn sees what
   * was actually done — without this, the model only sees its own final
   * narration and loses tool-use context across turns.
   */
  actionLog?: string[];
}

async function runComputerUseAgentLoop(
  opts: RunComputerUseAgentLoopOptions
): Promise<void> {
  let currentResponse = opts.initialResponse;
  let currentScreens = opts.initialScreens;
  let currentNativeToolUses = opts.initialNativeToolUses;
  let currentScreenContext = opts.initialScreenContext ?? "";
  let stepsTaken = 0;
  let stopReason = "no_executable_action";
  const repeatCounts = new Map<string, number>();
  const maxSteps = opts.maxCuSteps ?? MAX_CU_LOOP_STEPS;
  let consecutiveFailures = 0;
  const loopSpan = startTelemetrySpan("agent.computer_loop", {
    provider: opts.selectedProvider,
    modelId: opts.selectedModelId,
    maxSteps,
  }, opts.telemetryContext);

  try {
    while (stepsTaken < maxSteps) {
      const currentPrimaryScreen = currentScreens[0];
      const nativeActions =
        opts.selectedProvider === "claude" && currentPrimaryScreen
          ? currentNativeToolUses.flatMap((toolUse) =>
              claudeToolUseToAgentActions(toolUse, {
                screenWidth: currentPrimaryScreen.width,
                screenHeight: currentPrimaryScreen.height,
              })
            )
          : [];
      const availableActions =
        nativeActions.length > 0 ? nativeActions : extractAgentActionsWithElements(currentResponse, opts.uiElements ?? []);
      if (!hasExecutableAction(availableActions)) {
        stopReason = "model_done";
        break;
      }

      const nextAction = availableActions.find((action) => action.kind !== "none");
      if (!nextAction) {
        stopReason = "model_done";
        break;
      }

      currentScreens =
        stepsTaken === 0 ? currentScreens : await recaptureScreens(currentScreens);
      const resolvedAction = resolveAgentAction(nextAction, currentScreens);
      const safety = classifyAgentActionSafety(
        nextAction,
        opts.transcript,
        currentResponse,
        { screenContext: currentScreenContext }
      );
      recordTelemetryEvent("agent.safety_decision", {
        decision: safety.decision,
        tier: safety.tier,
        actionKind: nextAction.kind,
      }, loopSpan.context);

      if (safety.decision !== "allow") {
        stopReason = `safety_${safety.decision}`;
        if (safety.decision === "block") {
          opts.setError(`Action blocked: ${safety.reason}`);
          await emit("cu-safety-stop", {
            action: describeAgentAction(nextAction),
            tier: safety.tier,
            reason: safety.reason,
          });
          await emit("cu-safety-blocked", {
            action: describeAgentAction(nextAction),
            tier: safety.tier,
            reason: safety.reason,
          });
          break;
        }

        opts.setError(`Action paused: ${safety.reason}. Say "confirm" to continue or "cancel" to stop.`);
        opts.setPendingComputerAction(
          createPendingComputerAction({
            action: resolvedAction,
            originalTask: opts.transcript,
            reason: safety.reason,
            tier: safety.tier,
          })
        );
        await emit("cu-safety-stop", {
          action: describeAgentAction(nextAction),
          tier: safety.tier,
          reason: safety.reason,
        });
        await emit("cu-confirmation-required", {
          action: describeAgentAction(nextAction),
          tier: safety.tier,
          reason: safety.reason,
        });
        break;
      }

      const actionFingerprint = fingerprintAction(resolvedAction);
      const repeatCount = repeatCounts.get(actionFingerprint) ?? 0;
      if (repeatCount >= 2) {
        stopReason = "repeated_action_guard";
        opts.setError(`Action loop paused: repeated ${describeAgentAction(nextAction)}`);
        break;
      }
      repeatCounts.set(actionFingerprint, repeatCount + 1);

      stepsTaken++;
      recordTelemetryEvent("agent.step.started", {
        step: stepsTaken,
        maxSteps,
        actionKind: nextAction.kind,
        safetyTier: safety.tier,
      }, loopSpan.context);
      await emit("cu-step", {
        step: stepsTaken,
        max_steps: MAX_CU_LOOP_STEPS,
        label: describeAgentAction(nextAction),
        safety_tier: safety.tier,
      });

      let verification: { success: boolean; explanation: string };
      let afterShot: string;
      if (resolvedAction.kind === "screenshot") {
        afterShot = await invoke<string>("capture_primary");
        verification = { success: true, explanation: "screenshot captured" };
      } else {
        const beforeShot = await invoke<string>("capture_primary");
        await executeResolvedAgentAction(resolvedAction);
        await delay(400);
        afterShot = await invoke<string>("capture_primary");
        verification = opts.moondreamSessionLoaded
          ? await verifyActionLocal(beforeShot, afterShot, describeAgentAction(nextAction))
          : await verifyAction(beforeShot, afterShot, describeAgentAction(nextAction));
      }

      await emit("action-verify-result", {
        success: verification.success,
        label: nextAction.label,
        explanation: verification.explanation,
        step: stepsTaken,
      });
      recordTelemetryEvent("agent.action_verified", {
        success: verification.success,
        step: stepsTaken,
        actionKind: nextAction.kind,
      }, loopSpan.context);

      if (verification.success) {
        opts.actionLog?.push(describeAgentAction(nextAction));
        consecutiveFailures = 0;
        const cuState = useCompanionStore.getState();
        if (shouldUsePreferenceLearning(cuState)) {
          const latestTurn = cuState.conversationHistory.at(-1);
          if (latestTurn) {
            preferenceFeedbackQueue.recordForTurn(
              { id: latestTurn.id, clientTurnId: latestTurn.clientTurnId },
              { signal: "action_succeeded", reason: "computer use action executed and verified successfully" },
              cuState
            ).catch(() => {});
          }
        }
      } else {
        consecutiveFailures++;
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          stopReason = "consecutive_failures";
          opts.setError(
            `Computer-use paused: ${consecutiveFailures} consecutive actions failed. The task may require a different approach.`
          );
          break;
        }
      }

      currentScreens = await recaptureScreens(currentScreens);
      const freshPrimaryScreen = currentScreens[0];
      const [freshOcrText, { uiTreeText: freshUiTreeText, annotatedScreens: loopAnnotatedScreens }] = await Promise.all([
        readOcrTextForScreens(currentScreens),
        readUiTreeWithSom(currentScreens),
      ]);
      currentScreens = loopAnnotatedScreens;
      currentScreenContext = `${freshOcrText}\n${freshUiTreeText}`;
      // Parse fresh elements so [ELEM:N] resolution uses current-step coordinates, not step-1 coords
      const freshLoopElements = parseUiTree(freshUiTreeText);
      if (freshLoopElements.length > 0) opts.setCurrentUiElements?.(freshLoopElements);

      let loopResponse = "";
      const loopNativeToolUses: ToolUseBlock[] = [];
      await streamChat({
        provider: opts.selectedProvider,
        modelId: opts.selectedModelId,
        systemPrompt: buildSystemPrompt({
          memoryContext: "",
          sqliteMemory: opts.sqliteMemory,
          conversationSummary: opts.conversationSummary,
          sessionNotes: opts.sessionNotes,
          systemPromptOverride: opts.systemPromptOverride,
          speechLanguagePrompt: opts.speechLanguagePrompt,
          contextDepth: buildContextDepthBlock({ screens: currentScreens }),
          ambientContext: opts.ambientContext,
          ocrText: freshOcrText,
          uiTreeText: freshUiTreeText,
          screenWidth: freshPrimaryScreen?.width,
          screenHeight: freshPrimaryScreen?.height,
          numScreens: currentScreens.length,
        }),
        messages: buildLoopMessages({
          originalTask: opts.transcript,
          currentResponse,
          currentNativeToolUses,
          resolvedAction,
          verification,
          stepNumber: stepsTaken,
          afterShot,
        }),
        images: currentScreens.map((screen) => screen.data),
        onToolUse: (toolUse) => {
          loopNativeToolUses.push(toolUse);
        },
        onChunk: (chunk) => {
          loopResponse += chunk;
        },
        telemetryContext: loopSpan.context,
      });

      const cleanLoopResponse = stripPoints(loopResponse);
      if (cleanLoopResponse) {
        opts.appendResponse(`\n\n${cleanLoopResponse}`);
      }

      currentResponse = loopResponse;
      currentNativeToolUses = loopNativeToolUses;
      const nextNativeActions =
        opts.selectedProvider === "claude" && freshPrimaryScreen
          ? currentNativeToolUses.flatMap((toolUse) =>
              claudeToolUseToAgentActions(toolUse, {
                screenWidth: freshPrimaryScreen.width,
                screenHeight: freshPrimaryScreen.height,
              })
            )
          : [];
      const nextActions =
        nextNativeActions.length > 0 ? nextNativeActions : extractAgentActionsWithElements(currentResponse, freshLoopElements.length > 0 ? freshLoopElements : (opts.uiElements ?? []));
      if (!hasExecutableAction(nextActions)) {
        stopReason = verification.success ? "complete" : "blocked_after_verification";
        break;
      }
    }

    if (stepsTaken >= maxSteps) {
      stopReason = "max_steps";
    }
  } catch (err) {
    stopReason = "error";
    const message = err instanceof Error ? err.message : String(err);
    captureTelemetryError(err, { route: "agent.computer_loop", provider: opts.selectedProvider }, loopSpan.context);
    loopSpan.fail(err, { stepsTaken });
    opts.setError(`Computer-use loop stopped: ${message.slice(0, 140)}`);
  } finally {
    recordTelemetryEvent("agent.loop.completed", {
      provider: opts.selectedProvider,
      modelId: opts.selectedModelId,
      stepsTaken,
      stopReason,
    }, loopSpan.context);
    loopSpan.end({ stepsTaken, stopReason });
    await emit("cu-done", { steps_taken: stepsTaken, stop_reason: stopReason }).catch(
      () => {}
    );
  }
}

function buildLoopMessages(input: {
  originalTask: string;
  currentResponse: string;
  currentNativeToolUses: ToolUseBlock[];
  resolvedAction: ResolvedAgentAction;
  verification: { success: boolean; explanation: string };
  stepNumber: number;
  afterShot: string;
}): ChatMessage[] {
  const nativeToolUse = input.currentNativeToolUses.find(
    (toolUse) => toolUse.id === input.resolvedAction.providerCallId
  );

  if (nativeToolUse) {
    return [
      { role: "user", content: input.originalTask },
      {
        role: "assistant",
        content: input.currentNativeToolUses.map((toolUse) => ({
          type: "tool_use",
          id: toolUse.id,
          name: toolUse.name,
          input: toolUse.input,
        })),
      },
      {
        role: "user",
        content: [
          buildClaudeComputerToolResult(nativeToolUse.id, {
            text: buildVerificationResultText(
              describeAgentAction(input.resolvedAction),
              input.verification
            ),
            screenshotBase64: input.afterShot,
          }) as unknown as Record<string, unknown>,
        ],
      },
    ];
  }

  return [
    { role: "user", content: input.originalTask },
    { role: "assistant", content: input.currentResponse },
    {
      role: "user",
      content: buildLoopContinuationPrompt({
        originalTask: input.originalTask,
        stepNumber: input.stepNumber,
        maxSteps: MAX_CU_LOOP_STEPS,
        action: input.resolvedAction,
        verification: input.verification,
      }),
    },
  ];
}

async function executeConfirmedPendingAction(
  action: ResolvedAgentAction
): Promise<{ success: boolean; explanation: string }> {
  const beforeShot = await invoke<string>("capture_primary");
  await executeResolvedAgentAction(action);
  await delay(400);
  const afterShot = await invoke<string>("capture_primary");
  return verifyActionLocal(beforeShot, afterShot, describeAgentAction(action));
}

async function executeResolvedAgentAction(action: ResolvedAgentAction): Promise<void> {
  // Phase B2 — fire a video capture-now request immediately AFTER the action
  // executes so the timeline has a labeled keyframe pinned to the cause.
  // This is best-effort: if video isn't running, the Tauri command no-ops.
  const fireActionKeyframe = async () => {
    try {
      await invoke<number>("video_capture_now", { label: describeAgentAction(action) });
      recordTelemetryEvent("video.action_keyframe", {
        action_kind: action.kind,
      });
    } catch {
      // Non-fatal: video subsystem may not be running.
    }
  };

  if (action.kind === "screenshot") {
    return;
  }

  if (action.kind === "wait") {
    await delay(action.waitMs ?? 800);
    return;
  }

  if (action.kind === "key") {
    await invoke("computer_use_keypress", { keys: parseKeyChord(action.key ?? "") });
    await fireActionKeyframe();
    return;
  }

  if (action.kind === "type" && (action.absoluteX === null || action.absoluteY === null)) {
    await invoke("computer_use_type", { text: action.text ?? "" });
    await fireActionKeyframe();
    return;
  }

  if (action.absoluteX === null || action.absoluteY === null) {
    throw new Error(`Cannot execute ${describeAgentAction(action)} without coordinates`);
  }

  await invoke("animate_cursor_to", { x: action.absoluteX, y: action.absoluteY });
  await delay(600);

  if (action.kind === "scroll") {
    await invoke("computer_use_scroll", {
      x: action.absoluteX,
      y: action.absoluteY,
      delta: action.scrollDelta ?? 0,
    });
    await fireActionKeyframe();
    return;
  }

  if (action.kind === "drag") {
    if (action.targetAbsoluteX == null || action.targetAbsoluteY == null) {
      throw new Error(`Cannot execute ${describeAgentAction(action)} without target coordinates`);
    }
    await invoke("computer_use_drag", {
      x1: action.absoluteX,
      y1: action.absoluteY,
      x2: action.targetAbsoluteX,
      y2: action.targetAbsoluteY,
    });
    await fireActionKeyframe();
    return;
  }

  if (action.kind === "double_click") {
    await invoke("computer_use_double_click", { x: action.absoluteX, y: action.absoluteY });
    await fireActionKeyframe();
    return;
  }

  if (action.kind === "triple_click") {
    await invoke("computer_use_triple_click", { x: action.absoluteX, y: action.absoluteY });
    await fireActionKeyframe();
    return;
  }

  if (action.kind === "right_click") {
    await invoke("computer_use_right_click", { x: action.absoluteX, y: action.absoluteY });
    await fireActionKeyframe();
    return;
  }

  if (action.kind === "middle_click") {
    await invoke("computer_use_middle_click", { x: action.absoluteX, y: action.absoluteY });
    await fireActionKeyframe();
    return;
  }

  if (action.kind === "type") {
    await invoke("computer_use_click", { x: action.absoluteX, y: action.absoluteY });
    await delay(150);
    await invoke("computer_use_type", { text: action.text ?? "" });
    await fireActionKeyframe();
    return;
  }

  if (action.kind === "move") {
    await invoke("computer_use_move", { x: action.absoluteX, y: action.absoluteY });
    await fireActionKeyframe();
    return;
  }

  await invoke("computer_use_click", { x: action.absoluteX, y: action.absoluteY });
  await fireActionKeyframe();
}

function parseKeyChord(keyText: string): string[] {
  return keyText
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
}

async function recaptureScreens(
  fallbackScreens: CapturedScreen[]
): Promise<CapturedScreen[]> {
  const freshScreens = sortScreens(await captureAllScreens());
  return freshScreens.length > 0 ? freshScreens : fallbackScreens;
}

async function readOcrText(screen: CapturedScreen | undefined): Promise<string> {
  if (!screen) return "";
  try {
    return await invoke<string>("ocr_screenshot", { jpegB64: screen.data });
  } catch {
    return "";
  }
}

async function readOcrTextForScreens(screens: CapturedScreen[]): Promise<string> {
  if (screens.length === 0) return "";
  const entries = await Promise.all(
    screens.map(async (screen) => ({
      screen,
      text: await readOcrText(screen),
    }))
  );
  return renderMultiScreenOcrContext(entries);
}

async function readUiTreeWithSom(
  screens: CapturedScreen[]
): Promise<{ uiTreeText: string; annotatedScreens: CapturedScreen[] }> {
  if (screens.length === 0) return { uiTreeText: "", annotatedScreens: screens };
  try {
    const rawElements = await invoke<
      Array<{
        name: string; role: string;
        x: number; y: number; width: number; height: number;
        enabled: boolean; checked: string | null; value: string | null;
        expanded: string | null; focused: boolean;
        selected: boolean | null; automation_id: string | null; scroll_pct?: number | null;
      }>
    >("get_ui_tree");
    if (rawElements.length === 0) return { uiTreeText: "", annotatedScreens: screens };
    const annotatedScreens = [...screens];
    const allElements: Awaited<ReturnType<typeof annotateSom>>["elements"] = [];
    let indexOffset = 0;
    for (let i = 0; i < screens.length; i++) {
      const screen = screens[i];
      const localElements = rawElements
        .filter((el) => elementCenterIsOnScreen(el, screen))
        .map((el) => ({
          ...el,
          x: el.x - screen.x,
          y: el.y - screen.y,
        }));
      if (localElements.length === 0) continue;
      const somResult = await annotateSom(
        screen.data,
        localElements,
        screen.width,
        screen.height,
        screen.label ?? `screen${i + 1}`
      );
      annotatedScreens[i] = { ...screen, data: somResult.annotatedBase64 };
      allElements.push(
        ...somResult.elements.map((element) => ({
          ...element,
          index: element.index + indexOffset,
        }))
      );
      indexOffset = allElements.length;
    }
    const uiTreeText = buildSomSystemPromptSection(allElements);
    return { uiTreeText, annotatedScreens };
  } catch {
    return { uiTreeText: "", annotatedScreens: screens };
  }
}

function elementCenterIsOnScreen(
  element: { x: number; y: number; width: number; height: number },
  screen: CapturedScreen
): boolean {
  const cx = element.x + element.width / 2;
  const cy = element.y + element.height / 2;
  return (
    cx >= screen.x &&
    cx <= screen.x + screen.width &&
    cy >= screen.y &&
    cy <= screen.y + screen.height
  );
}

function fingerprintAction(action: ResolvedAgentAction): string {
  return [
    action.kind,
    action.label,
    action.screenLabel,
    action.absoluteX ?? "none",
    action.absoluteY ?? "none",
    action.text ?? "",
    action.scrollDelta ?? "",
  ].join("|");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function supportsOpenAIComputerUse(modelId: string): boolean {
  const normalized = modelId.toLowerCase();
  return (
    normalized.startsWith("gpt-4o") ||
    normalized.startsWith("gpt-5") ||
    normalized.startsWith("o3") ||
    normalized.startsWith("o4") ||
    normalized.startsWith("computer-use")
  );
}

function buildOpenAIComputerPrompt(input: {
  systemPrompt: string;
  conversationHistory: Array<{ userPrompt: string; assistantResponse: string }>;
  transcript: string;
}): string {
  const recentTurns = input.conversationHistory
    .slice(-6)
    .map((turn) => `user: ${turn.userPrompt}\nassistant: ${turn.assistantResponse}`)
    .join("\n\n");

  return [
    input.systemPrompt,
    recentTurns ? `[recent conversation]\n${recentTurns}\n[/recent conversation]` : "",
    `[current user request]\n${input.transcript}\n[/current user request]`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

