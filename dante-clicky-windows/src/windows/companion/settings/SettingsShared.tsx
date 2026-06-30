import type React from "react";
import { colors, radii, typography } from "../../../lib/designSystem";
export function SettingsCard({ children, index = 0 }: { children: React.ReactNode; index?: number }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        background: colors.backgroundSecondary,
        borderRadius: radii.md,
        border: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        animation: `fadeInUp 0.2s ease ${index * 0.05}s both`,
      }}
    >
      {children}
    </div>
  );
}

export function SettingsDivider() {
  return <div style={{ height: "1px", background: colors.border, margin: "0 -2px" }} />;
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        ...typography.small,
        color: colors.textTertiary,
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        marginBottom: "6px",
      }}
    >
      {children}
    </div>
  );
}
