import { colors, radii, typography } from "../../../lib/designSystem";
import type { KeyStatus } from "../../../lib/apiValidation";
import { KeyStatusIndicator } from "../controls/KeyStatusIndicator";
import { SettingsCard } from "./SettingsShared";

export function ApiKeysCard({ ctx }: any) {
  const {
    keys, keyStatuses, onSetKey, sectionHeader,
  } = ctx;
  return (
    <>
      {/* â”€â”€ API Keys â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */}
      <SettingsCard index={0}>
        {sectionHeader("ðŸ”‘", "API Keys")}
        {keys.map(({ label, provider, value, placeholder }: any) => {
          const status: KeyStatus = keyStatuses[provider] ?? "unchecked";
          const borderColor =
            status === "valid" ? "rgba(50,215,75,0.5)"
            : status === "invalid" ? "rgba(255,69,58,0.5)"
            : colors.border;
          return (
            <div key={provider}>
              <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "3px" }}>{label}</div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <input
                  type="password"
                  value={value}
                  onChange={(e) => onSetKey(provider, e.target.value)}
                  placeholder={placeholder}
                  style={{
                    padding: "6px 8px",
                    background: colors.surface,
                    border: `1px solid ${borderColor}`,
                    borderRadius: radii.sm,
                    color: colors.text,
                    fontSize: "12px",
                    outline: "none",
                    flex: 1,
                    boxSizing: "border-box" as const,
                    transition: "border-color 0.2s",
                  }}
                />
                <KeyStatusIndicator status={status} />
              </div>
              {status === "invalid" && (
                <div style={{ ...typography.small, color: "#FF453A", marginTop: "2px" }}>Invalid key</div>
              )}
            </div>
          );
        })}
      </SettingsCard>
    </>
  );
}

