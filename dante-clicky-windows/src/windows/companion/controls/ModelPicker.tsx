import { colors, providerColors, radii, typography } from "../../../lib/designSystem";
import { MODEL_OPTIONS, type ModelOption } from "../../../state/companionStore";
import { SectionLabel } from "../settings/SettingsShared";
export function ModelPicker({
  selected,
  onChange,
}: {
  selected: ModelOption;
  onChange: (m: ModelOption) => void;
}) {
  return (
    <div>
      <SectionLabel>Model</SectionLabel>
      <div
        role="radiogroup"
        aria-label="AI model selection"
        style={{ display: "flex", flexDirection: "column", gap: "3px" }}
      >
        {MODEL_OPTIONS.map((m) => {
          const isSelected = selected.modelId === m.modelId;
          return (
            <button
              key={`${m.provider}-${m.modelId}`}
              role="radio"
              aria-checked={isSelected}
              onClick={() => onChange(m)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                padding: "7px 10px",
                borderRadius: radii.sm,
                border: `1px solid ${isSelected ? colors.accent : "transparent"}`,
                background: isSelected ? "rgba(10,132,255,0.12)" : "transparent",
                cursor: "pointer",
                textAlign: "left",
                transition: "all 0.12s",
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: "7px",
                  height: "7px",
                  borderRadius: radii.full,
                  background: providerColors[m.provider] ?? colors.accent,
                  flexShrink: 0,
                }}
              />
              <span style={{ ...typography.body, color: isSelected ? colors.text : colors.textSecondary }}>
                {m.displayName}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
