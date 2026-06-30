import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { colors, radii, typography } from "../../../lib/designSystem";
import { useCompanionStore } from "../../../state/companionStore";
import { buildSpeechLanguageStatus, speechLanguageOptionForCode, type SpeechLanguageCode } from "../../../lib/speechLanguages";
import { speechLanguageToneColor, speechLanguageToneBackground } from "./SpeechLanguageSection";
import { SectionLabel } from "./SettingsShared";
export function SttModeSection({ speechLanguage }: { speechLanguage: SpeechLanguageCode }) {
  const { sttMode, setSttMode } = useCompanionStore();
  const languageOption = speechLanguageOptionForCode(speechLanguage);
  const languageStatus = buildSpeechLanguageStatus(speechLanguage, sttMode);
  const languageStatusColor = speechLanguageToneColor(languageStatus.tone);
  const expectedLocalRepository = languageOption.localWhisperModel === "english"
    ? "openai/whisper-tiny.en"
    : "openai/whisper-tiny";
  const [sttStatus, setSttStatus] = useState<{
    mode: string;
    available: boolean;
    model_language?: string | null;
    model_repository?: string | null;
  } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number>(0); // 0–100
  const [downloadError, setDownloadError] = useState<string | null>(null);

  useEffect(() => {
    invoke<{ mode: string; available: boolean; model_language?: string | null; model_repository?: string | null }>("get_local_model_status")
      .then((status) => {
        setSttStatus(status);
        setSttMode(status.mode === "Local" ? "Local" : "Cloud");
      })
      .catch(() => {});
  }, [speechLanguage, setSttMode]);

  async function handleDownload() {
    setDownloading(true);
    setDownloadProgress(0);
    setDownloadError(null);

    // Listen for streaming progress events from Rust
    const unlisten = await listen<{ file: string; bytes_done: number; bytes_total: number }>(
      "whisper-download-progress",
      ({ payload }) => {
        if (payload.bytes_total > 0) {
          setDownloadProgress(Math.round((payload.bytes_done / payload.bytes_total) * 100));
        }
      }
    );

    try {
      await invoke("download_whisper_model", { languageCode: speechLanguage });
      await invoke("set_stt_mode", { mode: "Local" });
      setSttMode("Local");
      setSttStatus(prev => prev ? { ...prev, available: true, mode: "Local", model_language: languageOption.code, model_repository: expectedLocalRepository } : { mode: "Local", available: true, model_language: languageOption.code, model_repository: expectedLocalRepository });
    } catch (e) {
      setDownloadError(String(e).slice(0, 120));
    } finally {
      unlisten();
      setDownloading(false);
      setDownloadProgress(0);
    }
  }

  if (!sttStatus) return null;
  const selectedLocalModelAvailable =
    sttStatus.available && sttStatus.model_repository === expectedLocalRepository;

  return (
    <div>
      <SectionLabel>Speech Recognition</SectionLabel>
      <div style={{ display: "flex", gap: "6px" }}>
        {(["Cloud", "Local"] as const).map((m) => {
          const active = sttMode === m;
          const disabled = m === "Local" && !selectedLocalModelAvailable;
          return (
            <button
              key={m}
              disabled={disabled}
              onClick={async () => {
                try {
                  await invoke("set_stt_mode", { mode: m });
                  setSttMode(m);
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
      <div
        style={{
          marginTop: "8px",
          padding: "7px 9px",
          borderRadius: radii.xs,
          background: speechLanguageToneBackground(languageStatus.tone),
          border: `1px solid ${languageStatusColor}33`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
          <span style={{ ...typography.small, color: languageStatusColor }}>
            {languageStatus.title}
          </span>
          <span style={{ ...typography.small, color: colors.textTertiary }}>
            {languageStatus.confidenceLabel}
          </span>
        </div>
        <div style={{ ...typography.small, color: colors.textSecondary, marginTop: "3px" }}>
          {languageStatus.message}
        </div>
        {languageStatus.recommendedMode !== sttMode && (
          <div style={{ ...typography.small, color: colors.warning, marginTop: "3px" }}>
            Recommended: switch to {languageStatus.recommendedMode}
          </div>
        )}
      </div>
      {!selectedLocalModelAvailable && (
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
                {downloadProgress > 0 ? `Downloading… ${downloadProgress}%` : "Downloading…"}
              </>
            ) : (
              `Download ${languageOption.localWhisperModel === "english" ? "English" : "multilingual"} Whisper model (~150MB)`
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

// ── STT accuracy upgrades (Dim 2: STT Cloud Accuracy) ──────────────────────
// Surfaces two settings that drive Cloud-mode WER:
//   1) Personal Dictionary — proper nouns, code identifiers, domain vocab.
//      Sent to AssemblyAI as keyterms_prompt to bias recognition. Up to 1,000
//      terms; we cap at a safe URL-budget before sending.
//   2) AI Polish (LLM cleanup) — runs the raw transcript through Haiku 4.5
//      (or gpt-4o-mini fallback) for capitalization, punctuation, and
//      disfluency removal. Anti-hallucination contract enforces "fix only
//      what was spoken".
export function SttAccuracySection() {
  const {
    personalDictionary,
    setPersonalDictionary,
    sttCleanupMode,
    setSttCleanupMode,
  } = useCompanionStore();
  const [draft, setDraft] = useState("");

  const addTerm = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (personalDictionary.some((t) => t.toLowerCase() === trimmed.toLowerCase())) {
      setDraft("");
      return;
    }
    setPersonalDictionary([...personalDictionary, trimmed]);
    setDraft("");
  };

  const removeTerm = (term: string) => {
    setPersonalDictionary(personalDictionary.filter((t) => t !== term));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      {/* AI Polish mode picker */}
      <div>
        <SectionLabel>AI Polish</SectionLabel>
        <div style={{ display: "flex", gap: "6px" }}>
          {(["off", "dictation", "formal"] as const).map((mode) => {
            const active = sttCleanupMode === mode;
            const label = mode === "off" ? "Raw" : mode === "dictation" ? "Dictation" : "Formal";
            return (
              <button
                key={mode}
                onClick={() => setSttCleanupMode(mode)}
                style={{
                  flex: 1,
                  padding: "6px",
                  borderRadius: radii.sm,
                  border: `1px solid ${active ? colors.accent : colors.border}`,
                  background: active ? "rgba(10,132,255,0.12)" : "transparent",
                  color: active ? colors.text : colors.textSecondary,
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "4px" }}>
          {sttCleanupMode === "off"
            ? "No post-processing. Lowest latency, raw ASR output."
            : sttCleanupMode === "dictation"
            ? "Light polish — capitalization, punctuation, filler removal."
            : "Stronger polish — formal sentence structure (slower)."}
        </div>
      </div>

      {/* Personal Dictionary editor */}
      <div>
        <SectionLabel>Personal Dictionary ({personalDictionary.length})</SectionLabel>
        <div style={{ display: "flex", gap: "6px" }}>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addTerm();
              }
            }}
            placeholder="Add a proper noun, code identifier, or domain term"
            style={{
              flex: 1,
              padding: "6px 8px",
              borderRadius: radii.sm,
              border: `1px solid ${colors.border}`,
              background: colors.surface,
              color: colors.text,
              fontSize: "12px",
            }}
          />
          <button
            onClick={addTerm}
            disabled={!draft.trim()}
            style={{
              padding: "6px 12px",
              borderRadius: radii.sm,
              border: "none",
              background: draft.trim() ? colors.accent : colors.surface,
              color: draft.trim() ? "#fff" : colors.textTertiary,
              cursor: draft.trim() ? "pointer" : "not-allowed",
              fontSize: "12px",
            }}
          >
            Add
          </button>
        </div>
        {personalDictionary.length > 0 && (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "6px",
              marginTop: "8px",
              maxHeight: "120px",
              overflowY: "auto",
            }}
          >
            {personalDictionary.map((term) => (
              <span
                key={term}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "3px 6px 3px 8px",
                  borderRadius: radii.sm,
                  background: "rgba(10,132,255,0.08)",
                  border: `1px solid ${colors.border}`,
                  fontSize: "11px",
                  color: colors.text,
                }}
              >
                {term}
                <button
                  onClick={() => removeTerm(term)}
                  aria-label={`Remove ${term}`}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: colors.textTertiary,
                    cursor: "pointer",
                    padding: "0 2px",
                    fontSize: "12px",
                    lineHeight: 1,
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <div style={{ ...typography.small, color: colors.textTertiary, marginTop: "4px" }}>
          Sent to AssemblyAI as keyterms each PTT — biases recognition toward your vocabulary.
        </div>
      </div>
    </div>
  );
}