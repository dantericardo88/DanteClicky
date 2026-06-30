import { colors, radii, typography } from "../../../lib/designSystem";
import { clearTelemetryBuffer, exportTelemetryBundleJson, getTelemetryCatalogSummary, getTelemetrySnapshot, recordTelemetryEvent } from "../../../lib/telemetry";
import { ToggleButton } from "../controls/ButtonControls";
import { SettingsCard, SettingsDivider } from "./SettingsShared";

export function TelemetrySettings({ ctx }: any) {
  const {
    sectionStyle, sectionHeader,
    telemetryLocalEnabled, onToggleTelemetryLocal, telemetryRemoteEnabled, onToggleTelemetryRemote, telemetryRemoteProjectKey,
    onTelemetryRemoteProjectKeyChange, telemetryRemoteHost, onTelemetryRemoteHostChange, telemetrySnapshot, setTelemetrySnapshot,
  } = ctx;
  return (
    <>
      {/* â”€â”€ Observability â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
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
    </>
  );
}

