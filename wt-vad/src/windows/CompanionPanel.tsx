import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  MODEL_OPTIONS,
  useCompanionStore,
  type ModelOption,
  type ConversationTurn,
} from "../state/companionStore";
import { useVoice } from "../hooks/useVoice";
import {
  colors,
  radii,
  shadows,
  providerColors,
  typography,
} from "../lib/designSystem";
import { validateKey, type KeyStatus, type Provider } from "../lib/apiValidation";

export default function CompanionPanel() {
  useVoice();

  const {
    voiceState,
    selectedModel,
    transcript,
    anthropicKey,
    openaiKey,
    grokKey,
    elevenLabsKey,
    assemblyAiKey,
    hotkeyBinding,
    conversationHistory,
    conversationSummary,
    sessionNotes,
    lastError,
    setSelectedModel,
    setApiKey,
    setHotkeyBinding,
    clearConversation,
    setSessionNotes,
    clearError,
  } = useCompanionStore();

  const [showSettings, setShowSettings] = useState(false);
  const [keyStatuses, setKeyStatuses] = useState<Record<string, KeyStatus>>({});
  const [autostart, setAutostart] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showMemory, setShowMemory] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);

  const hasAnyKey = !!(anthropicKey || openaiKey || grokKey || elevenLabsKey || assemblyAiKey);

  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  function handleSetKey(provider: Provider, key: string) {
    setApiKey(provider, key);

    // Clear existing debounce timer for this provider
    if (debounceTimers.current[provider]) {
      clearTimeout(debounceTimers.current[provider]);
    }

    if (!key.trim()) {
      setKeyStatuses((prev) => ({ ...prev, [provider]: "unchecked" }));
      return;
    }

    // Mark as checking immediately
    setKeyStatuses((prev) => ({ ...prev, [provider]: "checking" }));

    debounceTimers.current[provider] = setTimeout(async () => {
      const status = await validateKey(provider, key);
      setKeyStatuses((prev) => ({ ...prev, [provider]: status }));
    }, 600);
  }

  useEffect(() => {
    return () => {
      // Cleanup all pending timers on unmount
      Object.values(debounceTimers.current).forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    import("@tauri-apps/plugin-autostart")
      .then(({ isEnabled }) => isEnabled())
      .then(setAutostart)
      .catch(() => {});
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ version: string }>("tauri://update-available", (e) => {
      setUpdateVersion(e.payload.version);
    }).then((fn) => { unlisten = fn; }).catch(() => {});
    return () => { unlisten?.(); };
  }, []);

  async function toggleAutostart() {
    const { enable, disable, isEnabled } = await import("@tauri-apps/plugin-autostart");
    if (autostart) {
      await disable();
    } else {
      await enable();
    }
    setAutostart(await isEnabled());
  }

  const statusLabel: Record<typeof voiceState, string> = {
    idle: `Hold ${hotkeyBinding} to speak`,
    listening: "Listening…",
    processing: "Processing…",
    responding: "Responding…",
  };

  const statusColor: Record<typeof voiceState, string> = {
    idle: colors.textTertiary,
    listening: colors.success,
    processing: colors.accent,
    responding: colors.accentHover,
  };

  return (
    <div
      style={{
        width: "360px",
        minHeight: "580px",
        background: colors.background,
        borderRadius: radii.xl,
        boxShadow: shadows.panel,
        border: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        fontFamily: "-apple-system, 'Segoe UI', system-ui, sans-serif",
        color: colors.text,
        overflow: "hidden",
        userSelect: "none",
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: "16px 20px 14px",
          borderBottom: `1px solid ${colors.border}`,
          display: "flex",
          alignItems: "center",
          gap: "10px",
          cursor: "default",
        }}
        data-tauri-drag-region
      >
        <div
          style={{
            width: "32px",
            height: "32px",
            borderRadius: radii.sm,
            background: colors.accent,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "16px",
            flexShrink: 0,
          }}
        >
          ✦
        </div>
        <div>
          <div style={{ ...typography.title, color: colors.text }}>DanteClicky</div>
          <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "1px" }}>
            AI Companion
          </div>
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
          <IconButton
            title={showSettings ? "Close settings" : "Settings"}
            onClick={() => setShowSettings((v) => !v)}
          >
            ⚙
          </IconButton>
          <IconButton
            title="Close to tray"
            onClick={async () => {
              const { getCurrentWindow } = await import("@tauri-apps/api/window");
              await getCurrentWindow().hide();
            }}
          >
            ×
          </IconButton>
        </div>
      </div>

      {/* Update-available banner */}
      {updateVersion && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 16px",
            background: "rgba(255,159,10,0.15)",
            borderBottom: `1px solid rgba(255,159,10,0.4)`,
            color: colors.warning,
            ...typography.caption,
          }}
        >
          <span>Update available — v{updateVersion}</span>
          <button
            onClick={() => setUpdateVersion(null)}
            style={{
              background: "none",
              border: "none",
              color: colors.warning,
              cursor: "pointer",
              fontSize: "16px",
              lineHeight: 1,
              padding: "0 2px",
            }}
          >
            ×
          </button>
        </div>
      )}

      <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px", flex: 1, overflowY: "auto" }}>
        {/* Onboarding card (shown when no API keys are configured) */}
        {!hasAnyKey && !showSettings ? (
          <OnboardingCard onOpenSettings={() => setShowSettings(true)} />
        ) : (
          /* Status */
          <StatusCard
            label={statusLabel[voiceState]}
            color={statusColor[voiceState]}
            pulsing={voiceState === "listening"}
          />
        )}

        {/* Real-time audio level meter — shown during listening */}
        {voiceState === "listening" && <AudioLevelMeter />}

        {/* Error banner */}
        {lastError && (
          <div
            style={{
              padding: "10px 12px",
              background: "rgba(255,69,58,0.12)",
              border: "1px solid rgba(255,69,58,0.4)",
              borderRadius: "8px",
              color: "#FF453A",
              fontSize: "13px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>{lastError}</span>
            <button
              onClick={clearError}
              style={{
                background: "none",
                border: "none",
                color: "#FF453A",
                cursor: "pointer",
                fontSize: "16px",
              }}
            >
              ×
            </button>
          </div>
        )}

        {/* Live transcript */}
        {transcript && voiceState !== "idle" && voiceState !== "responding" && (
          <div
            style={{
              padding: "10px 12px",
              background: colors.backgroundSecondary,
              borderRadius: radii.md,
              ...typography.caption,
              color: colors.textSecondary,
              fontStyle: "italic",
            }}
          >
            "{transcript}"
          </div>
        )}

        {/* Settings drawer */}
        {showSettings && (
          <SettingsSection
            anthropicKey={anthropicKey}
            openaiKey={openaiKey}
            grokKey={grokKey}
            elevenLabsKey={elevenLabsKey}
            assemblyAiKey={assemblyAiKey}
            onSetKey={handleSetKey}
            autostart={autostart}
            onToggleAutostart={toggleAutostart}
            keyStatuses={keyStatuses}
            hotkeyBinding={hotkeyBinding}
            onHotkeyBindingChange={setHotkeyBinding}
          />
        )}

        {/* Conversation history */}
        {conversationHistory.length > 0 && (
          <ConversationHistory turns={conversationHistory} />
        )}

        {/* Model picker */}
        <ModelPicker selected={selectedModel} onChange={setSelectedModel} />

        {/* Collapsible history toggle */}
        {conversationHistory.length > 0 && (
          <button
            onClick={() => setShowHistory((v) => !v)}
            style={{
              padding: "4px 0",
              background: "none",
              border: "none",
              color: colors.textTertiary,
              cursor: "pointer",
              ...typography.caption,
              textAlign: "left",
            }}
          >
            {showHistory ? "Hide" : "Show"} history ({conversationHistory.length} turns)
          </button>
        )}
        {showHistory && (
          <div style={{ maxHeight: "180px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
            {conversationHistory.slice(-3).map((turn, i) => (
              <div key={i} style={{ padding: "8px 10px", background: colors.backgroundSecondary, borderRadius: radii.sm, fontSize: "12px", color: colors.textSecondary }}>
                <div style={{ color: colors.textTertiary, marginBottom: "2px" }}>You: {turn.userPrompt}</div>
                <div style={{ color: colors.text }}>{turn.assistantResponse.slice(0, 120)}{turn.assistantResponse.length > 120 ? "…" : ""}</div>
              </div>
            ))}
          </div>
        )}

        {/* Session Notes */}
        <div>
          <SectionLabel>Session Notes</SectionLabel>
          <textarea
            value={sessionNotes}
            onChange={(e) => setSessionNotes(e.target.value)}
            placeholder="Things for DanteClicky to always remember (e.g., 'I prefer dark mode', 'My main project is in C:/Projects/DanteClicky')"
            rows={3}
            style={{
              width: "100%",
              background: colors.surface,
              border: `1px solid ${colors.border}`,
              borderRadius: radii.sm,
              color: colors.text,
              fontSize: "12px",
              padding: "8px",
              resize: "vertical",
              outline: "none",
              boxSizing: "border-box" as const,
              fontFamily: "inherit",
            }}
          />
        </div>

        {/* Memory — collapsible summary of past sessions */}
        {conversationSummary && (
          <div>
            <button
              onClick={() => setShowMemory((v) => !v)}
              style={{
                padding: "4px 0",
                background: "none",
                border: "none",
                color: colors.textTertiary,
                cursor: "pointer",
                ...typography.caption,
                textAlign: "left",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
            >
              <span>{showMemory ? "▾" : "▸"}</span>
              <span>Memory (summarized history)</span>
            </button>
            {showMemory && (
              <div
                style={{
                  padding: "10px 12px",
                  background: colors.backgroundSecondary,
                  border: `1px solid ${colors.border}`,
                  borderRadius: radii.sm,
                  fontSize: "12px",
                  color: colors.textSecondary,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  maxHeight: "160px",
                  overflowY: "auto",
                }}
              >
                {conversationSummary}
              </div>
            )}
          </div>
        )}

        {/* STT mode */}
        <SttModeSection />

        {/* Hotkey hint */}
        <HotkeyHint />

        {/* Clear conversation */}
        {conversationHistory.length > 0 && (
          <button
            onClick={clearConversation}
            style={{
              padding: "8px",
              background: "transparent",
              border: `1px solid ${colors.border}`,
              borderRadius: radii.sm,
              color: colors.textTertiary,
              cursor: "pointer",
              ...typography.caption,
            }}
          >
            Clear conversation
          </button>
        )}
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function OnboardingCard({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { hotkeyBinding } = useCompanionStore();
  const steps = [
    { num: "1", text: "Open ⚙ Settings" },
    { num: "2", text: "Paste your Anthropic API key" },
    { num: "3", text: `Hold ${hotkeyBinding} to ask anything` },
  ];

  return (
    <div
      style={{
        padding: "20px 16px",
        background: colors.backgroundSecondary,
        borderRadius: radii.md,
        border: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        gap: "16px",
      }}
    >
      <div>
        <div style={{ ...typography.headline, color: colors.text }}>Welcome to DanteClicky</div>
        <div style={{ ...typography.caption, color: colors.textTertiary, marginTop: "3px" }}>
          AI companion for Windows
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
        {steps.map(({ num, text }) => (
          <div key={num} style={{ display: "flex", alignItems: "flex-start", gap: "10px" }}>
            <div
              style={{
                width: "20px",
                height: "20px",
                borderRadius: radii.full,
                background: colors.accent,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                ...typography.small,
                color: "#fff",
              }}
            >
              {num}
            </div>
            <span style={{ ...typography.body, color: colors.textSecondary, paddingTop: "1px" }}>
              {text}
            </span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" as const }}>
        <button
          onClick={onOpenSettings}
          style={{
            padding: "7px 14px",
            background: colors.accent,
            border: "none",
            borderRadius: radii.sm,
            color: "#fff",
            cursor: "pointer",
            ...typography.caption,
            fontWeight: 600,
          }}
        >
          ⚙ Open Settings
        </button>
        <button
          onClick={() =>
            import("@tauri-apps/plugin-opener").then(({ openUrl }) =>
              openUrl("https://console.anthropic.com")
            ).catch(() => {})
          }
          style={{
            padding: "7px 14px",
            background: "transparent",
            border: `1px solid ${colors.border}`,
            borderRadius: radii.sm,
            color: colors.textSecondary,
            cursor: "pointer",
            ...typography.caption,
          }}
        >
          Get Anthropic key →
        </button>
      </div>
    </div>
  );
}

function ConversationHistory({ turns }: { turns: ConversationTurn[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns]);

  return (
    <div>
      <SectionLabel>Conversation</SectionLabel>
      <div
        ref={scrollRef}
        style={{
          maxHeight: "220px",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          scrollbarWidth: "thin",
          scrollbarColor: `${colors.border} transparent`,
        }}
      >
        {turns.map((turn, i) => (
          <div key={i} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
              <div
                style={{
                  maxWidth: "80%",
                  padding: "7px 11px",
                  background: colors.accent,
                  borderRadius: `${radii.md} ${radii.md} ${radii.xs} ${radii.md}`,
                  ...typography.caption,
                  color: "#fff",
                  wordBreak: "break-word",
                }}
              >
                {turn.userPrompt}
              </div>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-start" }}>
              <div
                style={{
                  maxWidth: "80%",
                  padding: "7px 11px",
                  background: colors.backgroundSecondary,
                  border: `1px solid ${colors.border}`,
                  borderRadius: `${radii.md} ${radii.md} ${radii.md} ${radii.xs}`,
                  ...typography.caption,
                  color: colors.textSecondary,
                  wordBreak: "break-word",
                }}
              >
                {turn.assistantResponse}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusCard({
  label,
  color,
  pulsing,
}: {
  label: string;
  color: string;
  pulsing: boolean;
}) {
  return (
    <div
      style={{
        padding: "14px 16px",
        background: colors.backgroundSecondary,
        borderRadius: radii.md,
        border: `1px solid ${pulsing ? colors.accentGlow : colors.border}`,
        display: "flex",
        alignItems: "center",
        gap: "10px",
        transition: "border-color 0.2s",
      }}
    >
      <div
        style={{
          width: "8px",
          height: "8px",
          borderRadius: radii.full,
          background: color,
          flexShrink: 0,
          boxShadow: pulsing ? `0 0 8px ${color}` : "none",
          transition: "box-shadow 0.2s",
        }}
      />
      <span style={{ ...typography.body, color: colors.textSecondary }}>{label}</span>
    </div>
  );
}

function KeyStatusIndicator({ status }: { status: KeyStatus }) {
  if (status === "unchecked") return null;
  if (status === "checking") {
    return (
      <span style={{ fontSize: "11px", color: colors.textTertiary, flexShrink: 0 }}>
        ...
      </span>
    );
  }
  if (status === "valid") {
    return (
      <span style={{ fontSize: "13px", color: "#32D74B", flexShrink: 0, lineHeight: 1 }}>
        ✓
      </span>
    );
  }
  // invalid
  return (
    <span style={{ fontSize: "13px", color: "#FF453A", flexShrink: 0, lineHeight: 1 }}>
      ✗
    </span>
  );
}

function SettingsSection({
  anthropicKey, openaiKey, grokKey, elevenLabsKey, assemblyAiKey, onSetKey, autostart, onToggleAutostart, keyStatuses,
  hotkeyBinding, onHotkeyBindingChange,
}: {
  anthropicKey: string; openaiKey: string; grokKey: string;
  elevenLabsKey: string; assemblyAiKey: string;
  onSetKey: (provider: Provider, key: string) => void;
  autostart: boolean; onToggleAutostart: () => void;
  keyStatuses: Record<string, KeyStatus>;
  hotkeyBinding: string;
  onHotkeyBindingChange: (binding: string) => void;
}) {
  const [hotkeyDraft, setHotkeyDraft] = useState(hotkeyBinding);
  const [hotkeyError, setHotkeyError] = useState<string | null>(null);
  const [stealthMode, setStealthMode] = useState(false);

  // Keep draft in sync if the binding changes externally
  useEffect(() => {
    setHotkeyDraft(hotkeyBinding);
  }, [hotkeyBinding]);

  async function handleHotkeyBlur() {
    const newBinding = hotkeyDraft.trim();
    if (!newBinding || newBinding === hotkeyBinding) return;
    setHotkeyError(null);
    try {
      await invoke("set_hotkey", { shortcut: newBinding });
      onHotkeyBindingChange(newBinding);
    } catch {
      setHotkeyError("That hotkey combination is already in use");
      setHotkeyDraft(hotkeyBinding);
    }
  }

  const keys: Array<{ label: string; provider: Provider; value: string; placeholder: string }> = [
    { label: "Anthropic", provider: "anthropic", value: anthropicKey, placeholder: "sk-ant-..." },
    { label: "OpenAI", provider: "openai", value: openaiKey, placeholder: "sk-..." },
    { label: "Grok (xAI)", provider: "grok", value: grokKey, placeholder: "xai-..." },
    { label: "ElevenLabs", provider: "elevenLabs", value: elevenLabsKey, placeholder: "xi-..." },
    { label: "AssemblyAI", provider: "assemblyAi", value: assemblyAiKey, placeholder: "your-key" },
  ];

  return (
    <div
      style={{
        padding: "12px",
        background: colors.backgroundSecondary,
        borderRadius: radii.md,
        border: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <div style={{ ...typography.small, color: colors.textTertiary, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        API Keys
      </div>
      {keys.map(({ label, provider, value, placeholder }) => {
        const status: KeyStatus = keyStatuses[provider] ?? "unchecked";
        const borderColor =
          status === "valid"
            ? "rgba(50,215,75,0.5)"
            : status === "invalid"
            ? "rgba(255,69,58,0.5)"
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
              <div style={{ ...typography.small, color: "#FF453A", marginTop: "2px" }}>
                Invalid key
              </div>
            )}
          </div>
        );
      })}

      {/* Hotkey rebinding */}
      <div
        style={{
          paddingTop: "6px",
          borderTop: `1px solid ${colors.border}`,
        }}
      >
        <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "3px" }}>Hotkey</div>
        <input
          type="text"
          value={hotkeyDraft}
          onChange={(e) => {
            setHotkeyDraft(e.target.value);
            setHotkeyError(null);
          }}
          onBlur={handleHotkeyBlur}
          style={{
            padding: "6px 8px",
            background: colors.surface,
            border: `1px solid ${hotkeyError ? "rgba(255,69,58,0.5)" : colors.border}`,
            borderRadius: radii.sm,
            color: colors.text,
            fontSize: "12px",
            outline: "none",
            width: "100%",
            boxSizing: "border-box" as const,
            transition: "border-color 0.2s",
          }}
        />
        {hotkeyError ? (
          <div style={{ ...typography.small, color: "#FF453A", marginTop: "2px" }}>
            {hotkeyError}
          </div>
        ) : (
          <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "2px" }}>
            Format: "Ctrl+Alt+Space", "Shift+Ctrl+K", "Alt+F1"
          </div>
        )}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: "6px",
          borderTop: `1px solid ${colors.border}`,
        }}
      >
        <span style={{ ...typography.caption, color: colors.textSecondary }}>
          Launch at login
        </span>
        <button
          onClick={onToggleAutostart}
          style={{
            width: "36px",
            height: "20px",
            borderRadius: radii.full,
            border: "none",
            background: autostart ? colors.accent : colors.surface,
            cursor: "pointer",
            position: "relative",
            transition: "background 0.2s",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "2px",
              left: autostart ? "18px" : "2px",
              width: "16px",
              height: "16px",
              borderRadius: radii.full,
              background: "#fff",
              transition: "left 0.2s",
            }}
          />
        </button>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingTop: "6px",
          borderTop: `1px solid ${colors.border}`,
        }}
      >
        <div>
          <div style={{ ...typography.caption, color: colors.textSecondary }}>
            Hide from screen recordings
          </div>
          <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "1px" }}>
            Screen capture tools won't see DanteClicky's window
          </div>
        </div>
        <button
          onClick={async () => {
            const next = !stealthMode;
            try {
              await invoke("set_overlay_stealth", { enabled: next });
              setStealthMode(next);
            } catch (e) {
              console.warn("[stealth]", e);
            }
          }}
          style={{
            width: "36px",
            height: "20px",
            borderRadius: radii.full,
            border: "none",
            background: stealthMode ? colors.accent : colors.surface,
            cursor: "pointer",
            position: "relative",
            transition: "background 0.2s",
            flexShrink: 0,
          }}
        >
          <div
            style={{
              position: "absolute",
              top: "2px",
              left: stealthMode ? "18px" : "2px",
              width: "16px",
              height: "16px",
              borderRadius: radii.full,
              background: "#fff",
              transition: "left 0.2s",
            }}
          />
        </button>
      </div>
    </div>
  );
}

function ModelPicker({
  selected,
  onChange,
}: {
  selected: ModelOption;
  onChange: (m: ModelOption) => void;
}) {
  return (
    <div>
      <SectionLabel>Model</SectionLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
        {MODEL_OPTIONS.map((m) => (
          <button
            key={`${m.provider}-${m.modelId}`}
            onClick={() => onChange(m)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "7px 10px",
              borderRadius: radii.sm,
              border: `1px solid ${selected.modelId === m.modelId ? colors.accent : "transparent"}`,
              background: selected.modelId === m.modelId ? "rgba(10,132,255,0.12)" : "transparent",
              cursor: "pointer",
              textAlign: "left",
              transition: "all 0.12s",
            }}
          >
            <span
              style={{
                width: "7px",
                height: "7px",
                borderRadius: radii.full,
                background: providerColors[m.provider] ?? colors.accent,
                flexShrink: 0,
              }}
            />
            <span style={{ ...typography.body, color: selected.modelId === m.modelId ? colors.text : colors.textSecondary }}>
              {m.displayName}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SttModeSection() {
  const [sttStatus, setSttStatus] = useState<{ mode: string; available: boolean } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    invoke<{ mode: string; available: boolean }>("get_local_model_status")
      .then(setSttStatus)
      .catch(() => {});
  }, []);

  async function handleDownload() {
    setDownloading(true);
    setDownloadError(null);
    try {
      await invoke("download_whisper_model");
      setSttStatus(prev => prev ? { ...prev, available: true } : { mode: "Cloud", available: true });
    } catch (e) {
      setDownloadError(String(e).slice(0, 80));
    } finally {
      setDownloading(false);
    }
  }

  if (!sttStatus) return null;

  return (
    <div>
      <SectionLabel>Speech Recognition</SectionLabel>
      <div style={{ display: "flex", gap: "6px" }}>
        {(["Cloud", "Local"] as const).map((m) => {
          const active = sttStatus.mode === m;
          const disabled = m === "Local" && !sttStatus.available;
          return (
            <button
              key={m}
              disabled={disabled}
              onClick={async () => {
                try {
                  await invoke("set_stt_mode", { mode: m });
                  setSttStatus(prev => prev ? { ...prev, mode: m } : prev);
                } catch (e) {
                  console.warn("[STT]", e);
                }
              }}
              style={{
                flex: 1,
                padding: "6px",
                borderRadius: radii.sm,
                border: `1px solid ${active ? colors.accent : colors.border}`,
                background: active ? "rgba(10,132,255,0.12)" : "transparent",
                color: disabled ? colors.textTertiary : active ? colors.text : colors.textSecondary,
                cursor: disabled ? "not-allowed" : "pointer",
                fontSize: "12px",
                opacity: disabled ? 0.5 : 1,
              }}
            >
              {m === "Cloud" ? "☁ Cloud" : "⬡ Local"}
            </button>
          );
        })}
      </div>
      {sttStatus.mode === "Local" && (
        <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "4px" }}>
          Local Whisper — private, offline
        </div>
      )}
      {sttStatus.mode === "Cloud" && (
        <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "4px" }}>
          AssemblyAI — real-time, requires internet
        </div>
      )}
      {!sttStatus.available && (
        <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "4px" }}>
          <button
            onClick={handleDownload}
            disabled={downloading}
            style={{
              padding: "7px 12px",
              background: downloading ? colors.surface : colors.accent,
              border: "none",
              borderRadius: radii.sm,
              color: "#fff",
              cursor: downloading ? "not-allowed" : "pointer",
              ...typography.caption,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              opacity: downloading ? 0.7 : 1,
              transition: "opacity 0.2s",
            }}
          >
            {downloading ? (
              <>
                <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>↻</span>
                Downloading…
              </>
            ) : (
              "Download model (148MB)"
            )}
          </button>
          {downloadError && (
            <div style={{ ...typography.small, color: colors.error }}>
              {downloadError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HotkeyHint() {
  const { hotkeyBinding } = useCompanionStore();
  const keys = hotkeyBinding.split("+").filter(Boolean);
  return (
    <div
      style={{
        padding: "10px 12px",
        background: colors.backgroundSecondary,
        borderRadius: radii.md,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
      }}
    >
      <span style={{ ...typography.caption, color: colors.textSecondary }}>Push-to-talk</span>
      <div style={{ display: "flex", gap: "3px" }}>
        {keys.map((k) => (
          <span
            key={k}
            style={{
              padding: "2px 6px",
              background: colors.surface,
              borderRadius: radii.xs,
              ...typography.small,
              color: colors.textSecondary,
              border: `1px solid ${colors.border}`,
            }}
          >
            {k}
          </span>
        ))}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
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

function IconButton({
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
      } as React.CSSProperties}
    >
      {children}
    </button>
  );
}

function AudioLevelMeter() {
  const [levels, setLevels] = useState<number[]>([0.2, 0.2, 0.2, 0.2, 0.2]);
  const historyRef = useRef<number[]>([0, 0, 0, 0, 0]);

  useEffect(() => {
    const unlisten = listen<number>("audio-level", (e) => {
      const level = e.payload;
      historyRef.current = [...historyRef.current.slice(1), level];
      setLevels([...historyRef.current]);
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  return (
    <div
      style={{
        display: "flex",
        gap: "3px",
        alignItems: "flex-end",
        height: "24px",
        padding: "0 4px",
      }}
    >
      {levels.map((l, i) => (
        <div
          key={i}
          style={{
            width: "4px",
            height: `${Math.max(4, l * 24)}px`,
            background: colors.success,
            borderRadius: "2px",
            transition: "height 0.08s ease-out",
            opacity: 0.85,
          }}
        />
      ))}
    </div>
  );
}
