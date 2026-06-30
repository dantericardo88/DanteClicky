import { colors, radii, typography } from "../../../lib/designSystem";
import { useCompanionStore } from "../../../state/companionStore";
export function WelcomeHero() {
  const { hotkeyBinding } = useCompanionStore();
  const keys = (hotkeyBinding ?? "Ctrl+Shift+Space").split("+").filter(Boolean);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "20px",
        padding: "24px 8px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          width: 52,
          height: 52,
          borderRadius: "50%",
          background: `${colors.accent}18`,
          border: `2px solid ${colors.accent}50`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: colors.accent,
          }}
        />
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        <div style={{ ...typography.title, color: colors.text, fontSize: 17 }}>
          Hold to speak
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {keys.map((k) => (
            <span
              key={k}
              style={{
                padding: "4px 10px",
                background: colors.surface,
                borderRadius: radii.xs,
                fontSize: 13,
                fontWeight: 600,
                color: colors.text,
                border: `1px solid ${colors.border}`,
                fontFamily: "inherit",
              }}
            >
              {k}
            </span>
          ))}
        </div>
        <div style={{ ...typography.small, color: colors.textTertiary }}>
          Release to send · change hotkey in Settings
        </div>
      </div>
      <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 6 }}>
        {[
          ["Ask anything", "I see your screen and hear your voice"],
          ["Automate tasks", "I can click, type, and navigate for you"],
          ["Remembers you", "Preferences and history saved across sessions"],
        ].map(([title, detail]) => (
          <div
            key={title}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "9px 12px",
              background: colors.backgroundSecondary,
              borderRadius: radii.sm,
              border: `1px solid ${colors.border}`,
              textAlign: "left",
            }}
          >
            <div
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: colors.accent,
                flexShrink: 0,
                marginTop: 5,
              }}
            />
            <div>
              <div style={{ ...typography.caption, color: colors.text, fontWeight: 600 }}>{title}</div>
              <div style={{ ...typography.small, color: colors.textSecondary, marginTop: 2 }}>{detail}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function NoKeyReminder({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div
      style={{
        padding: "16px",
        background: colors.backgroundSecondary,
        borderRadius: radii.md,
        border: `1px solid ${colors.border}`,
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <div>
        <div style={{ ...typography.caption, color: colors.text, fontWeight: 600, marginBottom: 4 }}>
          Connect an AI model to get started
        </div>
        <div style={{ ...typography.small, color: colors.textSecondary }}>
          Choose a cloud provider (GPT, Claude, Grok) or use Ollama for free private AI with no API key.
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <button
          onClick={onOpenSettings}
          style={{
            padding: "7px 12px",
            background: colors.accent,
            border: "none",
            borderRadius: radii.sm,
            color: "#fff",
            cursor: "pointer",
            ...typography.caption,
            fontWeight: 600,
          }}
        >
          Open Model Settings
        </button>
        <button
          onClick={() =>
            import("@tauri-apps/plugin-opener")
              .then(({ openUrl }) => openUrl("https://ollama.com/download"))
              .catch(() => {})
          }
          style={{
            padding: "7px 12px",
            background: "transparent",
            border: `1px solid ${colors.success}66`,
            borderRadius: radii.sm,
            color: colors.success,
            cursor: "pointer",
            ...typography.caption,
          }}
        >
          Get Ollama (free) →
        </button>
      </div>
    </div>
  );
}

export function StatusCard({
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
        role="status"
        aria-label={`DanteClicky status: ${label}`}
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

export function HotkeyHint() {
  const { hotkeyBinding } = useCompanionStore();
  const keys = (hotkeyBinding ?? "Ctrl+Shift+Space").split("+").filter(Boolean);
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