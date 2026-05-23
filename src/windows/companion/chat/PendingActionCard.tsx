import { useState } from "react";
import { colors, radii, typography } from "../../../lib/designSystem";
import { useCompanionStore } from "../../../state/companionStore";
export function PendingActionCard({
  action,
  onConfirm,
  onCancel,
}: {
  action: { reason: string; tier?: number; action: { kind: string; label: string } };
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  const { clearPendingComputerAction } = useCompanionStore();
  const [confirmed, setConfirmed] = useState(false);

  const tier = action.tier ?? 2;
  const label = action.action.kind === "none"
    ? "action"
    : `${action.action.kind} "${action.action.label}"`;

  const tierBorder =
    tier >= 3 ? "rgba(255,69,58,0.5)"
    : tier === 2 ? "rgba(255,159,10,0.4)"
    : "rgba(10,132,255,0.4)";
  const tierBg =
    tier >= 3 ? "rgba(255,69,58,0.08)"
    : tier === 2 ? "rgba(255,159,10,0.08)"
    : "rgba(10,132,255,0.08)";
  const tierColor =
    tier >= 3 ? "#FF453A"
    : tier === 2 ? colors.warning
    : colors.accent;

  return (
    <div
      style={{
        padding: "12px 14px",
        background: tierBg,
        border: `1px solid ${tierBorder}`,
        borderRadius: radii.md,
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        animation: "slideInFromRight 0.25s ease",
      }}
    >
      <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
        <span style={{ fontSize: "16px", flexShrink: 0, marginTop: "1px" }}>
          {tier >= 3 ? "🛑" : tier === 2 ? "⚠" : "ℹ"}
        </span>
        <div>
          <div style={{ ...typography.caption, color: tierColor, fontWeight: 600 }}>
            {tier >= 3 ? "High-risk action" : tier === 2 ? "Confirm action" : "Low-risk action"}
          </div>
          <div style={{ ...typography.small, color: colors.textSecondary, marginTop: "2px" }}>
            {action.reason}
          </div>
          <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "2px" }}>
            About to: <strong style={{ color: colors.text }}>{label}</strong>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: "8px" }}>
        <button
          disabled={confirmed}
          onClick={async () => {
            setConfirmed(true);
            await onConfirm?.();
          }}
          style={{
            flex: 1,
            padding: "7px",
            background: confirmed ? colors.surface : tierColor,
            border: "none",
            borderRadius: radii.sm,
            color: confirmed ? colors.textTertiary : tier >= 3 ? "#fff" : "#000",
            cursor: confirmed ? "not-allowed" : "pointer",
            ...typography.caption,
            fontWeight: 600,
            opacity: confirmed ? 0.6 : 1,
          }}
        >
          {confirmed ? "Confirming…" : "Confirm"}
        </button>
        <button
          onClick={() => {
            clearPendingComputerAction();
            onCancel?.();
          }}
          style={{
            flex: 1,
            padding: "7px",
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
    </div>
  );
}