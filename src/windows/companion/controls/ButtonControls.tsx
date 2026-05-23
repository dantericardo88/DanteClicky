import type React from "react";
import { colors, radii } from "../../../lib/designSystem";
export function IconButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      title={title}
      aria-label={title}
      onClick={onClick}
      style={{
        width: "26px",
        height: "26px",
        borderRadius: radii.full,
        border: "none",
        background: "rgba(255,255,255,0.06)",
        color: colors.textTertiary,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: "14px",
        WebkitAppRegion: "no-drag",
        outline: "none",
      } as React.CSSProperties}
      onFocus={(e) => {
        (e.currentTarget as HTMLButtonElement).style.outline =
          "2px solid " + colors.accent;
        (e.currentTarget as HTMLButtonElement).style.outlineOffset = "2px";
      }}
      onBlur={(e) => {
        (e.currentTarget as HTMLButtonElement).style.outline = "none";
      }}
    >
      {children}
    </button>
  );
}

export function ToggleButton({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      aria-checked={on}
      role="switch"
      style={{
        width: "36px",
        height: "20px",
        borderRadius: radii.full,
        border: "none",
        background: on ? colors.accent : colors.surface,
        cursor: "pointer",
        position: "relative",
        transition: "background 0.2s",
        flexShrink: 0,
        outline: "none",
      }}
    >
      <div
        style={{
          position: "absolute",
          top: "2px",
          left: on ? "18px" : "2px",
          width: "16px",
          height: "16px",
          borderRadius: radii.full,
          background: "#fff",
          transition: "left 0.2s",
        }}
      />
    </button>
  );
}
