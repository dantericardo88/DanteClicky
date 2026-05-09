import { useState, useEffect, useRef, useCallback, Component } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useCompanionStore } from "../state/companionStore";
import { validateKey } from "../lib/apiValidation";
import { streamChat } from "../providers/chat";
import { recordTelemetryEvent } from "../lib/telemetry";

// ── Design tokens ─────────────────────────────────────────────────────────────
const OB = {
  bg: "#080810",
  bgCard: "rgba(255,255,255,0.04)",
  bgCardHover: "rgba(255,255,255,0.07)",
  border: "rgba(255,255,255,0.08)",
  borderActive: "rgba(99,102,241,0.6)",
  accent: "#6366f1",
  accentHover: "#818cf8",
  accentGlow: "rgba(99,102,241,0.35)",
  text: "#f9fafb",
  textSub: "rgba(249,250,251,0.65)",
  textMuted: "rgba(249,250,251,0.35)",
  success: "#22c55e",
  error: "#ef4444",
  warning: "#f59e0b",
  fontStack: "-apple-system, 'Segoe UI', system-ui, sans-serif",
} as const;

const STEP_COUNT = 6;
const FORMSPARK_FORM_ID = "YOUR_FORMSPARK_FORM_ID";
const CANNED_RESPONSE =
  "I can see a desktop with a code editor open — there's a TypeScript file with some components. There's also a browser tab in the background. I can describe code, answer questions about what's on screen, or take actions like clicking and typing on your behalf.";

// ── Analytics helper (privacy-first telemetry facade) ────────────────────────
function track(event: string, props?: Record<string, string | number | boolean | null>) {
  recordTelemetryEvent(event, props ?? {});
}

// ── Shared PrimaryButton ──────────────────────────────────────────────────────
function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "12px 28px",
        background: disabled ? "rgba(99,102,241,0.3)" : OB.accent,
        border: "none",
        borderRadius: "10px",
        color: disabled ? "rgba(255,255,255,0.4)" : "#fff",
        fontSize: "15px",
        fontWeight: 600,
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: disabled ? "none" : `0 4px 20px ${OB.accentGlow}`,
        transition: "background 0.2s, box-shadow 0.2s",
        alignSelf: "center",
        fontFamily: OB.fontStack,
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.background = OB.accentHover;
      }}
      onMouseLeave={(e) => {
        if (!disabled) e.currentTarget.style.background = OB.accent;
      }}
    >
      {children}
    </button>
  );
}

// ── Step 0: Welcome ───────────────────────────────────────────────────────────
function StepWelcome({ onAutoAdvance }: { onAutoAdvance: () => void }) {
  const TAGLINE = "your AI desktop companion";
  const SUBTITLE = "see your screen  ·  hear your voice  ·  take action";

  const [titleVisible, setTitleVisible] = useState(false);
  const [taglineChars, setTaglineChars] = useState("");
  const [subtitleVisible, setSubtitleVisible] = useState(false);
  const [cursorOn, setCursorOn] = useState(true);
  const hasAdvanced = useRef(false);

  useEffect(() => {
    track("onboarding_started");

    const t1 = setTimeout(() => setTitleVisible(true), 300);

    let charI = 0;
    const t2 = setTimeout(() => {
      const interval = setInterval(() => {
        charI++;
        setTaglineChars(TAGLINE.slice(0, charI));
        if (charI >= TAGLINE.length) {
          clearInterval(interval);
          setTimeout(() => setSubtitleVisible(true), 600);
          setTimeout(() => {
            if (!hasAdvanced.current) {
              hasAdvanced.current = true;
              onAutoAdvance();
            }
          }, 2400);
        }
      }, 35);
    }, 900);

    const cursorInterval = setInterval(() => setCursorOn((v) => !v), 530);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearInterval(cursorInterval);
    };
  }, [onAutoAdvance]);

  return (
    <div
      style={{
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "20px",
      }}
    >
      {/* Logo mark */}
      <div
        style={{
          width: "64px",
          height: "64px",
          borderRadius: "18px",
          background: OB.accent,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "28px",
          animation: "glowPulse 3s ease-in-out infinite",
          opacity: titleVisible ? 1 : 0,
          transform: titleVisible ? "scale(1)" : "scale(0.8)",
          transition: "opacity 0.6s ease, transform 0.6s ease",
        }}
      >
        ✦
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: "52px",
          fontWeight: 200,
          letterSpacing: "0.06em",
          color: OB.text,
          opacity: titleVisible ? 1 : 0,
          transform: titleVisible ? "translateY(0)" : "translateY(10px)",
          transition: "opacity 0.6s ease, transform 0.6s ease",
        }}
      >
        DanteClicky
      </div>

      {/* Tagline with streaming cursor */}
      <div
        style={{
          fontSize: "18px",
          color: OB.textSub,
          fontWeight: 300,
          height: "28px",
        }}
      >
        {taglineChars}
        {taglineChars.length < TAGLINE.length && cursorOn && (
          <span
            style={{
              display: "inline-block",
              width: "2px",
              height: "18px",
              background: OB.accent,
              marginLeft: "2px",
              verticalAlign: "text-bottom",
            }}
          />
        )}
      </div>

      {/* Subtitle */}
      <div
        style={{
          fontSize: "14px",
          color: OB.textMuted,
          letterSpacing: "0.08em",
          opacity: subtitleVisible ? 1 : 0,
          transition: "opacity 0.8s ease",
        }}
      >
        {SUBTITLE}
      </div>
    </div>
  );
}

// ── Step 1: Features ──────────────────────────────────────────────────────────
const FEATURES = [
  {
    icon: "👁",
    title: "Sees your screen",
    desc: "Hold the hotkey — it captures context from whatever you're working on",
    delay: 0,
  },
  {
    icon: "🎙",
    title: "Hears your voice",
    desc: "Speak naturally. The wake word is off by default",
    delay: 150,
  },
  {
    icon: "🖱",
    title: "Takes action",
    desc: "Click, type, and scroll on your behalf when you ask it to",
    delay: 300,
  },
];

function StepFeatures({ onNext }: { onNext: () => void }) {
  const [visible, setVisible] = useState([false, false, false]);

  useEffect(() => {
    FEATURES.forEach((f, i) => {
      setTimeout(() => {
        setVisible((v) => {
          const next = [...v];
          next[i] = true;
          return next;
        });
      }, 200 + f.delay);
    });
  }, []);

  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "24px",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: "28px",
            fontWeight: 300,
            marginBottom: "6px",
            color: OB.text,
          }}
        >
          What DanteClicky does
        </div>
        <div style={{ fontSize: "14px", color: OB.textMuted }}>
          An AI that lives on your desktop and actually helps
        </div>
      </div>

      <div style={{ display: "flex", gap: "16px" }}>
        {FEATURES.map((f, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              padding: "20px",
              background: OB.bgCard,
              border: `1px solid ${OB.border}`,
              borderRadius: "14px",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              opacity: visible[i] ? 1 : 0,
              transform: visible[i] ? "translateY(0)" : "translateY(20px)",
              transition: `opacity 0.5s ease ${f.delay}ms, transform 0.5s ease ${f.delay}ms`,
            }}
          >
            <div style={{ fontSize: "28px" }}>{f.icon}</div>
            <div
              style={{
                fontSize: "15px",
                fontWeight: 600,
                color: OB.text,
              }}
            >
              {f.title}
            </div>
            <div
              style={{
                fontSize: "13px",
                color: OB.textSub,
                lineHeight: 1.5,
              }}
            >
              {f.desc}
            </div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <PrimaryButton onClick={onNext}>Continue →</PrimaryButton>
      </div>
    </div>
  );
}

// ── Step 2: Privacy ───────────────────────────────────────────────────────────
function StepPrivacy({
  onNext,
  micGranted,
  setMicGranted,
  hotkeyBinding,
}: {
  onNext: () => void;
  micGranted: string;
  setMicGranted: (s: "unknown" | "granted" | "denied" | "prompt") => void;
  hotkeyBinding: string;
}) {
  const [requesting, setRequesting] = useState(false);
  const [justGranted, setJustGranted] = useState(false);

  useEffect(() => {
    navigator.permissions
      .query({ name: "microphone" as PermissionName })
      .then((r) => {
        setMicGranted(r.state as "granted" | "denied" | "prompt");
        r.addEventListener("change", () => {
          setMicGranted(r.state as "granted" | "denied" | "prompt");
          if (r.state === "granted") {
            track("onboarding_mic_granted");
            setJustGranted(true);
            setTimeout(() => setJustGranted(false), 2000);
          }
        });
      })
      .catch(() => setMicGranted("unknown"));
  }, [setMicGranted]);

  async function requestMic() {
    setRequesting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      setMicGranted("granted");
      setJustGranted(true);
      setTimeout(() => setJustGranted(false), 2000);
      track("onboarding_mic_granted");
    } catch {
      setMicGranted("denied");
      track("onboarding_mic_denied");
    } finally {
      setRequesting(false);
    }
  }

  const micAlreadyGranted = micGranted === "granted";

  return (
    <div
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: "28px",
        alignItems: "center",
      }}
    >
      {/* Privacy shield */}
      <div
        style={{
          width: "72px",
          height: "72px",
          borderRadius: "50%",
          background: "rgba(34,197,94,0.12)",
          border: "2px solid rgba(34,197,94,0.3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "32px",
          animation: "fadeIn 0.4s ease",
        }}
      >
        🔒
      </div>

      <div style={{ textAlign: "center", maxWidth: "520px" }}>
        <div
          style={{
            fontSize: "28px",
            fontWeight: 300,
            marginBottom: "12px",
            color: OB.text,
          }}
        >
          Nothing runs in the background.
        </div>
        <div
          style={{
            fontSize: "16px",
            color: OB.textSub,
            lineHeight: 1.65,
            marginBottom: "8px",
          }}
        >
          DanteClicky starts with push-to-talk. The wake word is off by default, and you can hold{" "}
          <span
            style={{
              display: "inline-block",
              padding: "2px 8px",
              borderRadius: "6px",
              background: "rgba(255,255,255,0.08)",
              border: `1px solid ${OB.border}`,
              fontFamily: "monospace",
              fontSize: "14px",
            }}
          >
            {hotkeyBinding}
          </span>
        </div>
        <div
          style={{
            fontSize: "14px",
            color: OB.textMuted,
            lineHeight: 1.6,
          }}
        >
          Your screen is never recorded. Screenshots are only taken when you
          trigger the hotkey and are never uploaded without your permission.
        </div>
      </div>

      {/* Mic permission row */}
      <div
        style={{
          padding: "16px 24px",
          background: OB.bgCard,
          border: `1px solid ${micAlreadyGranted ? "rgba(34,197,94,0.3)" : OB.border}`,
          borderRadius: "12px",
          width: "100%",
          maxWidth: "480px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "16px",
        }}
      >
        <div>
          <div
            style={{
              fontSize: "14px",
              fontWeight: 600,
              marginBottom: "2px",
              color: OB.text,
            }}
          >
            Microphone access
          </div>
          <div style={{ fontSize: "12px", color: OB.textMuted }}>
            Required for push-to-talk voice input
          </div>
          {micGranted === "denied" && (
            <div
              style={{
                fontSize: "12px",
                color: OB.error,
                marginTop: "4px",
              }}
            >
              Denied — allow microphone access in system settings
            </div>
          )}
        </div>
        {micAlreadyGranted ? (
          <div style={{ color: OB.success, fontSize: "20px" }}>✓</div>
        ) : (
          <button
            onClick={requestMic}
            disabled={requesting || micGranted === "denied"}
            style={{
              padding: "8px 16px",
              background: requesting
                ? "rgba(99,102,241,0.3)"
                : OB.accent,
              border: "none",
              borderRadius: "8px",
              color: "#fff",
              fontSize: "13px",
              fontWeight: 600,
              cursor:
                requesting || micGranted === "denied"
                  ? "not-allowed"
                  : "pointer",
              flexShrink: 0,
              opacity: micGranted === "denied" ? 0.5 : 1,
              transition: "background 0.2s",
              fontFamily: OB.fontStack,
            }}
          >
            {requesting ? "Requesting…" : "Allow access"}
          </button>
        )}
      </div>

      <PrimaryButton onClick={onNext}>
        {justGranted ? "Mic ready ✓  Continue →" : "Continue →"}
      </PrimaryButton>
    </div>
  );
}

// ── Step 3: API Key ───────────────────────────────────────────────────────────
function StepApiKey({
  keyValue,
  setKeyValue,
  keyStatus,
  email,
  setEmail,
  emailSent,
  setEmailSent,
  onNext,
  onSkip,
  onPasteKey,
}: {
  keyValue: string;
  setKeyValue: (v: string) => void;
  keyStatus: "unchecked" | "checking" | "valid" | "invalid";
  email: string;
  setEmail: (v: string) => void;
  emailSent: boolean;
  setEmailSent: (v: boolean) => void;
  onNext: () => void;
  onSkip: () => void;
  onPasteKey: (pasted: string) => void;
}) {
  const canContinue = keyStatus === "valid";

  async function submitEmail() {
    if (!email.trim() || emailSent || FORMSPARK_FORM_ID === "YOUR_FORMSPARK_FORM_ID") return;
    try {
      await fetch(`https://submit-form.com/${FORMSPARK_FORM_ID}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          email,
          source: "onboarding",
          product: "DanteClicky",
        }),
      });
      setEmailSent(true);
      track("onboarding_email_captured");
    } catch {
      // Non-fatal
    }
  }

  function openAnthropicLink() {
    import("@tauri-apps/plugin-opener")
      .then(({ openUrl }) => openUrl("https://console.anthropic.com/api-keys"))
      .catch(() => {});
  }

  const statusColor =
    keyStatus === "valid"
      ? OB.success
      : keyStatus === "invalid"
        ? OB.error
        : OB.border;
  const statusIcon =
    keyStatus === "valid"
      ? "✓"
      : keyStatus === "invalid"
        ? "✗"
        : keyStatus === "checking"
          ? "…"
          : null;

  const continueBtnLabel =
    keyStatus === "valid"
      ? "Continue →"
      : keyStatus === "checking"
        ? "Validating…"
        : "Paste your key to continue";

  return (
    <div
      style={{
        width: "100%",
        maxWidth: "480px",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <div
          style={{
            fontSize: "28px",
            fontWeight: 300,
            marginBottom: "6px",
            color: OB.text,
          }}
        >
          Add your Anthropic key
        </div>
        <div style={{ fontSize: "14px", color: OB.textMuted }}>
          DanteClicky uses Claude to understand your screen and respond
        </div>
      </div>

      {/* Key input */}
      <div>
        <div
          style={{
            fontSize: "12px",
            color: OB.textMuted,
            marginBottom: "6px",
            fontWeight: 500,
          }}
        >
          Anthropic API Key
        </div>
        <div
          style={{
            display: "flex",
            gap: "8px",
            alignItems: "center",
          }}
        >
          <input
            type="password"
            value={keyValue}
            onChange={(e) => setKeyValue(e.target.value)}
            onPaste={(e) => {
              const pasted = e.clipboardData.getData("text").trim();
              if (pasted) {
                e.preventDefault();
                onPasteKey(pasted);
              }
            }}
            placeholder="sk-ant-api03-..."
            autoFocus
            style={{
              flex: 1,
              padding: "12px 14px",
              background: "rgba(255,255,255,0.05)",
              border: `1px solid ${statusColor}`,
              borderRadius: "10px",
              color: OB.text,
              fontSize: "14px",
              outline: "none",
              transition: "border-color 0.2s",
              fontFamily: "monospace",
            }}
          />
          {statusIcon && (
            <span
              style={{
                fontSize: "18px",
                color: statusColor,
                width: "24px",
                textAlign: "center",
                flexShrink: 0,
              }}
            >
              {statusIcon}
            </span>
          )}
        </div>
        {keyStatus === "invalid" && (
          <div
            style={{
              fontSize: "12px",
              color: OB.error,
              marginTop: "5px",
            }}
          >
            That key doesn't seem to work — check it at console.anthropic.com
          </div>
        )}
        <div style={{ fontSize: "11px", color: OB.textMuted, marginTop: "6px", display: "flex", alignItems: "center", gap: "4px" }}>
          <span style={{ color: OB.success, fontSize: "12px" }}>🔒</span>
          Stored locally on your device — never sent to our servers
        </div>
      </div>

      {/* Get key link */}
      <button
        onClick={openAnthropicLink}
        style={{
          background: "transparent",
          border: `1px solid ${OB.border}`,
          borderRadius: "8px",
          padding: "8px 14px",
          color: OB.textSub,
          fontSize: "13px",
          cursor: "pointer",
          textAlign: "center",
          transition: "border-color 0.2s",
          fontFamily: OB.fontStack,
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.borderColor = OB.accent)
        }
        onMouseLeave={(e) =>
          (e.currentTarget.style.borderColor = OB.border)
        }
      >
        Get a free API key → console.anthropic.com
      </button>

      {/* Email capture (optional) — hidden when FormSpark not configured */}
      {FORMSPARK_FORM_ID !== "YOUR_FORMSPARK_FORM_ID" && (
        <div
          style={{
            padding: "14px 16px",
            background: OB.bgCard,
            border: `1px solid ${OB.border}`,
            borderRadius: "10px",
          }}
        >
          <div
            style={{
              fontSize: "12px",
              color: OB.textMuted,
              marginBottom: "8px",
            }}
          >
            Get tips and updates (optional)
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={emailSent}
              style={{
                flex: 1,
                padding: "8px 12px",
                background: "rgba(255,255,255,0.05)",
                border: `1px solid ${OB.border}`,
                borderRadius: "8px",
                color: OB.text,
                fontSize: "13px",
                outline: "none",
                opacity: emailSent ? 0.6 : 1,
                fontFamily: OB.fontStack,
              }}
            />
            {emailSent ? (
              <span
                style={{
                  color: OB.success,
                  fontSize: "18px",
                  alignSelf: "center",
                }}
              >
                ✓
              </span>
            ) : (
              <button
                onClick={submitEmail}
                disabled={!email.trim()}
                style={{
                  padding: "8px 14px",
                  background: email.trim()
                    ? OB.accent
                    : "rgba(99,102,241,0.3)",
                  border: "none",
                  borderRadius: "8px",
                  color: "#fff",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: email.trim() ? "pointer" : "not-allowed",
                  flexShrink: 0,
                  transition: "background 0.2s",
                  fontFamily: OB.fontStack,
                }}
              >
                Subscribe
              </button>
            )}
          </div>
        </div>
      )}

      <PrimaryButton onClick={onNext} disabled={!canContinue}>
        {continueBtnLabel}
      </PrimaryButton>

      {/* Skip link — handles API unreachable edge case */}
      <button
        onClick={onSkip}
        style={{
          background: "transparent",
          border: "none",
          color: OB.textMuted,
          fontSize: "13px",
          cursor: "pointer",
          textAlign: "center",
          padding: "4px",
          fontFamily: OB.fontStack,
          transition: "color 0.2s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = OB.textSub)}
        onMouseLeave={(e) => (e.currentTarget.style.color = OB.textMuted)}
      >
        Skip for now →
      </button>
    </div>
  );
}

// ── Step 4: Live Demo ─────────────────────────────────────────────────────────
function StepLiveDemo({
  onNext,
  selectedProvider,
  selectedModelId,
  hotkeyBinding,
  cannedDemo = false,
}: {
  onNext: () => void;
  selectedProvider: string;
  selectedModelId: string;
  hotkeyBinding: string;
  cannedDemo?: boolean;
}) {
  const [status, setStatus] = useState<"capturing" | "streaming" | "done" | "captureError" | "streamError">("capturing");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [demoText, setDemoText] = useState("");
  const [followupInput, setFollowupInput] = useState("");
  const [showFollowup, setShowFollowup] = useState(false);
  const [runCount, setRunCount] = useState(0);
  const [followupPending, setFollowupPending] = useState(false);
  const [followupError, setFollowupError] = useState(false);
  const [followupSubmitted, setFollowupSubmitted] = useState(false);
  const lastRunCount = useRef(-1);
  const cannedIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const followupInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (showFollowup && followupInputRef.current) {
      followupInputRef.current.focus();
    }
  }, [showFollowup]);

  useEffect(() => {
    if (lastRunCount.current === runCount) return;
    lastRunCount.current = runCount;

    async function runDemo() {
      if (cannedDemo) {
        setStatus("streaming");
        let i = 0;
        const interval = setInterval(() => {
          i++;
          setDemoText(CANNED_RESPONSE.slice(0, i));
          if (i >= CANNED_RESPONSE.length) {
            clearInterval(interval);
            cannedIntervalRef.current = null;
            setStatus("done");
            track("onboarding_demo_completed");
          }
        }, 25);
        cannedIntervalRef.current = interval;
        return;
      }

      let jpegB64: string;
      try {
        jpegB64 = await invoke<string>("capture_primary");
      } catch {
        setStatus("captureError");
        return;
      }
      setScreenshot(jpegB64);
      setStatus("streaming");
      try {
        await streamChat({
          provider: selectedProvider,
          modelId: selectedModelId,
          systemPrompt:
            "You are a helpful AI. Respond in 1-2 sentences only. Be specific and friendly.",
          messages: [
            {
              role: "user",
              content:
                "Describe what you can see on this screen. Be specific about the app or content visible.",
            },
          ],
          images: [jpegB64],
          onChunk: (chunk) => setDemoText((prev) => prev + chunk),
        });
        setStatus("done");
        track("onboarding_demo_completed");
        setShowFollowup(true);
      } catch {
        setStatus("streamError");
      }
    }

    runDemo();

    return () => {
      if (cannedIntervalRef.current) {
        clearInterval(cannedIntervalRef.current);
        cannedIntervalRef.current = null;
      }
    };
  }, [selectedProvider, selectedModelId, runCount, cannedDemo]);

  function handleDemoRetry() {
    setStatus("capturing");
    setScreenshot(null);
    setDemoText("");
    setShowFollowup(false);
    setRunCount((c) => c + 1);
  }

  const handleFollowup = useCallback(async () => {
    const q = followupInput.trim();
    if (!q || followupPending || !screenshot) return;
    setFollowupSubmitted(true);
    setFollowupPending(true);
    setFollowupError(false);
    setDemoText("");
    setStatus("streaming");
    try {
      await streamChat({
        provider: selectedProvider,
        modelId: selectedModelId,
        systemPrompt: "You are a helpful AI. Respond in 2-3 sentences. Be specific and friendly.",
        messages: [{ role: "user", content: q }],
        images: [screenshot],
        onChunk: (chunk) => setDemoText((prev) => prev + chunk),
      });
      setStatus("done");
      setShowFollowup(false);
      setFollowupPending(false);
    } catch {
      setStatus("done");
      setFollowupPending(false);
      setFollowupError(true);
    }
  }, [followupInput, followupPending, screenshot, selectedProvider, selectedModelId]);

  return (
    <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: "20px", alignItems: "center" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "28px", fontWeight: 300, marginBottom: "6px", color: OB.text }}>
          {status === "capturing"
            ? (cannedDemo ? "Loading preview…" : "Capturing your screen…")
            : (status === "captureError" || status === "streamError") && !followupSubmitted
              ? "Something went wrong"
              : followupSubmitted
                ? "Here's my answer"
                : cannedDemo
                  ? "Here's what I'd see"
                  : "Here's what I see"}
        </div>
        <div style={{ fontSize: "14px", color: OB.textMuted }}>
          {followupSubmitted
            ? "Ask another question or continue"
            : cannedDemo
              ? `Example of what happens every time you hold ${hotkeyBinding}`
              : `This is exactly what happens every time you hold ${hotkeyBinding}`}
        </div>
      </div>

      {/* Privacy/preview disclosure */}
      <div style={{ fontSize: "12px", color: OB.textMuted, textAlign: "center", lineHeight: 1.5 }}>
        {cannedDemo
          ? "This is a preview — add your API key in Settings for the real experience."
          : "Your screenshot will be analyzed by Claude's API. Nothing is stored."}
      </div>

      <div style={{ display: "flex", gap: "16px", width: "100%", alignItems: "flex-start" }}>
        {/* Screenshot or canned placeholder */}
        {cannedDemo ? (
          <div style={{
            flexShrink: 0,
            width: "220px",
            height: "140px",
            borderRadius: "10px",
            border: `1px solid ${OB.border}`,
            background: "linear-gradient(135deg, rgba(99,102,241,0.06) 0%, rgba(99,102,241,0.02) 100%)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            animation: "fadeIn 0.4s ease",
          }}>
            <div style={{ fontSize: "24px" }}>🖥</div>
            <div style={{ fontSize: "11px", color: OB.textMuted, textAlign: "center", lineHeight: 1.5 }}>
              Your screen would<br />appear here
            </div>
          </div>
        ) : screenshot ? (
          <div style={{
            flexShrink: 0,
            width: "220px",
            borderRadius: "10px",
            overflow: "hidden",
            border: `1px solid ${OB.border}`,
            animation: "fadeIn 0.4s ease",
          }}>
            <img
              src={`data:image/jpeg;base64,${screenshot}`}
              alt="Your screen"
              style={{ width: "100%", display: "block" }}
            />
          </div>
        ) : null}

        {/* Streaming response */}
        <div style={{
          flex: 1,
          padding: "16px",
          background: OB.bgCard,
          border: `1px solid ${OB.border}`,
          borderRadius: "12px",
          minHeight: "80px",
          display: "flex",
          flexDirection: "column",
          gap: "10px",
        }}>
          {status === "capturing" && (
            <div style={{ display: "flex", alignItems: "center", gap: "10px", color: OB.textMuted, fontSize: "14px" }}>
              <div style={{
                width: "16px",
                height: "16px",
                border: "2px solid rgba(99,102,241,0.25)",
                borderTopColor: OB.accent,
                borderRadius: "50%",
                animation: "spin 0.8s linear infinite",
                flexShrink: 0,
              }} />
              Taking screenshot…
            </div>
          )}
          {status === "captureError" && (
            <div style={{ color: OB.error, fontSize: "14px" }}>
              Screen capture failed — check screen recording permissions in system settings.
            </div>
          )}
          {status === "streamError" && (
            <div style={{ color: OB.error, fontSize: "14px" }}>
              Couldn't connect — check your API key in Settings.
            </div>
          )}
          {(status === "streaming" || status === "done") && (
            <div style={{
              fontSize: "15px",
              color: OB.text,
              lineHeight: 1.6,
              animation: "fadeIn 0.3s ease",
            }}>
              {demoText}
              {status === "streaming" && (
                <span style={{
                  display: "inline-block",
                  width: "2px",
                  height: "15px",
                  background: OB.accent,
                  marginLeft: "2px",
                  verticalAlign: "text-bottom",
                  animation: "typeCursor 1s infinite",
                }} />
              )}
            </div>
          )}
          {status === "done" && !showFollowup && (
            <div style={{ fontSize: "12px", color: OB.textMuted, marginTop: "4px" }}>
              ✦ powered by {selectedModelId.includes("claude") ? "Claude" : "AI"}
            </div>
          )}
          {status === "done" && showFollowup && (
            <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginTop: "4px" }}>
              {followupError && (
                <div style={{ fontSize: "11px", color: OB.error }}>
                  Couldn't connect — check your API key and try again
                </div>
              )}
              <div style={{ display: "flex", gap: "6px" }}>
                <input
                  ref={followupInputRef}
                  value={followupInput}
                  onChange={(e) => { setFollowupError(false); setFollowupInput(e.target.value); }}
                  onKeyDown={(e) => { if (e.key === "Enter") handleFollowup(); }}
                  placeholder="Ask a follow-up…"
                  disabled={followupPending}
                  style={{
                    flex: 1,
                    padding: "6px 10px",
                    background: "rgba(255,255,255,0.06)",
                    border: `1px solid ${followupError ? OB.error : OB.border}`,
                    borderRadius: "8px",
                    color: OB.text,
                    fontSize: "13px",
                    outline: "none",
                    fontFamily: OB.fontStack,
                    opacity: followupPending ? 0.7 : 1,
                  }}
                />
                <button
                  onClick={handleFollowup}
                  disabled={!followupInput.trim() || followupPending}
                  style={{
                    padding: "6px 10px",
                    background: (followupInput.trim() && !followupPending) ? OB.accent : "rgba(99,102,241,0.3)",
                    border: "none",
                    borderRadius: "8px",
                    color: "#fff",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: (followupInput.trim() && !followupPending) ? "pointer" : "not-allowed",
                    flexShrink: 0,
                    fontFamily: OB.fontStack,
                    transition: "background 0.2s",
                  }}
                >
                  {followupPending ? "…" : "→"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {(status === "done" || status === "captureError" || status === "streamError") && (
        <div style={{ display: "flex", gap: "10px", alignItems: "center", justifyContent: "center" }}>
          {(status === "captureError" || status === "streamError") && (
            <button
              onClick={handleDemoRetry}
              style={{
                padding: "10px 20px",
                background: "transparent",
                border: `1px solid ${OB.border}`,
                borderRadius: "10px",
                color: OB.textSub,
                fontSize: "14px",
                cursor: "pointer",
                fontFamily: OB.fontStack,
                transition: "border-color 0.2s",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = OB.accent)}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = OB.border)}
            >
              Try again →
            </button>
          )}
          <PrimaryButton onClick={onNext}>Continue →</PrimaryButton>
        </div>
      )}
    </div>
  );
}

// ── Step 5: Complete ──────────────────────────────────────────────────────────
function StepComplete({
  onComplete,
  keyProvided,
  hotkeyBinding,
}: {
  onComplete: () => void;
  keyProvided: boolean;
  hotkeyBinding: string;
}) {
  const hasCompleted = useRef(false);

  return (
    <div
      style={{
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "14px",
      }}
    >
      <div
        style={{
          width: "64px",
          height: "64px",
          borderRadius: "50%",
          background: "rgba(99,102,241,0.15)",
          border: "2px solid rgba(99,102,241,0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "32px",
          animation: "fadeInUp 0.5s ease",
        }}
      >
        🎉
      </div>

      <div>
        <div
          style={{
            fontSize: "36px",
            fontWeight: 300,
            marginBottom: "10px",
            color: OB.text,
            animation: "fadeInUp 0.5s ease 0.1s both",
          }}
        >
          You're all set!
        </div>
        <div
          style={{
            fontSize: "16px",
            color: OB.textSub,
            animation: "fadeInUp 0.5s ease 0.2s both",
            marginBottom: "8px",
          }}
        >
          Hold{" "}
          <span
            style={{
              padding: "2px 8px",
              borderRadius: "6px",
              background: "rgba(255,255,255,0.08)",
              border: `1px solid ${OB.border}`,
              fontFamily: "monospace",
              fontSize: "14px",
            }}
          >
            {hotkeyBinding}
          </span>{" "}
          to wake me up
        </div>
        {!keyProvided && (
          <div
            style={{
              fontSize: "13px",
              color: OB.warning,
              marginTop: "8px",
            }}
          >
            You skipped adding an API key — open Settings to add one later
          </div>
        )}
      </div>

      {/* First-try prompt */}
      <div style={{
        padding: "14px 20px",
        background: "rgba(99,102,241,0.08)",
        border: `1px solid rgba(99,102,241,0.25)`,
        borderRadius: "12px",
        maxWidth: "380px",
        textAlign: "left",
        animation: "fadeInUp 0.5s ease 0.25s both",
      }}>
        <div style={{ fontSize: "12px", color: OB.accent, fontWeight: 600, marginBottom: "6px", letterSpacing: "0.05em" }}>
          TRY IT NOW
        </div>
        <div style={{ fontSize: "14px", color: OB.text, lineHeight: 1.55 }}>
          Hold{" "}
          <span style={{
            padding: "1px 6px",
            borderRadius: "5px",
            background: "rgba(255,255,255,0.1)",
            border: `1px solid ${OB.border}`,
            fontFamily: "monospace",
            fontSize: "13px",
          }}>
            {hotkeyBinding}
          </span>
          {" "}and ask{" "}
          <span style={{ color: OB.textSub, fontStyle: "italic" }}>"What's on my screen?"</span>
        </div>
      </div>

      {/* Panel orientation hint */}
      <div style={{
        fontSize: "13px",
        color: OB.textMuted,
        animation: "fadeInUp 0.5s ease 0.3s both",
        display: "flex",
        alignItems: "center",
        gap: "6px",
      }}>
        <span style={{ color: OB.accent }}>✦</span>
        Look for this icon near your desktop tray or menu bar
      </div>

      <button
        onClick={() => {
          if (!hasCompleted.current) {
            hasCompleted.current = true;
            onComplete();
          }
        }}
        style={{
          padding: "12px 28px",
          background: OB.accent,
          border: "none",
          borderRadius: "10px",
          color: "#fff",
          fontSize: "15px",
          fontWeight: 600,
          cursor: "pointer",
          boxShadow: `0 4px 20px ${OB.accentGlow}`,
          animation: "fadeInUp 0.5s ease 0.3s both",
          transition: "background 0.2s",
          fontFamily: OB.fontStack,
        }}
        onMouseEnter={(e) =>
          (e.currentTarget.style.background = OB.accentHover)
        }
        onMouseLeave={(e) => (e.currentTarget.style.background = OB.accent)}
      >
        Start using DanteClicky
      </button>

      {/* Feedback link */}
      <button
        onClick={() =>
          import("@tauri-apps/plugin-opener")
            .then(({ openUrl }) => openUrl("https://x.com/farzatv"))
            .catch(() => {})
        }
        style={{
          background: "transparent",
          border: "none",
          color: OB.textMuted,
          fontSize: "13px",
          cursor: "pointer",
          fontFamily: OB.fontStack,
          transition: "color 0.2s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = OB.textSub)}
        onMouseLeave={(e) => (e.currentTarget.style.color = OB.textMuted)}
      >
        💬 Give feedback
      </button>
    </div>
  );
}

// ── Root component ────────────────────────────────────────────────────────────
// ── Error boundary ────────────────────────────────────────────────────────────
class OnboardingErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          width: "800px", height: "560px",
          background: "#080810",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "16px",
          fontFamily: "-apple-system, 'Segoe UI', system-ui, sans-serif",
          color: "#f9fafb",
          borderRadius: "16px",
        }}>
          <div style={{ fontSize: "40px" }}>⚠️</div>
          <div style={{ fontSize: "20px", fontWeight: 300 }}>Setup encountered an error</div>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{
              padding: "10px 20px",
              background: "#6366f1",
              border: "none",
              borderRadius: "10px",
              color: "#fff",
              fontSize: "14px",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Root component ────────────────────────────────────────────────────────────
function OnboardingWindowInner() {
  const {
    setApiKey,
    setOnboardingCompleted,
    setOnboardingStep,
    onboardingCompleted,
    onboardingStep,
    hotkeyBinding,
    anthropicKey,
    openaiKey,
    grokKey,
    elevenLabsKey,
    assemblyAiKey,
  } = useCompanionStore();

  const [step, setStep] = useState(onboardingStep ?? 0);
  const [animKey, setAnimKey] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);

  // Shared state lifted so it survives step transitions
  const [micGranted, setMicGranted] = useState<
    "unknown" | "granted" | "denied" | "prompt"
  >("unknown");
  const [keyValue, setKeyValue] = useState("");
  const [keyStatus, setKeyStatus] = useState<
    "unchecked" | "checking" | "valid" | "invalid"
  >("unchecked");
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [demoIsLive, setDemoIsLive] = useState(false);

  useEffect(() => {
    const hasAnyKey = !!(anthropicKey || openaiKey || grokKey || elevenLabsKey || assemblyAiKey);
    if (!hasAnyKey || onboardingCompleted) return;

    setOnboardingCompleted(true);
    invoke("complete_onboarding").catch(() => {
      invoke("show_companion_panel").catch(() => {});
    });
  }, [
    anthropicKey,
    openaiKey,
    grokKey,
    elevenLabsKey,
    assemblyAiKey,
    onboardingCompleted,
    setOnboardingCompleted,
  ]);

  // ── Web Audio API ambient drone ──────────────────────────────────────────────
  useEffect(() => {
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    audioCtxRef.current = ctx;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0, ctx.currentTime);
    masterGain.connect(ctx.destination);
    masterGainRef.current = masterGain;

    // A major triad drone: A2 / C#3 / E3 — triangle waves for warmth
    [110, 138.6, 165].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = "triangle";
      osc.frequency.value = freq;
      osc.detune.value = i * 8;
      oscGain.gain.value = 0.28;
      osc.connect(oscGain);
      oscGain.connect(masterGain);
      osc.start();
    });

    ctx.resume().then(() => {
      masterGain.gain.linearRampToValueAtTime(0.07, ctx.currentTime + 3);
    }).catch(() => {});

    return () => {
      masterGain.gain.setValueAtTime(masterGain.gain.value, ctx.currentTime);
      masterGain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1.5);
      setTimeout(() => ctx.close().catch(() => {}), 2000);
    };
  }, []);

  const handleWindowClick = useCallback(() => {
    const ctx = audioCtxRef.current;
    const gain = masterGainRef.current;
    if (!ctx || !gain || ctx.state === "closed") return;
    ctx.resume().then(() => {
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.07, ctx.currentTime + 2);
    }).catch(() => {});
  }, []);

  // ── Step navigation ──────────────────────────────────────────────────────────
  const goToStep = (n: number) => {
    setStep(n);
    setOnboardingStep(n);
    setAnimKey((k) => k + 1);
  };

  const goNext = () => {
    if (step < STEP_COUNT - 1) goToStep(step + 1);
  };

  // ── API key navigation handlers ──────────────────────────────────────────────
  const handleApiKeyNext = async () => {
    if (keyValue.trim() && keyStatus === "valid") {
      setApiKey("anthropic", keyValue.trim());
      try {
        await invoke("set_api_key", { provider: "anthropic", key: keyValue.trim() });
      } catch {
        // non-fatal
      }
      setDemoIsLive(true);
      goToStep(4);
    } else {
      goToStep(5);
    }
  };

  const handleSkipApiKey = () => {
    setDemoIsLive(false);
    goToStep(4); // canned demo — user still sees the product work
  };

  // ── Key validation (debounced 500ms) ────────────────────────────────────────
  const keyDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Paste handler — bypasses debounce for immediate validation ──────────────
  const handleKeyPaste = useCallback((pasted: string) => {
    if (keyDebounceRef.current) clearTimeout(keyDebounceRef.current);
    setKeyValue(pasted);
    setKeyStatus("checking");
    keyDebounceRef.current = setTimeout(async () => {
      const result = await validateKey("anthropic", pasted);
      setKeyStatus(result);
      if (result === "valid") track("onboarding_key_validated");
    }, 0);
  }, []);

  useEffect(() => {
    if (!keyValue.trim()) {
      setKeyStatus("unchecked");
      return;
    }
    setKeyStatus("checking");
    if (keyDebounceRef.current) clearTimeout(keyDebounceRef.current);
    keyDebounceRef.current = setTimeout(async () => {
      const result = await validateKey("anthropic", keyValue);
      setKeyStatus(result);
      if (result === "valid") track("onboarding_key_validated");
    }, 500);
    return () => {
      if (keyDebounceRef.current) clearTimeout(keyDebounceRef.current);
    };
  }, [keyValue]);

  // ── Complete handler ─────────────────────────────────────────────────────────
  const handleComplete = async () => {
    if (keyValue.trim()) {
      setApiKey("anthropic", keyValue.trim());
      try {
        await invoke("set_api_key", {
          provider: "anthropic",
          key: keyValue.trim(),
        });
      } catch {
        // non-fatal
      }
    }
    setOnboardingCompleted(true);
    track("onboarding_completed", { step_reached: step });

    // Fade out ambient audio
    const ctx = audioCtxRef.current;
    const gain = masterGainRef.current;
    if (ctx && gain && ctx.state !== "closed") {
      gain.gain.cancelScheduledValues(ctx.currentTime);
      gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 2);
    }

    try {
      await invoke("complete_onboarding");
    } catch {
      try {
        await invoke("show_companion_panel");
      } catch {
        // last resort — set completed in store
      }
    }
  };

  // ── Skip handler ─────────────────────────────────────────────────────────────
  const handleSkip = async () => {
    track("onboarding_skipped", { step });
    setOnboardingCompleted(true);
    try {
      await invoke("complete_onboarding");
    } catch {
      try {
        await invoke("show_companion_panel");
      } catch {
        // ignore
      }
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  const steps = [
    <StepWelcome key="welcome" onAutoAdvance={goNext} />,
    <StepFeatures key="features" onNext={goNext} />,
    <StepPrivacy
      key="privacy"
      onNext={goNext}
      micGranted={micGranted}
      setMicGranted={setMicGranted}
      hotkeyBinding={hotkeyBinding}
    />,
    <StepApiKey
      key="apikey"
      keyValue={keyValue}
      setKeyValue={setKeyValue}
      keyStatus={keyStatus}
      email={email}
      setEmail={setEmail}
      emailSent={emailSent}
      setEmailSent={setEmailSent}
      onNext={handleApiKeyNext}
      onSkip={handleSkipApiKey}
      onPasteKey={handleKeyPaste}
    />,
    <StepLiveDemo
      key="demo"
      onNext={goNext}
      selectedProvider="claude"
      selectedModelId="claude-sonnet-4-6"
      hotkeyBinding={hotkeyBinding}
      cannedDemo={!demoIsLive}
    />,
    <StepComplete
      key="complete"
      onComplete={handleComplete}
      keyProvided={!!keyValue.trim()}
      hotkeyBinding={hotkeyBinding}
    />,
  ];

  return (
    <div
      onClick={handleWindowClick}
      style={{
        width: "800px",
        height: "560px",
        background: "linear-gradient(-45deg, #0d0a2e, #1a0520, #0a1f3e, #200a28)",
        backgroundSize: "400% 400%",
        animation: "gradientShift 20s ease infinite",
        fontFamily: OB.fontStack,
        color: OB.text,
        display: "flex",
        flexDirection: "column",
        position: "relative",
        overflow: "hidden",
        userSelect: "none",
        borderRadius: "16px",
        boxShadow: "0 32px 80px rgba(0,0,0,0.8)",
      }}
      data-tauri-drag-region
    >
      {/* Radial gradient accent */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          background:
            "radial-gradient(ellipse 600px 400px at 50% 0%, rgba(99,102,241,0.08) 0%, transparent 70%)",
        }}
      />

      {/* Skip button — visible on steps 0-4 */}
      {step < 5 && (
        <button
          onClick={handleSkip}
          style={{
            position: "absolute",
            top: "16px",
            right: "20px",
            zIndex: 10,
            background: "transparent",
            border: "none",
            color: OB.textMuted,
            fontSize: "13px",
            cursor: "pointer",
            padding: "6px 10px",
            transition: "color 0.2s",
            fontFamily: OB.fontStack,
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = OB.textSub)}
          onMouseLeave={(e) => (e.currentTarget.style.color = OB.textMuted)}
        >
          Skip setup
        </button>
      )}

      {/* Main content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "40px 60px 20px",
        }}
      >
        <div
          key={animKey}
          style={{
            animation: animKey === 0 ? "none" : "fadeInUp 0.35s ease both",
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {steps[step]}
        </div>
      </div>

      {/* Step indicator dots */}
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          gap: "8px",
          paddingBottom: "28px",
        }}
      >
        {Array.from({ length: STEP_COUNT }).map((_, i) => (
          <div
            key={i}
            style={{
              width: i === step ? "24px" : "8px",
              height: "8px",
              borderRadius: "4px",
              background:
                i === step ? OB.accent : "rgba(255,255,255,0.15)",
              transition: "width 0.3s ease, background 0.3s ease",
            }}
          />
        ))}
      </div>
    </div>
  );
}

export default function OnboardingWindow() {
  return (
    <OnboardingErrorBoundary>
      <OnboardingWindowInner />
    </OnboardingErrorBoundary>
  );
}
