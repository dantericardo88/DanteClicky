import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useCompanionStore } from "../state/companionStore";
import { captureTelemetryError, startTelemetrySpan } from "../lib/telemetry";

// Fetches MP3 audio via Rust (bypasses CORS) and plays via Web Audio API.
// Sentence-queue mode — prefetches each sentence in parallel and plays
// them back-to-back, so audio starts as soon as the first sentence is ready.
// Dimension 4: when ttsMode === "local", tries Kokoro ONNX first, falls back to cloud.

// Built-in ElevenLabs voice presets — shown as fallback when API library unavailable
export const ELEVENLABS_VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel", style: "warm, clear" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam", style: "deep, authoritative" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi", style: "strong, confident" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella", style: "soft, friendly" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh", style: "casual, warm" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni", style: "professional, clear" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold", style: "gravelly, distinct" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli", style: "young, energetic" },
  { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam", style: "conversational, natural" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", style: "British, crisp" },
  { id: "g5CIjZEefAph4nQFvHAz", name: "Ethan", style: "young, bright" },
  { id: "oWAxZDx7w5VEj9dCyTzz", name: "Grace", style: "warm, approachable" },
];

// Language-aware voice filtering: prioritize voices with good support, include all as fallback
// European languages have explicit preferences; Asian/non-European languages supported by all voices via multilingual_v2
const VOICE_LANGUAGE_AFFINITIES: Record<string, string[]> = {
  "21m00Tcm4TlvDq8ikWAM": ["en", "es", "fr", "de", "pt", "it", "nl", "zh", "ja", "ko", "hi", "ar", "pl", "tr", "uk", "vi", "id", "sv"],   // Rachel
  "pNInz6obpgDQGcFmaJgB": ["en", "es", "de", "it", "zh", "ja", "ko", "hi", "ar", "pl", "tr", "uk", "vi", "id", "sv"],                      // Adam
  "AZnzlk1XvdvUeBnXmlld": ["en", "es", "pt", "zh", "ja", "ko", "hi", "ar", "pl", "tr", "uk", "vi", "id", "sv"],                           // Domi
  "EXAVITQu4vr4xnSDxMaL": ["en", "es", "fr", "de", "zh", "ja", "ko", "hi", "ar", "pl", "tr", "uk", "vi", "id", "sv"],                      // Bella
  "TxGEqnHWrfWFTfGW9XjX": ["en", "zh", "ja", "ko", "hi", "ar", "pl", "tr", "uk", "vi", "id", "sv"],                                        // Josh (English focused)
  "ErXwobaYiN019PkySvjV": ["en", "es", "fr", "it", "zh", "ja", "ko", "hi", "ar", "pl", "tr", "uk", "vi", "id", "sv"],                      // Antoni
  "VR6AewLTigWG4xSOukaG": ["en", "de", "zh", "ja", "ko", "hi", "ar", "pl", "tr", "uk", "vi", "id", "sv"],                                 // Arnold
  "MF3mGyEYCl7XYWbV9V6O": ["en", "es", "fr", "zh", "ja", "ko", "hi", "ar", "pl", "tr", "uk", "vi", "id", "sv"],                            // Elli
  "yoZ06aMxZJJ28mfd3POQ": ["en", "zh", "ja", "ko", "hi", "ar", "pl", "tr", "uk", "vi", "id", "sv"],                                        // Sam (English focused)
  "onwK4e9ZLuTAKqWW03F9": ["en", "zh", "ja", "ko", "hi", "ar", "pl", "tr", "uk", "vi", "id", "sv"],                                        // Daniel (English focused)
  "g5CIjZEefAph4nQFvHAz": ["en", "es", "zh", "ja", "ko", "hi", "ar", "pl", "tr", "uk", "vi", "id", "sv"],                                 // Ethan
  "oWAxZDx7w5VEj9dCyTzz": ["en", "fr", "zh", "ja", "ko", "hi", "ar", "pl", "tr", "uk", "vi", "id", "sv"],                                 // Grace
};

const LABEL_TO_LANG_CODE: Record<string, string> = {
  "english": "en", "spanish": "es", "french": "fr", "german": "de",
  "portuguese": "pt", "italian": "it", "chinese": "zh", "japanese": "ja",
  "korean": "ko", "hindi": "hi", "arabic": "ar", "dutch": "nl",
  "polish": "pl", "turkish": "tr", "ukrainian": "uk", "vietnamese": "vi",
  "indonesian": "id", "swedish": "sv",
};

function resolveVoiceAffinities(voice: ElevenLabsVoice): string[] {
  const staticAffinities = VOICE_LANGUAGE_AFFINITIES[voice.voice_id] ?? [];

  if (voice.labels?.language) {
    const code = LABEL_TO_LANG_CODE[voice.labels.language.toLowerCase()];
    if (code && !staticAffinities.includes(code)) {
      return [...staticAffinities, code];
    }
  }

  return staticAffinities;
}

// Filter voices by language: prioritize voices with good support, include all as fallback
export function filterVoicesByLanguage(
  voices: ElevenLabsVoice[],
  languageCode?: string
): ElevenLabsVoice[] {
  if (!languageCode || languageCode === "auto") {
    return voices; // Show all voices for auto/unselected
  }

  // Separate voices into supported and fallback
  const supported = voices.filter((v) => {
    const affinities = resolveVoiceAffinities(v);
    return affinities.includes(languageCode);
  });

  // Return supported voices first, then fallback to all voices
  return supported.length > 0 ? supported : voices;
}

// Quality presets: model + output format + latency optimization level
export const QUALITY_PRESETS = {
  fast:     { modelId: "eleven_flash_v2_5",      outputFormat: "mp3_44100_128", latencyOpt: 4 },
  balanced: { modelId: "eleven_turbo_v2_5",       outputFormat: "mp3_44100_192", latencyOpt: 3 },
  max:      { modelId: "eleven_multilingual_v2",  outputFormat: "mp3_44100_192", latencyOpt: 0 },
} as const;

export type TtsQuality = keyof typeof QUALITY_PRESETS;

// Voice returned from ElevenLabs /v1/voices
export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  category: "premade" | "cloned" | "generated" | "professional" | string;
  labels?: Record<string, string>;
  preview_url?: string;
  description?: string;
}

// Fetch the user's full ElevenLabs voice library (premade + cloned + generated)
export async function fetchVoiceLibrary(): Promise<ElevenLabsVoice[]> {
  try {
    const result = await invoke<{ voices: ElevenLabsVoice[] }>("elevenlabs_list_voices");
    return (result.voices ?? []).sort((a, b) => {
      const aScore = a.category === "cloned" ? 0 : a.category === "professional" ? 1 : 2;
      const bScore = b.category === "cloned" ? 0 : b.category === "professional" ? 1 : 2;
      return aScore - bScore || a.name.localeCompare(b.name);
    });
  } catch {
    return [];
  }
}

// Play a voice preview URL inline (one-shot, no queue)
let _previewCtx: AudioContext | null = null;
let _previewSource: AudioBufferSourceNode | null = null;

export async function previewVoice(previewUrl: string, onStart?: () => void): Promise<void> {
  try {
    _previewSource?.stop();
    _previewSource = null;
  } catch { /* already stopped */ }

  if (!previewUrl) return;
  try {
    const res = await fetch(previewUrl);
    const buf = await res.arrayBuffer();
    if (!_previewCtx || _previewCtx.state === "closed") {
      _previewCtx = new AudioContext();
    }
    const decoded = await _previewCtx.decodeAudioData(buf);
    const source = _previewCtx.createBufferSource();
    source.buffer = decoded;
    source.connect(_previewCtx.destination);
    // Await full playback so callers see the Promise resolve only when audio ends.
    // This lets UI toggle the ■ stop button correctly for the entire duration.
    await new Promise<void>((resolve) => {
      source.onended = () => resolve();
      source.start(0);
      onStart?.();
    });
    _previewSource = source;
  } catch (e) {
    console.warn("[TTS] Preview failed:", e);
  }
}

export function stopPreview(): void {
  try { _previewSource?.stop(); } catch { /* already stopped */ }
  _previewSource = null;
}

export function useElevenLabs(
  elevenLabsKey: string,
  voiceId?: string,
  customVoiceId?: string,
  modelId?: string,
  ttsQuality?: TtsQuality,
  languageCode?: string,
  overrideOutputFormat?: string,
  overrideLatencyOpt?: number,
) {
  const activeVoiceId = (customVoiceId?.trim()) || voiceId || "21m00Tcm4TlvDq8ikWAM";

  // Quality preset drives model + output format + latency opt.
  // If modelId is passed explicitly (legacy), use it; otherwise derive from preset.
  // Allow overrides for multilingual model quality parity.
  const preset = QUALITY_PRESETS[ttsQuality ?? "balanced"];
  const activeModelId = modelId || preset.modelId;
  const activeOutputFormat = overrideOutputFormat ?? preset.outputFormat;
  const activeLatencyOpt = overrideLatencyOpt ?? preset.latencyOpt;

  const audioCtxRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<Promise<AudioBuffer | null>[]>([]);
  const playingRef = useRef(false);
  const stoppedRef = useRef(false);

  const warmUp = useCallback((): void => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
      if (audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume().catch(() => {});
      }
    }
    stoppedRef.current = false;
  }, []);

  function getCtx(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }

  async function fetchAudio(text: string): Promise<AudioBuffer | null> {
    if (!text.trim()) return null;

    const { ttsMode } = useCompanionStore.getState();
    const span = startTelemetrySpan("tts.fetch_audio", {
      mode: ttsMode,
      modelId: activeModelId,
      outputFormat: activeOutputFormat,
      latencyOptimization: activeLatencyOpt,
      languageCode: languageCode && languageCode !== "auto" ? languageCode : "auto",
      textLengthBucket: text.length < 80 ? "<80" : text.length < 280 ? "80-280" : "280+",
    });

    // Dimension 4: try local Kokoro TTS first when in local mode
    if (ttsMode === "local") {
      try {
        const audioBytes = await invoke<number[]>("kokoro_tts", { text });
        const ctx = getCtx();
        const buffer = await ctx.decodeAudioData(new Uint8Array(audioBytes).buffer);
        span.end({ route: "local" });
        return buffer;
      } catch (e) {
        console.warn("[TTS] Local Kokoro failed, falling back to cloud:", e);
        captureTelemetryError(e, { route: "tts.local_fallback" });
      }
    }

    if (!elevenLabsKey) {
      span.end({ route: "cloud", skipped: true });
      return null;
    }
    try {
      const bytes = await invoke<number[]>("elevenlabs_tts", {
        text,
        voiceId: activeVoiceId,
        modelId: activeModelId,
        outputFormat: activeOutputFormat,
        latencyOptimization: activeLatencyOpt,
        languageCode: languageCode && languageCode !== "auto" ? languageCode : undefined,
      });
      const ctx = getCtx();
      const buffer = await ctx.decodeAudioData(new Uint8Array(bytes).buffer);
      span.end({ route: "cloud", byteLengthBucket: bytes.length < 25_000 ? "<25k" : bytes.length < 100_000 ? "25k-100k" : "100k+" });
      return buffer;
    } catch (err) {
      console.error("[ElevenLabs] fetchAudio failed:", err);
      captureTelemetryError(err, { route: "tts.cloud" });
      span.fail(err);
      return null;
    }
  }

  async function drainQueue() {
    if (playingRef.current) return;
    playingRef.current = true;
    while (queueRef.current.length > 0 && !stoppedRef.current) {
      const bufferPromise = queueRef.current.shift()!;
      const buffer = await bufferPromise;
      if (!buffer || stoppedRef.current) continue;
      await new Promise<void>((resolve) => {
        const ctx = getCtx();
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => resolve();
        source.start(0);
      });
    }
    playingRef.current = false;
  }

  const queueSentence = useCallback(
    (text: string): void => {
      if (!elevenLabsKey || !text.trim()) return;
      queueRef.current.push(fetchAudio(text));
      drainQueue();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [elevenLabsKey, activeVoiceId, activeModelId, activeOutputFormat, activeLatencyOpt, languageCode]
  );

  const speak = useCallback(
    (text: string): void => {
      if (!elevenLabsKey || !text.trim()) return;
      stoppedRef.current = false;
      const sentences = splitSentences(text, languageCode && languageCode !== "auto" ? languageCode : "en");
      for (const s of sentences) {
        queueRef.current.push(fetchAudio(s));
      }
      drainQueue();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [elevenLabsKey]
  );

  const stop = useCallback(() => {
    stoppedRef.current = true;
    queueRef.current = [];
    playingRef.current = false;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
  }, []);

  return { speak, stop, warmUp, queueSentence };
}

function splitSentences(text: string, locale = "en"): string[] {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmenter = new Intl.Segmenter(locale, { granularity: "sentence" });
    return Array.from(segmenter.segment(text))
      .map((s) => s.segment.trim())
      .filter((s) => s.length > 0);
  }
  const raw = text.split(/(?<=[.!?؟。！？۔])\s*/u);
  return raw.map((s) => s.trim()).filter((s) => s.length > 0);
}
