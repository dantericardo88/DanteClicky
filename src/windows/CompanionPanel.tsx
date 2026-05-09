import { Suspense, lazy, useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, emit } from "@tauri-apps/api/event";
import {
  MODEL_OPTIONS,
  useCompanionStore,
  type ModelOption,
  type ConversationTurn,
} from "../state/companionStore";
import { useVoice } from "../hooks/useVoice";
import { useAmbient } from "../hooks/useAmbient";
import { useMoondream } from "../hooks/useMoondream";
import { useVideoSubsystem } from "../hooks/useVideoSubsystem";
import { VideoControls } from "../components/VideoControls";
import {
  ELEVENLABS_VOICES,
  fetchVoiceLibrary,
  previewVoice,
  stopPreview,
  filterVoicesByLanguage,
  type ElevenLabsVoice,
} from "../hooks/useElevenLabs";
import {
  colors,
  radii,
  shadows,
  providerColors,
  typography,
} from "../lib/designSystem";
import { validateKey, type KeyStatus, type Provider } from "../lib/apiValidation";
import { type PreferenceProfile } from "../lib/preferenceLearning";
import { preferenceFeedbackQueue } from "../lib/preferenceClient";
import {
  clearTelemetryBuffer,
  configureTelemetry,
  exportTelemetryBundleJson,
  getTelemetrySnapshot,
  getTelemetryCatalogSummary,
  installGlobalTelemetryHandlers,
  recordTelemetryEvent,
} from "../lib/telemetry";
import {
  SPEECH_LANGUAGE_OPTIONS,
  buildSpeechLanguageStatus,
  getSpeechLanguageSupport,
  speechLanguageOptionForCode,
  type SpeechLanguageCode,
  type SpeechLanguageStatusTone,
} from "../lib/speechLanguages";
import { DEFAULT_WAKE_PHRASE, wakeStatusLabel, type WakeSensitivity, type WakeStatus } from "../lib/wakeWord";

const AgentPanel = lazy(() => import("./AgentPanel").then((module) => ({ default: module.AgentPanel })));
const MemoryPanel = lazy(() => import("./MemoryPanel").then((module) => ({ default: module.MemoryPanel })));

// Convert epoch ms to relative time format (e.g., "12s ago", "3m ago", "1h ago")
function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

interface AmbientSnapshotRow {
  id: number;
  active_window: string;
  captured_at: string;
  ocr_snippet: string;
  vision_desc: string;
  pixel_hash: string;
}

interface CapabilityStatus {
  supported: boolean;
  degraded: boolean;
  backend: string;
  reason?: string | null;
}

interface PlatformCapabilities {
  os: string;
  family: string;
  nativeScreenCapture: CapabilityStatus;
  nativeInputControl: CapabilityStatus;
  accessibilityTree: CapabilityStatus;
  ocr: CapabilityStatus;
  globalShortcut: CapabilityStatus;
  tray: CapabilityStatus;
  overlayStealth: CapabilityStatus;
  autostart: CapabilityStatus;
  notes: string[];
}

// Classify error for actionable messaging
interface ClassifiedError {
  headline: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}

function classifyError(raw: string, goToSettings: () => void): ClassifiedError {
  const lower = raw.toLowerCase();
  if (lower.includes("api key") || lower.includes("authentication") ||
      lower.includes("invalid_api_key") || lower.includes("401") || lower.includes("unauthorized")) {
    return {
      headline: "API key invalid",
      detail: "Check your key in Settings",
      actionLabel: "Open Settings",
      onAction: goToSettings,
    };
  }
  if (lower.includes("rate limit") || lower.includes("429") || lower.includes("too many")) {
    return { headline: "Rate limited", detail: "Too many requests — wait 30s and retry" };
  }
  if (lower.includes("network") || lower.includes("connection") || lower.includes("timeout") ||
      lower.includes("fetch") || lower.includes("offline")) {
    return { headline: "Connection issue", detail: "Check your internet connection" };
  }
  return { headline: "Something went wrong", detail: raw.slice(0, 120) };
}

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
    elevenLabsKey,
    assemblyAiKey,
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
    setHotkeyBinding,
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
  } = useCompanionStore();

  const [activeTab, setActiveTab] = useState<"chat" | "memory" | "agents" | "settings">("chat");
  const showSettings = activeTab === "settings";
  const [keyStatuses, setKeyStatuses] = useState<Record<string, KeyStatus>>({});
  const [autostart, setAutostart] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [prefSavedAt, setPrefSavedAt] = useState<number | null>(null);
  const [showDetectionBadge, setShowDetectionBadge] = useState(false);

  const hasAnyKey = !!(anthropicKey || openaiKey || grokKey || elevenLabsKey || assemblyAiKey);

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

  // Seed the Rust KeyStore with any persisted keys on mount
  useEffect(() => {
    const entries: Array<[string, string]> = [
      ["anthropic", anthropicKey],
      ["openai", openaiKey],
      ["xai", grokKey],
      ["elevenlabs", elevenLabsKey],
      ["assemblyai", assemblyAiKey],
    ];
    for (const [storeKey, key] of entries) {
      if (key.trim()) {
        invoke("set_api_key", { provider: storeKey, key }).catch(() => {});
      }
    }
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
    elevenLabs: "elevenlabs",
    assemblyAi: "assemblyai",
  };

  function handleSetKey(provider: Provider, key: string) {
    setApiKey(provider, key);

    // Push key into Rust KeyStore so IPC commands never receive it directly
    const storeKey = PROVIDER_STORE_KEY[provider];
    if (key.trim()) {
      invoke("set_api_key", { provider: storeKey, key }).catch(() => {});
    } else {
      invoke("clear_api_key", { provider: storeKey }).catch(() => {});
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

  // Enforce memory retention policy on startup — delete turns older than the user's chosen limit.
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

  const statusLabel: Record<typeof voiceState, string> = {
    idle: wakeModeEnabled ? `Say "${wakePhrase.trim() || DEFAULT_WAKE_PHRASE}" or hold ${hotkeyBinding}` : `Hold ${hotkeyBinding} to speak`,
    listening: "Listening…",
    processing: "Processing…",
    responding: "Responding…",
  };

  const statusColor: Record<typeof voiceState, string> = {
    idle: colors.textTertiary,
    listening: colors.success,
    processing: colors.accent,
    responding: colors.accentHover,
  };

  const transcriptLanguageStatus = buildSpeechLanguageStatus(
    speechLanguageDetection?.selectedLanguage ?? speechLanguage,
    speechLanguageDetection?.mode ?? sttMode
  );
  const transcriptLanguageColor = speechLanguageToneColor(transcriptLanguageStatus.tone);
  const transcriptLanguageLabel =
    speechLanguageDetection?.statusLabel ?? transcriptLanguageStatus.confidenceLabel;

  return (
    <div
      style={{
        width: "360px",
        minHeight: "580px",
        background: colors.background,
        borderRadius: radii.xl,
        boxShadow: shadows.panel,
        border: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        fontFamily: "-apple-system, 'Segoe UI', system-ui, sans-serif",
        color: colors.text,
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 20px 14px",
          borderBottom: `1px solid ${colors.border}`,
          display: "flex",
          alignItems: "center",
          gap: "10px",
          cursor: "default",
        }}
        data-tauri-drag-region
      >
        <div
          style={{
            width: "32px",
            height: "32px",
            borderRadius: radii.sm,
            background: colors.accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "16px",
            flexShrink: 0,
          }}
        >
          ✦
        </div>
        <div>
          <div style={{ ...typography.title, color: colors.text }}>DanteClicky</div>
          <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "1px" }}>
            AI Companion
          </div>
        </div>

        {/* Ambient status pill — clickable toggle */}
        <div
          onClick={() => setAmbientMode(!ambientMode)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 5,
            padding: "3px 8px",
            borderRadius: 10,
            background: ambientMode
              ? "rgba(50,215,75,0.12)"
              : "rgba(255,255,255,0.06)",
            border: `1px solid ${ambientMode ? "rgba(50,215,75,0.3)" : colors.border}`,
            cursor: "pointer",
            fontSize: 11,
            color: ambientMode ? colors.success : colors.textTertiary,
            userSelect: "none",
            transition: "all 0.2s",
          }}
          title={ambientMode ? `Ambient ON — ${ambientCapturesToday} captures today` : "Click to enable ambient mode"}
        >
          <span style={{ fontSize: 8 }}>{ambientMode ? "●" : "○"}</span>
          {ambientMode ? "Watching" : "Ambient off"}
        </div>

        {wakeModeEnabled && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              padding: "3px 8px",
              borderRadius: 10,
              background: "rgba(10,132,255,0.12)",
              border: `1px solid ${colors.accent}4d`,
              fontSize: 11,
              color: wakeStatus === "error" ? colors.error : colors.accent,
              userSelect: "none",
            }}
            title="Wake word uses the local microphone stream and local Whisper before any cloud STT starts"
          >
            <span style={{ fontSize: 8 }}>{wakeStatus === "listening" ? "●" : "○"}</span>
            Wake
          </div>
        )}

        {/* Language quick-select dropdown — discoverable multilingual support */}
        <select
          value={speechLanguage}
          onChange={(e) => setSpeechLanguage(e.target.value as SpeechLanguageCode)}
          style={{
            padding: "3px 6px",
            borderRadius: 6,
            background: colors.backgroundSecondary,
            border: `1px solid ${colors.border}`,
            color: colors.textSecondary,
            fontSize: 10,
            cursor: "pointer",
            fontFamily: "inherit",
          }}
          title="Language for STT/TTS and AI responses"
        >
          {SPEECH_LANGUAGE_OPTIONS.map((opt) => (
            <option key={opt.code} value={opt.code}>
              {opt.code === "auto" ? "Auto" : opt.label}
            </option>
          ))}
        </select>

        <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
          <button
            title={incognitoMode ? "Incognito ON — click to disable" : "Enable incognito mode"}
            onClick={() => setIncognitoMode(!incognitoMode)}
            style={{
              width: "26px",
              height: "26px",
              borderRadius: radii.full,
              border: incognitoMode ? `1px solid ${colors.accent}44` : "1px solid transparent",
              background: incognitoMode ? "rgba(10,132,255,0.12)" : "transparent",
              color: incognitoMode ? colors.accent : colors.textTertiary,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "14px",
              WebkitAppRegion: "no-drag",
              outline: "none",
              transition: "all 0.2s",
            } as React.CSSProperties}
            onFocus={(e) => {
              (e.currentTarget as HTMLButtonElement).style.outline = "2px solid " + colors.accent;
              (e.currentTarget as HTMLButtonElement).style.outlineOffset = "2px";
            }}
            onBlur={(e) => {
              (e.currentTarget as HTMLButtonElement).style.outline = "none";
            }}
          >
            {incognitoMode ? "🕵️" : "👁"}
          </button>
          <IconButton
            title="Agents monitor"
            onClick={() => setActiveTab((t) => t === "agents" ? "chat" : "agents")}
          >
            ◎
          </IconButton>
          <IconButton
            title={showSettings ? "Close settings" : "Settings"}
            onClick={() => setActiveTab((t) => t === "settings" ? "chat" : "settings")}
          >
            ⚙
          </IconButton>
          <IconButton
            title="Close to tray"
            onClick={async () => {
              const { getCurrentWindow } = await import("@tauri-apps/api/window");
              await getCurrentWindow().hide();
            }}
          >
            ×
          </IconButton>
        </div>
      </div>

      {/* Update-available banner */}
      {updateVersion && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 16px",
            background: "rgba(255,159,10,0.15)",
            borderBottom: `1px solid rgba(255,159,10,0.4)`,
            color: colors.warning,
            animation: "slideInFromRight 0.3s ease",
            ...typography.caption,
          }}
        >
          <span>Update available — v{updateVersion}</span>
          <button
            aria-label="Dismiss update notification"
            onClick={() => setUpdateVersion(null)}
            style={{
              background: "none",
              border: "none",
              color: colors.warning,
              cursor: "pointer",
              fontSize: "16px",
              lineHeight: 1,
              padding: "0 2px",
            }}
          >
            ×
          </button>
        </div>
      )}

      {/* Tab bar */}
      <div style={{
        display: "flex",
        borderBottom: `1px solid ${colors.border}`,
        padding: "0 16px",
      }}>
        {(["chat", "memory", "agents", "settings"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              padding: "8px 10px",
              background: "none",
              border: "none",
              borderBottom: `2px solid ${activeTab === tab ? colors.accent : "transparent"}`,
              color: activeTab === tab ? colors.text : colors.textTertiary,
              cursor: "pointer",
              fontSize: "12px",
              fontWeight: activeTab === tab ? 600 : 400,
              textTransform: "capitalize",
              marginBottom: "-1px",
              transition: "color 0.15s, border-color 0.15s",
            }}
          >
            {tab === "memory" ? "Memory" : tab === "agents" ? "Agents" : tab === "settings" ? "Settings" : "Chat"}
          </button>
        ))}
      </div>

      {/* Agents panel */}
      {activeTab === "agents" && (
        <div key="agents" style={{ padding: "16px", overflowY: "auto", flex: 1, animation: "fadeIn 0.15s ease" }}>
          <Suspense fallback={null}>
            <AgentPanel />
          </Suspense>
        </div>
      )}

      {/* Memory panel */}
      {activeTab === "memory" && (
        <div key="memory" style={{ padding: "16px", overflowY: "auto", flex: 1, animation: "fadeIn 0.15s ease" }}>
          <Suspense fallback={null}>
            <MemoryPanel />
          </Suspense>
        </div>
      )}

      {activeTab !== "agents" && activeTab !== "memory" && (
      <div key={activeTab} style={{ padding: "16px", flexDirection: "column", gap: "12px", flex: 1, overflowY: "auto", display: "flex", animation: "fadeIn 0.15s ease" }}>
        {/* No-key reminder (shown when no API keys are configured) */}
        {!hasAnyKey && !showSettings ? (
          <NoKeyReminder onOpenSettings={() => setActiveTab("settings")} />
        ) : (
          /* Status */
          <StatusCard
            label={statusLabel[voiceState]}
            color={statusColor[voiceState]}
            pulsing={voiceState === "listening"}
          />
        )}

        {/* Ambient status — always visible while ambient mode is on (dimmed when voice is busy) */}
        {ambientMode && lastAmbientTs && (
          <div style={{
            fontSize: 11,
            color: colors.textTertiary,
            marginTop: 2,
            textAlign: "center",
            opacity: voiceState === "idle" ? 1 : 0.55,
          }}>
            👁 {lastAmbientWindow || "Desktop"} · {timeAgo(lastAmbientTs)}
          </div>
        )}
        {ambientMode && !lastAmbientTs && (
          <div style={{
            fontSize: 11,
            color: colors.textTertiary,
            marginTop: 2,
            textAlign: "center",
            opacity: voiceState === "idle" ? 1 : 0.55,
          }}>
            Starting ambient capture…
          </div>
        )}

        {wakeModeEnabled && (
          <div style={{
            fontSize: 11,
            color: wakeStatus === "error" ? colors.error : colors.textTertiary,
            marginTop: 2,
            textAlign: "center",
            opacity: voiceState === "idle" ? 1 : 0.6,
          }}>
            {wakeStatusLabel(wakeStatus, wakePhrase.trim() || DEFAULT_WAKE_PHRASE)}
            {wakeLastDetectedAt ? ` · last wake ${timeAgo(wakeLastDetectedAt)}` : " · local only"}
          </div>
        )}

        {/* Real-time audio level meter — shown during listening */}
        {voiceState === "listening" && <AudioLevelMeter />}

        {/* Incognito mode banner — persistent indicator so users always know */}
        {incognitoMode && (
          <div style={{
            display: "flex", alignItems: "center", gap: "7px",
            padding: "7px 10px",
            background: "rgba(99,102,241,0.10)",
            border: `1px solid ${colors.accent}44`,
            borderRadius: radii.sm,
          }}>
            <span style={{ fontSize: "12px" }}>🕵️</span>
            <span style={{ ...typography.caption, color: colors.accent, flex: 1 }}>
              Incognito — this session is not saved to memory
            </span>
            <button
              onClick={() => setIncognitoMode(false)}
              style={{
                padding: "2px 7px", background: "transparent",
                border: `1px solid ${colors.accent}55`, borderRadius: radii.xs,
                color: colors.accent, cursor: "pointer", fontSize: "10px",
                fontFamily: "inherit",
              }}
            >
              off
            </button>
          </div>
        )}

        {/* Classified error banner */}
        {lastError && (() => {
          const classified = classifyError(lastError, () => setActiveTab("settings"));
          return (
            <div
              style={{
                padding: "10px 12px",
                background: "rgba(255,69,58,0.12)",
                border: "1px solid rgba(255,69,58,0.4)",
                borderRadius: "8px",
                color: "#FF453A",
                fontSize: "13px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
                animation: "fadeInUp 0.2s ease",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: "13px" }}>{classified.headline}</div>
                  <div style={{ fontSize: "12px", color: "rgba(255, 69, 58, 0.8)", marginTop: "2px" }}>
                    {classified.detail}
                  </div>
                </div>
                <button
                  aria-label="Dismiss error"
                  onClick={clearError}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#FF453A",
                    cursor: "pointer",
                    fontSize: "16px",
                    marginLeft: "8px",
                    flexShrink: 0,
                  }}
                >
                  ×
                </button>
              </div>
              {classified.actionLabel && classified.onAction && (
                <button
                  onClick={classified.onAction}
                  style={{
                    padding: "6px 10px",
                    background: "#FF453A",
                    border: "none",
                    borderRadius: "6px",
                    color: "#fff",
                    cursor: "pointer",
                    fontSize: "12px",
                    fontWeight: 600,
                    alignSelf: "flex-start",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#FF5A47"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "#FF453A"; }}
                >
                  {classified.actionLabel}
                </button>
              )}
            </div>
          );
        })()}

        {/* Live transcript */}
        {transcript && voiceState !== "idle" && voiceState !== "responding" && (
          <div
            style={{
              padding: "10px 12px",
              background: colors.backgroundSecondary,
              borderRadius: radii.md,
              ...typography.caption,
              color: colors.textSecondary,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px" }}>
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: radii.full,
                  background: transcriptLanguageColor,
                  flexShrink: 0,
                }}
              />
              <span style={{ color: transcriptLanguageColor, fontSize: "11px", fontWeight: 600 }}>
                {(speechLanguageDetection?.mode ?? sttMode).toLowerCase()} STT
              </span>
              <span style={{ color: colors.textTertiary, fontSize: "11px" }}>
                {transcriptLanguageLabel}
              </span>
            </div>
            <div style={{ fontStyle: "italic" }} dir="auto">"{transcript}"</div>
          </div>
        )}

        {/* Persistent detection badge */}
        {showDetectionBadge && speechLanguageDetection && voiceState === "idle" && (
          <div
            style={{
              padding: "8px 12px",
              background: colors.backgroundSecondary,
              borderRadius: radii.md,
              ...typography.caption,
              display: "flex",
              alignItems: "center",
              gap: "8px",
              justifyContent: "space-between",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <span style={{ color: colors.accent, fontWeight: 600 }}>
                Detected: {speechLanguageDetection.detectedLanguageCode?.toUpperCase()}
              </span>
              {speechLanguageDetection.languageConfidence != null && (
                <span style={{ color: colors.textTertiary, fontSize: "11px" }}>
                  {Math.round(speechLanguageDetection.languageConfidence * 100)}%
                </span>
              )}
            </div>
          </div>
        )}

        {/* Language override affordance */}
        {speechLanguage === "auto" && speechLanguageDetection?.detectedLanguageCode && voiceState === "idle" && (
          <button
            onClick={() => {
              setSpeechLanguageDetection(null);
              emit("language-detection-rejected", {
                detectedCode: speechLanguageDetection!.detectedLanguageCode,
                confidence: speechLanguageDetection!.languageConfidence,
              }).catch(() => {});
              setActiveTab("settings");
              setTimeout(() => {
                const langSelector = document.querySelector('[data-language-selector]');
                langSelector?.scrollIntoView({ behavior: "smooth", block: "center" });
              }, 100);
            }}
            style={{
              background: "none",
              border: `1px solid ${colors.textTertiary}`,
              color: colors.textSecondary,
              padding: "8px 12px",
              borderRadius: radii.md,
              cursor: "pointer",
              ...typography.caption,
              width: "100%",
              textAlign: "center",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = colors.backgroundSecondary;
              (e.currentTarget as HTMLButtonElement).style.borderColor = colors.accent;
              (e.currentTarget as HTMLButtonElement).style.color = colors.accent;
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "none";
              (e.currentTarget as HTMLButtonElement).style.borderColor = colors.textTertiary;
              (e.currentTarget as HTMLButtonElement).style.color = colors.textSecondary;
            }}
          >
            Detected {speechLanguageDetection.detectedLanguageCode.toUpperCase()} · wrong?
          </button>
        )}

        {/* Settings drawer */}
        {showSettings && (
          <SettingsSection
            anthropicKey={anthropicKey}
            openaiKey={openaiKey}
            grokKey={grokKey}
            elevenLabsKey={elevenLabsKey}
            assemblyAiKey={assemblyAiKey}
            onSetKey={handleSetKey}
            autostart={autostart}
            onToggleAutostart={toggleAutostart}
            keyStatuses={keyStatuses}
            hotkeyBinding={hotkeyBinding}
            onHotkeyBindingChange={setHotkeyBinding}
            ttsMode={ttsMode}
            onTtsModeChange={setTtsMode}
            speechLanguage={speechLanguage}
            onSpeechLanguageChange={setSpeechLanguage}
            wakeModeEnabled={wakeModeEnabled}
            onToggleWakeMode={() => setWakeModeEnabled(!wakeModeEnabled)}
            wakePhrase={wakePhrase}
            onWakePhraseChange={setWakePhrase}
            wakeSensitivity={wakeSensitivity}
            onWakeSensitivityChange={setWakeSensitivity}
            wakeStatus={wakeStatus}
            sessionNotes={sessionNotes}
            onSessionNotesChange={setSessionNotes}
            systemPromptOverride={systemPromptOverride}
            onSystemPromptOverrideChange={setSystemPromptOverride}
            maxCuSteps={maxCuSteps}
            onMaxCuStepsChange={setMaxCuSteps}
            memoryEnabled={memoryEnabled}
            onToggleMemory={() => setMemoryEnabled(!memoryEnabled)}
            preferenceLearningEnabled={preferenceLearningEnabled}
            onTogglePreferenceLearning={() => setPreferenceLearningEnabled(!preferenceLearningEnabled)}
            memoryRetentionDays={memoryRetentionDays}
            onMemoryRetentionDaysChange={setMemoryRetentionDays}
            incognitoMode={incognitoMode}
            onToggleIncognito={() => setIncognitoMode(!incognitoMode)}
            onClearConversation={conversationHistory.length > 0 ? clearConversation : undefined}
            telemetryLocalEnabled={telemetryLocalEnabled}
            onToggleTelemetryLocal={() => setTelemetryLocalEnabled(!telemetryLocalEnabled)}
            telemetryRemoteEnabled={telemetryRemoteEnabled}
            onToggleTelemetryRemote={() => setTelemetryRemoteEnabled(!telemetryRemoteEnabled)}
            telemetryRemoteProjectKey={telemetryRemoteProjectKey}
            onTelemetryRemoteProjectKeyChange={setTelemetryRemoteProjectKey}
            telemetryRemoteHost={telemetryRemoteHost}
            onTelemetryRemoteHostChange={setTelemetryRemoteHost}
            ambientMode={ambientMode}
            onToggleAmbient={() => setAmbientMode(!ambientMode)}
            ambientIntervalSeconds={ambientIntervalSeconds}
            onAmbientIntervalChange={setAmbientIntervalSeconds}
            ambientExcludedApps={ambientExcludedApps}
            onAmbientExcludedAppsChange={setAmbientExcludedApps}
            overlayOpacity={overlayOpacity}
            onOverlayOpacityChange={setOverlayOpacity}
            overlayPosition={overlayPosition}
            onOverlayPositionChange={setOverlayPosition}
          />
        )}

        {/* Pending safety-gate confirmation card */}
        {pendingComputerAction && (
          <PendingActionCard
            action={pendingComputerAction}
            onConfirm={() => emit("pending-action-ui-confirm", {})}
            onCancel={() => emit("pending-action-ui-cancel", {})}
          />
        )}

        {/* Post-action verification badge — shown for 4s after confirmed action */}
        {verificationResult !== null && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              background: verificationResult.success
                ? "rgba(52,199,89,0.12)"
                : "rgba(255,159,10,0.12)",
              border: `1px solid ${verificationResult.success
                ? "rgba(52,199,89,0.3)"
                : "rgba(255,159,10,0.3)"}`,
              borderRadius: 6,
              fontSize: 12,
              fontFamily: "inherit",
              color: verificationResult.success ? "#34C759" : "#FF9F0A",
            }}
          >
            <span>{verificationResult.success ? "✓" : "⚠"}</span>
            <span>
              {verificationResult.success
                ? "Action verified"
                : "Could not verify — check manually"}
            </span>
          </div>
        )}

        {/* Preference saved acknowledgment — shown for 2s after explicit preference capture */}
        {prefSavedAt !== null && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              background: "rgba(10,132,255,0.10)",
              border: "1px solid rgba(10,132,255,0.25)",
              borderRadius: 6,
              fontSize: 12,
              fontFamily: "inherit",
              color: "#0A84FF",
            }}
          >
            <span>✓</span>
            <span>preference saved</span>
          </div>
        )}

        {/* Memory active badge */}
        {memoryEnabled && !incognitoMode && (
          <div style={{
            display: "flex", alignItems: "center", gap: "6px",
            padding: "4px 10px", borderRadius: radii.full, alignSelf: "flex-start",
            background: "rgba(50,215,75,0.08)", border: "1px solid rgba(50,215,75,0.2)",
          }}>
            <span style={{ fontSize: "12px" }}>🧠</span>
            <span style={{ ...typography.small, color: colors.success }}>Memory active</span>
            {conversationHistory.length > 0 && (
              <span style={{ ...typography.small, color: colors.textTertiary, marginLeft: "2px" }}>
                · {conversationHistory.length} turn{conversationHistory.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}

        {/* Conversation history */}
        {conversationHistory.length > 0 && (
          <ConversationHistory turns={conversationHistory} />
        )}

        {/* Model picker */}
        <ModelPicker selected={selectedModel} onChange={setSelectedModel} />

        {/* Hotkey hint */}
        <HotkeyHint />

        {/* Clear conversation */}
        {conversationHistory.length > 0 && (
          <button
            onClick={clearConversation}
            style={{
              padding: "8px",
              background: "transparent",
              border: `1px solid ${colors.border}`,
              borderRadius: radii.sm,
              color: colors.textTertiary,
              cursor: "pointer",
              ...typography.caption,
            }}
          >
            Clear conversation
          </button>
        )}
      </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function NoKeyReminder({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div
      style={{
        padding: "16px",
        background: colors.backgroundSecondary,
        borderRadius: radii.md,
        border: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <div style={{ ...typography.caption, color: colors.textSecondary }}>
        No API key configured. Add your Anthropic key in Settings to get started.
      </div>
      <div style={{ display: "flex", gap: "8px" }}>
        <button
          onClick={onOpenSettings}
          style={{
            padding: "7px 12px",
            background: colors.accent,
            border: "none",
            borderRadius: radii.sm,
            color: "#fff",
            cursor: "pointer",
            ...typography.caption,
            fontWeight: 600,
          }}
        >
          ⚙ Open Settings
        </button>
        <button
          onClick={() =>
            import("@tauri-apps/plugin-opener")
              .then(({ openUrl }) => openUrl("https://console.anthropic.com/api-keys"))
              .catch(() => {})
          }
          style={{
            padding: "7px 12px",
            background: "transparent",
            border: `1px solid ${colors.border}`,
            borderRadius: radii.sm,
            color: colors.textSecondary,
            cursor: "pointer",
            ...typography.caption,
          }}
        >
          Get Anthropic key →
        </button>
      </div>
    </div>
  );
}

const THUMBS_DOWN_REASONS = [
  "too long",
  "too short",
  "missed screen",
  "wrong action",
  "wrong tone",
  "not specific enough",
] as const;

function requestThumbsDownReason(): string | null {
  const menu = THUMBS_DOWN_REASONS
    .map((reason, index) => `${index + 1}. ${reason}`)
    .join("\n");
  const selected = window.prompt(`What was off?\n${menu}\n7. custom note`, "4");
  if (selected === null) return null;
  const trimmed = selected.trim().toLowerCase();
  const index = Number.parseInt(trimmed, 10);
  if (Number.isInteger(index) && index >= 1 && index <= THUMBS_DOWN_REASONS.length) {
    return THUMBS_DOWN_REASONS[index - 1];
  }
  if (trimmed === "7" || trimmed === "custom" || trimmed === "custom note") {
    const custom = window.prompt("Add a short note about what was wrong", "");
    if (custom === null) return null;
    return custom.trim() || "custom note";
  }
  return trimmed || "custom note";
}

function ConversationHistory({ turns }: { turns: ConversationTurn[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [ratings, setRatings] = useState<Record<string, 1 | -1>>({});
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns]);

  async function copyResponse(text: string, index: number) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 1500);
      const state = useCompanionStore.getState();
      const turn = state.conversationHistory[index];
      if (turn) {
        preferenceFeedbackQueue.recordForTurn(
          { id: turn.id, clientTurnId: turn.clientTurnId },
          {
            signal: "copied_response",
            reason: "user copied the answer",
            rawText: text,
            idempotencyKey: turn.id ? `copy:${turn.id}:${text.slice(0, 32)}` : undefined,
          },
          state
        ).catch(() => {});
      }
    } catch {
      // clipboard unavailable
    }
  }

  function turnRatingKey(turn: ConversationTurn, index: number): string {
    return turn.id ? `id:${turn.id}` : `idx:${index}`;
  }

  async function rateTurn(turn: ConversationTurn, index: number, rating: 1 | -1) {
    const ratingKey = turnRatingKey(turn, index);
    const previousRating = ratings[ratingKey];
    const nextRating: 1 | -1 | 0 = previousRating === rating ? 0 : rating;
    const feedbackReason = nextRating === -1 ? requestThumbsDownReason() : null;
    if (nextRating === -1 && feedbackReason === null) return;
    setRatings((r) => {
      const next = { ...r };
      if (nextRating === 0) delete next[ratingKey];
      else next[ratingKey] = nextRating;
      return next;
    });
    const prefs = useCompanionStore.getState();
    if (!prefs.memoryEnabled || !prefs.preferenceLearningEnabled || prefs.incognitoMode) {
      return;
    }
    if (!turn.id) {
      let attempts = 0;
      const poll = setInterval(() => {
        const current = useCompanionStore.getState().conversationHistory[index];
        if (current?.id) {
          clearInterval(poll);
          invoke("rate_turn", { turnId: current.id, rating: nextRating, reason: feedbackReason })
            .catch(() => {
              setRatings((r) => {
                const next = { ...r };
                if (previousRating === undefined) delete next[ratingKey];
                else next[ratingKey] = previousRating;
                return next;
              });
            });
        } else if (++attempts > 20) {
          clearInterval(poll);
        }
      }, 100);
      return;
    }
    try {
      await invoke("rate_turn", { turnId: turn.id, rating: nextRating, reason: feedbackReason });
    } catch {
      // DB unavailable — local state already reflects intent
    }
  }

  return (
    <div>
      <SectionLabel>Conversation</SectionLabel>
      <div
        ref={scrollRef}
        style={{
          maxHeight: "240px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          scrollbarWidth: "thin",
          scrollbarColor: `${colors.border} transparent`,
        }}
      >
        {turns.map((turn, i) => (
          <div
            key={i}
            style={{ display: "flex", flexDirection: "column", gap: "4px", animation: i === turns.length - 1 ? "fadeInUp 0.15s ease" : undefined }}
            onMouseEnter={() => setHoveredIndex(i)}
            onMouseLeave={() => setHoveredIndex(null)}
          >
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <div
                style={{
                  maxWidth: "80%",
                  padding: "7px 11px",
                  background: colors.accent,
                  borderRadius: `${radii.md} ${radii.md} ${radii.xs} ${radii.md}`,
                  ...typography.caption,
                  color: "#fff",
                  wordBreak: "break-word",
                }}
                dir="auto"
              >
                {turn.userPrompt}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-start", gap: "4px", alignItems: "flex-start" }}>
              <div
                style={{
                  maxWidth: "calc(80% - 56px)",
                  padding: "7px 11px",
                  background: colors.backgroundSecondary,
                  border: `1px solid ${colors.border}`,
                  borderRadius: `${radii.md} ${radii.md} ${radii.md} ${radii.xs}`,
                  ...typography.caption,
                  color: colors.textSecondary,
                  wordBreak: "break-word",
                }}
                dir="auto"
              >
                {turn.assistantResponse}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "2px", flexShrink: 0, marginTop: "4px", opacity: hoveredIndex === i || ratings[turnRatingKey(turn, i)] !== undefined ? 1 : 0, transition: "opacity 0.15s" }}>
                <button
                  title="Good response"
                  aria-label="Good response"
                  onClick={() => rateTurn(turn, i, 1)}
                  style={{
                    width: "22px",
                    height: "22px",
                    borderRadius: radii.xs,
                    border: "none",
                    background: "transparent",
                    color: ratings[turnRatingKey(turn, i)] === 1 ? colors.success : colors.textTertiary,
                    cursor: "pointer",
                    fontSize: "11px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "color 0.2s",
                  }}
                >
                  ▲
                </button>
                <button
                  title="Bad response"
                  aria-label="Bad response"
                  onClick={() => rateTurn(turn, i, -1)}
                  style={{
                    width: "22px",
                    height: "22px",
                    borderRadius: radii.xs,
                    border: "none",
                    background: "transparent",
                    color: ratings[turnRatingKey(turn, i)] === -1 ? colors.error : colors.textTertiary,
                    cursor: "pointer",
                    fontSize: "11px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    transition: "color 0.2s",
                  }}
                >
                  ▼
                </button>
              </div>
              <button
                title="Copy response"
                aria-label="Copy response"
                onClick={() => copyResponse(turn.assistantResponse, i)}
                style={{
                  flexShrink: 0,
                  marginTop: "4px",
                  width: "22px",
                  height: "22px",
                  borderRadius: radii.xs,
                  border: "none",
                  background: "transparent",
                  color: copiedIndex === i ? colors.success : colors.textTertiary,
                  cursor: "pointer",
                  fontSize: "12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  transition: "color 0.2s",
                }}
              >
                {copiedIndex === i ? "✓" : "⎘"}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PendingActionCard({
  action,
  onConfirm,
  onCancel,
}: {
  action: { reason: string; tier?: number; action: { kind: string; label: string } };
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  const { clearPendingComputerAction } = useCompanionStore();
  const [confirmed, setConfirmed] = useState(false);

  const tier = action.tier ?? 2;
  const label = action.action.kind === "none"
    ? "action"
    : `${action.action.kind} "${action.action.label}"`;

  const tierBorder =
    tier >= 3 ? "rgba(255,69,58,0.5)"
    : tier === 2 ? "rgba(255,159,10,0.4)"
    : "rgba(10,132,255,0.4)";
  const tierBg =
    tier >= 3 ? "rgba(255,69,58,0.08)"
    : tier === 2 ? "rgba(255,159,10,0.08)"
    : "rgba(10,132,255,0.08)";
  const tierColor =
    tier >= 3 ? "#FF453A"
    : tier === 2 ? colors.warning
    : colors.accent;

  return (
    <div
      style={{
        padding: "12px 14px",
        background: tierBg,
        border: `1px solid ${tierBorder}`,
        borderRadius: radii.md,
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        animation: "slideInFromRight 0.25s ease",
      }}
    >
      <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
        <span style={{ fontSize: "16px", flexShrink: 0, marginTop: "1px" }}>
          {tier >= 3 ? "🛑" : tier === 2 ? "⚠" : "ℹ"}
        </span>
        <div>
          <div style={{ ...typography.caption, color: tierColor, fontWeight: 600 }}>
            {tier >= 3 ? "High-risk action" : tier === 2 ? "Confirm action" : "Low-risk action"}
          </div>
          <div style={{ ...typography.small, color: colors.textSecondary, marginTop: "2px" }}>
            {action.reason}
          </div>
          <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "2px" }}>
            About to: <strong style={{ color: colors.text }}>{label}</strong>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px" }}>
        <button
          disabled={confirmed}
          onClick={async () => {
            setConfirmed(true);
            await onConfirm?.();
          }}
          style={{
            flex: 1,
            padding: "7px",
            background: confirmed ? colors.surface : tierColor,
            border: "none",
            borderRadius: radii.sm,
            color: confirmed ? colors.textTertiary : tier >= 3 ? "#fff" : "#000",
            cursor: confirmed ? "not-allowed" : "pointer",
            ...typography.caption,
            fontWeight: 600,
            opacity: confirmed ? 0.6 : 1,
          }}
        >
          {confirmed ? "Confirming…" : "Confirm"}
        </button>
        <button
          onClick={() => {
            clearPendingComputerAction();
            onCancel?.();
          }}
          style={{
            flex: 1,
            padding: "7px",
            background: "transparent",
            border: `1px solid ${colors.border}`,
            borderRadius: radii.sm,
            color: colors.textSecondary,
            cursor: "pointer",
            ...typography.caption,
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function StatusCard({
  label,
  color,
  pulsing,
}: {
  label: string;
  color: string;
  pulsing: boolean;
}) {
  return (
    <div
      style={{
        padding: "14px 16px",
        background: colors.backgroundSecondary,
        borderRadius: radii.md,
        border: `1px solid ${pulsing ? colors.accentGlow : colors.border}`,
        display: "flex",
        alignItems: "center",
        gap: "10px",
        transition: "border-color 0.2s",
      }}
    >
      <div
        role="status"
        aria-label={`DanteClicky status: ${label}`}
        style={{
          width: "8px",
          height: "8px",
          borderRadius: radii.full,
          background: color,
          flexShrink: 0,
          boxShadow: pulsing ? `0 0 8px ${color}` : "none",
          transition: "box-shadow 0.2s",
        }}
      />
      <span style={{ ...typography.body, color: colors.textSecondary }}>{label}</span>
    </div>
  );
}

function KeyStatusIndicator({ status }: { status: KeyStatus }) {
  if (status === "unchecked") return null;
  if (status === "checking") {
    return (
      <span style={{ fontSize: "11px", color: colors.textTertiary, flexShrink: 0 }}>
        ...
      </span>
    );
  }
  if (status === "valid") {
    return (
      <span style={{ fontSize: "13px", color: "#32D74B", flexShrink: 0, lineHeight: 1 }}>
        ✓
      </span>
    );
  }
  // invalid
  return (
    <span style={{ fontSize: "13px", color: "#FF453A", flexShrink: 0, lineHeight: 1 }}>
      ✗
    </span>
  );
}

function ImportMemoryButton() {
  const [importState, setImportState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [importCount, setImportCount] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportState("working");
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const json = reader.result as string;
        const count = await invoke<number>("import_memory_json", { json });
        setImportCount(count);
        setImportState("done");
      } catch {
        setImportState("error");
      }
    };
    reader.onerror = () => setImportState("error");
    reader.readAsText(file);
    // reset so the same file can be re-selected
    e.target.value = "";
  }

  if (importState === "done") {
    return (
      <div style={{
        padding: "7px 10px", background: "rgba(52,199,89,0.08)",
        border: "1px solid rgba(52,199,89,0.25)", borderRadius: radii.sm,
        ...typography.caption, color: "#34C759",
      }}>
        Imported {importCount} conversation{importCount !== 1 ? "s" : ""}
      </div>
    );
  }
  if (importState === "error") {
    return (
      <div style={{
        padding: "7px 10px", background: "rgba(255,69,58,0.08)",
        border: "1px solid rgba(255,69,58,0.25)", borderRadius: radii.sm,
        ...typography.caption, color: "#FF453A",
      }}>
        Import failed — file must be a dante-memory JSON export
      </div>
    );
  }

  return (
    <>
      <input ref={fileRef} type="file" accept=".json,application/json" onChange={handleFileChange}
        style={{ display: "none" }} />
      <button
        onClick={() => fileRef.current?.click()}
        disabled={importState === "working"}
        style={{
          padding: "7px 10px", background: "transparent",
          border: `1px solid ${colors.border}`, borderRadius: radii.sm,
          color: importState === "working" ? colors.textTertiary : colors.textSecondary,
          cursor: importState === "working" ? "default" : "pointer",
          ...typography.caption, textAlign: "left" as const, fontFamily: "inherit",
        }}
      >
        {importState === "working" ? "Importing…" : "Import memory from JSON"}
      </button>
    </>
  );
}

interface DbKeyStatus { encrypted: boolean; dpapi_protected: boolean; sqlcipher_active: boolean; platform: string; }

function EncryptionStatusBadge() {
  const [status, setStatus] = useState<DbKeyStatus | null>(null);
  useEffect(() => {
    invoke<DbKeyStatus>("db_key_status").then(setStatus).catch(() => {});
  }, []);

  const dpapiLabel = status?.dpapi_protected
    ? "DPAPI-bound"
    : status?.platform === "windows"
    ? "⚠ not DPAPI-protected"
    : null;
  const isWarn = status !== null && status.platform === "windows" && !status.dpapi_protected;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "6px",
      padding: "5px 8px", marginBottom: "4px",
      background: isWarn ? "rgba(255,159,10,0.08)" : "rgba(52,199,89,0.08)",
      border: `1px solid ${isWarn ? "rgba(255,159,10,0.25)" : "rgba(52,199,89,0.25)"}`,
      borderRadius: radii.sm,
    }}>
      <span style={{ fontSize: "11px" }}>{isWarn ? "⚠️" : "🔒"}</span>
      <span style={{ ...typography.small, color: isWarn ? "#FF9F0A" : "#34C759", flex: 1 }}>
        {status?.sqlcipher_active ? "SQLCipher AES-256 + " : ""}ChaCha20-Poly1305 (fields){dpapiLabel ? ` · ${dpapiLabel}` : ""}
      </span>
    </div>
  );
}

function DataInventoryRow() {
  const [turnCount, setTurnCount] = useState<number | null>(null);
  const [oldest, setOldest] = useState<string | null>(null);
  const retentionDays = useCompanionStore(s => s.memoryRetentionDays);

  useEffect(() => {
    invoke<number>("db_turn_count").then(setTurnCount).catch(() => {});
    invoke<string | null>("get_oldest_turn_date").then(setOldest).catch(() => {});
  }, []);

  const nextClear = retentionDays > 0 && oldest
    ? new Date(new Date(oldest).getTime() + retentionDays * 86_400_000).toLocaleDateString()
    : retentionDays > 0 ? "soon" : "never";

  return (
    <div style={{ ...typography.small, color: colors.textTertiary, padding: "3px 2px 5px" }}>
      {turnCount !== null ? `${turnCount} conversation${turnCount === 1 ? "" : "s"} stored` : "—"}
      {oldest ? ` · oldest ${new Date(oldest).toLocaleDateString()}` : ""}
      {` · auto-clear: ${nextClear}`}
    </div>
  );
}

function RekeyButton() {
  const [rekeyState, setRekeyState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [rekeyed, setRekeyed] = useState(0);

  async function handleRekey() {
    if (!window.confirm(
      "Re-encrypt all conversations with a fresh key?\n\nNew saves will immediately use the new key — no restart required."
    )) return;
    setRekeyState("working");
    try {
      const count = await invoke<number>("rekey_database");
      setRekeyed(count);
      setRekeyState("done");
    } catch {
      setRekeyState("error");
    }
  }

  if (rekeyState === "done") {
    return (
      <div style={{
        padding: "7px 10px",
        background: "rgba(52,199,89,0.08)",
        border: "1px solid rgba(52,199,89,0.25)",
        borderRadius: radii.sm,
        ...typography.caption, color: "#34C759",
      }}>
        Re-keyed {rekeyed} conversation{rekeyed !== 1 ? "s" : ""} — active immediately
      </div>
    );
  }
  if (rekeyState === "error") {
    return (
      <div style={{
        padding: "7px 10px",
        background: "rgba(255,69,58,0.08)",
        border: "1px solid rgba(255,69,58,0.25)",
        borderRadius: radii.sm,
        ...typography.caption, color: "#FF453A",
      }}>
        Re-key failed — app data directory may not be writable
      </div>
    );
  }

  return (
    <button
      onClick={handleRekey}
      disabled={rekeyState === "working"}
      style={{
        padding: "7px 10px",
        background: "transparent",
        border: `1px solid ${colors.border}`,
        borderRadius: radii.sm,
        color: rekeyState === "working" ? colors.textTertiary : colors.textSecondary,
        cursor: rekeyState === "working" ? "default" : "pointer",
        ...typography.caption,
        textAlign: "left" as const,
        fontFamily: "inherit",
      }}
    >
      {rekeyState === "working" ? "Re-keying…" : "Rotate encryption key"}
    </button>
  );
}

function SettingsSection({
  anthropicKey, openaiKey, grokKey, elevenLabsKey, assemblyAiKey, onSetKey,
  autostart, onToggleAutostart, keyStatuses,
  hotkeyBinding, onHotkeyBindingChange,
  ttsMode, onTtsModeChange,
  speechLanguage, onSpeechLanguageChange,
  wakeModeEnabled, onToggleWakeMode, wakePhrase, onWakePhraseChange, wakeSensitivity, onWakeSensitivityChange, wakeStatus,
  sessionNotes, onSessionNotesChange,
  systemPromptOverride, onSystemPromptOverrideChange,
  maxCuSteps, onMaxCuStepsChange,
  memoryEnabled, onToggleMemory, preferenceLearningEnabled, onTogglePreferenceLearning, memoryRetentionDays, onMemoryRetentionDaysChange,
  incognitoMode, onToggleIncognito, onClearConversation,
  telemetryLocalEnabled, onToggleTelemetryLocal,
  telemetryRemoteEnabled, onToggleTelemetryRemote,
  telemetryRemoteProjectKey, onTelemetryRemoteProjectKeyChange,
  telemetryRemoteHost, onTelemetryRemoteHostChange,
  ambientMode, onToggleAmbient, ambientIntervalSeconds, onAmbientIntervalChange,
  ambientExcludedApps, onAmbientExcludedAppsChange,
  overlayOpacity, onOverlayOpacityChange,
  overlayPosition, onOverlayPositionChange,
}: {
  anthropicKey: string; openaiKey: string; grokKey: string;
  elevenLabsKey: string; assemblyAiKey: string;
  onSetKey: (provider: Provider, key: string) => void;
  autostart: boolean; onToggleAutostart: () => void;
  keyStatuses: Record<string, KeyStatus>;
  hotkeyBinding: string; onHotkeyBindingChange: (binding: string) => void;
  ttsMode: "cloud" | "local"; onTtsModeChange: (m: "cloud" | "local") => void;
  speechLanguage: SpeechLanguageCode; onSpeechLanguageChange: (language: SpeechLanguageCode) => void;
  wakeModeEnabled: boolean; onToggleWakeMode: () => void;
  wakePhrase: string; onWakePhraseChange: (phrase: string) => void;
  wakeSensitivity: WakeSensitivity; onWakeSensitivityChange: (sensitivity: WakeSensitivity) => void;
  wakeStatus: WakeStatus;
  sessionNotes: string; onSessionNotesChange: (v: string) => void;
  systemPromptOverride: string; onSystemPromptOverrideChange: (v: string) => void;
  maxCuSteps: number; onMaxCuStepsChange: (v: number) => void;
  memoryEnabled: boolean; onToggleMemory: () => void;
  preferenceLearningEnabled: boolean; onTogglePreferenceLearning: () => void;
  memoryRetentionDays: number; onMemoryRetentionDaysChange: (days: number) => void;
  incognitoMode: boolean; onToggleIncognito: () => void;
  onClearConversation?: () => void;
  telemetryLocalEnabled: boolean; onToggleTelemetryLocal: () => void;
  telemetryRemoteEnabled: boolean; onToggleTelemetryRemote: () => void;
  telemetryRemoteProjectKey: string; onTelemetryRemoteProjectKeyChange: (v: string) => void;
  telemetryRemoteHost: string; onTelemetryRemoteHostChange: (v: string) => void;
  ambientMode: boolean; onToggleAmbient: () => void;
  ambientIntervalSeconds: number; onAmbientIntervalChange: (v: number) => void;
  ambientExcludedApps: string; onAmbientExcludedAppsChange: (v: string) => void;
  overlayOpacity: number; onOverlayOpacityChange: (v: number) => void;
  overlayPosition: "left" | "right"; onOverlayPositionChange: (v: "left" | "right") => void;
}) {
  const [hotkeyDraft, setHotkeyDraft] = useState(hotkeyBinding);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [stealthMode, setStealthMode] = useState(true);
  const [purgeConfirm, setPurgeConfirm] = useState(false);
  const [prefProfile, setPrefProfile] = useState<PreferenceProfile | null>(null);
  const [captureCountToday, setCaptureCountToday] = useState(0);
  const [showAmbientHistory, setShowAmbientHistory] = useState(false);
  const [ambientSnapshots, setAmbientSnapshots] = useState<AmbientSnapshotRow[]>([]);
  const ambientCaptureDurationsMs = useCompanionStore(s => s.ambientCaptureDurationsMs);
  const [telemetrySnapshot, setTelemetrySnapshot] = useState(getTelemetrySnapshot());
  const [platformCapabilities, setPlatformCapabilities] = useState<PlatformCapabilities | null>(null);

  useEffect(() => { setHotkeyDraft(hotkeyBinding); }, [hotkeyBinding]);

  useEffect(() => {
    invoke<PlatformCapabilities>("get_platform_capabilities")
      .then(setPlatformCapabilities)
      .catch(() => setPlatformCapabilities(null));
  }, []);

  useEffect(() => {
    const refresh = () => setTelemetrySnapshot(getTelemetrySnapshot());
    refresh();
    const intervalId = setInterval(refresh, 2_000);
    return () => clearInterval(intervalId);
  }, [
    telemetryLocalEnabled,
    telemetryRemoteEnabled,
    telemetryRemoteProjectKey,
    telemetryRemoteHost,
    incognitoMode,
  ]);

  useEffect(() => {
    if (!preferenceLearningEnabled || !memoryEnabled) { setPrefProfile(null); return; }
    const refresh = () => {
      invoke<PreferenceProfile>("get_preference_profile", { limit: 20 })
        .then(setPrefProfile)
        .catch(() => {});
    };
    refresh();
    const intervalId = setInterval(refresh, 30_000);
    let unlistenFn: (() => void) | null = null;
    listen("preference-updated", refresh).then((fn) => { unlistenFn = fn; }).catch(() => {});
    return () => {
      clearInterval(intervalId);
      unlistenFn?.();
    };
  }, [preferenceLearningEnabled, memoryEnabled]);

  useEffect(() => {
    if (!ambientMode) return;
    invoke<number>("count_ambient_today").then(setCaptureCountToday).catch(() => {});
    const t = setInterval(() => {
      invoke<number>("count_ambient_today").then(setCaptureCountToday).catch(() => {});
    }, 30_000);
    return () => clearInterval(t);
  }, [ambientMode]);

  async function handleHotkeyBlur() {
    const newBinding = hotkeyDraft.trim();
    if (!newBinding || newBinding === hotkeyBinding) return;
    setHotkeyError(null);
    try {
      await invoke("set_hotkey", { shortcut: newBinding });
      onHotkeyBindingChange(newBinding);
    } catch {
      setHotkeyError("That hotkey combination is already in use");
      setHotkeyDraft(hotkeyBinding);
    }
  }

  const keys: Array<{ label: string; provider: Provider; value: string; placeholder: string }> = [
    { label: "Anthropic", provider: "anthropic", value: anthropicKey, placeholder: "sk-ant-..." },
    { label: "OpenAI", provider: "openai", value: openaiKey, placeholder: "sk-..." },
    { label: "Grok (xAI)", provider: "grok", value: grokKey, placeholder: "xai-..." },
    { label: "ElevenLabs", provider: "elevenLabs", value: elevenLabsKey, placeholder: "xi-..." },
    { label: "AssemblyAI", provider: "assemblyAi", value: assemblyAiKey, placeholder: "your-key" },
  ];

  const sectionStyle: React.CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    paddingTop: "14px",
  };

  const sectionHeader = (icon: string, label: string) => (
    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
      <span style={{ fontSize: "12px", opacity: 0.7 }}>{icon}</span>
      <span style={{ ...typography.small, color: colors.textTertiary, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }}>
        {label}
      </span>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>

      {/* ── API Keys ─────────────────────────────────────── */}
      <SettingsCard index={0}>
        {sectionHeader("🔑", "API Keys")}
        {keys.map(({ label, provider, value, placeholder }) => {
          const status: KeyStatus = keyStatuses[provider] ?? "unchecked";
          const borderColor =
            status === "valid" ? "rgba(50,215,75,0.5)"
            : status === "invalid" ? "rgba(255,69,58,0.5)"
            : colors.border;
          return (
            <div key={provider}>
              <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "3px" }}>{label}</div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <input
                  type="password"
                  value={value}
                  onChange={(e) => onSetKey(provider, e.target.value)}
                  placeholder={placeholder}
                  style={{
                    padding: "6px 8px",
                    background: colors.surface,
                    border: `1px solid ${borderColor}`,
                    borderRadius: radii.sm,
                    color: colors.text,
                    fontSize: "12px",
                    outline: "none",
                    flex: 1,
                    boxSizing: "border-box" as const,
                    transition: "border-color 0.2s",
                  }}
                />
                <KeyStatusIndicator status={status} />
              </div>
              {status === "invalid" && (
                <div style={{ ...typography.small, color: "#FF453A", marginTop: "2px" }}>Invalid key</div>
              )}
            </div>
          );
        })}
      </SettingsCard>

      {/* ── Voice ────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <SettingsCard index={1}>
          {sectionHeader("OS", "Platform")}
          <PlatformStatusCard capabilities={platformCapabilities} />
        </SettingsCard>
      </div>

      <div style={sectionStyle}>
        <SettingsCard index={1}>
          {sectionHeader("🎙", "Voice")}

          {/* Speech language */}
          <div>
            <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "4px" }}>Language</div>
            <SpeechLanguageSection
              speechLanguage={speechLanguage}
              onSpeechLanguageChange={onSpeechLanguageChange}
            />
          </div>

          {/* STT */}
          <SettingsDivider />
          <div>
            <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "4px" }}>Speech recognition</div>
            <SttModeSection speechLanguage={speechLanguage} />
          </div>

          {/* STT Accuracy upgrades — Personal Dictionary + AI Polish */}
          <SettingsDivider />
          <div>
            <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "4px" }}>STT accuracy</div>
            <SttAccuracySection />
          </div>

          {/* TTS */}
          <SettingsDivider />
          <div>
            <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "4px" }}>Text-to-speech</div>
            <TtsModeSection ttsMode={ttsMode} setTtsMode={onTtsModeChange} speechLanguage={speechLanguage} />
          </div>

          {/* Hotkey */}
          <SettingsDivider />
          <div>
            <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "3px" }}>Push-to-talk hotkey</div>
            <input
              type="text"
              value={hotkeyDraft}
              onChange={(e) => { setHotkeyDraft(e.target.value); setHotkeyError(null); }}
              onBlur={handleHotkeyBlur}
              style={{
                padding: "6px 8px",
                background: colors.surface,
                border: `1px solid ${hotkeyError ? "rgba(255,69,58,0.5)" : colors.border}`,
                borderRadius: radii.sm,
                color: colors.text,
                fontSize: "12px",
                outline: "none",
                width: "100%",
                boxSizing: "border-box" as const,
              }}
            />
            {hotkeyError
              ? <div style={{ ...typography.small, color: "#FF453A", marginTop: "2px" }}>{hotkeyError}</div>
              : <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "2px" }}>e.g. "Ctrl+Alt+Space", "Shift+Ctrl+K"</div>
            }
          </div>

          {/* Wake word */}
          <SettingsDivider />
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
              <div>
                <div style={{ ...typography.caption, color: colors.textSecondary }}>Wake word</div>
                <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "1px" }}>
                  {wakeStatusLabel(wakeStatus, wakePhrase.trim() || DEFAULT_WAKE_PHRASE)}
                </div>
              </div>
              <ToggleButton on={wakeModeEnabled} onToggle={onToggleWakeMode} />
            </div>
            {wakeModeEnabled && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
                <input
                  type="text"
                  value={wakePhrase}
                  onChange={(e) => onWakePhraseChange(e.target.value)}
                  placeholder="hey dante"
                  style={{
                    padding: "6px 8px",
                    background: colors.surface,
                    border: `1px solid ${colors.border}`,
                    borderRadius: radii.sm,
                    color: colors.text,
                    fontSize: "12px",
                    outline: "none",
                    width: "100%",
                    boxSizing: "border-box" as const,
                  }}
                />
                <select
                  value={wakeSensitivity}
                  onChange={(e) => onWakeSensitivityChange(e.target.value as WakeSensitivity)}
                  style={{
                    padding: "6px 8px",
                    background: colors.surface,
                    border: `1px solid ${colors.border}`,
                    borderRadius: radii.sm,
                    color: colors.textSecondary,
                    fontSize: "12px",
                    outline: "none",
                    width: "100%",
                    boxSizing: "border-box" as const,
                  }}
                >
                  <option value="strict">Strict</option>
                  <option value="balanced">Balanced</option>
                  <option value="sensitive">Sensitive</option>
                </select>
                <div style={{ ...typography.small, color: colors.textTertiary }}>
                  Local Whisper gate. Cloud STT starts only after the wake phrase matches.
                </div>
              </div>
            )}
          </div>

          {/* VAD */}
          <SettingsDivider />
          <VadToggle />
        </SettingsCard>
      </div>

      {/* ── AI ───────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <SettingsCard index={2}>
          {sectionHeader("✦", "AI")}

          {/* System prompt override */}
          <div>
            <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "3px" }}>System prompt suffix</div>
            <textarea
              value={systemPromptOverride}
              onChange={(e) => onSystemPromptOverrideChange(e.target.value)}
              placeholder="Extra instructions appended to the system prompt (e.g. 'Always respond concisely')"
              rows={3}
              style={{
                width: "100%",
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: radii.sm,
                color: colors.text,
                fontSize: "12px",
                padding: "8px",
                resize: "vertical",
                outline: "none",
                boxSizing: "border-box" as const,
                fontFamily: "inherit",
              }}
            />
          </div>

          {/* Max CU steps */}
          <SettingsDivider />
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <div style={{ ...typography.caption, color: colors.textSecondary }}>Max computer use steps</div>
              <span style={{ ...typography.caption, color: colors.accent, fontWeight: 600 }}>{maxCuSteps}</span>
            </div>
            <input
              type="range"
              min={2}
              max={20}
              step={1}
              value={maxCuSteps}
              onChange={(e) => onMaxCuStepsChange(Number(e.target.value))}
              style={{ width: "100%", accentColor: colors.accent, cursor: "pointer" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ ...typography.small, color: colors.textTertiary }}>2 (safe)</span>
              <span style={{ ...typography.small, color: colors.textTertiary }}>20 (thorough)</span>
            </div>
          </div>

          {/* Session notes */}
          <SettingsDivider />
          <div>
            <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "3px" }}>Session notes</div>
            <textarea
              value={sessionNotes}
              onChange={(e) => onSessionNotesChange(e.target.value)}
              placeholder="Always-on context (e.g. 'I prefer dark mode', 'My project is in C:/Projects')"
              rows={3}
              style={{
                width: "100%",
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: radii.sm,
                color: colors.text,
                fontSize: "12px",
                padding: "8px",
                resize: "vertical",
                outline: "none",
                boxSizing: "border-box" as const,
                fontFamily: "inherit",
              }}
            />
          </div>
        </SettingsCard>
      </div>

      {/* ── Memory ───────────────────────────────────────── */}
      <div style={sectionStyle}>
        <SettingsCard index={3}>
          {sectionHeader("🧠", "Memory")}

          {/* Dual encryption status (SQLCipher + ChaCha20) + data inventory */}
          <EncryptionStatusBadge />
          <DataInventoryRow />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ ...typography.caption, color: colors.textSecondary }}>Enable memory</div>
              <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "1px" }}>
                Summarise and recall past conversations
              </div>
            </div>
            <ToggleButton on={memoryEnabled} onToggle={onToggleMemory} />
          </div>

          <SettingsDivider />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ ...typography.caption, color: colors.textSecondary }}>Preference learning</div>
              <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "1px" }}>
                Learn from ratings, copied answers, and corrections
              </div>
            </div>
            <ToggleButton on={preferenceLearningEnabled} onToggle={onTogglePreferenceLearning} />
          </div>

          {preferenceLearningEnabled && memoryEnabled && (
            <div style={{ marginTop: "8px" }}>
              {!prefProfile || (prefProfile.traits.length === 0 && prefProfile.explicit_feedback_count === 0) ? (
                <div style={{ ...typography.small, color: colors.textTertiary, fontStyle: "italic" }}>
                  No preferences learned yet — rate responses or say "perfect" / "no, that's wrong"
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {prefProfile.traits.map((trait) => {
                    const conf = trait.confidence ?? Math.min(0.99, Math.abs(trait.score) / Math.max(1, trait.evidence_count));
                    const pct = Math.round(conf * 100);
                    const positive = trait.score > 0;
                    const isConflicted = trait.status === "conflicted" || (trait.positive_count > 0 && trait.negative_count > 0 && Math.abs(trait.positive_count - trait.negative_count) <= 1);
                    const labelColor = isConflicted ? "#F59E0B" : positive ? "#34C759" : "#FF453A";
                    return (
                      <div key={trait.key} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ ...typography.small, color: labelColor, width: "8px", textAlign: "center", flexShrink: 0 }}>
                          {isConflicted ? "~" : positive ? "+" : "−"}
                        </div>
                        <div style={{ ...typography.small, color: isConflicted ? "#F59E0B" : colors.textSecondary, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {trait.label}
                        </div>
                        <div style={{ ...typography.small, color: colors.textTertiary, flexShrink: 0 }}>
                          {trait.evidence_count}×
                        </div>
                        <div style={{ width: "40px", height: "4px", background: colors.border, borderRadius: "2px", flexShrink: 0 }}>
                          <div style={{ width: `${pct}%`, height: "100%", borderRadius: "2px", background: isConflicted ? "#F59E0B" : positive ? "#34C759" : "#FF453A" }} />
                        </div>
                        <button
                          onClick={() => {
                            invoke("delete_preference_trait", { key: trait.key }).catch(() => {});
                            setPrefProfile((p) => p ? { ...p, traits: p.traits.filter((t) => t.key !== trait.key) } : p);
                          }}
                          style={{ background: "none", border: "none", cursor: "pointer", color: colors.textTertiary, fontSize: "11px", padding: "0 2px", flexShrink: 0, lineHeight: 1 }}
                          title="Dismiss trait"
                        >
                          ✕
                        </button>
                      </div>
                    );
                  })}
                  <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "2px" }}>
                    {prefProfile.explicit_feedback_count} explicit · {prefProfile.implicit_feedback_count} implicit signals
                  </div>
                </div>
              )}
            </div>
          )}

          <SettingsDivider />

          {/* Incognito mode */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ ...typography.caption, color: incognitoMode ? colors.accent : colors.textSecondary }}>
                Incognito mode
              </div>
              <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "1px" }}>
                This session is not saved to memory
              </div>
            </div>
            <ToggleButton on={incognitoMode} onToggle={onToggleIncognito} />
          </div>

          <SettingsDivider />

          {/* Auto-clear retention */}
          <div>
            <div style={{ ...typography.caption, color: colors.textSecondary, marginBottom: "8px" }}>Auto-clear memory after</div>
            <div style={{ display: "flex", gap: "4px" }}>
              {([0, 7, 30, 90] as const).map((days) => (
                <button
                  key={days}
                  onClick={() => onMemoryRetentionDaysChange(days)}
                  style={{
                    flex: 1,
                    padding: "5px 4px",
                    borderRadius: radii.xs,
                    border: `1px solid ${memoryRetentionDays === days ? colors.accent : colors.border}`,
                    background: memoryRetentionDays === days ? `${colors.accent}22` : "transparent",
                    color: memoryRetentionDays === days ? colors.accent : colors.textSecondary,
                    cursor: "pointer",
                    ...typography.small,
                    fontWeight: memoryRetentionDays === days ? 600 : 400,
                  }}
                >
                  {days === 0 ? "∞" : `${days}d`}
                </button>
              ))}
            </div>
          </div>

          <SettingsDivider />

          {/* Privacy actions */}
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            <button
              onClick={async () => {
                try {
                  const json = await invoke<string>("export_memory_json");
                  const blob = new Blob([json], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `dante-memory-${new Date().toISOString().slice(0, 10)}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch { /* DB unavailable */ }
              }}
              style={{
                padding: "7px 10px",
                background: "transparent",
                border: `1px solid ${colors.border}`,
                borderRadius: radii.sm,
                color: colors.textSecondary,
                cursor: "pointer",
                ...typography.caption,
                textAlign: "left",
              }}
            >
              Export memory as JSON
            </button>

            <ImportMemoryButton />

            <RekeyButton />

            {onClearConversation && (
              <button
                onClick={onClearConversation}
                style={{
                  padding: "7px 10px",
                  background: "transparent",
                  border: `1px solid ${colors.border}`,
                  borderRadius: radii.sm,
                  color: colors.textSecondary,
                  cursor: "pointer",
                  ...typography.caption,
                  textAlign: "left",
                }}
              >
                Clear conversation history
              </button>
            )}

            {!purgeConfirm ? (
              <button
                onClick={() => setPurgeConfirm(true)}
                style={{
                  padding: "7px 10px",
                  background: "transparent",
                  border: `1px solid ${colors.error}44`,
                  borderRadius: radii.sm,
                  color: colors.error,
                  cursor: "pointer",
                  ...typography.caption,
                  textAlign: "left",
                }}
              >
                Purge all memory
              </button>
            ) : (
              <div style={{ display: "flex", gap: "6px" }}>
                <button
                  onClick={async () => {
                    setPurgeConfirm(false);
                    try {
                      await invoke("purge_all_memory");
                      onClearConversation?.();
                    } catch { /* DB unavailable */ }
                  }}
                  style={{
                    flex: 1,
                    padding: "7px 10px",
                    background: `${colors.error}22`,
                    border: `1px solid ${colors.error}`,
                    borderRadius: radii.sm,
                    color: colors.error,
                    cursor: "pointer",
                    ...typography.caption,
                    fontWeight: 600,
                  }}
                >
                  Yes, delete everything
                </button>
                <button
                  onClick={() => setPurgeConfirm(false)}
                  style={{
                    padding: "7px 10px",
                    background: "transparent",
                    border: `1px solid ${colors.border}`,
                    borderRadius: radii.sm,
                    color: colors.textSecondary,
                    cursor: "pointer",
                    ...typography.caption,
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </SettingsCard>
      </div>

      {/* ── Observability ────────────────────────────────── */}
      <div style={sectionStyle}>
        <SettingsCard index={4}>
          {sectionHeader("::", "Observability")}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <div>
              <div style={{ ...typography.caption, color: telemetryLocalEnabled ? colors.accent : colors.textSecondary }}>
                Local diagnostics
              </div>
              <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "1px" }}>
                Redacted events, spans, metrics, and errors stay on this device
              </div>
            </div>
            <ToggleButton on={telemetryLocalEnabled} onToggle={onToggleTelemetryLocal} />
          </div>

          <SettingsDivider />

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <div>
              <div style={{ ...typography.caption, color: telemetryRemoteEnabled ? colors.accent : colors.textSecondary }}>
                External analytics
              </div>
              <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "1px" }}>
                Explicit opt-in only; disabled during incognito
              </div>
            </div>
            <ToggleButton on={telemetryRemoteEnabled} onToggle={onToggleTelemetryRemote} />
          </div>

          {telemetryRemoteEnabled && (
            <>
              <SettingsDivider />
              <div>
                <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "3px" }}>PostHog project key</div>
                <input
                  type="password"
                  value={telemetryRemoteProjectKey}
                  onChange={(e) => onTelemetryRemoteProjectKeyChange(e.target.value)}
                  placeholder="phc_..."
                  style={{
                    padding: "6px 8px",
                    background: colors.surface,
                    border: `1px solid ${colors.border}`,
                    borderRadius: radii.sm,
                    color: colors.text,
                    fontSize: "12px",
                    outline: "none",
                    width: "100%",
                    boxSizing: "border-box" as const,
                    fontFamily: "inherit",
                  }}
                />
              </div>

              <div style={{ marginTop: "6px" }}>
                <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "3px" }}>Host</div>
                <input
                  type="text"
                  value={telemetryRemoteHost}
                  onChange={(e) => onTelemetryRemoteHostChange(e.target.value)}
                  placeholder="https://us.i.posthog.com"
                  style={{
                    padding: "6px 8px",
                    background: colors.surface,
                    border: `1px solid ${colors.border}`,
                    borderRadius: radii.sm,
                    color: colors.text,
                    fontSize: "12px",
                    outline: "none",
                    width: "100%",
                    boxSizing: "border-box" as const,
                    fontFamily: "inherit",
                  }}
                />
              </div>
            </>
          )}

          <SettingsDivider />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "6px" }}>
            {[
              ["Events", telemetrySnapshot.events.length],
              ["Spans", telemetrySnapshot.spans.length],
              ["Errors", telemetrySnapshot.errors.length],
              ["Held", telemetrySnapshot.suppressedCount],
              ["Native", telemetrySnapshot.nativeRecordCount],
              ["Queued", telemetrySnapshot.queuedRemoteCount],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{
                  background: colors.surface,
                  border: `1px solid ${colors.border}`,
                  borderRadius: radii.xs,
                  padding: "6px 4px",
                  textAlign: "center",
                  minWidth: 0,
                }}
              >
                <div style={{ ...typography.caption, color: colors.text, fontWeight: 600 }}>{value}</div>
                <div style={{ ...typography.small, color: colors.textTertiary, overflow: "hidden", textOverflow: "ellipsis" }}>
                  {label}
                </div>
              </div>
            ))}
          </div>

          <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "6px" }}>
            Native: {telemetrySnapshot.nativeStoreStatus} | Remote: {telemetrySnapshot.remoteStatus} | Retention: 14 days
          </div>
          <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "4px" }}>
            Dropped: {telemetrySnapshot.droppedUnknownEventCount} names, {telemetrySnapshot.droppedUnknownPropertyCount} props | Redacted: {telemetrySnapshot.redactedValueCount}
          </div>
          <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "4px" }}>
            Catalog: {getTelemetryCatalogSummary().length} allowlisted records across local diagnostics, voice, model, screen, and computer-use categories.
          </div>

          <SettingsDivider />

          <div style={{ display: "flex", gap: "6px" }}>
            <button
              onClick={async () => {
                recordTelemetryEvent("diagnostics.export_requested");
                const blob = new Blob([await exportTelemetryBundleJson()], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `dante-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
                setTelemetrySnapshot(getTelemetrySnapshot());
              }}
              style={{
                flex: 1,
                padding: "7px 10px",
                background: "transparent",
                border: `1px solid ${colors.border}`,
                borderRadius: radii.sm,
                color: colors.textSecondary,
                cursor: "pointer",
                ...typography.caption,
              }}
            >
              Export diagnostics
            </button>
            <button
              onClick={() => {
                clearTelemetryBuffer();
                setTelemetrySnapshot(getTelemetrySnapshot());
              }}
              style={{
                padding: "7px 10px",
                background: "transparent",
                border: `1px solid ${colors.border}`,
                borderRadius: radii.sm,
                color: colors.textSecondary,
                cursor: "pointer",
                ...typography.caption,
              }}
            >
              Clear
            </button>
          </div>
        </SettingsCard>
      </div>

      <div style={sectionStyle}>
        <SettingsCard index={5}>
          {sectionHeader("👁", "Ambient Mode")}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ ...typography.caption, color: ambientMode ? colors.accent : colors.textSecondary }}>
                Always-on screen awareness
              </div>
              <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "1px" }}>
                Silently captures screen context in the background
              </div>
            </div>
            <ToggleButton on={ambientMode} onToggle={onToggleAmbient} />
          </div>

          {ambientMode && (
            <>
              <SettingsDivider />

              {/* Capture count badge */}
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ ...typography.small, color: colors.textTertiary }}>Captures today</span>
                <span style={{
                  ...typography.caption,
                  color: colors.accent,
                  background: `${colors.accent}18`,
                  border: `1px solid ${colors.accent}33`,
                  borderRadius: radii.xs,
                  padding: "1px 6px",
                  fontWeight: 600,
                }}>
                  {captureCountToday}
                </span>
              </div>

              {/* Capture latency (D38 perf proof) */}
              {ambientCaptureDurationsMs.length > 0 && (() => {
                const sorted = [...ambientCaptureDurationsMs].sort((a, b) => a - b);
                const pct = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))];
                const p50 = pct(0.5);
                const p95 = pct(0.95);
                return (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ ...typography.small, color: colors.textTertiary }}>Capture latency</span>
                    <span style={{ ...typography.small, color: colors.textTertiary }}>
                      {p50}ms p50 · {p95}ms p95 · n={sorted.length}
                    </span>
                  </div>
                );
              })()}

              <SettingsDivider />

              {/* Capture interval */}
              <div>
                <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "6px" }}>Capture interval</div>
                <div style={{ display: "flex", gap: "4px" }}>
                  {([30, 60, 120, 300] as const).map((secs) => (
                    <button
                      key={secs}
                      onClick={() => onAmbientIntervalChange(secs)}
                      style={{
                        flex: 1,
                        padding: "5px 4px",
                        borderRadius: radii.xs,
                        border: `1px solid ${ambientIntervalSeconds === secs ? colors.accent : colors.border}`,
                        background: ambientIntervalSeconds === secs ? `${colors.accent}22` : "transparent",
                        color: ambientIntervalSeconds === secs ? colors.accent : colors.textSecondary,
                        cursor: "pointer",
                        ...typography.small,
                        fontWeight: ambientIntervalSeconds === secs ? 600 : 400,
                      }}
                    >
                      {secs < 60 ? `${secs}s` : `${secs / 60}m`}
                    </button>
                  ))}
                </div>
              </div>

              <SettingsDivider />

              {/* Excluded apps */}
              <div>
                <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "4px" }}>
                  Skip these apps (comma-separated)
                </div>
                <input
                  type="text"
                  value={ambientExcludedApps}
                  onChange={(e) => onAmbientExcludedAppsChange(e.target.value)}
                  placeholder="1Password, Bitwarden, KeePass"
                  style={{
                    padding: "6px 8px",
                    background: colors.surface,
                    border: `1px solid ${colors.border}`,
                    borderRadius: radii.sm,
                    color: colors.text,
                    fontSize: "12px",
                    outline: "none",
                    width: "100%",
                    boxSizing: "border-box" as const,
                    fontFamily: "inherit",
                  }}
                />
                <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "3px" }}>
                  Matching windows are never captured
                </div>
              </div>

              <SettingsDivider />

              {/* Ambient history viewer */}
              <div>
                <button
                  onClick={async () => {
                    const next = !showAmbientHistory;
                    setShowAmbientHistory(next);
                    if (next) {
                      try {
                        const rows = await invoke<AmbientSnapshotRow[]>("get_recent_ambient_snapshots", { limit: 20 });
                        setAmbientSnapshots(rows);
                      } catch { /* DB unavailable */ }
                    }
                  }}
                  style={{
                    padding: "7px 10px",
                    background: "transparent",
                    border: `1px solid ${colors.border}`,
                    borderRadius: radii.sm,
                    color: colors.textSecondary,
                    cursor: "pointer",
                    ...typography.caption,
                    textAlign: "left" as const,
                    width: "100%",
                  }}
                >
                  {showAmbientHistory ? "Hide recent captures" : "View recent captures"}
                </button>

                {showAmbientHistory && (
                  <div style={{
                    maxHeight: 200,
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: 4,
                    marginTop: 6,
                  }}>
                    {ambientSnapshots.length === 0 ? (
                      <div style={{ ...typography.small, color: colors.textTertiary, padding: "6px 8px" }}>
                        No captures yet
                      </div>
                    ) : ambientSnapshots.map((row) => {
                      const iso = row.captured_at.includes("T") ? row.captured_at : row.captured_at.replace(" ", "T") + "Z";
                      const ts = new Date(iso).getTime();
                      const age = Number.isFinite(ts) ? timeAgo(ts) : row.captured_at;
                      return (
                        <div key={row.id} style={{
                          background: colors.background,
                          borderRadius: radii.xs,
                          padding: "6px 8px",
                          display: "flex",
                          flexDirection: "column",
                          gap: 2,
                        }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ ...typography.caption, color: colors.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                              {row.active_window || "Desktop"}
                            </span>
                            <span style={{ ...typography.small, color: colors.textTertiary, flexShrink: 0 }}>{age}</span>
                          </div>
                          {row.ocr_snippet && (
                            <div style={{ ...typography.small, color: colors.textSecondary, fontSize: 11, lineHeight: 1.3, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                              {row.ocr_snippet}
                            </div>
                          )}
                          {row.vision_desc && (
                            <span style={{ ...typography.small, color: colors.accent, fontSize: 10 }}>
                              vision ✓
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <SettingsDivider />

              {/* Clear ambient history */}
              <button
                onClick={async () => {
                  try {
                    await invoke("prune_ambient_snapshots", { days: 0 });
                    setCaptureCountToday(0);
                    setAmbientSnapshots([]);
                    setShowAmbientHistory(false);
                  } catch { /* DB unavailable */ }
                }}
                style={{
                  padding: "7px 10px",
                  background: "transparent",
                  border: `1px solid ${colors.error}44`,
                  borderRadius: radii.sm,
                  color: colors.error,
                  cursor: "pointer",
                  ...typography.caption,
                  textAlign: "left" as const,
                  width: "100%",
                }}
              >
                Clear ambient history
              </button>
            </>
          )}
        </SettingsCard>
      </div>

      {/* ── Local vision (Moondream2) ────────────────────── */}
      <div style={sectionStyle}>
        <LocalVisionCard />
      </div>

      {/* ── Video & temporal context (Dim 16) ───────────── */}
      <div style={sectionStyle}>
        <VideoControls />
      </div>

      {/* ── Appearance ───────────────────────────────────── */}
      <div style={sectionStyle}>
        <SettingsCard index={6}>
          {sectionHeader("🎨", "Appearance")}

          {/* Overlay opacity */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
              <div style={{ ...typography.caption, color: colors.textSecondary }}>Overlay opacity</div>
              <span style={{ ...typography.caption, color: colors.accent, fontWeight: 600 }}>{Math.round(overlayOpacity * 100)}%</span>
            </div>
            <input
              type="range"
              min={50}
              max={100}
              step={5}
              value={Math.round(overlayOpacity * 100)}
              onChange={(e) => onOverlayOpacityChange(Number(e.target.value) / 100)}
              style={{ width: "100%", accentColor: colors.accent, cursor: "pointer" }}
            />
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ ...typography.small, color: colors.textTertiary }}>50%</span>
              <span style={{ ...typography.small, color: colors.textTertiary }}>100%</span>
            </div>
          </div>

          {/* Position */}
          <SettingsDivider />
          <div>
            <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "4px" }}>Panel position</div>
            <div style={{ display: "flex", gap: "6px" }}>
              {(["left", "right"] as const).map((pos) => (
                <button
                  key={pos}
                  onClick={() => onOverlayPositionChange(pos)}
                  style={{
                    flex: 1,
                    padding: "6px",
                    borderRadius: radii.sm,
                    border: `1px solid ${overlayPosition === pos ? colors.accent : colors.border}`,
                    background: overlayPosition === pos ? "rgba(10,132,255,0.12)" : "transparent",
                    color: overlayPosition === pos ? colors.text : colors.textSecondary,
                    cursor: "pointer",
                    fontSize: "12px",
                    textTransform: "capitalize",
                  }}
                >
                  {pos === "left" ? "← Left" : "Right →"}
                </button>
              ))}
            </div>
          </div>
        </SettingsCard>
      </div>

      {/* ── App ──────────────────────────────────────────── */}
      <div style={sectionStyle}>
        <SettingsCard index={7}>
          {sectionHeader("⚙", "App")}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ ...typography.caption, color: colors.textSecondary }}>Launch at login</span>
            <ToggleButton on={autostart} onToggle={onToggleAutostart} />
          </div>

          <SettingsDivider />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ ...typography.caption, color: colors.textSecondary }}>Hide from screen recordings</div>
              <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "1px" }}>
                Invisible to Zoom, Teams, OBS, Game Bar
              </div>
            </div>
            <ToggleButton
              on={stealthMode}
              onToggle={async () => {
                const next = !stealthMode;
                try {
                  await invoke("set_overlay_stealth", { enabled: next });
                  setStealthMode(next);
                } catch (e) {
                  console.warn("[stealth]", e);
                }
              }}
            />
          </div>
        </SettingsCard>
      </div>

    </div>
  );
}

function LocalVisionCard() {
  const moondream = useMoondream();
  const ambientVisionEnabled = useCompanionStore(s => s.ambientVisionEnabled);
  const setAmbientVisionEnabled = useCompanionStore(s => s.setAmbientVisionEnabled);
  const moondreamSessionLoaded = useCompanionStore(s => s.moondreamSessionLoaded);
  const setMoondreamSessionLoaded = useCompanionStore(s => s.setMoondreamSessionLoaded);
  const inferenceDurations = useCompanionStore(s => s.moondreamInferenceDurationsMs);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const status = moondream.status;
  const available = status?.available ?? false;
  const sessionLoaded = (status?.session_loaded ?? false) || moondreamSessionLoaded;
  const dtype = status?.dtype ?? null;
  const backendError = status?.last_error ?? null;

  // Keep the store flag in sync when the Tauri-reported status changes,
  // so useAmbient.ts and useVoice.ts see the right session_loaded value.
  useEffect(() => {
    if (status && status.session_loaded !== moondreamSessionLoaded) {
      setMoondreamSessionLoaded(status.session_loaded);
    }
  }, [status?.session_loaded, moondreamSessionLoaded, setMoondreamSessionLoaded, status]);

  async function handleLoad() {
    setLoading(true);
    setLoadError(null);
    try {
      await moondream.loadModel();
      setMoondreamSessionLoaded(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLoadError(msg);
      console.error("loadModel failed:", err);
    } finally {
      setLoading(false);
    }
  }

  // Compute p50/p95 from the rolling inference-duration window (Track D).
  const sortedDurations = inferenceDurations.length > 0
    ? [...inferenceDurations].sort((a, b) => a - b)
    : null;
  const p50 = sortedDurations
    ? sortedDurations[Math.min(sortedDurations.length - 1, Math.floor(sortedDurations.length * 0.5))]
    : null;
  const p95 = sortedDurations
    ? sortedDurations[Math.min(sortedDurations.length - 1, Math.floor(sortedDurations.length * 0.95))]
    : null;

  const displayedError = loadError ?? backendError;

  const dl = moondream.downloadProgress;
  const downloadPct = dl && dl.bytes_total > 0
    ? Math.floor((dl.bytes_done / dl.bytes_total) * 100)
    : null;

  return (
    <SettingsCard index={6}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <div style={{ ...typography.caption, color: colors.text, fontWeight: 600 }}>👁️ Local vision (Moondream2)</div>
          <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "1px" }}>
            On-device image captioning + VQA via candle-transformers
          </div>
        </div>
      </div>

      <SettingsDivider />

      {/* Status row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ ...typography.small, color: colors.textTertiary }}>Status</span>
        <span style={{
          ...typography.caption,
          color: sessionLoaded ? colors.success : (available ? colors.accent : colors.textTertiary),
          fontWeight: 600,
        }}>
          {sessionLoaded
            ? `● Loaded${dtype ? ` (${dtype})` : ""}`
            : available ? "○ Downloaded" : "Not installed"}
        </span>
      </div>

      {/* Inference latency p50/p95 — Track D telemetry. Replaces the single-value
          "Last inference: Xms" line with a proper distribution summary. */}
      {sessionLoaded && p50 !== null && p95 !== null && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ ...typography.small, color: colors.textTertiary }}>Inference latency</span>
          <span style={{ ...typography.small, color: colors.textTertiary }}>
            {p50}ms p50 · {p95}ms p95 · n={inferenceDurations.length}
          </span>
        </div>
      )}

      {/* Error UI — Track E. Shows the most recent load/inference error and
          a retry button so the user can recover without restarting. */}
      {displayedError && (
        <div style={{
          padding: "6px 8px",
          background: `${colors.error}18`,
          border: `1px solid ${colors.error}33`,
          borderRadius: radii.xs,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}>
          <div style={{ ...typography.small, color: colors.error, wordBreak: "break-word" }}>
            {displayedError}
          </div>
          <button
            onClick={() => { setLoadError(null); handleLoad(); }}
            disabled={loading}
            style={{
              padding: "4px 8px",
              background: "transparent",
              border: `1px solid ${colors.error}66`,
              borderRadius: radii.xs,
              color: colors.error,
              cursor: loading ? "wait" : "pointer",
              ...typography.small,
              alignSelf: "flex-start",
            }}
          >
            {loading ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}

      {/* Download button — only when not yet downloaded */}
      {!available && (
        <button
          onClick={moondream.download}
          disabled={moondream.downloading}
          style={{
            padding: "7px 10px",
            background: "transparent",
            border: `1px solid ${colors.accent}66`,
            borderRadius: radii.sm,
            color: colors.accent,
            cursor: moondream.downloading ? "wait" : "pointer",
            ...typography.caption,
            textAlign: "left" as const,
            width: "100%",
            opacity: moondream.downloading ? 0.6 : 1,
          }}
        >
          {moondream.downloading
            ? (downloadPct !== null ? `Downloading… ${downloadPct}% (${dl?.file ?? ""})` : "Downloading…")
            : "Download model (~3.7 GB)"}
        </button>
      )}

      {/* Load button — only when downloaded but session not yet loaded */}
      {available && !sessionLoaded && (
        <button
          onClick={handleLoad}
          disabled={loading}
          style={{
            padding: "7px 10px",
            background: "transparent",
            border: `1px solid ${colors.accent}66`,
            borderRadius: radii.sm,
            color: colors.accent,
            cursor: loading ? "wait" : "pointer",
            ...typography.caption,
            textAlign: "left" as const,
            width: "100%",
            opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "Loading model into memory…" : "Load model"}
        </button>
      )}

      {/* Enable/disable ambient vision usage */}
      {sessionLoaded && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ ...typography.caption, color: colors.textSecondary }}>Use in ambient capture</div>
            <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "1px" }}>
              Adds vision descriptions to ambient snapshots
            </div>
          </div>
          <ToggleButton on={ambientVisionEnabled} onToggle={() => setAmbientVisionEnabled(!ambientVisionEnabled)} />
        </div>
      )}
    </SettingsCard>
  );
}

function PlatformStatusCard({ capabilities }: { capabilities: PlatformCapabilities | null }) {
  if (!capabilities) {
    return (
      <div style={{ ...typography.small, color: colors.textTertiary }}>
        Platform diagnostics unavailable
      </div>
    );
  }

  const rows: Array<{ key: keyof PlatformCapabilities; label: string; status: CapabilityStatus }> = [
    { key: "nativeScreenCapture", label: "Screen capture", status: capabilities.nativeScreenCapture },
    { key: "nativeInputControl", label: "Input control", status: capabilities.nativeInputControl },
    { key: "accessibilityTree", label: "Accessibility tree", status: capabilities.accessibilityTree },
    { key: "ocr", label: "OCR", status: capabilities.ocr },
    { key: "globalShortcut", label: "Global shortcut", status: capabilities.globalShortcut },
    { key: "tray", label: "Tray", status: capabilities.tray },
    { key: "overlayStealth", label: "Screen-share privacy", status: capabilities.overlayStealth },
    { key: "autostart", label: "Autostart", status: capabilities.autostart },
  ];

  const statusText = (status: CapabilityStatus) =>
    status.supported && !status.degraded ? "Native" : status.supported ? "Degraded" : "Unavailable";

  const statusColor = (status: CapabilityStatus) =>
    status.supported && !status.degraded ? colors.success : status.supported ? colors.warning : "#FF453A";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
        <div>
          <div style={{ ...typography.caption, color: colors.textSecondary }}>
            {capabilities.os} / {capabilities.family}
          </div>
          <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "1px" }}>
            Runtime capability map for this machine
          </div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "6px" }}>
        {rows.map(({ key, label, status }) => (
          <div
            key={String(key)}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 1fr) auto",
              gap: "8px",
              alignItems: "start",
              padding: "7px 8px",
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: radii.sm,
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div style={{ ...typography.small, color: colors.textSecondary }}>{label}</div>
              <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "1px" }}>
                {status.backend}{status.reason ? ` - ${status.reason}` : ""}
              </div>
            </div>
            <span style={{ ...typography.small, color: statusColor(status), whiteSpace: "nowrap" }}>
              {statusText(status)}
            </span>
          </div>
        ))}
      </div>
      {capabilities.notes.length > 0 && (
        <div style={{ ...typography.small, color: colors.textTertiary }}>
          {capabilities.notes[0]}
        </div>
      )}
    </div>
  );
}

function SettingsCard({ children, index = 0 }: { children: React.ReactNode; index?: number }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        background: colors.backgroundSecondary,
        borderRadius: radii.md,
        border: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        animation: `fadeInUp 0.2s ease ${index * 0.05}s both`,
      }}
    >
      {children}
    </div>
  );
}

function SettingsDivider() {
  return <div style={{ height: "1px", background: colors.border, margin: "0 -2px" }} />;
}

function speechLanguageToneColor(tone: SpeechLanguageStatusTone): string {
  if (tone === "success") return colors.success;
  if (tone === "warning") return colors.warning;
  return colors.accent;
}

function speechLanguageToneBackground(tone: SpeechLanguageStatusTone): string {
  if (tone === "success") return "rgba(50, 215, 75, 0.10)";
  if (tone === "warning") return "rgba(255, 159, 10, 0.12)";
  return "rgba(10, 132, 255, 0.10)";
}

function SpeechLanguageSection({
  speechLanguage,
  onSpeechLanguageChange,
}: {
  speechLanguage: SpeechLanguageCode;
  onSpeechLanguageChange: (language: SpeechLanguageCode) => void;
}) {
  const selectedOption = speechLanguageOptionForCode(speechLanguage);
  const support = getSpeechLanguageSupport(selectedOption.code);
  const languageTone: SpeechLanguageStatusTone =
    support.cloudTier === "local-recommended" ? "warning" : "info";
  const languageToneColor = speechLanguageToneColor(languageTone);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <select
        value={selectedOption.code}
        onChange={(event) => onSpeechLanguageChange(event.target.value as SpeechLanguageCode)}
        aria-label="Speech language"
        style={{
          width: "100%",
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.sm,
          color: colors.text,
          cursor: "pointer",
          fontSize: "12px",
          fontFamily: "inherit",
          padding: "6px 8px",
          outline: "none",
        }}
      >
        {SPEECH_LANGUAGE_OPTIONS.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}{option.code === "auto" ? "" : ` - ${option.nativeLabel}`}
          </option>
        ))}
      </select>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "6px",
          padding: "6px 8px",
          borderRadius: radii.xs,
          background: speechLanguageToneBackground(languageTone),
          border: `1px solid ${languageToneColor}33`,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: "6px",
            height: "6px",
            borderRadius: radii.full,
            background: languageToneColor,
            marginTop: "4px",
            flexShrink: 0,
          }}
        />
        <div style={{ ...typography.small, color: colors.textSecondary }}>
          {selectedOption.code === "auto"
            ? support.cloudLabel
            : support.cloudTier === "local-recommended"
              ? support.fallbackLabel
              : `${selectedOption.label} uses native cloud prompts and ${support.localLabel.toLowerCase()}`}
        </div>
      </div>
    </div>
  );
}

function ModelPicker({
  selected,
  onChange,
}: {
  selected: ModelOption;
  onChange: (m: ModelOption) => void;
}) {
  return (
    <div>
      <SectionLabel>Model</SectionLabel>
      <div
        role="radiogroup"
        aria-label="AI model selection"
        style={{ display: "flex", flexDirection: "column", gap: "3px" }}
      >
        {MODEL_OPTIONS.map((m) => {
          const isSelected = selected.modelId === m.modelId;
          return (
            <button
              key={`${m.provider}-${m.modelId}`}
              role="radio"
              aria-checked={isSelected}
              onClick={() => onChange(m)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "7px 10px",
                borderRadius: radii.sm,
                border: `1px solid ${isSelected ? colors.accent : "transparent"}`,
                background: isSelected ? "rgba(10,132,255,0.12)" : "transparent",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.12s",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: "7px",
                  height: "7px",
                  borderRadius: radii.full,
                  background: providerColors[m.provider] ?? colors.accent,
                  flexShrink: 0,
                }}
              />
              <span style={{ ...typography.body, color: isSelected ? colors.text : colors.textSecondary }}>
                {m.displayName}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SttModeSection({ speechLanguage }: { speechLanguage: SpeechLanguageCode }) {
  const { sttMode, setSttMode } = useCompanionStore();
  const languageOption = speechLanguageOptionForCode(speechLanguage);
  const languageStatus = buildSpeechLanguageStatus(speechLanguage, sttMode);
  const languageStatusColor = speechLanguageToneColor(languageStatus.tone);
  const expectedLocalRepository = languageOption.localWhisperModel === "english"
    ? "openai/whisper-tiny.en"
    : "openai/whisper-tiny";
  const [sttStatus, setSttStatus] = useState<{
    mode: string;
    available: boolean;
    model_language?: string | null;
    model_repository?: string | null;
  } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0); // 0–100
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    invoke<{ mode: string; available: boolean; model_language?: string | null; model_repository?: string | null }>("get_local_model_status")
      .then((status) => {
        setSttStatus(status);
        setSttMode(status.mode === "Local" ? "Local" : "Cloud");
      })
      .catch(() => {});
  }, [speechLanguage, setSttMode]);

  async function handleDownload() {
    setDownloading(true);
    setDownloadProgress(0);
    setDownloadError(null);

    // Listen for streaming progress events from Rust
    const unlisten = await listen<{ file: string; bytes_done: number; bytes_total: number }>(
      "whisper-download-progress",
      ({ payload }) => {
        if (payload.bytes_total > 0) {
          setDownloadProgress(Math.round((payload.bytes_done / payload.bytes_total) * 100));
        }
      }
    );

    try {
      await invoke("download_whisper_model", { languageCode: speechLanguage });
      await invoke("set_stt_mode", { mode: "Local" });
      setSttMode("Local");
      setSttStatus(prev => prev ? { ...prev, available: true, mode: "Local", model_language: languageOption.code, model_repository: expectedLocalRepository } : { mode: "Local", available: true, model_language: languageOption.code, model_repository: expectedLocalRepository });
    } catch (e) {
      setDownloadError(String(e).slice(0, 120));
    } finally {
      unlisten();
      setDownloading(false);
      setDownloadProgress(0);
    }
  }

  if (!sttStatus) return null;
  const selectedLocalModelAvailable =
    sttStatus.available && sttStatus.model_repository === expectedLocalRepository;

  return (
    <div>
      <SectionLabel>Speech Recognition</SectionLabel>
      <div style={{ display: "flex", gap: "6px" }}>
        {(["Cloud", "Local"] as const).map((m) => {
          const active = sttMode === m;
          const disabled = m === "Local" && !selectedLocalModelAvailable;
          return (
            <button
              key={m}
              disabled={disabled}
              onClick={async () => {
                try {
                  await invoke("set_stt_mode", { mode: m });
                  setSttMode(m);
                  setSttStatus(prev => prev ? { ...prev, mode: m } : prev);
                } catch (e) {
                  console.warn("[STT]", e);
                }
              }}
              style={{
                flex: 1,
                padding: "6px",
                borderRadius: radii.sm,
                border: `1px solid ${active ? colors.accent : colors.border}`,
                background: active ? "rgba(10,132,255,0.12)" : "transparent",
                color: disabled ? colors.textTertiary : active ? colors.text : colors.textSecondary,
                cursor: disabled ? "not-allowed" : "pointer",
                fontSize: "12px",
                opacity: disabled ? 0.5 : 1,
              }}
            >
              {m === "Cloud" ? "☁ Cloud" : "⬡ Local"}
            </button>
          );
        })}
      </div>
      <div
        style={{
          marginTop: "8px",
          padding: "7px 9px",
          borderRadius: radii.xs,
          background: speechLanguageToneBackground(languageStatus.tone),
          border: `1px solid ${languageStatusColor}33`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
          <span style={{ ...typography.small, color: languageStatusColor }}>
            {languageStatus.title}
          </span>
          <span style={{ ...typography.small, color: colors.textTertiary }}>
            {languageStatus.confidenceLabel}
          </span>
        </div>
        <div style={{ ...typography.small, color: colors.textSecondary, marginTop: "3px" }}>
          {languageStatus.message}
        </div>
        {languageStatus.recommendedMode !== sttMode && (
          <div style={{ ...typography.small, color: colors.warning, marginTop: "3px" }}>
            Recommended: switch to {languageStatus.recommendedMode}
          </div>
        )}
      </div>
      {!selectedLocalModelAvailable && (
        <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "4px" }}>
          <button
            onClick={handleDownload}
            disabled={downloading}
            style={{
              padding: "7px 12px",
              background: downloading ? colors.surface : colors.accent,
              border: "none",
              borderRadius: radii.sm,
              color: "#fff",
              cursor: downloading ? "not-allowed" : "pointer",
              ...typography.caption,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              opacity: downloading ? 0.7 : 1,
              transition: "opacity 0.2s",
            }}
          >
            {downloading ? (
              <>
                <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>↻</span>
                {downloadProgress > 0 ? `Downloading… ${downloadProgress}%` : "Downloading…"}
              </>
            ) : (
              `Download ${languageOption.localWhisperModel === "english" ? "English" : "multilingual"} Whisper model (~150MB)`
            )}
          </button>
          {downloadError && (
            <div style={{ ...typography.small, color: colors.error }}>
              {downloadError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── STT accuracy upgrades (Dim 2: STT Cloud Accuracy) ──────────────────────
// Surfaces two settings that drive Cloud-mode WER:
//   1) Personal Dictionary — proper nouns, code identifiers, domain vocab.
//      Sent to AssemblyAI as keyterms_prompt to bias recognition. Up to 1,000
//      terms; we cap at a safe URL-budget before sending.
//   2) AI Polish (LLM cleanup) — runs the raw transcript through Haiku 4.5
//      (or gpt-4o-mini fallback) for capitalization, punctuation, and
//      disfluency removal. Anti-hallucination contract enforces "fix only
//      what was spoken".
function SttAccuracySection() {
  const {
    personalDictionary,
    setPersonalDictionary,
    sttCleanupMode,
    setSttCleanupMode,
  } = useCompanionStore();
  const [draft, setDraft] = useState("");

  const addTerm = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (personalDictionary.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      setDraft("");
      return;
    }
    setPersonalDictionary([...personalDictionary, trimmed]);
    setDraft("");
  };

  const removeTerm = (term: string) => {
    setPersonalDictionary(personalDictionary.filter((t) => t !== term));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {/* AI Polish mode picker */}
      <div>
        <SectionLabel>AI Polish</SectionLabel>
        <div style={{ display: "flex", gap: "6px" }}>
          {(["off", "dictation", "formal"] as const).map((mode) => {
            const active = sttCleanupMode === mode;
            const label = mode === "off" ? "Raw" : mode === "dictation" ? "Dictation" : "Formal";
            return (
              <button
                key={mode}
                onClick={() => setSttCleanupMode(mode)}
                style={{
                  flex: 1,
                  padding: "6px",
                  borderRadius: radii.sm,
                  border: `1px solid ${active ? colors.accent : colors.border}`,
                  background: active ? "rgba(10,132,255,0.12)" : "transparent",
                  color: active ? colors.text : colors.textSecondary,
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "4px" }}>
          {sttCleanupMode === "off"
            ? "No post-processing. Lowest latency, raw ASR output."
            : sttCleanupMode === "dictation"
            ? "Light polish — capitalization, punctuation, filler removal."
            : "Stronger polish — formal sentence structure (slower)."}
        </div>
      </div>

      {/* Personal Dictionary editor */}
      <div>
        <SectionLabel>Personal Dictionary ({personalDictionary.length})</SectionLabel>
        <div style={{ display: "flex", gap: "6px" }}>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTerm();
              }
            }}
            placeholder="Add a proper noun, code identifier, or domain term"
            style={{
              flex: 1,
              padding: "6px 8px",
              borderRadius: radii.sm,
              border: `1px solid ${colors.border}`,
              background: colors.surface,
              color: colors.text,
              fontSize: "12px",
            }}
          />
          <button
            onClick={addTerm}
            disabled={!draft.trim()}
            style={{
              padding: "6px 12px",
              borderRadius: radii.sm,
              border: "none",
              background: draft.trim() ? colors.accent : colors.surface,
              color: draft.trim() ? "#fff" : colors.textTertiary,
              cursor: draft.trim() ? "pointer" : "not-allowed",
              fontSize: "12px",
            }}
          >
            Add
          </button>
        </div>
        {personalDictionary.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
              marginTop: "8px",
              maxHeight: "120px",
              overflowY: "auto",
            }}
          >
            {personalDictionary.map((term) => (
              <span
                key={term}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "3px 6px 3px 8px",
                  borderRadius: radii.sm,
                  background: "rgba(10,132,255,0.08)",
                  border: `1px solid ${colors.border}`,
                  fontSize: "11px",
                  color: colors.text,
                }}
              >
                {term}
                <button
                  onClick={() => removeTerm(term)}
                  aria-label={`Remove ${term}`}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: colors.textTertiary,
                    cursor: "pointer",
                    padding: "0 2px",
                    fontSize: "12px",
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "4px" }}>
          Sent to AssemblyAI as keyterms each PTT — biases recognition toward your vocabulary.
        </div>
      </div>
    </div>
  );
}

function parseCloneError(raw: unknown): string {
  const s = String(raw);
  const jsonStart = s.indexOf("{");
  if (jsonStart !== -1) {
    try {
      const json = JSON.parse(s.slice(jsonStart));
      const msg = json?.detail?.message ?? json?.detail?.status_message ?? json?.message;
      if (msg && typeof msg === "string") return msg;
    } catch { /* not JSON */ }
  }
  return s.replace(/^Voice clone failed:\s*/i, "");
}

function TtsModeSection({
  ttsMode,
  setTtsMode,
  speechLanguage,
}: {
  ttsMode: "cloud" | "local";
  setTtsMode: (mode: "cloud" | "local") => void;
  speechLanguage?: SpeechLanguageCode;
}) {
  const {
    elevenLabsKey,
    elevenLabsVoiceId, setElevenLabsVoiceId,
    elevenLabsCustomVoiceId, setElevenLabsCustomVoiceId,
    ttsQuality, setTtsQuality,
  } = useCompanionStore();

  const [voiceLibrary, setVoiceLibrary] = useState<ElevenLabsVoice[]>([]);
  const [voiceSearch, setVoiceSearch] = useState("");
  const [voiceCategory, setVoiceCategory] = useState<"all" | "mine" | "builtin">("all");
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [previewPlayingId, setPreviewPlayingId] = useState<string | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [cloneFiles, setCloneFiles] = useState<{ name: string; base64: string }[]>([]);
  const [cloneLoading, setCloneLoading] = useState(false);
  const [cloneError, setCloneError] = useState("");
  const [cloneSuccess, setCloneSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!elevenLabsKey) {
      setVoiceLibrary(
        ELEVENLABS_VOICES.map((v) => ({
          voice_id: v.id, name: v.name,
          category: "premade" as const, labels: { style: v.style },
        }))
      );
      return;
    }
    setVoiceLoading(true);
    fetchVoiceLibrary()
      .then((voices) => {
        setVoiceLibrary(
          voices.length > 0
            ? voices
            : ELEVENLABS_VOICES.map((v) => ({
                voice_id: v.id, name: v.name,
                category: "premade" as const, labels: { style: v.style },
              }))
        );
      })
      .finally(() => setVoiceLoading(false));
  }, [elevenLabsKey]);

  // Language-aware voice filtering: prioritize voices that support the selected language
  const languageFilteredVoices = filterVoicesByLanguage(voiceLibrary, speechLanguage);

  const filteredVoices = languageFilteredVoices
    .filter((v) => {
      if (voiceCategory === "mine") return v.category === "cloned" || v.category === "professional" || v.category === "generated";
      if (voiceCategory === "builtin") return v.category === "premade";
      return true;
    })
    .filter((v) => !voiceSearch.trim() || v.name.toLowerCase().includes(voiceSearch.toLowerCase()));

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const MAX_FILE_BYTES = 10 * 1024 * 1024;
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const oversized = files.filter((f) => f.size > MAX_FILE_BYTES);
    const valid = files.filter((f) => f.size <= MAX_FILE_BYTES);

    if (oversized.length > 0) {
      setCloneError(
        `${oversized.map((f) => f.name).join(", ")} ${oversized.length === 1 ? "is" : "are"} over 10 MB — ElevenLabs limit. Use a shorter clip.`
      );
    }

    if (valid.length === 0) { e.target.value = ""; return; }

    Promise.all(
      valid.map(
        (file) =>
          new Promise<{ name: string; base64: string }>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              const base64 = result.includes(",") ? result.split(",")[1] : result;
              resolve({ name: file.name, base64 });
            };
            reader.readAsDataURL(file);
          })
      )
    ).then((loaded) => setCloneFiles((prev) => [...prev, ...loaded]));
    e.target.value = "";
  }

  async function handleClone() {
    if (!cloneName.trim() || cloneFiles.length === 0) return;
    setCloneLoading(true);
    setCloneError("");
    setCloneSuccess(false);
    try {
      const voiceId = await invoke<string>("elevenlabs_add_voice", {
        name: cloneName.trim(),
        audioFiles: cloneFiles.map((f) => ({ base64: f.base64, fileName: f.name })),
        description: undefined,
      });
      const voices = await fetchVoiceLibrary();
      if (voices.length > 0) setVoiceLibrary(voices);
      setElevenLabsVoiceId(voiceId);
      setElevenLabsCustomVoiceId("");
      setCloneOpen(false);
      setCloneName("");
      setCloneFiles([]);
      setCloneSuccess(true);
      setTimeout(() => setCloneSuccess(false), 3000);
    } catch (e) {
      setCloneError(parseCloneError(e));
    } finally {
      setCloneLoading(false);
    }
  }

  const cloneFilesTotalMB = cloneFiles.length > 0
    ? (cloneFiles.reduce((acc, f) => acc + f.base64.length * 0.75, 0) / (1024 * 1024)).toFixed(1)
    : "0";

  const QUALITY_OPTIONS: { id: "fast" | "balanced" | "max"; label: string; hint: string }[] = [
    { id: "fast",     label: "Fast",     hint: "Flash · 128kbps · lowest latency" },
    { id: "balanced", label: "Balanced", hint: "Turbo · 192kbps · recommended" },
    { id: "max",      label: "Max",      hint: "Multilingual v2 · 192kbps · best quality" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <SectionLabel>Text-to-Speech</SectionLabel>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => setTtsMode("cloud")}
          style={{
            flex: 1, padding: "6px 12px", borderRadius: radii.sm,
            border: `1px solid ${ttsMode === "cloud" ? colors.accent : colors.border}`,
            background: ttsMode === "cloud" ? "rgba(10,132,255,0.12)" : "transparent",
            color: ttsMode === "cloud" ? colors.text : colors.textSecondary,
            fontSize: 12, cursor: "pointer",
          }}
        >
          Cloud (ElevenLabs)
        </button>
        <button
          onClick={() => setTtsMode("local")}
          style={{
            flex: 1, padding: "6px 12px", borderRadius: radii.sm,
            border: `1px solid ${ttsMode === "local" ? colors.accent : colors.border}`,
            background: ttsMode === "local" ? "rgba(10,132,255,0.12)" : "transparent",
            color: ttsMode === "local" ? colors.text : colors.textSecondary,
            fontSize: 12, cursor: "pointer",
          }}
        >
          Local (Kokoro)
        </button>
      </div>

      {ttsMode === "cloud" && (
        <>
          {/* Quality preset */}
          <div>
            <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "4px" }}>Quality</div>
            <div style={{ display: "flex", gap: 4 }}>
              {QUALITY_OPTIONS.map((q) => (
                <button
                  key={q.id}
                  onClick={() => setTtsQuality(q.id)}
                  title={q.hint}
                  style={{
                    flex: 1, padding: "4px 6px", borderRadius: radii.xs,
                    border: `1px solid ${ttsQuality === q.id ? colors.accent : colors.border}`,
                    background: ttsQuality === q.id ? "rgba(10,132,255,0.12)" : "transparent",
                    color: ttsQuality === q.id ? colors.text : colors.textSecondary,
                    fontSize: 11, cursor: "pointer",
                  }}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dynamic voice browser */}
          <div>
            <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "4px" }}>
              Voice{voiceLoading && <span style={{ fontStyle: "italic" }}> · Loading…</span>}
            </div>

            {/* Category filter tabs */}
            <div style={{ display: "flex", gap: 3, marginBottom: "4px" }}>
              {(([["all", "All"], ["mine", "My Voices"], ["builtin", "Built-in"]] as const)).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setVoiceCategory(id)}
                  style={{
                    flex: 1, padding: "3px 4px", borderRadius: radii.xs, fontSize: 10, cursor: "pointer",
                    border: `1px solid ${voiceCategory === id ? colors.accent : colors.border}`,
                    background: voiceCategory === id ? "rgba(10,132,255,0.12)" : "transparent",
                    color: voiceCategory === id ? colors.text : colors.textSecondary,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <input
              type="text"
              placeholder="Search voices…"
              value={voiceSearch}
              onChange={(e) => setVoiceSearch(e.target.value)}
              style={{
                width: "100%", background: "rgba(255,255,255,0.05)",
                border: `1px solid ${colors.border}`, borderRadius: radii.xs,
                padding: "5px 8px", color: colors.text, fontSize: 12,
                boxSizing: "border-box", marginBottom: "4px",
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: "2px", maxHeight: "200px", overflowY: "auto" }}>
              {filteredVoices.map((v) => {
                const active = !elevenLabsCustomVoiceId && elevenLabsVoiceId === v.voice_id;
                const isCloned = v.category === "cloned" || v.category === "professional" || v.category === "generated";
                const isLoading = previewLoadingId === v.voice_id;
                const isPlaying = previewPlayingId === v.voice_id;
                const metaLine = v.description?.slice(0, 55) ?? "";
                return (
                  <div
                    key={v.voice_id}
                    style={{
                      display: "flex", alignItems: "center", gap: "4px",
                      padding: "4px 8px", borderRadius: radii.xs,
                      border: `1px solid ${active ? colors.accent : "transparent"}`,
                      background: active ? "rgba(10,132,255,0.12)" : "transparent",
                    }}
                  >
                    <button
                      onClick={() => { setElevenLabsVoiceId(v.voice_id); setElevenLabsCustomVoiceId(""); }}
                      style={{
                        flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "1px",
                        background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0,
                        minWidth: 0,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "5px", width: "100%" }}>
                        <span style={{
                          width: "6px", height: "6px", borderRadius: radii.full, flexShrink: 0,
                          background: active ? colors.accent : colors.textTertiary,
                        }} />
                        <span style={{ ...typography.caption, color: active ? colors.text : colors.textSecondary, fontWeight: active ? 600 : 400 }}>
                          {v.name}
                        </span>
                        {isCloned && (
                          <span style={{
                            fontSize: 9, padding: "1px 4px", borderRadius: 3,
                            background: "rgba(48,209,88,0.15)", color: "#30d158", flexShrink: 0,
                          }}>
                            {v.category === "professional" ? "PRO" : "CLONE"}
                          </span>
                        )}
                        {v.labels?.style && (
                          <span style={{ ...typography.small, color: colors.textTertiary, marginLeft: "auto", flexShrink: 0 }}>
                            {v.labels.style}
                          </span>
                        )}
                      </div>
                      {metaLine && (
                        <span style={{
                          fontSize: 9, color: colors.textTertiary,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          maxWidth: "150px", paddingLeft: "11px",
                        }}>
                          {metaLine}
                        </span>
                      )}
                    </button>
                    {v.preview_url ? (
                      <button
                        onClick={() => {
                          if (isPlaying || isLoading) {
                            stopPreview();
                            setPreviewPlayingId(null);
                            setPreviewLoadingId(null);
                          } else {
                            setPreviewLoadingId(v.voice_id);
                            previewVoice(v.preview_url!, () => {
                              setPreviewLoadingId(null);
                              setPreviewPlayingId(v.voice_id);
                            }).finally(() => {
                              setPreviewPlayingId(null);
                              setPreviewLoadingId(null);
                            });
                          }
                        }}
                        title={isLoading ? "Loading…" : isPlaying ? "Stop" : "Preview"}
                        style={{
                          background: "none", border: "none", cursor: "pointer", padding: "2px 4px",
                          color: (isPlaying || isLoading) ? colors.accent : colors.textTertiary,
                          fontSize: 11, flexShrink: 0,
                        }}
                      >
                        {isLoading
                          ? <span style={{ display: "inline-block", animation: "spin 0.8s linear infinite" }}>↻</span>
                          : isPlaying ? "■" : "▶"}
                      </button>
                    ) : (
                      <span
                        title="No preview available"
                        style={{ fontSize: 11, color: colors.textTertiary, opacity: 0.3, padding: "2px 4px", flexShrink: 0, userSelect: "none" }}
                      >
                        ▶
                      </span>
                    )}
                  </div>
                );
              })}
              {filteredVoices.length === 0 && !voiceLoading && (
                <div style={{ ...typography.small, color: colors.textTertiary, padding: "8px" }}>No voices found</div>
              )}
            </div>
          </div>

          {/* Clone a voice */}
          <div>
            <button
              onClick={() => { setCloneOpen((o) => !o); setCloneError(""); }}
              style={{
                background: "none", border: `1px solid ${colors.border}`, borderRadius: radii.xs,
                color: colors.textSecondary, fontSize: 11, cursor: "pointer",
                padding: "4px 8px", width: "100%",
              }}
            >
              {cloneOpen ? "✕ Cancel" : "+ Clone a voice"}
            </button>
            {cloneSuccess && (
              <div style={{ ...typography.small, color: "#30d158", marginTop: "4px" }}>
                Voice cloned! Now active in your library.
              </div>
            )}
            {cloneOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "6px" }}>
                <input
                  type="text"
                  placeholder="Voice name…"
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                  style={{
                    width: "100%", background: "rgba(255,255,255,0.05)",
                    border: `1px solid ${colors.border}`, borderRadius: radii.xs,
                    padding: "5px 8px", color: colors.text, fontSize: 12, boxSizing: "border-box",
                  }}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,.mp3,.wav,.m4a,.ogg"
                  multiple
                  onChange={handleFileSelect}
                  style={{ display: "none" }}
                />
                {cloneFiles.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    {cloneFiles.map((f, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 6px", background: "rgba(255,255,255,0.04)", borderRadius: radii.xs }}>
                        <span style={{ ...typography.small, color: colors.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✓ {f.name}</span>
                        <button
                          onClick={() => setCloneFiles((prev) => prev.filter((_, j) => j !== i))}
                          style={{ background: "none", border: "none", color: colors.textTertiary, cursor: "pointer", fontSize: 10, flexShrink: 0, padding: "0 2px" }}
                        >✕</button>
                      </div>
                    ))}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        background: "rgba(255,255,255,0.03)", border: `1px dashed ${colors.border}`,
                        borderRadius: radii.xs, color: colors.textTertiary,
                        fontSize: 10, cursor: "pointer", padding: "3px 8px",
                      }}
                    >
                      + Add more samples (more = better quality)
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      background: "rgba(255,255,255,0.05)", border: `1px solid ${colors.border}`,
                      borderRadius: radii.xs, color: colors.textTertiary,
                      fontSize: 11, cursor: "pointer", padding: "5px 8px", textAlign: "left",
                    }}
                  >
                    Select audio files (MP3, WAV, M4A) — multiple for better quality
                  </button>
                )}
                {cloneError && (
                  <div style={{ ...typography.small, color: "#ff453a" }}>{cloneError}</div>
                )}
                <button
                  onClick={handleClone}
                  disabled={cloneLoading || !cloneName.trim() || cloneFiles.length === 0}
                  style={{
                    padding: "6px 12px", borderRadius: radii.xs,
                    background: cloneLoading || !cloneName.trim() || cloneFiles.length === 0
                      ? "rgba(255,255,255,0.05)" : "rgba(10,132,255,0.2)",
                    border: `1px solid ${colors.accent}`,
                    color: cloneLoading || !cloneName.trim() || cloneFiles.length === 0 ? colors.textTertiary : colors.text,
                    fontSize: 12, cursor: cloneLoading ? "wait" : "pointer",
                  }}
                >
                  {cloneLoading
                    ? <><span style={{ display: "inline-block", animation: "spin 0.8s linear infinite" }}>↻</span>{" "}Uploading {cloneFiles.length} file{cloneFiles.length !== 1 ? "s" : ""} ({cloneFilesTotalMB} MB)…</>
                    : cloneFiles.length > 0
                      ? `Upload & Clone (${cloneFiles.length} file${cloneFiles.length !== 1 ? "s" : ""}, ${cloneFilesTotalMB} MB)`
                      : "Upload & Clone"}
                </button>
              </div>
            )}
          </div>

          {/* Custom voice ID */}
          <div>
            <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "4px" }}>Custom voice ID (overrides selection)</div>
            <input
              type="text"
              placeholder="Paste ElevenLabs voice ID…"
              value={elevenLabsCustomVoiceId}
              onChange={(e) => setElevenLabsCustomVoiceId(e.target.value)}
              style={{
                width: "100%", background: "rgba(255,255,255,0.05)",
                border: `1px solid ${elevenLabsCustomVoiceId ? colors.accent : colors.border}`,
                borderRadius: radii.xs, padding: "6px 8px", color: colors.text,
                fontSize: 12, boxSizing: "border-box",
              }}
            />
          </div>
        </>
      )}

      {ttsMode === "local" && (
        <div style={{ ...typography.small, color: colors.textTertiary }}>
          Kokoro-82M — private, offline. Download model to enable.
        </div>
      )}
    </div>
  );
}

function HotkeyHint() {
  const { hotkeyBinding } = useCompanionStore();
  const keys = hotkeyBinding.split("+").filter(Boolean);
  return (
    <div
      style={{
        padding: "10px 12px",
        background: colors.backgroundSecondary,
        borderRadius: radii.md,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <span style={{ ...typography.caption, color: colors.textSecondary }}>Push-to-talk</span>
      <div style={{ display: "flex", gap: "3px" }}>
        {keys.map((k) => (
          <span
            key={k}
            style={{
              padding: "2px 6px",
              background: colors.surface,
              borderRadius: radii.xs,
              ...typography.small,
              color: colors.textSecondary,
              border: `1px solid ${colors.border}`,
            }}
          >
            {k}
          </span>
        ))}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        ...typography.small,
        color: colors.textTertiary,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        marginBottom: "6px",
      }}
    >
      {children}
    </div>
  );
}

function IconButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      style={{
        width: "26px",
        height: "26px",
        borderRadius: radii.full,
        border: "none",
        background: "rgba(255,255,255,0.06)",
        color: colors.textTertiary,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "14px",
        WebkitAppRegion: "no-drag",
        outline: "none",
      } as React.CSSProperties}
      onFocus={(e) => {
        (e.currentTarget as HTMLButtonElement).style.outline =
          "2px solid " + colors.accent;
        (e.currentTarget as HTMLButtonElement).style.outlineOffset = "2px";
      }}
      onBlur={(e) => {
        (e.currentTarget as HTMLButtonElement).style.outline = "none";
      }}
    >
      {children}
    </button>
  );
}

function ToggleButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-checked={on}
      role="switch"
      style={{
        width: "36px",
        height: "20px",
        borderRadius: radii.full,
        border: "none",
        background: on ? colors.accent : colors.surface,
        cursor: "pointer",
        position: "relative",
        transition: "background 0.2s",
        flexShrink: 0,
        outline: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "2px",
          left: on ? "18px" : "2px",
          width: "16px",
          height: "16px",
          borderRadius: radii.full,
          background: "#fff",
          transition: "left 0.2s",
        }}
      />
    </button>
  );
}

function VadToggle() {
  const { vadEnabled, setVadEnabled } = useCompanionStore();

  async function toggle() {
    const next = !vadEnabled;
    setVadEnabled(next);
    try {
      await invoke("set_vad_enabled", { enabled: next });
    } catch (e) {
      console.warn("[VAD]", e);
    }
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        paddingTop: "6px",
        borderTop: `1px solid ${colors.border}`,
      }}
    >
      <div>
        <div style={{ ...typography.caption, color: colors.textSecondary }}>
          Auto-stop on silence
        </div>
        <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "1px" }}>
          Release hotkey automatically when you stop speaking
        </div>
      </div>
      <ToggleButton on={vadEnabled} onToggle={toggle} />
    </div>
  );
}

function AudioLevelMeter() {
  const [levels, setLevels] = useState<number[]>([0.2, 0.2, 0.2, 0.2, 0.2]);
  const historyRef = useRef<number[]>([0, 0, 0, 0, 0]);

  useEffect(() => {
    const unlisten = listen<number>("audio-level", (e) => {
      const level = e.payload;
      historyRef.current = [...historyRef.current.slice(1), level];
      setLevels([...historyRef.current]);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div
      style={{
        display: "flex",
        gap: "3px",
        alignItems: "flex-end",
        height: "24px",
        padding: "0 4px",
      }}
    >
      {levels.map((l, i) => (
        <div
          key={i}
          style={{
            width: "4px",
            height: `${Math.max(4, l * 24)}px`,
            background: colors.success,
            borderRadius: "2px",
            transition: "height 0.08s ease-out",
            opacity: 0.85,
          }}
        />
      ))}
    </div>
  );
}
