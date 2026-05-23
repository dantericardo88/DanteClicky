import { invoke } from "@tauri-apps/api/core";
import { colors, radii, typography } from "../../../lib/designSystem";
import { ToggleButton } from "../controls/ButtonControls";
import { SettingsCard, SettingsDivider } from "./SettingsShared";

export function AppearanceAppSettings({ ctx }: any) {
  const {
    sectionStyle, sectionHeader,
    overlayOpacity, onOverlayOpacityChange, overlayPosition, onOverlayPositionChange,
    autostart, onToggleAutostart, stealthMode, setStealthMode, automationSafetyMode, onAutomationSafetyModeChange,
  } = ctx;
  return (
    <>
      {/* â”€â”€ Appearance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div style={sectionStyle}>
        <SettingsCard index={6}>
          {sectionHeader("ðŸŽ¨", "Appearance")}

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
                  {pos === "left" ? "â† Left" : "Right â†’"}
                </button>
              ))}
            </div>
          </div>
        </SettingsCard>
      </div>

      {/* â”€â”€ App â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div style={sectionStyle}>
        <SettingsCard index={7}>
          {sectionHeader("âš™", "App")}

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

          <SettingsDivider />
          <div>
            <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "4px" }}>Automation safety</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
              {([
                ["confirm-actions", "Confirm actions"],
                ["trusted-assist", "Trusted assist"],
                ["power-user", "Power user"],
              ] as const).map(([mode, label]) => (
                <button
                  key={mode}
                  onClick={() => onAutomationSafetyModeChange(mode)}
                  style={{
                    padding: "7px 9px",
                    borderRadius: radii.sm,
                    border: `1px solid ${automationSafetyMode === mode ? colors.accent : colors.border}`,
                    background: automationSafetyMode === mode ? "rgba(10,132,255,0.12)" : "transparent",
                    color: automationSafetyMode === mode ? colors.text : colors.textSecondary,
                    cursor: "pointer",
                    ...typography.caption,
                    textAlign: "left",
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div style={{ ...typography.small, color: colors.textTertiary, marginTop: 4 }}>
              Power user still confirms purchases, external messages, destructive file actions, and system settings.
            </div>
          </div>
        </SettingsCard>
      </div>
    </>
  );
}

