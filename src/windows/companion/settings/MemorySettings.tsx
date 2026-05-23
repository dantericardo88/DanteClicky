import { invoke } from "@tauri-apps/api/core";
import { colors, radii, typography } from "../../../lib/designSystem";
import { ImportMemoryButton, EncryptionStatusBadge, DataInventoryRow, RekeyButton } from "../controls/MemoryControls";
import { ToggleButton } from "../controls/ButtonControls";
import { SettingsCard, SettingsDivider } from "./SettingsShared";

export function MemorySettings({ ctx }: any) {
  const {
    sectionStyle, sectionHeader,
    memoryEnabled, onToggleMemory, preferenceLearningEnabled, onTogglePreferenceLearning, prefProfile, setPrefProfile,
    incognitoMode, onToggleIncognito, memoryRetentionDays, onMemoryRetentionDaysChange, onClearConversation, purgeConfirm, setPurgeConfirm,
  } = ctx;
  return (
    <>
      {/* â”€â”€ Memory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <div style={sectionStyle}>
        <SettingsCard index={3}>
          {sectionHeader("ðŸ§ ", "Memory")}

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
                  No preferences learned yet â€” rate responses or say "perfect" / "no, that's wrong"
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  {prefProfile.traits.map((trait: any) => {
                    const conf = trait.confidence ?? Math.min(0.99, Math.abs(trait.score) / Math.max(1, trait.evidence_count));
                    const pct = Math.round(conf * 100);
                    const positive = trait.score > 0;
                    const isConflicted = trait.status === "conflicted" || (trait.positive_count > 0 && trait.negative_count > 0 && Math.abs(trait.positive_count - trait.negative_count) <= 1);
                    const labelColor = isConflicted ? "#F59E0B" : positive ? "#34C759" : "#FF453A";
                    return (
                      <div key={trait.key} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        <div style={{ ...typography.small, color: labelColor, width: "8px", textAlign: "center", flexShrink: 0 }}>
                          {isConflicted ? "~" : positive ? "+" : "âˆ’"}
                        </div>
                        <div style={{ ...typography.small, color: isConflicted ? "#F59E0B" : colors.textSecondary, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {trait.label}
                        </div>
                        <div style={{ ...typography.small, color: colors.textTertiary, flexShrink: 0 }}>
                          {trait.evidence_count}Ã—
                        </div>
                        <div style={{ width: "40px", height: "4px", background: colors.border, borderRadius: "2px", flexShrink: 0 }}>
                          <div style={{ width: `${pct}%`, height: "100%", borderRadius: "2px", background: isConflicted ? "#F59E0B" : positive ? "#34C759" : "#FF453A" }} />
                        </div>
                        <button
                          onClick={() => {
                            invoke("delete_preference_trait", { key: trait.key }).catch(() => {});
                            setPrefProfile((p: any) => p ? { ...p, traits: p.traits.filter((t: any) => t.key !== trait.key) } : p);
                          }}
                          style={{ background: "none", border: "none", cursor: "pointer", color: colors.textTertiary, fontSize: "11px", padding: "0 2px", flexShrink: 0, lineHeight: 1 }}
                          title="Dismiss trait"
                        >
                          âœ•
                        </button>
                      </div>
                    );
                  })}
                  <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "2px" }}>
                    {prefProfile.explicit_feedback_count} explicit Â· {prefProfile.implicit_feedback_count} implicit signals
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
                  {days === 0 ? "âˆž" : `${days}d`}
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
    </>
  );
}

