import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import { useCompanionStore } from "../state/companionStore";
import { parsePoints, stripPoints, denormalize } from "../providers/pointParser";
import { colors, radii, shadows } from "../lib/designSystem";

interface VerifyBadge {
  success: boolean;
  label: string;
  explanation: string;
}

// Transparent full-screen overlay — click-through by default.
// Rust show_overlay / hide_overlay commands toggle it via IPC.
// This component reads live streaming response from the Zustand store.

export default function OverlayPanel() {
  const { voiceState, response } = useCompanionStore();
  const prevResponseRef = useRef("");
  const [verifyBadge, setVerifyBadge] = useState<VerifyBadge | null>(null);
  const badgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Dismiss on click (user acknowledges response)
  async function dismiss() {
    await invoke("hide_overlay");
  }

  // Sync response ref for dismiss timeout
  useEffect(() => {
    prevResponseRef.current = response;
  }, [response]);

  // Listen for hide-overlay events triggered externally
  useEffect(() => {
    const unlisten = listen("overlay-hide", dismiss);
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for action-verify-result events from the voice hook
  useEffect(() => {
    const unlisten = listen<VerifyBadge>("action-verify-result", (e) => {
      const badge = e.payload;
      setVerifyBadge(badge);
      // Clear any pending dismiss timer
      if (badgeTimerRef.current !== null) {
        clearTimeout(badgeTimerRef.current);
      }
      // Success disappears after 2s; failure lingers for 4s so the user can read it
      const duration = badge.success ? 2000 : 4000;
      badgeTimerRef.current = setTimeout(() => {
        setVerifyBadge(null);
        badgeTimerRef.current = null;
      }, duration);
    });
    return () => {
      unlisten.then((fn) => fn());
      if (badgeTimerRef.current !== null) clearTimeout(badgeTimerRef.current);
    };
  }, []);

  const points = parsePoints(response);
  const displayText = stripPoints(response);

  // Animate cursor to the first detected point whenever a new set arrives
  useEffect(() => {
    if (points.length === 0) return;
    const first = points[0];
    const { px, py } = denormalize(
      first,
      window.screen.width,
      window.screen.height,
    );
    invoke("animate_cursor_to", { x: px, y: py }).catch(console.error);
  }, [points]);

  const isActive =
    voiceState === "responding" ||
    voiceState === "listening" ||
    voiceState === "processing";

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "transparent",
        position: "relative",
        pointerEvents: isActive ? "auto" : "none",
        fontFamily: "-apple-system, 'Segoe UI', system-ui, sans-serif",
      }}
      onClick={voiceState === "responding" ? dismiss : undefined}
    >
      {/* Listening waveform */}
      {voiceState === "listening" && (
        <div
          style={{
            position: "absolute",
            bottom: "72px",
            left: "50%",
            transform: "translateX(-50%)",
            display: "flex",
            alignItems: "center",
            gap: "5px",
          }}
        >
          {[0, 1, 2, 3, 4].map((i) => (
            <div
              key={i}
              style={{
                width: "4px",
                borderRadius: "2px",
                background: colors.success,
                animation: `waveBar 0.7s ease-in-out ${i * 0.12}s infinite alternate`,
                height: `${12 + i * 5}px`,
              }}
            />
          ))}
          <style>{`@keyframes waveBar { from{transform:scaleY(.35)} to{transform:scaleY(1.15)} }`}</style>
        </div>
      )}

      {/* Processing spinner */}
      {voiceState === "processing" && (
        <div
          style={{
            position: "absolute",
            bottom: "72px",
            left: "50%",
            transform: "translateX(-50%)",
          }}
        >
          <div
            style={{
              width: "26px",
              height: "26px",
              borderRadius: radii.full,
              border: `3px solid rgba(10,132,255,.18)`,
              borderTopColor: colors.accent,
              animation: "spin .7s linear infinite",
            }}
          />
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      )}

      {/* Response bubble */}
      {voiceState === "responding" && displayText && (
        <ResponseBubble text={displayText} />
      )}

      {/* Point annotations — blue dots at detected UI element positions */}
      {points.map((pt, i) => (
        <PointDot key={i} x={pt.x} y={pt.y} label={pt.label} />
      ))}

      {/* Action verification badge — briefly shown after a computer-use click */}
      {verifyBadge && (
        <VerificationBadge
          success={verifyBadge.success}
          label={verifyBadge.label}
          explanation={verifyBadge.explanation}
        />
      )}
    </div>
  );
}

function ResponseBubble({ text }: { text: string }) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: "100px",
        left: "50%",
        transform: "translateX(-50%)",
        maxWidth: "680px",
        minWidth: "180px",
        padding: "16px 20px",
        background: "rgba(28,28,30,0.94)",
        backdropFilter: "blur(24px)",
        WebkitBackdropFilter: "blur(24px)",
        borderRadius: radii.lg,
        boxShadow: shadows.panel,
        border: "1px solid rgba(255,255,255,0.10)",
        color: colors.text,
        fontSize: "16px",
        lineHeight: "25px",
        wordBreak: "break-word",
        cursor: "pointer",
      }}
    >
      <ReactMarkdown>{text}</ReactMarkdown>
      <div
        style={{
          marginTop: "10px",
          ...({} as object),
          fontSize: "11px",
          color: colors.textTertiary,
          textAlign: "right",
        }}
      >
        Click to dismiss
      </div>
    </div>
  );
}

function VerificationBadge({
  success,
  label,
  explanation,
}: {
  success: boolean;
  label: string;
  explanation: string;
}) {
  const bg = success ? "rgba(50,215,75,0.9)" : "rgba(255,69,58,0.9)";
  const icon = success ? "✓" : "✗";
  const headline = success ? "Action confirmed" : "Action may have failed";

  return (
    <div
      style={{
        position: "absolute",
        top: "24px",
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "4px",
        pointerEvents: "none",
        zIndex: 9999,
      }}
    >
      <div
        style={{
          background: bg,
          color: "#fff",
          padding: "6px 14px",
          borderRadius: "20px",
          fontSize: "13px",
          fontWeight: 600,
          whiteSpace: "nowrap",
          boxShadow: "0 2px 12px rgba(0,0,0,0.35)",
        }}
      >
        {icon} {headline}
        {label ? ` — ${label}` : ""}
      </div>
      {!success && explanation && (
        <div
          style={{
            background: "rgba(0,0,0,0.72)",
            color: "#fff",
            padding: "4px 12px",
            borderRadius: "12px",
            fontSize: "11px",
            maxWidth: "420px",
            textAlign: "center",
            whiteSpace: "normal",
            wordBreak: "break-word",
          }}
        >
          {explanation}
        </div>
      )}
    </div>
  );
}

function PointDot({
  x,
  y,
  label,
}: {
  x: number;
  y: number;
  label: string;
}) {
  // x, y are 0–1024 normalized coords
  const px = `${(x / 1024) * 100}%`;
  const py = `${(y / 1024) * 100}%`;

  return (
    <div
      style={{
        position: "absolute",
        left: px,
        top: py,
        transform: "translate(-50%,-50%)",
        pointerEvents: "none",
      }}
    >
      {/* Outer ring pulse */}
      <div
        style={{
          position: "absolute",
          inset: "-8px",
          borderRadius: radii.full,
          border: `2px solid ${colors.accent}`,
          animation: "ringPulse 1.2s ease-out infinite",
          opacity: 0.6,
        }}
      />
      {/* Inner dot */}
      <div
        style={{
          width: "14px",
          height: "14px",
          borderRadius: radii.full,
          background: colors.accent,
          boxShadow: `0 0 12px ${colors.accentGlow}`,
        }}
      />
      {/* Label */}
      <div
        style={{
          position: "absolute",
          top: "18px",
          left: "50%",
          transform: "translateX(-50%)",
          background: "rgba(0,0,0,0.75)",
          color: "#fff",
          fontSize: "11px",
          padding: "2px 8px",
          borderRadius: radii.full,
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
      <style>{`@keyframes ringPulse{0%{transform:scale(1);opacity:.6}100%{transform:scale(2.2);opacity:0}}`}</style>
    </div>
  );
}
