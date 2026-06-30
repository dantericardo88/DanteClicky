import { useEffect, useState } from "react";
import { colors, radii, typography } from "../../../lib/designSystem";
import { useCompanionStore } from "../../../state/companionStore";
import { useMoondream } from "../../../hooks/useMoondream";
import { ToggleButton } from "../controls/ButtonControls";
import { SettingsCard, SettingsDivider } from "./SettingsShared";
export function LocalVisionCard() {
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