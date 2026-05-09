import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PendingComputerAction } from "../lib/agentLoop";
import type { SpeechLanguageCode, SpeechRecognitionMode } from "../lib/speechLanguages";
import type { UiElement } from "../lib/uiTreeParser";
import { DEFAULT_WAKE_PHRASE, type WakeSensitivity, type WakeStatus } from "../lib/wakeWord";

export type VoiceState = "idle" | "listening" | "processing" | "responding";
export type ProviderType = "claude" | "openai" | "grok";

export interface SpeechLanguageDetection {
  mode: SpeechRecognitionMode;
  selectedLanguage: SpeechLanguageCode;
  detectedLanguageCode: string | null;
  languageConfidence: number | null;
  statusLabel: string;
}

export interface ModelOption {
  provider: ProviderType;
  modelId: string;
  displayName: string;
  supportsVision: boolean;
}

export const MODEL_OPTIONS: ModelOption[] = [
  { provider: "claude", modelId: "claude-sonnet-4-6",         displayName: "Claude Sonnet 4.6", supportsVision: true },
  { provider: "claude", modelId: "claude-opus-4-7",           displayName: "Claude Opus 4.7",   supportsVision: true },
  { provider: "claude", modelId: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5",  supportsVision: true },
  { provider: "openai", modelId: "gpt-4o",                    displayName: "GPT-4o",            supportsVision: true },
  { provider: "openai", modelId: "o3",                        displayName: "OpenAI o3",         supportsVision: true },
  { provider: "grok",   modelId: "grok-2-vision-1212",        displayName: "Grok 2 Vision",     supportsVision: true },
  { provider: "grok",   modelId: "grok-3",                    displayName: "Grok 3",            supportsVision: false },
];

export interface ConversationTurn {
  id?: number;
  clientTurnId?: string;
  userPrompt: string;
  assistantResponse: string;
  detectedLang?: string;
}

interface CompanionState {
  // Runtime state (not persisted)
  voiceState: VoiceState;
  transcript: string;
  response: string;
  conversationHistory: ConversationTurn[];
  lastError: string;
  latencyMs: number | null;
  lastResponseMs: number | null;
  pendingComputerAction: PendingComputerAction | null;
  verificationResult: { success: boolean; explanation: string } | null;
  currentUiElements: UiElement[];
  speechLanguageDetection: SpeechLanguageDetection | null;
  lastAmbientWindow: string;
  lastAmbientTs: number | null;
  ambientCapturesToday: number;
  ambientCaptureDurationsMs: number[]; // rolling window, last 20 completed captures
  moondreamInferenceDurationsMs: number[]; // rolling window, last 20 completed inferences (caption/vqa/point_query)
  wakeStatus: WakeStatus;
  wakeLastDetectedAt: number | null;
  wakeLastTranscript: string;

  // User settings (persisted to localStorage)
  selectedModel: ModelOption;
  anthropicKey: string;
  openaiKey: string;
  grokKey: string;
  elevenLabsKey: string;
  assemblyAiKey: string;
  hotkeyBinding: string;
  hotkeyCombo: string;

  // TTS mode (persisted to localStorage)
  ttsMode: "cloud" | "local";

  // ElevenLabs voice (persisted)
  elevenLabsVoiceId: string;
  elevenLabsCustomVoiceId: string;
  elevenLabsModel: "eleven_flash_v2_5" | "eleven_turbo_v2_5" | "eleven_multilingual_v2";
  ttsQuality: "fast" | "balanced" | "max";

  // VAD auto-stop — when true, recording stops automatically on silence
  vadEnabled: boolean;
  speechLanguage: SpeechLanguageCode;
  sttMode: SpeechRecognitionMode;
  wakeModeEnabled: boolean;
  wakePhrase: string;
  wakeSensitivity: WakeSensitivity;

  // STT cloud accuracy upgrades
  /// User-managed hotword dictionary (proper nouns, code identifiers,
  /// domain vocabulary). Sent to AssemblyAI as keyterms_prompt to bias
  /// recognition. Persisted across sessions.
  personalDictionary: string[];
  /// LLM cleanup mode applied to AssemblyAI's final transcript before it
  /// reaches the conversation. "off" disables; "dictation" lightly polishes;
  /// "formal" applies stricter capitalization/punctuation/structure rules.
  sttCleanupMode: "off" | "dictation" | "formal";

  // Memory (persisted to localStorage)
  conversationSummary: string;
  sessionNotes: string;

  // AI settings (persisted)
  systemPromptOverride: string;
  maxCuSteps: number;

  // Memory settings (persisted)
  memoryEnabled: boolean;
  preferenceLearningEnabled: boolean;
  memoryRetentionDays: number; // 0 = forever
  incognitoMode: boolean; // when true, no turns are written to SQLite

  // Observability / diagnostics (persisted)
  telemetryLocalEnabled: boolean;
  telemetryRemoteEnabled: boolean;
  telemetryRemoteProjectKey: string;
  telemetryRemoteHost: string;

  // Ambient / always-on mode (persisted)
  ambientMode: boolean;
  ambientIntervalSeconds: number; // 30 | 60 | 120 | 300
  ambientExcludedApps: string;    // comma-separated app-title substrings to skip
  ambientVisionEnabled: boolean;  // enable Moondream2 local vision in ambient captures

  // Dim 16 — Video / temporal context (persisted user prefs + runtime status)
  videoEnabled: boolean;
  videoRetentionMinutes: number;  // disk retention window for video segments
  videoFpsMin: number;
  videoFpsMax: number;
  // Runtime-only — populated by status polling.
  videoRunning: boolean;
  videoCurrentFps: number;
  videoRamBytes: number;
  videoDiskBytes: number;
  videoDroppedFrames: number;
  videoUptimeSeconds: number;

  // Local vision model (runtime only)
  moondreamSessionLoaded: boolean; // true when ONNX session is ready

  // Appearance (persisted)
  overlayOpacity: number;
  overlayPosition: "left" | "right";

  // Onboarding (persisted)
  onboardingCompleted: boolean;
  onboardingStep: number;

  // Actions
  setSystemPromptOverride: (v: string) => void;
  setMaxCuSteps: (v: number) => void;
  setMemoryEnabled: (v: boolean) => void;
  setPreferenceLearningEnabled: (v: boolean) => void;
  setMemoryRetentionDays: (days: number) => void;
  setIncognitoMode: (v: boolean) => void;
  setTelemetryLocalEnabled: (v: boolean) => void;
  setTelemetryRemoteEnabled: (v: boolean) => void;
  setTelemetryRemoteProjectKey: (v: string) => void;
  setTelemetryRemoteHost: (v: string) => void;
  setAmbientMode: (v: boolean) => void;
  setAmbientIntervalSeconds: (v: number) => void;
  setAmbientExcludedApps: (v: string) => void;
  setAmbientVisionEnabled: (v: boolean) => void;
  setMoondreamSessionLoaded: (v: boolean) => void;
  setVideoEnabled: (v: boolean) => void;
  setVideoRetentionMinutes: (v: number) => void;
  setVideoFpsMin: (v: number) => void;
  setVideoFpsMax: (v: number) => void;
  setVideoStatus: (status: {
    running: boolean;
    currentFps: number;
    ramBytes: number;
    diskBytes: number;
    droppedFrames: number;
    uptimeSeconds: number;
  }) => void;
  setOverlayOpacity: (v: number) => void;
  setOverlayPosition: (v: "left" | "right") => void;
  setLatencyMs: (ms: number) => void;
  clearLatency: () => void;
  setVoiceState: (state: VoiceState) => void;
  setTtsMode: (mode: "cloud" | "local") => void;
  setElevenLabsVoiceId: (id: string) => void;
  setElevenLabsCustomVoiceId: (id: string) => void;
  setElevenLabsModel: (model: "eleven_flash_v2_5" | "eleven_turbo_v2_5" | "eleven_multilingual_v2") => void;
  setTtsQuality: (quality: "fast" | "balanced" | "max") => void;
  setVadEnabled: (enabled: boolean) => void;
  setSpeechLanguage: (language: SpeechLanguageCode) => void;
  setSttMode: (mode: SpeechRecognitionMode) => void;
  setWakeModeEnabled: (enabled: boolean) => void;
  setWakePhrase: (phrase: string) => void;
  setWakeSensitivity: (sensitivity: WakeSensitivity) => void;
  setWakeStatus: (status: WakeStatus) => void;
  setWakeLastDetectedAt: (ts: number | null) => void;
  setWakeLastTranscript: (transcript: string) => void;
  setPersonalDictionary: (terms: string[]) => void;
  setSttCleanupMode: (mode: "off" | "dictation" | "formal") => void;
  setSpeechLanguageDetection: (detection: SpeechLanguageDetection | null) => void;
  setSelectedModel: (model: ModelOption) => void;
  setTranscript: (text: string) => void;
  setResponse: (text: string) => void;
  appendResponse: (chunk: string) => void;
  pushConversationTurn: (turn: ConversationTurn) => void;
  updateConversationTurnId: (index: number, id: number) => void;
  clearConversation: () => void;
  replaceConversationContext: (context: { summary: string; turns: ConversationTurn[] }) => void;
  setApiKey: (provider: "anthropic" | "openai" | "grok" | "elevenLabs" | "assemblyAi", key: string) => void;
  setError: (msg: string) => void;
  clearError: () => void;
  setPendingComputerAction: (pending: PendingComputerAction) => void;
  clearPendingComputerAction: () => void;
  setVerificationResult: (result: { success: boolean; explanation: string } | null) => void;
  setCurrentUiElements: (elements: UiElement[]) => void;
  setHotkeyBinding: (binding: string) => void;
  setHotkeyCombo: (combo: string) => void;
  setConversationSummary: (summary: string) => void;
  setSessionNotes: (notes: string) => void;
  setOnboardingCompleted: (val: boolean) => void;
  setOnboardingStep: (step: number) => void;
  setLastAmbientWindow: (w: string) => void;
  setLastAmbientTs: (ts: number) => void;
  setAmbientCapturesToday: (n: number) => void;
  pushAmbientCaptureDuration: (ms: number) => void;
  pushMoondreamInferenceDuration: (ms: number) => void;
}

export const useCompanionStore = create<CompanionState>()(
  persist(
    (set) => ({
      voiceState: "idle",
      transcript: "",
      response: "",
      conversationHistory: [],
      lastError: "",
      latencyMs: null,
      lastResponseMs: null,
      pendingComputerAction: null,
      verificationResult: null,
      currentUiElements: [],
      speechLanguageDetection: null,
      lastAmbientWindow: "",
      lastAmbientTs: null,
      ambientCapturesToday: 0,
      ambientCaptureDurationsMs: [],
      moondreamInferenceDurationsMs: [],
      wakeStatus: "off",
      wakeLastDetectedAt: null,
      wakeLastTranscript: "",
      selectedModel: MODEL_OPTIONS[0],
      anthropicKey: "",
      openaiKey: "",
      grokKey: "",
      elevenLabsKey: "",
      assemblyAiKey: "",
      hotkeyBinding: "Ctrl+Alt+Space",
      hotkeyCombo: "ctrl+alt+space",
      ttsMode: "cloud" as const,
      elevenLabsVoiceId: "21m00Tcm4TlvDq8ikWAM", // Rachel — warm, clear
      elevenLabsCustomVoiceId: "",
      elevenLabsModel: "eleven_flash_v2_5" as const,
      ttsQuality: "balanced" as const,
      vadEnabled: false,
      speechLanguage: "auto" as const,
      sttMode: "Cloud" as const,
      wakeModeEnabled: false,
      wakePhrase: DEFAULT_WAKE_PHRASE,
      wakeSensitivity: "balanced" as const,
      personalDictionary: [] as string[],
      sttCleanupMode: "dictation" as const,
      conversationSummary: "",
      sessionNotes: "",
      systemPromptOverride: "",
      maxCuSteps: 8,
      memoryEnabled: true,
      preferenceLearningEnabled: true,
      memoryRetentionDays: 30,
      incognitoMode: false,
      telemetryLocalEnabled: true,
      telemetryRemoteEnabled: false,
      telemetryRemoteProjectKey: "",
      telemetryRemoteHost: "https://us.i.posthog.com",
      ambientMode: true,
      ambientIntervalSeconds: 60,
      ambientExcludedApps: "1Password,Bitwarden,KeePass,Keychain",
      ambientVisionEnabled: false,
      moondreamSessionLoaded: false,
      videoEnabled: false,
      videoRetentionMinutes: 1440, // 1 day
      videoFpsMin: 0.5,
      videoFpsMax: 5,
      videoRunning: false,
      videoCurrentFps: 0,
      videoRamBytes: 0,
      videoDiskBytes: 0,
      videoDroppedFrames: 0,
      videoUptimeSeconds: 0,
      overlayOpacity: 0.95,
      overlayPosition: "right" as const,
      onboardingCompleted: false,
      onboardingStep: 0,

      setSystemPromptOverride: (systemPromptOverride) => set({ systemPromptOverride }),
      setMaxCuSteps: (maxCuSteps) => set({ maxCuSteps }),
      setMemoryEnabled: (memoryEnabled) => set({ memoryEnabled }),
      setPreferenceLearningEnabled: (preferenceLearningEnabled) => set({ preferenceLearningEnabled }),
      setMemoryRetentionDays: (memoryRetentionDays) => set({ memoryRetentionDays }),
      setIncognitoMode: (incognitoMode) => set({ incognitoMode }),
      setTelemetryLocalEnabled: (telemetryLocalEnabled) => set({ telemetryLocalEnabled }),
      setTelemetryRemoteEnabled: (telemetryRemoteEnabled) => set({ telemetryRemoteEnabled }),
      setTelemetryRemoteProjectKey: (telemetryRemoteProjectKey) => set({ telemetryRemoteProjectKey }),
      setTelemetryRemoteHost: (telemetryRemoteHost) => set({ telemetryRemoteHost }),
      setAmbientMode: (ambientMode) => set({ ambientMode }),
      setAmbientIntervalSeconds: (ambientIntervalSeconds) => set({ ambientIntervalSeconds }),
      setAmbientExcludedApps: (ambientExcludedApps) => set({ ambientExcludedApps }),
      setAmbientVisionEnabled: (ambientVisionEnabled) => set({ ambientVisionEnabled }),
      setVideoEnabled: (videoEnabled) => set({ videoEnabled }),
      setVideoRetentionMinutes: (videoRetentionMinutes) => set({ videoRetentionMinutes }),
      setVideoFpsMin: (videoFpsMin) => set({ videoFpsMin }),
      setVideoFpsMax: (videoFpsMax) => set({ videoFpsMax }),
      setVideoStatus: ({ running, currentFps, ramBytes, diskBytes, droppedFrames, uptimeSeconds }) =>
        set({
          videoRunning: running,
          videoCurrentFps: currentFps,
          videoRamBytes: ramBytes,
          videoDiskBytes: diskBytes,
          videoDroppedFrames: droppedFrames,
          videoUptimeSeconds: uptimeSeconds,
        }),
      setMoondreamSessionLoaded: (moondreamSessionLoaded) => set({ moondreamSessionLoaded }),
      setOverlayOpacity: (overlayOpacity) => set({ overlayOpacity }),
      setOverlayPosition: (overlayPosition) => set({ overlayPosition }),
      setLatencyMs: (ms) => set({ latencyMs: ms, lastResponseMs: ms }),
      clearLatency: () => set({ latencyMs: null }),
      setVoiceState: (voiceState) => set({ voiceState }),
      setTtsMode: (ttsMode) => set({ ttsMode }),
      setElevenLabsVoiceId: (elevenLabsVoiceId) => set({ elevenLabsVoiceId }),
      setElevenLabsCustomVoiceId: (elevenLabsCustomVoiceId) => set({ elevenLabsCustomVoiceId }),
      setElevenLabsModel: (elevenLabsModel) => set({ elevenLabsModel }),
      setTtsQuality: (ttsQuality) => set({ ttsQuality }),
      setVadEnabled: (vadEnabled) => set({ vadEnabled }),
      setSpeechLanguage: (speechLanguage) => set({ speechLanguage }),
      setSttMode: (sttMode) => set({ sttMode }),
      setWakeModeEnabled: (wakeModeEnabled) => set({ wakeModeEnabled }),
      setWakePhrase: (wakePhrase) => set({ wakePhrase }),
      setWakeSensitivity: (wakeSensitivity) => set({ wakeSensitivity }),
      setWakeStatus: (wakeStatus) => set({ wakeStatus }),
      setWakeLastDetectedAt: (wakeLastDetectedAt) => set({ wakeLastDetectedAt }),
      setWakeLastTranscript: (wakeLastTranscript) => set({ wakeLastTranscript }),
      setPersonalDictionary: (personalDictionary) => set({ personalDictionary }),
      setSttCleanupMode: (sttCleanupMode) => set({ sttCleanupMode }),
      setSpeechLanguageDetection: (speechLanguageDetection) => set({ speechLanguageDetection }),
      setSelectedModel: (selectedModel) => set({ selectedModel }),
      setTranscript: (transcript) => set({ transcript }),
      setResponse: (response) => set({ response }),
      appendResponse: (chunk) => set((s) => ({ response: s.response + chunk })),
      pushConversationTurn: (turn) =>
        set((s) => ({ conversationHistory: [...s.conversationHistory, turn] })),
      updateConversationTurnId: (index, id) =>
        set((s) => {
          const history = [...s.conversationHistory];
          if (history[index]) history[index] = { ...history[index], id };
          return { conversationHistory: history };
        }),
      clearConversation: () =>
        set({ conversationHistory: [], conversationSummary: "", transcript: "", response: "" }),
      replaceConversationContext: ({ summary, turns }) =>
        set({ conversationHistory: turns, conversationSummary: summary }),
      setApiKey: (provider, key) => {
        const field = {
          anthropic: "anthropicKey",
          openai: "openaiKey",
          grok: "grokKey",
          elevenLabs: "elevenLabsKey",
          assemblyAi: "assemblyAiKey",
        }[provider] as keyof CompanionState;
        set({ [field]: key } as Partial<CompanionState>);
      },
      setError: (msg) => set({ lastError: msg }),
      clearError: () => set({ lastError: "" }),
      setPendingComputerAction: (pendingComputerAction) => set({ pendingComputerAction }),
      clearPendingComputerAction: () => set({ pendingComputerAction: null }),
      setVerificationResult: (verificationResult) => set({ verificationResult }),
      setCurrentUiElements: (currentUiElements) => set({ currentUiElements }),
      setHotkeyBinding: (binding) => set({ hotkeyBinding: binding }),
      setHotkeyCombo: (combo) => set({ hotkeyCombo: combo }),
      setConversationSummary: (conversationSummary) => set({ conversationSummary }),
      setSessionNotes: (sessionNotes) => set({ sessionNotes }),
      setOnboardingCompleted: (onboardingCompleted) => set({ onboardingCompleted }),
      setOnboardingStep: (onboardingStep) => set({ onboardingStep }),
      setLastAmbientWindow: (lastAmbientWindow) => set({ lastAmbientWindow }),
      setLastAmbientTs: (lastAmbientTs) => set({ lastAmbientTs }),
      setAmbientCapturesToday: (ambientCapturesToday) => set({ ambientCapturesToday }),
      pushAmbientCaptureDuration: (ms) => set((s) => {
        const next = [...s.ambientCaptureDurationsMs, ms];
        return { ambientCaptureDurationsMs: next.length > 20 ? next.slice(-20) : next };
      }),
      pushMoondreamInferenceDuration: (ms) => set((s) => {
        const next = [...s.moondreamInferenceDurationsMs, ms];
        return { moondreamInferenceDurationsMs: next.length > 20 ? next.slice(-20) : next };
      }),
    }),
    {
      name: "dante-clicky-settings",
      // Only persist user settings and memory, not transient voice state
      partialize: (s) => ({
        selectedModel: s.selectedModel,
        anthropicKey: s.anthropicKey,
        openaiKey: s.openaiKey,
        grokKey: s.grokKey,
        elevenLabsKey: s.elevenLabsKey,
        assemblyAiKey: s.assemblyAiKey,
        hotkeyBinding: s.hotkeyBinding,
        hotkeyCombo: s.hotkeyCombo,
        ttsMode: s.ttsMode,
        elevenLabsVoiceId: s.elevenLabsVoiceId,
        elevenLabsCustomVoiceId: s.elevenLabsCustomVoiceId,
        elevenLabsModel: s.elevenLabsModel,
        ttsQuality: s.ttsQuality,
        vadEnabled: s.vadEnabled,
        speechLanguage: s.speechLanguage,
        wakeModeEnabled: s.wakeModeEnabled,
        wakePhrase: s.wakePhrase,
        wakeSensitivity: s.wakeSensitivity,
        personalDictionary: s.personalDictionary,
        sttCleanupMode: s.sttCleanupMode,
        conversationSummary: s.conversationSummary,
        sessionNotes: s.sessionNotes,
        systemPromptOverride: s.systemPromptOverride,
        maxCuSteps: s.maxCuSteps,
        memoryEnabled: s.memoryEnabled,
        preferenceLearningEnabled: s.preferenceLearningEnabled,
        memoryRetentionDays: s.memoryRetentionDays,
        // incognitoMode intentionally NOT persisted — always resets to false on app start
        telemetryLocalEnabled: s.telemetryLocalEnabled,
        telemetryRemoteEnabled: s.telemetryRemoteEnabled,
        telemetryRemoteProjectKey: s.telemetryRemoteProjectKey,
        telemetryRemoteHost: s.telemetryRemoteHost,
        ambientMode: s.ambientMode,
        ambientIntervalSeconds: s.ambientIntervalSeconds,
        ambientExcludedApps: s.ambientExcludedApps,
        ambientVisionEnabled: s.ambientVisionEnabled,
        // Dim 16 — persist user prefs, NOT runtime status fields
        videoEnabled: s.videoEnabled,
        videoRetentionMinutes: s.videoRetentionMinutes,
        videoFpsMin: s.videoFpsMin,
        videoFpsMax: s.videoFpsMax,
        overlayOpacity: s.overlayOpacity,
        overlayPosition: s.overlayPosition,
        onboardingCompleted: s.onboardingCompleted,
        onboardingStep: s.onboardingStep,
      }),
    }
  )
);
