import { colors, radii, typography } from "../../../lib/designSystem";
import { PROVIDERS, nativeStoreKeyForProvider } from "../../../lib/providerRegistry";
import { recommendModels, toModelOption, type HardwareProfile, type KeyPresence } from "../../../lib/modelAdvisor";
import type { ModelOption } from "../../../state/companionStore";
import { SettingsCard, SettingsDivider } from "./SettingsShared";
export function ModelStudioCard({
  hardwareProfile,
  keyPresence,
  selectedModel,
  onSelectedModelChange,
}: {
  hardwareProfile: HardwareProfile | null;
  keyPresence: Record<string, boolean>;
  selectedModel: ModelOption;
  onSelectedModelChange: (model: ModelOption) => void;
}) {
  const keys: KeyPresence = {
    anthropic: keyPresence.anthropic,
    openai: keyPresence.openai,
    grok: keyPresence.grok,
    openrouter: keyPresence.openrouter,
  };
  const recommendations = recommendModels(hardwareProfile, keys, "chat").slice(0, 5);

  return (
    <SettingsCard index={1}>
      <div>
        <div style={{ ...typography.caption, color: colors.text, fontWeight: 700 }}>Model Studio</div>
        <div style={{ ...typography.small, color: colors.textTertiary, marginTop: 2 }}>
          Hybrid guidance based on this PC, configured keys, and Ollama status
        </div>
      </div>
      <SettingsDivider />
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {recommendations.map((rec) => {
          const model = toModelOption(rec.model);
          const selected = selectedModel.provider === model.provider && selectedModel.modelId === model.modelId;
          const provider = PROVIDERS[model.provider];
          const storeKey = nativeStoreKeyForProvider(model.provider);
          const readinessLabel =
            rec.readiness === "ready"
              ? "Ready"
              : rec.readiness === "needs-key"
                ? `Add ${provider?.label ?? model.provider} key`
                : rec.readiness === "needs-ollama"
                  ? "Start Ollama"
                  : "Install Ollama";
          return (
            <button
              key={`${model.provider}-${model.modelId}`}
              onClick={() => onSelectedModelChange(model)}
              style={{
                display: "grid",
                gridTemplateColumns: "minmax(0, 1fr) auto",
                gap: 8,
                alignItems: "center",
                padding: "8px 10px",
                background: selected ? "rgba(10,132,255,0.12)" : colors.surface,
                border: `1px solid ${selected ? colors.accent : colors.border}`,
                borderRadius: radii.sm,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ ...typography.caption, color: colors.text, fontWeight: 650 }}>
                  {model.displayName}
                </div>
                <div style={{ ...typography.small, color: colors.textTertiary, marginTop: 1 }}>
                  {provider?.label ?? model.provider} / {storeKey} / {rec.reason}
                </div>
              </div>
              <span style={{
                ...typography.small,
                color: rec.readiness === "ready" ? colors.success : colors.warning,
                whiteSpace: "nowrap",
              }}>
                {readinessLabel}
              </span>
            </button>
          );
        })}
      </div>
    </SettingsCard>
  );
}
