import type React from "react";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { colors, radii, typography } from "../../../lib/designSystem";
import { type SpeechLanguageCode } from "../../../lib/speechLanguages";
import { ELEVENLABS_VOICES, fetchVoiceLibrary, previewVoice, stopPreview, filterVoicesByLanguage, type ElevenLabsVoice } from "../../../hooks/useElevenLabs";
import { parseCloneError } from "../utils";
import { useCompanionStore } from "../../../state/companionStore";
import { SectionLabel } from "./SettingsShared";
export function TtsModeSection({
  ttsMode,
  setTtsMode,
  speechLanguage,
}: {
  ttsMode: "cloud" | "local";
  setTtsMode: (mode: "cloud" | "local") => void;
  speechLanguage?: SpeechLanguageCode;
}) {
  const {
    elevenLabsKey,
    elevenLabsVoiceId, setElevenLabsVoiceId,
    elevenLabsCustomVoiceId, setElevenLabsCustomVoiceId,
    ttsQuality, setTtsQuality,
  } = useCompanionStore();

  const [voiceLibrary, setVoiceLibrary] = useState<ElevenLabsVoice[]>([]);
  const [voiceSearch, setVoiceSearch] = useState("");
  const [voiceCategory, setVoiceCategory] = useState<"all" | "mine" | "builtin">("all");
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null);
  const [previewPlayingId, setPreviewPlayingId] = useState<string | null>(null);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState("");
  const [cloneFiles, setCloneFiles] = useState<{ name: string; base64: string }[]>([]);
  const [cloneLoading, setCloneLoading] = useState(false);
  const [cloneError, setCloneError] = useState("");
  const [cloneSuccess, setCloneSuccess] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!elevenLabsKey) {
      setVoiceLibrary(
        ELEVENLABS_VOICES.map((v) => ({
          voice_id: v.id, name: v.name,
          category: "premade" as const, labels: { style: v.style },
        }))
      );
      return;
    }
    setVoiceLoading(true);
    fetchVoiceLibrary()
      .then((voices) => {
        setVoiceLibrary(
          voices.length > 0
            ? voices
            : ELEVENLABS_VOICES.map((v) => ({
                voice_id: v.id, name: v.name,
                category: "premade" as const, labels: { style: v.style },
              }))
        );
      })
      .finally(() => setVoiceLoading(false));
  }, [elevenLabsKey]);

  // Language-aware voice filtering: prioritize voices that support the selected language
  const languageFilteredVoices = filterVoicesByLanguage(voiceLibrary, speechLanguage);

  const filteredVoices = languageFilteredVoices
    .filter((v) => {
      if (voiceCategory === "mine") return v.category === "cloned" || v.category === "professional" || v.category === "generated";
      if (voiceCategory === "builtin") return v.category === "premade";
      return true;
    })
    .filter((v) => !voiceSearch.trim() || v.name.toLowerCase().includes(voiceSearch.toLowerCase()));

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const MAX_FILE_BYTES = 10 * 1024 * 1024;
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;

    const oversized = files.filter((f) => f.size > MAX_FILE_BYTES);
    const valid = files.filter((f) => f.size <= MAX_FILE_BYTES);

    if (oversized.length > 0) {
      setCloneError(
        `${oversized.map((f) => f.name).join(", ")} ${oversized.length === 1 ? "is" : "are"} over 10 MB — ElevenLabs limit. Use a shorter clip.`
      );
    }

    if (valid.length === 0) { e.target.value = ""; return; }

    Promise.all(
      valid.map(
        (file) =>
          new Promise<{ name: string; base64: string }>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              const base64 = result.includes(",") ? result.split(",")[1] : result;
              resolve({ name: file.name, base64 });
            };
            reader.readAsDataURL(file);
          })
      )
    ).then((loaded) => setCloneFiles((prev) => [...prev, ...loaded]));
    e.target.value = "";
  }

  async function handleClone() {
    if (!cloneName.trim() || cloneFiles.length === 0) return;
    setCloneLoading(true);
    setCloneError("");
    setCloneSuccess(false);
    try {
      const voiceId = await invoke<string>("elevenlabs_add_voice", {
        name: cloneName.trim(),
        audioFiles: cloneFiles.map((f) => ({ base64: f.base64, fileName: f.name })),
        description: undefined,
      });
      const voices = await fetchVoiceLibrary();
      if (voices.length > 0) setVoiceLibrary(voices);
      setElevenLabsVoiceId(voiceId);
      setElevenLabsCustomVoiceId("");
      setCloneOpen(false);
      setCloneName("");
      setCloneFiles([]);
      setCloneSuccess(true);
      setTimeout(() => setCloneSuccess(false), 3000);
    } catch (e) {
      setCloneError(parseCloneError(e));
    } finally {
      setCloneLoading(false);
    }
  }

  const cloneFilesTotalMB = cloneFiles.length > 0
    ? (cloneFiles.reduce((acc, f) => acc + f.base64.length * 0.75, 0) / (1024 * 1024)).toFixed(1)
    : "0";

  const QUALITY_OPTIONS: { id: "fast" | "balanced" | "max"; label: string; hint: string }[] = [
    { id: "fast",     label: "Fast",     hint: "Flash · 128kbps · lowest latency" },
    { id: "balanced", label: "Balanced", hint: "Turbo · 192kbps · recommended" },
    { id: "max",      label: "Max",      hint: "Multilingual v2 · 192kbps · best quality" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
      <SectionLabel>Text-to-Speech</SectionLabel>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => setTtsMode("cloud")}
          style={{
            flex: 1, padding: "6px 12px", borderRadius: radii.sm,
            border: `1px solid ${ttsMode === "cloud" ? colors.accent : colors.border}`,
            background: ttsMode === "cloud" ? "rgba(10,132,255,0.12)" : "transparent",
            color: ttsMode === "cloud" ? colors.text : colors.textSecondary,
            fontSize: 12, cursor: "pointer",
          }}
        >
          Cloud (ElevenLabs)
        </button>
        <button
          onClick={() => setTtsMode("local")}
          style={{
            flex: 1, padding: "6px 12px", borderRadius: radii.sm,
            border: `1px solid ${ttsMode === "local" ? colors.accent : colors.border}`,
            background: ttsMode === "local" ? "rgba(10,132,255,0.12)" : "transparent",
            color: ttsMode === "local" ? colors.text : colors.textSecondary,
            fontSize: 12, cursor: "pointer",
          }}
        >
          Local (Kokoro)
        </button>
      </div>

      {ttsMode === "cloud" && (
        <>
          {/* Quality preset */}
          <div>
            <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "4px" }}>Quality</div>
            <div style={{ display: "flex", gap: 4 }}>
              {QUALITY_OPTIONS.map((q) => (
                <button
                  key={q.id}
                  onClick={() => setTtsQuality(q.id)}
                  title={q.hint}
                  style={{
                    flex: 1, padding: "4px 6px", borderRadius: radii.xs,
                    border: `1px solid ${ttsQuality === q.id ? colors.accent : colors.border}`,
                    background: ttsQuality === q.id ? "rgba(10,132,255,0.12)" : "transparent",
                    color: ttsQuality === q.id ? colors.text : colors.textSecondary,
                    fontSize: 11, cursor: "pointer",
                  }}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          {/* Dynamic voice browser */}
          <div>
            <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "4px" }}>
              Voice{voiceLoading && <span style={{ fontStyle: "italic" }}> · Loading…</span>}
            </div>

            {/* Category filter tabs */}
            <div style={{ display: "flex", gap: 3, marginBottom: "4px" }}>
              {(([["all", "All"], ["mine", "My Voices"], ["builtin", "Built-in"]] as const)).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setVoiceCategory(id)}
                  style={{
                    flex: 1, padding: "3px 4px", borderRadius: radii.xs, fontSize: 10, cursor: "pointer",
                    border: `1px solid ${voiceCategory === id ? colors.accent : colors.border}`,
                    background: voiceCategory === id ? "rgba(10,132,255,0.12)" : "transparent",
                    color: voiceCategory === id ? colors.text : colors.textSecondary,
                  }}
                >
                  {label}
                </button>
              ))}
            </div>

            <input
              type="text"
              placeholder="Search voices…"
              value={voiceSearch}
              onChange={(e) => setVoiceSearch(e.target.value)}
              style={{
                width: "100%", background: "rgba(255,255,255,0.05)",
                border: `1px solid ${colors.border}`, borderRadius: radii.xs,
                padding: "5px 8px", color: colors.text, fontSize: 12,
                boxSizing: "border-box", marginBottom: "4px",
              }}
            />
            <div style={{ display: "flex", flexDirection: "column", gap: "2px", maxHeight: "200px", overflowY: "auto" }}>
              {filteredVoices.map((v) => {
                const active = !elevenLabsCustomVoiceId && elevenLabsVoiceId === v.voice_id;
                const isCloned = v.category === "cloned" || v.category === "professional" || v.category === "generated";
                const isLoading = previewLoadingId === v.voice_id;
                const isPlaying = previewPlayingId === v.voice_id;
                const metaLine = v.description?.slice(0, 55) ?? "";
                return (
                  <div
                    key={v.voice_id}
                    style={{
                      display: "flex", alignItems: "center", gap: "4px",
                      padding: "4px 8px", borderRadius: radii.xs,
                      border: `1px solid ${active ? colors.accent : "transparent"}`,
                      background: active ? "rgba(10,132,255,0.12)" : "transparent",
                    }}
                  >
                    <button
                      onClick={() => { setElevenLabsVoiceId(v.voice_id); setElevenLabsCustomVoiceId(""); }}
                      style={{
                        flex: 1, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: "1px",
                        background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0,
                        minWidth: 0,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "5px", width: "100%" }}>
                        <span style={{
                          width: "6px", height: "6px", borderRadius: radii.full, flexShrink: 0,
                          background: active ? colors.accent : colors.textTertiary,
                        }} />
                        <span style={{ ...typography.caption, color: active ? colors.text : colors.textSecondary, fontWeight: active ? 600 : 400 }}>
                          {v.name}
                        </span>
                        {isCloned && (
                          <span style={{
                            fontSize: 9, padding: "1px 4px", borderRadius: 3,
                            background: "rgba(48,209,88,0.15)", color: "#30d158", flexShrink: 0,
                          }}>
                            {v.category === "professional" ? "PRO" : "CLONE"}
                          </span>
                        )}
                        {v.labels?.style && (
                          <span style={{ ...typography.small, color: colors.textTertiary, marginLeft: "auto", flexShrink: 0 }}>
                            {v.labels.style}
                          </span>
                        )}
                      </div>
                      {metaLine && (
                        <span style={{
                          fontSize: 9, color: colors.textTertiary,
                          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                          maxWidth: "150px", paddingLeft: "11px",
                        }}>
                          {metaLine}
                        </span>
                      )}
                    </button>
                    {v.preview_url ? (
                      <button
                        onClick={() => {
                          if (isPlaying || isLoading) {
                            stopPreview();
                            setPreviewPlayingId(null);
                            setPreviewLoadingId(null);
                          } else {
                            setPreviewLoadingId(v.voice_id);
                            previewVoice(v.preview_url!, () => {
                              setPreviewLoadingId(null);
                              setPreviewPlayingId(v.voice_id);
                            }).finally(() => {
                              setPreviewPlayingId(null);
                              setPreviewLoadingId(null);
                            });
                          }
                        }}
                        title={isLoading ? "Loading…" : isPlaying ? "Stop" : "Preview"}
                        style={{
                          background: "none", border: "none", cursor: "pointer", padding: "2px 4px",
                          color: (isPlaying || isLoading) ? colors.accent : colors.textTertiary,
                          fontSize: 11, flexShrink: 0,
                        }}
                      >
                        {isLoading
                          ? <span style={{ display: "inline-block", animation: "spin 0.8s linear infinite" }}>↻</span>
                          : isPlaying ? "■" : "▶"}
                      </button>
                    ) : (
                      <span
                        title="No preview available"
                        style={{ fontSize: 11, color: colors.textTertiary, opacity: 0.3, padding: "2px 4px", flexShrink: 0, userSelect: "none" }}
                      >
                        ▶
                      </span>
                    )}
                  </div>
                );
              })}
              {filteredVoices.length === 0 && !voiceLoading && (
                <div style={{ ...typography.small, color: colors.textTertiary, padding: "8px" }}>No voices found</div>
              )}
            </div>
          </div>

          {/* Clone a voice */}
          <div>
            <button
              onClick={() => { setCloneOpen((o) => !o); setCloneError(""); }}
              style={{
                background: "none", border: `1px solid ${colors.border}`, borderRadius: radii.xs,
                color: colors.textSecondary, fontSize: 11, cursor: "pointer",
                padding: "4px 8px", width: "100%",
              }}
            >
              {cloneOpen ? "✕ Cancel" : "+ Clone a voice"}
            </button>
            {cloneSuccess && (
              <div style={{ ...typography.small, color: "#30d158", marginTop: "4px" }}>
                Voice cloned! Now active in your library.
              </div>
            )}
            {cloneOpen && (
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "6px" }}>
                <input
                  type="text"
                  placeholder="Voice name…"
                  value={cloneName}
                  onChange={(e) => setCloneName(e.target.value)}
                  style={{
                    width: "100%", background: "rgba(255,255,255,0.05)",
                    border: `1px solid ${colors.border}`, borderRadius: radii.xs,
                    padding: "5px 8px", color: colors.text, fontSize: 12, boxSizing: "border-box",
                  }}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*,.mp3,.wav,.m4a,.ogg"
                  multiple
                  onChange={handleFileSelect}
                  style={{ display: "none" }}
                />
                {cloneFiles.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                    {cloneFiles.map((f, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "3px 6px", background: "rgba(255,255,255,0.04)", borderRadius: radii.xs }}>
                        <span style={{ ...typography.small, color: colors.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>✓ {f.name}</span>
                        <button
                          onClick={() => setCloneFiles((prev) => prev.filter((_, j) => j !== i))}
                          style={{ background: "none", border: "none", color: colors.textTertiary, cursor: "pointer", fontSize: 10, flexShrink: 0, padding: "0 2px" }}
                        >✕</button>
                      </div>
                    ))}
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        background: "rgba(255,255,255,0.03)", border: `1px dashed ${colors.border}`,
                        borderRadius: radii.xs, color: colors.textTertiary,
                        fontSize: 10, cursor: "pointer", padding: "3px 8px",
                      }}
                    >
                      + Add more samples (more = better quality)
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      background: "rgba(255,255,255,0.05)", border: `1px solid ${colors.border}`,
                      borderRadius: radii.xs, color: colors.textTertiary,
                      fontSize: 11, cursor: "pointer", padding: "5px 8px", textAlign: "left",
                    }}
                  >
                    Select audio files (MP3, WAV, M4A) — multiple for better quality
                  </button>
                )}
                {cloneError && (
                  <div style={{ ...typography.small, color: "#ff453a" }}>{cloneError}</div>
                )}
                <button
                  onClick={handleClone}
                  disabled={cloneLoading || !cloneName.trim() || cloneFiles.length === 0}
                  style={{
                    padding: "6px 12px", borderRadius: radii.xs,
                    background: cloneLoading || !cloneName.trim() || cloneFiles.length === 0
                      ? "rgba(255,255,255,0.05)" : "rgba(10,132,255,0.2)",
                    border: `1px solid ${colors.accent}`,
                    color: cloneLoading || !cloneName.trim() || cloneFiles.length === 0 ? colors.textTertiary : colors.text,
                    fontSize: 12, cursor: cloneLoading ? "wait" : "pointer",
                  }}
                >
                  {cloneLoading
                    ? <><span style={{ display: "inline-block", animation: "spin 0.8s linear infinite" }}>↻</span>{" "}Uploading {cloneFiles.length} file{cloneFiles.length !== 1 ? "s" : ""} ({cloneFilesTotalMB} MB)…</>
                    : cloneFiles.length > 0
                      ? `Upload & Clone (${cloneFiles.length} file${cloneFiles.length !== 1 ? "s" : ""}, ${cloneFilesTotalMB} MB)`
                      : "Upload & Clone"}
                </button>
              </div>
            )}
          </div>

          {/* Custom voice ID */}
          <div>
            <div style={{ ...typography.small, color: colors.textTertiary, marginBottom: "4px" }}>Custom voice ID (overrides selection)</div>
            <input
              type="text"
              placeholder="Paste ElevenLabs voice ID…"
              value={elevenLabsCustomVoiceId}
              onChange={(e) => setElevenLabsCustomVoiceId(e.target.value)}
              style={{
                width: "100%", background: "rgba(255,255,255,0.05)",
                border: `1px solid ${elevenLabsCustomVoiceId ? colors.accent : colors.border}`,
                borderRadius: radii.xs, padding: "6px 8px", color: colors.text,
                fontSize: 12, boxSizing: "border-box",
              }}
            />
          </div>
        </>
      )}

      {ttsMode === "local" && (
        <div style={{ ...typography.small, color: colors.textTertiary }}>
          Kokoro-82M — private, offline. Download model to enable.
        </div>
      )}
    </div>
  );
}