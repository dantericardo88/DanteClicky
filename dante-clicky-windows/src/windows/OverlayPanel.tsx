import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import ReactMarkdown from "react-markdown";
import { useCompanionStore } from "../state/companionStore";
import { parsePoints, stripPoints } from "../providers/pointParser";
import { colors, radii, shadows } from "../lib/designSystem";

interface VerifyBadge {
  success: boolean;
  label: string;
  explanation: string;
}

interface CuStep {
  step: number;
  max_steps: number;
  label: string;
}

// Transparent full-screen overlay — click-through by default.
// Rust show_overlay / hide_overlay commands toggle it via IPC.
// This component reads live streaming response from the Zustand store.

export default function OverlayPanel() {
  const { voiceState, response, overlayOpacity, currentUiElements, speechLanguage, speechLanguageDetection } = useCompanionStore();
  const prevResponseRef = useRef("");
  const [verifyBadge, setVerifyBadge] = useState<VerifyBadge | null>(null);
  const badgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [cuStep, setCuStep] = useState<CuStep | null>(null);

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

  // Listen for computer-use loop step progress events
  useEffect(() => {
    const unlisten = listen<CuStep>("cu-step", (e) => {
      setCuStep(e.payload);
    });
    const unlistenDone = listen("cu-done", () => {
      setCuStep(null);
    });
    return () => {
      unlisten.then((fn) => fn());
      unlistenDone.then((fn) => fn());
    };
  }, []);

  const points = parsePoints(response);
  const displayText = stripPoints(response);

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
            flexDirection: "column",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "5px" }}>
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
          </div>
          {(speechLanguage !== "en" || speechLanguageDetection?.detectedLanguageCode) && (
            <div
              style={{
                backgroundColor: "rgba(10, 132, 255, 0.9)",
                color: "white",
                padding: "6px 12px",
                borderRadius: "6px",
                fontSize: "12px",
                fontWeight: 500,
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
            >
              <span>{(speechLanguageDetection?.detectedLanguageCode ?? speechLanguage).toUpperCase()}</span>
              {speechLanguageDetection?.languageConfidence != null && (
                <span style={{ opacity: 0.8 }}>
                  {Math.round(speechLanguageDetection.languageConfidence * 100)}%
                </span>
              )}
            </div>
          )}
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
            role="progressbar"
            aria-label="Processing"
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

      {/* Response bubble — streaming=true shows blinking cursor while AI generates */}
      {voiceState === "responding" && displayText && (
        <div role="status" aria-live="polite" aria-label="AI response">
          <ResponseBubble text={displayText} streaming={voiceState === "responding"} opacity={overlayOpacity} />
        </div>
      )}

      {/* Point annotations — blue dots at detected UI element positions (visual only) */}
      <div aria-hidden="true">
        {points.map((pt, i) => (
          <PointDot key={i} x={pt.x} y={pt.y} label={pt.label} />
        ))}
      </div>

      {/* Set-of-Mark numbered badges — shown during AI processing/responding so user can see element IDs */}
      {(voiceState === "processing" || voiceState === "responding") && currentUiElements.length > 0 && (
        <div aria-hidden="true">
          {currentUiElements
            .filter(el => ["Button", "Edit", "Link", "MenuItem", "ListItem", "ComboBox", "CheckBox", "RadioButton", "Hyperlink"].includes(el.role ?? ""))
            .slice(0, 20)
            .map((el) => {
            const px = `${(el.cx / 1024) * 100}%`;
            const py = `${(el.cy / 1024) * 100}%`;
            return (
              <div
                key={el.id}
                style={{
                  position: "absolute",
                  left: px,
                  top: py,
                  transform: "translate(-50%,-50%)",
                  pointerEvents: "none",
                  zIndex: 9990,
                }}
              >
                <div
                  style={{
                    width: "18px",
                    height: "18px",
                    borderRadius: "50%",
                    background: "rgba(10,132,255,0.9)",
                    border: "1px solid rgba(255,255,255,0.6)",
                    color: "#fff",
                    fontSize: "9px",
                    fontWeight: 700,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                  }}
                >
                  {el.id}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Action verification badge — briefly shown after a computer-use click */}
      {verifyBadge && (
        <VerificationBadge
          success={verifyBadge.success}
          label={verifyBadge.label}
          explanation={verifyBadge.explanation}
        />
      )}

      {/* Computer-use loop step counter */}
      {cuStep && (
        <div
          style={{
            position: "absolute",
            bottom: "56px",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(10,10,20,0.82)",
            border: "1px solid rgba(0,170,255,0.35)",
            borderRadius: "12px",
            padding: "4px 14px",
            pointerEvents: "none",
            zIndex: 9998,
          }}
        >
          <span style={{ fontSize: 11, color: "#a0e0ff" }}>
            Step {cuStep.step}/{cuStep.max_steps}: {cuStep.label}
          </span>
        </div>
      )}
    </div>
  );
}

function ResponseBubble({ text, streaming, opacity = 0.94 }: { text: string; streaming: boolean; opacity?: number }) {
  const [copied, setCopied] = useState(false);
  const [cursorVisible, setCursorVisible] = useState(true);

  // Blink the streaming cursor while AI is still generating
  useEffect(() => {
    if (!streaming) return;
    const id = setInterval(() => setCursorVisible((v) => !v), 500);
    return () => clearInterval(id);
  }, [streaming]);

  function handleCopy(e: React.MouseEvent) {
    e.stopPropagation();
    navigator.clipboard.writeText(text || "").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  return (
    <>
      <style>{`
        @keyframes bubbleIn {
          from { opacity: 0; transform: translateX(-50%) translateY(10px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
      <div
        style={{
          position: "absolute",
          bottom: "100px",
          left: "50%",
          transform: "translateX(-50%)",
          maxWidth: "680px",
          minWidth: "180px",
          padding: "16px 20px",
          background: `rgba(28,28,30,${opacity})`,
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
          animation: "bubbleIn 0.18s ease-out forwards",
        } as React.CSSProperties}
      >
        {/* Copy button */}
        <button
          onClick={handleCopy}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            background: copied ? "rgba(76,175,80,0.2)" : "rgba(255,255,255,0.08)",
            border: "none",
            borderRadius: 4,
            color: copied ? "#4caf50" : "#888",
            fontSize: 11,
            padding: "3px 8px",
            cursor: "pointer",
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>

        <div dir="auto"><ReactMarkdown>{text}</ReactMarkdown></div>

        {/* Streaming cursor — pulses while AI is still generating */}
        {streaming && (
          <span
            style={{
              display: "inline-block",
              width: "2px",
              height: "16px",
              background: colors.accent,
              marginLeft: "2px",
              verticalAlign: "text-bottom",
              opacity: cursorVisible ? 1 : 0,
              transition: "opacity 0.12s",
            }}
          />
        )}

        {!streaming && (
          <div
            role="button"
            aria-label="Dismiss"
            style={{
              marginTop: "10px",
              fontSize: "11px",
              color: colors.textTertiary,
              textAlign: "right",
            }}
          >
            Click to dismiss
          </div>
        )}
      </div>
    </>
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
