import { useEffect, useState } from "react";
import type React from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { colors, typography } from "../../../lib/designSystem";
import { type KeyStatus, type Provider } from "../../../lib/apiValidation";
import { type HardwareProfile } from "../../../lib/modelAdvisor";
import { type PreferenceProfile } from "../../../lib/preferenceLearning";
import { useCompanionStore, type ModelOption } from "../../../state/companionStore";
import { type WakeSensitivity, type WakeStatus } from "../../../lib/wakeWord";
import { type SpeechLanguageCode } from "../../../lib/speechLanguages";
import { getTelemetrySnapshot } from "../../../lib/telemetry";
import type { AmbientSnapshotRow, PlatformCapabilities } from "../types";
import { SettingsErrorBoundary } from "./SettingsErrorBoundary";
import { SetupHealthCard } from "./SetupHealthCard";
import { ModelStudioCard } from "./ModelStudioCard";
import { PlatformStatusCard } from "./PlatformStatusCard";
import { ApiKeysCard } from "./ApiKeysCard";
import { VoiceAiSettings } from "./VoiceAiSettings";
import { MemorySettings } from "./MemorySettings";
import { TelemetrySettings } from "./TelemetrySettings";
import { AmbientVisionSettings } from "./AmbientVisionSettings";
import { AppearanceAppSettings } from "./AppearanceAppSettings";export function SettingsSection({
  anthropicKey, openaiKey, grokKey, openrouterKey, elevenLabsKey, assemblyAiKey, apiKeyPresence, onSetKey,
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
  selectedModel, onSelectedModelChange,
  automationSafetyMode, onAutomationSafetyModeChange,
}: {
  anthropicKey: string; openaiKey: string; grokKey: string; openrouterKey: string;
  elevenLabsKey: string; assemblyAiKey: string;
  apiKeyPresence: Record<string, boolean>;
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
  selectedModel: ModelOption; onSelectedModelChange: (m: ModelOption) => void;
  automationSafetyMode: "confirm-actions" | "trusted-assist" | "power-user";
  onAutomationSafetyModeChange: (mode: "confirm-actions" | "trusted-assist" | "power-user") => void;
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
  const [hardwareProfile, setHardwareProfile] = useState<HardwareProfile | null>(null);

  useEffect(() => { setHotkeyDraft(hotkeyBinding); }, [hotkeyBinding]);

  useEffect(() => {
    invoke<PlatformCapabilities>("get_platform_capabilities")
      .then(setPlatformCapabilities)
      .catch(() => setPlatformCapabilities(null));
    invoke<HardwareProfile>("get_hardware_profile")
      .then(setHardwareProfile)
      .catch(() => setHardwareProfile(null));
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
    { label: "OpenRouter", provider: "openrouter", value: openrouterKey, placeholder: "sk-or-..." },
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

  const settingsView = {
    keys, keyStatuses, onSetKey, sectionStyle, sectionHeader,
    platformCapabilities, speechLanguage, onSpeechLanguageChange, ttsMode, onTtsModeChange,
    hotkeyDraft, setHotkeyDraft, setHotkeyError, handleHotkeyBlur, hotkeyError,
    wakeStatus, wakePhrase, wakeModeEnabled, onToggleWakeMode, onWakePhraseChange, wakeSensitivity, onWakeSensitivityChange,
    systemPromptOverride, onSystemPromptOverrideChange, maxCuSteps, onMaxCuStepsChange, sessionNotes, onSessionNotesChange,
    memoryEnabled, onToggleMemory, preferenceLearningEnabled, onTogglePreferenceLearning, prefProfile, setPrefProfile,
    incognitoMode, onToggleIncognito, memoryRetentionDays, onMemoryRetentionDaysChange, onClearConversation, purgeConfirm, setPurgeConfirm,
    telemetryLocalEnabled, onToggleTelemetryLocal, telemetryRemoteEnabled, onToggleTelemetryRemote, telemetryRemoteProjectKey,
    onTelemetryRemoteProjectKeyChange, telemetryRemoteHost, onTelemetryRemoteHostChange, telemetrySnapshot, setTelemetrySnapshot,
    ambientMode, onToggleAmbient, captureCountToday, setCaptureCountToday, ambientCaptureDurationsMs, ambientIntervalSeconds,
    onAmbientIntervalChange, ambientExcludedApps, onAmbientExcludedAppsChange, showAmbientHistory, setShowAmbientHistory,
    ambientSnapshots, setAmbientSnapshots, overlayOpacity, onOverlayOpacityChange, overlayPosition, onOverlayPositionChange,
    autostart, onToggleAutostart, stealthMode, setStealthMode, automationSafetyMode, onAutomationSafetyModeChange,
  };

  return (
    <SettingsErrorBoundary>
      <div style={{ display: "flex", flexDirection: "column", gap: "0" }}>
        <div style={sectionStyle}>
          <SetupHealthCard
            hardwareProfile={hardwareProfile}
            capabilities={platformCapabilities}
            keyPresence={apiKeyPresence}
            selectedModel={selectedModel}
            automationSafetyMode={automationSafetyMode}
          />
        </div>

        <div style={sectionStyle}>
          <ModelStudioCard
            hardwareProfile={hardwareProfile}
            keyPresence={apiKeyPresence}
            selectedModel={selectedModel}
            onSelectedModelChange={onSelectedModelChange}
          />
        </div>

        <div style={sectionStyle}>
          <PlatformStatusCard capabilities={platformCapabilities} />
        </div>

        <ApiKeysCard ctx={settingsView} />
        <VoiceAiSettings ctx={settingsView} />
        <MemorySettings ctx={settingsView} />
        <TelemetrySettings ctx={settingsView} />
        <AmbientVisionSettings ctx={settingsView} />
        <AppearanceAppSettings ctx={settingsView} />
      </div>
    </SettingsErrorBoundary>
  );
}
