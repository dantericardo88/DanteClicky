import { colors, radii, typography } from "../../../lib/designSystem";
import { SPEECH_LANGUAGE_OPTIONS, getSpeechLanguageSupport, speechLanguageOptionForCode, type SpeechLanguageCode, type SpeechLanguageStatusTone } from "../../../lib/speechLanguages";
export function speechLanguageToneColor(tone: SpeechLanguageStatusTone): string {
  if (tone === "success") return colors.success;
  if (tone === "warning") return colors.warning;
  return colors.accent;
}

export function speechLanguageToneBackground(tone: SpeechLanguageStatusTone): string {
  if (tone === "success") return "rgba(50, 215, 75, 0.10)";
  if (tone === "warning") return "rgba(255, 159, 10, 0.12)";
  return "rgba(10, 132, 255, 0.10)";
}

export function SpeechLanguageSection({
  speechLanguage,
  onSpeechLanguageChange,
}: {
  speechLanguage: SpeechLanguageCode;
  onSpeechLanguageChange: (language: SpeechLanguageCode) => void;
}) {
  const selectedOption = speechLanguageOptionForCode(speechLanguage);
  const support = getSpeechLanguageSupport(selectedOption.code);
  const languageTone: SpeechLanguageStatusTone =
    support.cloudTier === "local-recommended" ? "warning" : "info";
  const languageToneColor = speechLanguageToneColor(languageTone);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <select
        value={selectedOption.code}
        onChange={(event) => onSpeechLanguageChange(event.target.value as SpeechLanguageCode)}
        aria-label="Speech language"
        style={{
          width: "100%",
          background: colors.surface,
          border: `1px solid ${colors.border}`,
          borderRadius: radii.sm,
          color: colors.text,
          cursor: "pointer",
          fontSize: "12px",
          fontFamily: "inherit",
          padding: "6px 8px",
          outline: "none",
        }}
      >
        {SPEECH_LANGUAGE_OPTIONS.map((option) => (
          <option key={option.code} value={option.code}>
            {option.label}{option.code === "auto" ? "" : ` - ${option.nativeLabel}`}
          </option>
        ))}
      </select>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: "6px",
          padding: "6px 8px",
          borderRadius: radii.xs,
          background: speechLanguageToneBackground(languageTone),
          border: `1px solid ${languageToneColor}33`,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: "6px",
            height: "6px",
            borderRadius: radii.full,
            background: languageToneColor,
            marginTop: "4px",
            flexShrink: 0,
          }}
        />
        <div style={{ ...typography.small, color: colors.textSecondary }}>
          {selectedOption.code === "auto"
            ? support.cloudLabel
            : support.cloudTier === "local-recommended"
              ? support.fallbackLabel
              : `${selectedOption.label} uses native cloud prompts and ${support.localLabel.toLowerCase()}`}
        </div>
      </div>
    </div>
  );
}