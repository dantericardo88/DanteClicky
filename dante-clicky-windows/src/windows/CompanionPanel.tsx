import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCompanionStore, MODEL_OPTIONS, type ApiKeyProvider, type ProviderType } from "../state/companionStore";
import { useVoice } from "../hooks/useVoice";
import { useAmbient } from "../hooks/useAmbient";
import { useVideoSubsystem } from "../hooks/useVideoSubsystem";
import { validateKey, type KeyStatus, type Provider } from "../lib/apiValidation";
import { configureTelemetry, installGlobalTelemetryHandlers, recordTelemetryEvent } from "../lib/telemetry";
import { isLocalProvider, PROVIDERS } from "../lib/providerRegistry";
import { CompanionPanelView } from "./companion/CompanionPanelView";
export default function CompanionPanel() {
  useVoice();
  useAmbient();
  useVideoSubsystem();

  const {
    voiceState,
    selectedModel,
    transcript,
    anthropicKey,
    openaiKey,
    grokKey,
    openrouterKey,
    elevenLabsKey,
    assemblyAiKey,
    apiKeyPresence,
    automationSafetyMode,
    hotkeyBinding,
    ttsMode,
    speechLanguage,
    sttMode,
    speechLanguageDetection,
    wakeModeEnabled,
    wakePhrase,
    wakeSensitivity,
    wakeStatus,
    wakeLastDetectedAt,
    conversationHistory,
    sessionNotes,
    lastError,
    pendingComputerAction,
    verificationResult,
    systemPromptOverride,
    maxCuSteps,
    memoryEnabled,
    preferenceLearningEnabled,
    memoryRetentionDays,
    incognitoMode,
    telemetryLocalEnabled,
    telemetryRemoteEnabled,
    telemetryRemoteProjectKey,
    telemetryRemoteHost,
    ambientMode,
    ambientIntervalSeconds,
    ambientExcludedApps,
    lastAmbientWindow,
    lastAmbientTs,
    ambientCapturesToday,
    overlayOpacity,
    overlayPosition,
    setSelectedModel,
    setApiKey,
    setApiKeyPresence,
    setAutomationSafetyMode,
    setHotkeyBinding,
    setHotkeyCombo,
    setTtsMode,
    setSpeechLanguage,
    setWakeModeEnabled,
    setWakePhrase,
    setWakeSensitivity,
    clearConversation,
    setSessionNotes,
    clearError,
    setSystemPromptOverride,
    setMaxCuSteps,
    setMemoryEnabled,
    setPreferenceLearningEnabled,
    setMemoryRetentionDays,
    setIncognitoMode,
    setTelemetryLocalEnabled,
    setTelemetryRemoteEnabled,
    setTelemetryRemoteProjectKey,
    setTelemetryRemoteHost,
    setAmbientMode,
    setAmbientIntervalSeconds,
    setAmbientExcludedApps,
    setOverlayOpacity,
    setOverlayPosition,
    setSpeechLanguageDetection,
    setSttMode,
  } = useCompanionStore();

  const [activeTab, setActiveTab] = useState<"chat" | "memory" | "agents" | "settings">("chat");
  const showSettings = activeTab === "settings";
  const [keyStatuses, setKeyStatuses] = useState<Record<string, KeyStatus>>({});
  const [autostart, setAutostart] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [prefSavedAt, setPrefSavedAt] = useState<number | null>(null);
  const [showDetectionBadge, setShowDetectionBadge] = useState(false);

  const hasAnyKey = !!(
    anthropicKey ||
    openaiKey ||
    grokKey ||
    openrouterKey ||
    elevenLabsKey ||
    assemblyAiKey ||
    Object.values(apiKeyPresence).some(Boolean)
  );

  // If the selected model has no valid key, silently switch to the first model that does.
  useEffect(() => {
    const providerHasKey = (provider: ProviderType) =>
      isLocalProvider(provider) ||
      Boolean(apiKeyPresence[PROVIDERS[provider].keyProvider as keyof typeof apiKeyPresence]);
    if (providerHasKey(selectedModel.provider)) return;
    const fallback = MODEL_OPTIONS.find((m) => providerHasKey(m.provider));
    if (fallback) setSelectedModel(fallback);
  }, [apiKeyPresence, selectedModel.provider, setSelectedModel]);

  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const detectionFadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    installGlobalTelemetryHandlers();
    configureTelemetry({
      localEnabled: telemetryLocalEnabled,
      remoteEnabled: telemetryRemoteEnabled,
      remoteProjectKey: telemetryRemoteProjectKey,
      remoteHost: telemetryRemoteHost,
      incognito: incognitoMode,
    });
    recordTelemetryEvent("app.telemetry_configured", {
      localEnabled: telemetryLocalEnabled,
      remoteEnabled: telemetryRemoteEnabled,
      incognitoMode,
    });
  }, [
    telemetryLocalEnabled,
    telemetryRemoteEnabled,
    telemetryRemoteProjectKey,
    telemetryRemoteHost,
    incognitoMode,
  ]);

  // Migrate stale Ctrl+Alt+Space binding persisted from old installs.
  // Ctrl+Alt = AltGr on many Windows keyboard layouts; Rust now registers Ctrl+Shift+Space.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (hotkeyBinding === "Ctrl+Alt+Space") {
      setHotkeyBinding("Ctrl+Shift+Space");
      setHotkeyCombo("ctrl+shift+space");
      invoke("set_hotkey", { shortcut: "Ctrl+Shift+Space" }).catch(() => {});
    }
  }, []);

  // Migrate stale Cloud sttMode for users with no AssemblyAI key.
  // Cloud STT (AssemblyAI) is a paid service; default to Local (Whisper) so voice works OOTB.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (sttMode === "Cloud" && !assemblyAiKey.trim()) {
      setSttMode("Local");
    }
  }, []);

  // Migrate persisted model IDs that are no longer valid.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const staleModels: Record<string, { provider: string; modelId: string }> = {
      "gpt-5.5": { provider: "openai", modelId: "gpt-4o" },
      "grok-4.3": { provider: "grok", modelId: "grok-3" },
      "openai/gpt-5.5": { provider: "openrouter", modelId: "openai/gpt-4o" },
    };
    const replacement = staleModels[selectedModel.modelId];
    if (replacement) {
      const fresh = MODEL_OPTIONS.find(
        (m) => m.provider === replacement.provider && m.modelId === replacement.modelId,
      );
      if (fresh) setSelectedModel(fresh);
    }
  }, []);

  // Seed the Rust KeyStore with any persisted keys on mount
  useEffect(() => {
    const entries: Array<[Exclude<Provider, "ollama">, string, string]> = [
      ["anthropic", "anthropic", anthropicKey],
      ["openai", "openai", openaiKey],
      ["grok", "xai", grokKey],
      ["openrouter", "openrouter", openrouterKey],
      ["elevenLabs", "elevenlabs", elevenLabsKey],
      ["assemblyAi", "assemblyai", assemblyAiKey],
    ];
    console.log("[startup] key values in store: anthropic=%d openai=%d grok=%d openrouter=%d",
      anthropicKey.length, openaiKey.length, grokKey.length, openrouterKey.length);
    for (const [provider, storeKey, key] of entries) {
      if (key.trim()) {
        console.log("[startup] pushing key for %s (storeKey=%s, len=%d)", provider, storeKey, key.length);
        invoke("set_api_key", { provider: storeKey, key })
          .then(() => setApiKeyPresence(provider, true))
          .catch(() => {});
      }
    }
    invoke<Array<{ provider: string; configured: boolean }>>("get_api_key_statuses")
      .then((statuses) => {
        console.log("[startup] get_api_key_statuses result:", JSON.stringify(statuses));
        const reverse: Record<string, ApiKeyProvider> = {
          anthropic: "anthropic",
          openai: "openai",
          xai: "grok",
          openrouter: "openrouter",
          elevenlabs: "elevenLabs",
          assemblyai: "assemblyAi",
        };
        for (const status of statuses) {
          const provider = reverse[status.provider];
          if (provider) setApiKeyPresence(provider, status.configured);
        }
      })
      .catch((e) => console.error("[startup] get_api_key_statuses FAILED:", e));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Show "preference saved" badge for 2s when an explicit preference is captured.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen("preference-saved-ack", () => {
      setPrefSavedAt(Date.now());
      setTimeout(() => setPrefSavedAt(null), 2000);
    }).then((fn) => { unlisten = fn; }).catch(() => {});
    return () => { unlisten?.(); };
  }, []);

  // Persistent detection badge: show for 5 seconds post-idle when language was detected
  useEffect(() => {
    if (detectionFadeTimerRef.current) clearTimeout(detectionFadeTimerRef.current);
    if (speechLanguageDetection && voiceState === "idle") {
      setShowDetectionBadge(true);
      detectionFadeTimerRef.current = setTimeout(() => setShowDetectionBadge(false), 5000);
    } else if (voiceState !== "idle") {
      setShowDetectionBadge(true);
    }
    return () => {
      if (detectionFadeTimerRef.current) clearTimeout(detectionFadeTimerRef.current);
    };
  }, [voiceState, speechLanguageDetection]);

  // Map frontend provider names to the keystore keys used in Rust
  const PROVIDER_STORE_KEY: Record<Provider, string> = {
    anthropic: "anthropic",
    openai: "openai",
    grok: "xai",
    openrouter: "openrouter",
    ollama: "ollama",
    elevenLabs: "elevenlabs",
    assemblyAi: "assemblyai",
  };

  function handleSetKey(provider: Provider, key: string) {
    if (provider !== "ollama") setApiKey(provider, key);

    // Push key into Rust KeyStore so IPC commands never receive it directly
    const storeKey = PROVIDER_STORE_KEY[provider];
    if (key.trim()) {
      invoke("set_api_key", { provider: storeKey, key })
        .then(() => {
          if (provider !== "ollama") setApiKeyPresence(provider, true);
        })
        .catch(() => {});
    } else {
      invoke("clear_api_key", { provider: storeKey })
        .then(() => {
          if (provider !== "ollama") setApiKeyPresence(provider, false);
        })
        .catch(() => {});
    }

    // Clear existing debounce timer for this provider
    if (debounceTimers.current[provider]) {
      clearTimeout(debounceTimers.current[provider]);
    }

    if (!key.trim()) {
      setKeyStatuses((prev) => ({ ...prev, [provider]: "unchecked" }));
      return;
    }

    // Mark as checking immediately
    setKeyStatuses((prev) => ({ ...prev, [provider]: "checking" }));

    debounceTimers.current[provider] = setTimeout(async () => {
      const status = await validateKey(provider, key);
      setKeyStatuses((prev) => ({ ...prev, [provider]: status }));
    }, 600);
  }

  useEffect(() => {
    return () => {
      // Cleanup all pending timers on unmount
      Object.values(debounceTimers.current).forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    import("@tauri-apps/plugin-autostart")
      .then(({ isEnabled }) => isEnabled())
      .then(setAutostart)
      .catch(() => {});
  }, []);

  // Enforce memory retention policy on startup â€” delete turns older than the user's chosen limit.
  useEffect(() => {
    if (memoryEnabled && memoryRetentionDays > 0) {
      invoke("enforce_retention_policy", { days: memoryRetentionDays }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ version: string }>("tauri://update-available", (e) => {
      setUpdateVersion(e.payload.version);
    }).then((fn) => { unlisten = fn; }).catch(() => {});
    return () => { unlisten?.(); };
  }, []);

  async function toggleAutostart() {
    const { enable, disable, isEnabled } = await import("@tauri-apps/plugin-autostart");
    if (autostart) {
      await disable();
    } else {
      await enable();
    }
    setAutostart(await isEnabled());
  }

  // Reposition the native window to left/right edge when the setting changes
  useEffect(() => {
    invoke("set_companion_panel_position", { position: overlayPosition }).catch(() => {});
  }, [overlayPosition]);

  const panelView = {
    voiceState, selectedModel, transcript, anthropicKey, openaiKey, grokKey, openrouterKey, elevenLabsKey, assemblyAiKey,
    apiKeyPresence, automationSafetyMode, hotkeyBinding, ttsMode, speechLanguage, sttMode, speechLanguageDetection,
    wakeModeEnabled, wakePhrase, wakeSensitivity, wakeStatus, wakeLastDetectedAt, conversationHistory, sessionNotes, lastError,
    pendingComputerAction, verificationResult, systemPromptOverride, maxCuSteps, memoryEnabled, preferenceLearningEnabled,
    memoryRetentionDays, incognitoMode, telemetryLocalEnabled, telemetryRemoteEnabled, telemetryRemoteProjectKey, telemetryRemoteHost,
    ambientMode, ambientIntervalSeconds, ambientExcludedApps, lastAmbientWindow, lastAmbientTs, ambientCapturesToday, overlayOpacity,
    overlayPosition, activeTab, setActiveTab, showSettings, hasAnyKey, keyStatuses, autostart, updateVersion, prefSavedAt,
    showDetectionBadge, handleSetKey, toggleAutostart, setSelectedModel, setAutomationSafetyMode, setHotkeyBinding, setTtsMode,
    setSpeechLanguage, setWakeModeEnabled, setWakePhrase, setWakeSensitivity, clearConversation, setSessionNotes, clearError,
    setSystemPromptOverride, setMaxCuSteps, setMemoryEnabled, setPreferenceLearningEnabled, setMemoryRetentionDays, setIncognitoMode,
    setTelemetryLocalEnabled, setTelemetryRemoteEnabled, setTelemetryRemoteProjectKey, setTelemetryRemoteHost, setAmbientMode,
    setAmbientIntervalSeconds, setAmbientExcludedApps, setOverlayOpacity, setOverlayPosition, setSpeechLanguageDetection,
    setUpdateVersion,
  };

  return <CompanionPanelView ctx={panelView} />;
}


