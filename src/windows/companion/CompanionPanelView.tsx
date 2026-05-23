import { Suspense, lazy } from "react";
import type React from "react";
import { emit } from "@tauri-apps/api/event";
import { colors, radii, shadows, typography } from "../../lib/designSystem";
import { SPEECH_LANGUAGE_OPTIONS, buildSpeechLanguageStatus, type SpeechLanguageCode } from "../../lib/speechLanguages";
import { DEFAULT_WAKE_PHRASE, wakeStatusLabel } from "../../lib/wakeWord";
import { classifyError, timeAgo } from "./utils";
import { speechLanguageToneColor } from "./settings/SpeechLanguageSection";
import { IconButton } from "./controls/ButtonControls";
import { AudioLevelMeter } from "./controls/VoiceControls";
import { ModelPicker } from "./controls/ModelPicker";
import { WelcomeHero, NoKeyReminder, StatusCard, HotkeyHint } from "./chat/ChatViews";
import { ConversationHistory } from "./chat/ConversationHistory";
import { PendingActionCard } from "./chat/PendingActionCard";
import { SettingsSection } from "./settings/SettingsSection";

const AgentPanel = lazy(() => import("../AgentPanel").then((module) => ({ default: module.AgentPanel })));
const MemoryPanel = lazy(() => import("../MemoryPanel").then((module) => ({ default: module.MemoryPanel })));

export function CompanionPanelView({ ctx }: any) {
  const {
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
  } = ctx;
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
        height: "100vh",
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
            onClick={() => setActiveTab((t: string) => t === "agents" ? "chat" : "agents")}
          >
            ◎
          </IconButton>
          <IconButton
            title={showSettings ? "Close settings" : "Settings"}
            onClick={() => setActiveTab((t: string) => t === "settings" ? "chat" : "settings")}
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

      {/* Agents panel — kept mounted to preserve download state across tab switches */}
      <div style={{ display: activeTab === "agents" ? "block" : "none", padding: "16px", overflowY: "auto", flex: 1 }}>
        <Suspense fallback={null}>
          <AgentPanel />
        </Suspense>
      </div>

      {/* Memory panel — kept mounted to preserve state across tab switches */}
      <div style={{ display: activeTab === "memory" ? "block" : "none", padding: "16px", overflowY: "auto", flex: 1 }}>
        <Suspense fallback={null}>
          <MemoryPanel />
        </Suspense>
      </div>

      {activeTab !== "agents" && activeTab !== "memory" && (
      <div style={{ padding: "16px", flexDirection: "column", gap: "12px", flex: 1, overflowY: "auto", display: "flex" }}>
        {/* No-key reminder / welcome hero / status */}
        {!hasAnyKey && !showSettings ? (
          <NoKeyReminder onOpenSettings={() => setActiveTab("settings")} />
        ) : !showSettings && conversationHistory.length === 0 && voiceState === "idle" ? (
          <WelcomeHero />
        ) : (
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
            openrouterKey={openrouterKey}
            elevenLabsKey={elevenLabsKey}
            assemblyAiKey={assemblyAiKey}
            apiKeyPresence={apiKeyPresence}
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
            selectedModel={selectedModel}
            onSelectedModelChange={setSelectedModel}
            automationSafetyMode={automationSafetyMode}
            onAutomationSafetyModeChange={setAutomationSafetyMode}
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

        {/* Preference saved acknowledgment */}
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
            <span>?</span>
            <span>preference saved</span>
          </div>
        )}

        {memoryEnabled && !incognitoMode && (
          <div style={{
            display: "flex", alignItems: "center", gap: "6px",
            padding: "4px 10px", borderRadius: radii.full, alignSelf: "flex-start",
            background: "rgba(50,215,75,0.08)", border: "1px solid rgba(50,215,75,0.2)",
          }}>
            <span style={{ fontSize: "12px" }}>?</span>
            <span style={{ ...typography.small, color: colors.success }}>Memory active</span>
            {conversationHistory.length > 0 && (
              <span style={{ ...typography.small, color: colors.textTertiary, marginLeft: "2px" }}>
                � {conversationHistory.length} turn{conversationHistory.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        )}

        {conversationHistory.length > 0 && (
          <ConversationHistory turns={conversationHistory} />
        )}

        <ModelPicker selected={selectedModel} onChange={setSelectedModel} />

        {(conversationHistory.length > 0 || voiceState !== "idle" || showSettings) && <HotkeyHint />}

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

