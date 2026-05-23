import { invoke } from "@tauri-apps/api/core";
import { VideoControls } from "../../../components/VideoControls";
import { colors, radii, typography } from "../../../lib/designSystem";
import { timeAgo } from "../utils";
import type { AmbientSnapshotRow } from "../types";
import { ToggleButton } from "../controls/ButtonControls";
import { SettingsCard, SettingsDivider } from "./SettingsShared";
import { LocalVisionCard } from "./LocalVisionCard";
export function AmbientVisionSettings({ ctx }: any) {
  const {
    sectionStyle, sectionHeader,
    ambientMode, onToggleAmbient, captureCountToday, setCaptureCountToday, ambientCaptureDurationsMs, ambientIntervalSeconds,
    onAmbientIntervalChange, ambientExcludedApps, onAmbientExcludedAppsChange, showAmbientHistory, setShowAmbientHistory,
    ambientSnapshots, setAmbientSnapshots,
  } = ctx;
  return (
    <>
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
                    ) : ambientSnapshots.map((row: AmbientSnapshotRow) => {
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
    </>
  );
}

