import { colors, radii, typography } from "../../../lib/designSystem";
import { DEFAULT_WAKE_PHRASE, wakeStatusLabel, type WakeSensitivity } from "../../../lib/wakeWord";
import { ToggleButton } from "../controls/ButtonControls";
import { VadToggle } from "../controls/VoiceControls";
import { SettingsCard, SettingsDivider } from "./SettingsShared";
import { PlatformStatusCard } from "./PlatformStatusCard";
import { SpeechLanguageSection } from "./SpeechLanguageSection";
import { SttModeSection, SttAccuracySection } from "./SttSection";
import { TtsModeSection } from "./TtsSection";
export function VoiceAiSettings({ ctx }: any) {
  const {
    sectionStyle, sectionHeader,
    platformCapabilities, speechLanguage, onSpeechLanguageChange, ttsMode, onTtsModeChange,
    hotkeyDraft, setHotkeyDraft, setHotkeyError, handleHotkeyBlur, hotkeyError,
    wakeStatus, wakePhrase, wakeModeEnabled, onToggleWakeMode, onWakePhraseChange, wakeSensitivity, onWakeSensitivityChange,
    systemPromptOverride, onSystemPromptOverrideChange, maxCuSteps, onMaxCuStepsChange, sessionNotes, onSessionNotesChange,
  } = ctx;
  return (
    <>
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
    </>
  );
}

