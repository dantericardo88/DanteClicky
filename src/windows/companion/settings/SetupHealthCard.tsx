import { colors, radii, typography } from "../../../lib/designSystem";
import { PROVIDERS } from "../../../lib/providerRegistry";
import { summarizeHardware, type HardwareProfile } from "../../../lib/modelAdvisor";
import type { ModelOption } from "../../../state/companionStore";
import type { PlatformCapabilities } from "../types";
import { SettingsCard, SettingsDivider } from "./SettingsShared";
export function SetupHealthCard({
  hardwareProfile,
  capabilities,
  keyPresence,
  selectedModel,
  automationSafetyMode,
}: {
  hardwareProfile: HardwareProfile | null;
  capabilities: PlatformCapabilities | null;
  keyPresence: Record<string, boolean>;
  selectedModel: ModelOption;
  automationSafetyMode: "confirm-actions" | "trusted-assist" | "power-user";
}) {
  const selectedProvider = PROVIDERS[selectedModel.provider];
  if (!selectedProvider) return null;
  const keyReady =
    selectedProvider.locality === "local" ||
    Boolean(keyPresence[selectedProvider.keyProvider]);
  const nativeReady = capabilities
    ? [
        capabilities.nativeScreenCapture,
        capabilities.nativeInputControl,
        capabilities.globalShortcut,
        capabilities.tray,
      ].filter((status) => status.supported).length
    : 0;
  const releaseLabel = keyReady && nativeReady >= 4 ? "Daily Driver Preview" : "Setup incomplete";
  const rows = [
    {
      label: "Installer posture",
      value: releaseLabel,
      tone: releaseLabel === "Daily Driver Preview" ? colors.success : colors.warning,
    },
    {
      label: "Model",
      value: `${selectedModel.displayName}${keyReady ? "" : " needs key"}`,
      tone: keyReady ? colors.success : colors.warning,
    },
    {
      label: "Hardware",
      value: summarizeHardware(hardwareProfile),
      tone: hardwareProfile ? colors.textSecondary : colors.warning,
    },
    {
      label: "Automation",
      value: automationSafetyMode === "power-user" ? "Power User with guarded risky actions" : automationSafetyMode,
      tone: colors.accent,
    },
  ];

  return (
    <SettingsCard index={0}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
        <div>
          <div style={{ ...typography.caption, color: colors.text, fontWeight: 700 }}>Setup Health</div>
          <div style={{ ...typography.small, color: colors.textTertiary, marginTop: 2 }}>
            Local install, model readiness, hardware, and release confidence
          </div>
        </div>
        <span style={{
          ...typography.small,
          color: releaseLabel === "Daily Driver Preview" ? colors.success : colors.warning,
          border: `1px solid ${releaseLabel === "Daily Driver Preview" ? colors.success : colors.warning}55`,
          borderRadius: radii.full,
          padding: "3px 8px",
          whiteSpace: "nowrap",
        }}>
          {releaseLabel}
        </span>
      </div>
      <SettingsDivider />
      <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 6 }}>
        {rows.map((row) => (
          <div key={row.label} style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 8 }}>
            <span style={{ ...typography.small, color: colors.textTertiary }}>{row.label}</span>
            <span style={{ ...typography.small, color: row.tone, overflow: "hidden", textOverflow: "ellipsis" }}>
              {row.value}
            </span>
          </div>
        ))}
      </div>
    </SettingsCard>
  );
}
