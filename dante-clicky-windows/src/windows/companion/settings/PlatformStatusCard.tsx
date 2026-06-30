import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { colors, radii, typography } from "../../../lib/designSystem";
import type { CapabilityStatus, PlatformCapabilities, UpdateCheckResult } from "../types";
export function PlatformStatusCard({ capabilities }: { capabilities: PlatformCapabilities | null }) {
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updateCheckResult, setUpdateCheckResult] = useState<UpdateCheckResult | null>(null);
  const [updateCheckError, setUpdateCheckError] = useState<string | null>(null);

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

  async function checkUpdaterManifest() {
    setCheckingUpdate(true);
    setUpdateCheckError(null);
    try {
      const result = await invoke<UpdateCheckResult>("check_for_update");
      setUpdateCheckResult(result);
    } catch (error) {
      setUpdateCheckResult(null);
      setUpdateCheckError(error instanceof Error ? error.message : String(error));
    } finally {
      setCheckingUpdate(false);
    }
  }

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
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          padding: "8px",
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.sm,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
          <div>
            <div style={{ ...typography.small, color: colors.textSecondary }}>Updater manifest</div>
            <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "1px" }}>
              {updateCheckResult
                ? updateCheckResult.available
                  ? `v${updateCheckResult.version} available`
                  : `Checked from v${updateCheckResult.currentVersion}`
                : updateCheckError
                  ? "Check failed"
                  : "Not checked"}
            </div>
          </div>
          <button
            onClick={checkUpdaterManifest}
            disabled={checkingUpdate}
            style={{
              padding: "5px 9px",
              borderRadius: radii.xs,
              border: `1px solid ${colors.border}`,
              background: checkingUpdate ? "rgba(255,255,255,0.04)" : colors.backgroundSecondary,
              color: checkingUpdate ? colors.textTertiary : colors.textSecondary,
              cursor: checkingUpdate ? "wait" : "pointer",
              fontSize: 11,
              flexShrink: 0,
            }}
          >
            {checkingUpdate ? "Checking..." : "Check"}
          </button>
        </div>
        {updateCheckResult && (
          <div style={{ ...typography.small, color: updateCheckResult.reachedManifest ? colors.success : colors.warning }}>
            Manifest reached{updateCheckResult.target ? ` for ${updateCheckResult.target}` : ""}
            {(() => {
              const u = updateCheckResult.downloadUrl ?? updateCheckResult.manifestUrl ?? "";
              if (!u) return "";
              try { return ` - ${new URL(u).hostname}`; } catch { return ""; }
            })()}
            {updateCheckResult.signaturePresent ? " - signature present" : ""}
          </div>
        )}
        {updateCheckError && (
          <div style={{ ...typography.small, color: "#FF453A" }}>
            {updateCheckError.slice(0, 160)}
          </div>
        )}
      </div>
    </div>
  );
}
