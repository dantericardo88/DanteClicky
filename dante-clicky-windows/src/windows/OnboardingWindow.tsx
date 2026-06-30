import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { MODEL_OPTIONS, useCompanionStore, type ApiKeyProvider, type ModelOption } from "../state/companionStore";
import { validateKey, type KeyStatus, type Provider } from "../lib/apiValidation";
import { colors, radii, typography } from "../lib/designSystem";
import { PROVIDERS } from "../lib/providerRegistry";
import {
  recommendModels,
  summarizeHardware,
  type HardwareProfile,
  type KeyPresence,
} from "../lib/modelAdvisor";

const STEPS = ["Welcome", "System", "Models", "Safety", "Try"];

const KEY_PROVIDERS: Array<{
  provider: Exclude<Provider, "ollama" | "elevenLabs" | "assemblyAi">;
  label: string;
  placeholder: string;
  docsUrl: string;
  storeKey: string;
  model: ModelOption;
}> = [
  {
    provider: "openai",
    label: "OpenAI",
    placeholder: "sk-...",
    docsUrl: PROVIDERS.openai.docsUrl,
    storeKey: "openai",
    model: MODEL_OPTIONS.find((m) => m.provider === "openai") ?? MODEL_OPTIONS[0],
  },
  {
    provider: "anthropic",
    label: "Anthropic",
    placeholder: "sk-ant-...",
    docsUrl: PROVIDERS.claude.docsUrl,
    storeKey: "anthropic",
    model: MODEL_OPTIONS.find((m) => m.provider === "claude") ?? MODEL_OPTIONS[0],
  },
  {
    provider: "grok",
    label: "xAI",
    placeholder: "xai-...",
    docsUrl: PROVIDERS.grok.docsUrl,
    storeKey: "xai",
    model: MODEL_OPTIONS.find((m) => m.provider === "grok") ?? MODEL_OPTIONS[0],
  },
  {
    provider: "openrouter",
    label: "OpenRouter",
    placeholder: "sk-or-...",
    docsUrl: PROVIDERS.openrouter.docsUrl,
    storeKey: "openrouter",
    model: MODEL_OPTIONS.find((m) => m.provider === "openrouter") ?? MODEL_OPTIONS[0],
  },
];

function providerToStoreProvider(provider: Provider): ApiKeyProvider | null {
  if (provider === "anthropic") return "anthropic";
  if (provider === "openai") return "openai";
  if (provider === "grok") return "grok";
  if (provider === "openrouter") return "openrouter";
  if (provider === "elevenLabs") return "elevenLabs";
  if (provider === "assemblyAi") return "assemblyAi";
  return null;
}

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
        padding: "10px 18px",
        background: disabled ? colors.surface : colors.accent,
        color: disabled ? colors.textTertiary : colors.text,
        border: "none",
        borderRadius: radii.sm,
        cursor: disabled ? "default" : "pointer",
        fontWeight: 700,
        fontSize: 13,
      }}
    >
      {children}
    </button>
  );
}

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        width: 860,
        height: 600,
        background: colors.background,
        color: colors.text,
        fontFamily: "-apple-system, Segoe UI, system-ui, sans-serif",
        borderRadius: 16,
        boxShadow: "0 30px 80px rgba(0,0,0,0.72)",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
        overflow: "hidden",
      }}
      data-tauri-drag-region
    >
      {children}
    </div>
  );
}

function StepDots({ step }: { step: number }) {
  return (
    <div style={{ display: "flex", gap: 8 }}>
      {STEPS.map((label, index) => (
        <div
          key={label}
          title={label}
          style={{
            width: index === step ? 26 : 8,
            height: 8,
            borderRadius: 999,
            background: index === step ? colors.accent : colors.surface,
            transition: "width 160ms ease",
          }}
        />
      ))}
    </div>
  );
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      style={{
        ...typography.small,
        color: ok ? colors.success : colors.warning,
        border: `1px solid ${ok ? colors.success : colors.warning}55`,
        borderRadius: radii.full,
        padding: "3px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

export default function OnboardingWindow() {
  const {
    hotkeyBinding,
    setApiKey,
    setApiKeyPresence,
    setSelectedModel,
    setAutomationSafetyMode,
    setOnboardingCompleted,
  } = useCompanionStore();

  const [step, setStep] = useState(0);
  const [hardwareProfile, setHardwareProfile] = useState<HardwareProfile | null>(null);
  const [selectedProvider, setSelectedProvider] = useState(KEY_PROVIDERS[0]);
  const [keyValue, setKeyValue] = useState("");
  const [keyStatus, setKeyStatus] = useState<KeyStatus>("unchecked");
  const [savingKey, setSavingKey] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<KeyStatus>("unchecked");
  const [micState, setMicState] = useState<PermissionState | "unknown">("unknown");
  const [smokeResult, setSmokeResult] = useState<"idle" | "running" | "passed" | "failed">("idle");
  const [smokeDetail, setSmokeDetail] = useState("");

  useEffect(() => {
    invoke<HardwareProfile>("get_hardware_profile")
      .then((profile) => {
        setHardwareProfile(profile);
        setOllamaStatus(profile.ollamaRunning ? "valid" : "unchecked");
      })
      .catch(() => setHardwareProfile(null));
    navigator.permissions
      ?.query({ name: "microphone" as PermissionName })
      .then((permission) => setMicState(permission.state))
      .catch(() => setMicState("unknown"));
  }, []);

  const keyPresence: KeyPresence = useMemo(
    () => ({
      anthropic: selectedProvider.provider === "anthropic" && keyStatus === "valid",
      openai: selectedProvider.provider === "openai" && keyStatus === "valid",
      grok: selectedProvider.provider === "grok" && keyStatus === "valid",
      openrouter: selectedProvider.provider === "openrouter" && keyStatus === "valid",
    }),
    [keyStatus, selectedProvider.provider],
  );

  const recommendations = recommendModels(hardwareProfile, keyPresence, "chat").slice(0, 4);

  async function requestMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      setMicState("granted");
    } catch {
      setMicState("denied");
    }
  }

  async function validateSelectedKey(nextValue = keyValue) {
    setKeyStatus("checking");
    const status = await validateKey(selectedProvider.provider, nextValue);
    setKeyStatus(status);
    return status;
  }

  async function saveSelectedKey() {
    if (!keyValue.trim()) return;
    setSavingKey(true);
    const provider = providerToStoreProvider(selectedProvider.provider);
    try {
      await invoke("set_api_key", {
        provider: selectedProvider.storeKey,
        key: keyValue.trim(),
      });
      if (provider) {
        setApiKey(provider, keyValue.trim());
        setApiKeyPresence(provider, true);
      }
      setSelectedModel(selectedProvider.model);
      setStep(3);
    } finally {
      setSavingKey(false);
    }
  }

  async function finish() {
    setAutomationSafetyMode("power-user");
    setOnboardingCompleted(true);
    await invoke("complete_onboarding").catch(() => invoke("show_companion_panel").catch(() => {}));
  }

  async function runSmoke() {
    setSmokeResult("running");
    setSmokeDetail("");
    const checks: string[] = [];
    try {
      const statuses = await invoke<Array<{ provider: string; configured: boolean }>>("get_api_key_statuses");
      const anyKey = statuses.some((s) => s.configured);
      if (anyKey) {
        checks.push("API key configured");
      } else if (hardwareProfile?.ollamaRunning) {
        checks.push("Ollama local model ready");
      } else {
        setSmokeResult("failed");
        setSmokeDetail("No API key or Ollama running — add a key or start Ollama");
        return;
      }
      if (hardwareProfile) checks.push("Hardware profile loaded");
      if (micState === "granted") checks.push("Microphone ready");
      setSmokeResult("passed");
      setSmokeDetail(checks.join(" · "));
    } catch {
      setSmokeResult("failed");
      setSmokeDetail("Could not reach backend — check install and restart");
    }
  }

  const content = [
    <div key="welcome" style={{ display: "grid", gap: 22, alignContent: "center" }}>
      <div>
        <div style={{ ...typography.title, fontSize: 28 }}>Welcome to DanteClicky</div>
        <div style={{ ...typography.body, color: colors.textSecondary, marginTop: 10, lineHeight: 1.6 }}>
          Hold a hotkey — your screen assistant sees what you see and answers by voice. Works with cloud AI or a fully local private model.
          Setup takes two minutes.
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {[
          { label: "Voice-first", sub: "Speak naturally, hear answers" },
          { label: "Sees your screen", sub: "Context-aware help" },
          { label: "Private option", sub: "Fully local via Ollama" },
        ].map(({ label, sub }) => (
          <div key={label} style={{ padding: 14, border: `1px solid ${colors.border}`, borderRadius: radii.sm, background: colors.backgroundSecondary }}>
            <div style={{ ...typography.caption, color: colors.text, fontWeight: 700 }}>{label}</div>
            <div style={{ ...typography.small, color: colors.textTertiary, marginTop: 4 }}>{sub}</div>
          </div>
        ))}
      </div>
      <div style={{ ...typography.small, color: colors.textTertiary }}>
        Privacy: wake word is off by default. No data leaves your machine with local Ollama models.
      </div>
    </div>,
    <div key="system" style={{ display: "grid", gap: 12 }}>
      <div>
        <div style={{ ...typography.title }}>System check</div>
        <div style={{ ...typography.small, color: colors.textTertiary, marginTop: 3 }}>
          DanteClicky reads your hardware to suggest the best AI models for this machine.
        </div>
      </div>
      <HealthRow label="PC profile" value={summarizeHardware(hardwareProfile)} ok={Boolean(hardwareProfile)} />
      <HealthRow
        label="Ollama (local AI)"
        value={hardwareProfile?.ollamaRunning
          ? hardwareProfile.ollamaVersion ?? "running"
          : hardwareProfile?.ollamaInstalled
            ? "installed, not running"
            : "not installed — optional for free private AI"}
        ok={hardwareProfile?.ollamaRunning ?? false}
        action={!hardwareProfile?.ollamaRunning ? () => openUrl("https://ollama.com/download") : undefined}
      />
      <HealthRow
        label="Microphone"
        value={micState === "granted" ? "ready" : micState === "denied" ? "blocked — check browser permissions" : "not yet granted"}
        ok={micState === "granted"}
        action={micState !== "granted" ? requestMic : undefined}
      />
      <HealthRow label="Global hotkey" value={hotkeyBinding} ok />
      {hardwareProfile && (
        <div style={{ padding: 10, border: `1px solid ${colors.border}`, borderRadius: radii.sm, background: colors.backgroundSecondary }}>
          <div style={{ ...typography.small, color: colors.textTertiary }}>
            {hardwareProfile.hasNvidia
              ? `NVIDIA GPU detected — local vision models (Qwen2.5-VL) available via Ollama`
              : hardwareProfile.hasAmd
                ? `AMD GPU detected — local AI models supported via Ollama`
                : `CPU only — cloud AI recommended; lightweight local models available`}
          </div>
        </div>
      )}
    </div>,
    <div key="models" style={{ display: "grid", gap: 12 }}>
      <div>
        <div style={{ ...typography.title }}>Model setup</div>
        <div style={{ ...typography.small, color: colors.textTertiary, marginTop: 3 }}>
          Pick a cloud provider (needs API key) or use Ollama for free private AI on this PC. Keys are saved in Windows protected storage.
        </div>
      </div>
      {hardwareProfile?.ollamaRunning && (
        <div style={{ padding: 10, border: `1px solid ${colors.success}55`, borderRadius: radii.sm, background: "rgba(50,215,75,0.06)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ ...typography.caption, color: colors.success }}>Ollama is running</div>
            <div style={{ ...typography.small, color: colors.textTertiary, marginTop: 2 }}>Free and private — no API key needed</div>
          </div>
          <PrimaryButton onClick={() => {
            const local = MODEL_OPTIONS.find((m) => m.provider === "ollama") ?? MODEL_OPTIONS[0];
            setSelectedModel(local);
            setStep(3);
          }}>
            Use Ollama
          </PrimaryButton>
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "170px 1fr", gap: 12 }}>
        <div style={{ display: "grid", gap: 6 }}>
          {KEY_PROVIDERS.map((provider) => (
            <button
              key={provider.provider}
              onClick={() => {
                setSelectedProvider(provider);
                setKeyValue("");
                setKeyStatus("unchecked");
              }}
              style={{
                padding: "8px 10px",
                borderRadius: radii.sm,
                border: `1px solid ${selectedProvider.provider === provider.provider ? colors.accent : colors.border}`,
                background: selectedProvider.provider === provider.provider ? "rgba(10,132,255,0.12)" : colors.backgroundSecondary,
                color: colors.text,
                textAlign: "left",
              }}
            >
              {provider.label}
            </button>
          ))}
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <input
            type="password"
            value={keyValue}
            placeholder={selectedProvider.placeholder}
            onChange={(event) => {
              setKeyValue(event.target.value);
              setKeyStatus("unchecked");
            }}
            style={{
              padding: "9px 10px",
              border: `1px solid ${keyStatus === "valid" ? colors.success : keyStatus === "invalid" ? colors.error : colors.border}`,
              borderRadius: radii.sm,
              background: colors.surface,
              color: colors.text,
            }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <PrimaryButton onClick={() => validateSelectedKey()} disabled={!keyValue.trim() || keyStatus === "checking"}>
              {keyStatus === "checking" ? "Checking" : "Validate"}
            </PrimaryButton>
            <PrimaryButton onClick={saveSelectedKey} disabled={!keyValue.trim() || savingKey}>
              {savingKey ? "Saving" : "Use this model"}
            </PrimaryButton>
            <button style={{ ...typography.caption, color: colors.textSecondary }} onClick={() => openUrl(selectedProvider.docsUrl)}>
              Provider docs
            </button>
          </div>
          <StatusPill ok={keyStatus === "valid"} label={keyStatus === "valid" ? "Key valid" : keyStatus === "invalid" ? "Could not verify — save anyway to try" : "Enter key then click Validate or Save"} />
        </div>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {recommendations.map((rec) => (
          <div key={`${rec.model.provider}-${rec.model.modelId}`} style={{ padding: 8, border: `1px solid ${colors.border}`, borderRadius: radii.sm, background: colors.backgroundSecondary }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
              <span style={{ ...typography.caption, color: colors.text }}>{rec.model.displayName}</span>
              <span style={{ ...typography.small, color: rec.readiness === "ready" ? colors.success : colors.warning }}>{rec.readiness}</span>
            </div>
            <div style={{ ...typography.small, color: colors.textTertiary }}>{rec.reason}</div>
          </div>
        ))}
      </div>
    </div>,
    <div key="safety" style={{ display: "grid", gap: 12 }}>
      <div style={{ ...typography.title }}>Automation safety</div>
      <div style={{ ...typography.body, color: colors.textSecondary }}>
        Power User mode keeps the assistant fast for daily work. It still confirms purchases, external messages, destructive file actions, and system settings.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
        {["Clicks and typing", "Files and settings", "Private diagnostics"].map((label) => (
          <div key={label} style={{ padding: 12, border: `1px solid ${colors.border}`, borderRadius: radii.sm, background: colors.backgroundSecondary }}>
            <div style={{ ...typography.caption }}>{label}</div>
            <div style={{ ...typography.small, color: colors.textTertiary, marginTop: 4 }}>Guarded</div>
          </div>
        ))}
      </div>
    </div>,
    <div key="try" style={{ display: "grid", gap: 14 }}>
      <div>
        <div style={{ ...typography.title }}>Ready to go</div>
        <div style={{ ...typography.body, color: colors.textSecondary, marginTop: 6 }}>
          Hold <strong style={{ color: colors.text }}>{hotkeyBinding}</strong> and speak. DanteClicky hears you, sees your screen, and answers.
        </div>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: 2 }}>Try saying one of these:</div>
        {[
          `"What is on my screen right now?"`,
          `"Help me write a reply to this email"`,
          `"Explain what this error means"`,
          `"What should I do next?"`,
        ].map((phrase) => (
          <div key={phrase} style={{ padding: "7px 10px", border: `1px solid ${colors.border}`, borderRadius: radii.sm, background: colors.backgroundSecondary, ...typography.small, color: colors.text }}>
            {phrase}
          </div>
        ))}
      </div>
      <HealthRow
        label="System ready"
        value={smokeResult === "passed" ? smokeDetail || "all checks passed" : smokeResult === "failed" ? smokeDetail : smokeResult === "running" ? "checking…" : "tap to verify"}
        ok={smokeResult === "passed"}
        action={smokeResult !== "passed" && smokeResult !== "running" ? runSmoke : undefined}
      />
      <HealthRow label="Active model" value={selectedProvider.model.displayName} ok />
      <HealthRow label="Local Ollama" value={ollamaStatus === "valid" ? "running — privacy mode available" : "optional — install from ollama.com"} ok={ollamaStatus === "valid"} />
    </div>,
  ];

  return (
    <Surface>
      <header style={{ padding: "22px 28px", borderBottom: `1px solid ${colors.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ ...typography.small, color: colors.textTertiary, textTransform: "uppercase", letterSpacing: "0.08em" }}>Daily Driver Preview</div>
          <div style={{ ...typography.title }}>Easy install setup</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <StepDots step={step} />
          <button
            onClick={finish}
            data-tauri-drag-region="false"
            style={{ pointerEvents: "all", background: "none", border: "none", cursor: "pointer", color: colors.textTertiary, fontSize: 20, lineHeight: 1, padding: "2px 4px", borderRadius: 4, display: "flex", alignItems: "center" }}
            title="Close"
          >
            ×
          </button>
        </div>
      </header>
      <main style={{ padding: "28px", overflow: "auto" }}>{content[step]}</main>
      <footer style={{ padding: "18px 28px", borderTop: `1px solid ${colors.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button style={{ ...typography.caption, color: colors.textSecondary }} onClick={() => (step === 0 ? finish() : setStep(step - 1))}>
          {step === 0 ? "Skip setup" : "Back"}
        </button>
        <div style={{ display: "flex", gap: 10 }}>
          {step === 2 && (
            <PrimaryButton
              onClick={() => {
                const local = MODEL_OPTIONS.find((model) => model.provider === "ollama") ?? MODEL_OPTIONS[0];
                setSelectedModel(local);
                setStep(3);
              }}
            >
              Use local later
            </PrimaryButton>
          )}
          <PrimaryButton onClick={() => (step === STEPS.length - 1 ? finish() : setStep(step + 1))}>
            {step === STEPS.length - 1 ? "Open DanteClicky" : "Continue"}
          </PrimaryButton>
        </div>
      </footer>
    </Surface>
  );
}

function HealthRow({
  label,
  value,
  ok,
  action,
}: {
  label: string;
  value: string;
  ok: boolean;
  action?: () => void;
}) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "160px minmax(0, 1fr) auto", gap: 10, alignItems: "center", padding: 10, border: `1px solid ${colors.border}`, borderRadius: radii.sm, background: colors.backgroundSecondary }}>
      <span style={{ ...typography.caption, color: colors.textSecondary }}>{label}</span>
      <span style={{ ...typography.caption, color: colors.text, overflow: "hidden", textOverflow: "ellipsis" }}>{value}</span>
      {action ? (
        <button onClick={action} style={{ ...typography.small, color: colors.accent }}>Fix</button>
      ) : (
        <StatusPill ok={ok} label={ok ? "Ready" : "Check"} />
      )}
    </div>
  );
}
