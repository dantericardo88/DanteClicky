/**
 * STT provider abstraction.
 *
 * Layer 4 of the Dim-2 (STT Cloud Accuracy) effort: defines the surface that
 * `useAssemblyAI` and any sibling provider hook (Deepgram Nova-3, ElevenLabs
 * Scribe v2 Realtime) must implement so the rest of the pipeline (`useVoice`)
 * can swap providers without code changes.
 *
 * The abstraction also enables a confidence-gated ensemble: a primary
 * provider transcribes in real time, and segments below a confidence
 * threshold can be re-transcribed by a secondary provider (Groq
 * Whisper-Large-v3-Turbo is cheap + extremely fast). The cleanup LLM picks
 * the higher-confidence reading per segment.
 */

import type { AssemblyAILanguageDetection, AssemblyAIWord } from "../lib/assemblyAIStreaming";

export type SttProviderId = "assemblyai" | "deepgram-nova3" | "elevenlabs-scribe" | "groq-whisper";

export interface SttConnectOptions {
  /** Hotwords / domain vocabulary biasing. Each provider maps this to its native API. */
  keyterms?: readonly string[] | null;
  /** Dictation-grade smart formatting (caps, numerals, punctuation). Default true. */
  formatText?: boolean;
  /** When false (default) finals omit filler words. */
  preserveDisfluencies?: boolean;
}

export interface SttProvider {
  readonly id: SttProviderId;
  /** Pre-warm a connection so PTT-down has zero handshake latency. No-op if already warm. */
  preWarm?: (sampleRate: number) => Promise<void>;
  /** Open a streaming session. Reuses pre-warmed sockets where possible. */
  connect: (sampleRate: number, options?: SttConnectOptions) => Promise<void>;
  /** Forward one PCM16LE chunk encoded as base64. */
  sendChunk: (base64Pcm: string) => void;
  /** Close the session and return the final transcript. */
  disconnect: () => string;
  /** Optional language detection metadata if the provider supports it. */
  getLastLanguageDetection?: () => AssemblyAILanguageDetection | null;
  /** Word-level data with confidence; empty array if the provider does not expose it. */
  getLiveWords?: () => AssemblyAIWord[];
  /** Update the keyterms cache used on the next connect/preWarm cycle. */
  setKeyterms?: (keyterms: readonly string[] | null) => void;
}

/**
 * Identify low-confidence runs that benefit from a secondary-provider
 * re-transcription pass. A run is a contiguous span of words whose mean
 * confidence is below `threshold`. The runs are kept short (≤ `maxRunLength`
 * words) so the LLM cleanup can splice them back in granularly.
 */
export interface LowConfidenceRun {
  startIndex: number;
  endIndex: number; // exclusive
  text: string;
  meanConfidence: number;
}

export function findLowConfidenceRuns(
  words: readonly AssemblyAIWord[],
  threshold = 0.6,
  maxRunLength = 6,
): LowConfidenceRun[] {
  const runs: LowConfidenceRun[] = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i];
    if (typeof w.confidence === "number" && w.confidence < threshold) {
      let j = i;
      let sum = 0;
      let count = 0;
      while (
        j < words.length &&
        j - i < maxRunLength &&
        typeof words[j].confidence === "number" &&
        (words[j].confidence as number) < threshold
      ) {
        sum += words[j].confidence as number;
        count += 1;
        j += 1;
      }
      runs.push({
        startIndex: i,
        endIndex: j,
        text: words.slice(i, j).map((w) => w.text).join(" "),
        meanConfidence: count === 0 ? 0 : sum / count,
      });
      i = j;
    } else {
      i += 1;
    }
  }
  return runs;
}

/**
 * Combine primary-provider words with secondary re-transcriptions of
 * low-confidence runs. The secondary results replace the runs verbatim
 * (text only — confidence is unknown for the secondary). Used downstream
 * by the LLM cleanup pass which has the final say on phrasing.
 */
export function spliceSecondaryReadings(
  primaryWords: readonly AssemblyAIWord[],
  runs: readonly LowConfidenceRun[],
  secondaryByRunIndex: Record<number, string>,
): string {
  const parts: string[] = [];
  let cursor = 0;
  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    if (cursor < run.startIndex) {
      parts.push(primaryWords.slice(cursor, run.startIndex).map((w) => w.text).join(" "));
    }
    const secondary = secondaryByRunIndex[r];
    if (secondary && secondary.trim().length > 0) {
      parts.push(secondary.trim());
    } else {
      parts.push(primaryWords.slice(run.startIndex, run.endIndex).map((w) => w.text).join(" "));
    }
    cursor = run.endIndex;
  }
  if (cursor < primaryWords.length) {
    parts.push(primaryWords.slice(cursor).map((w) => w.text).join(" "));
  }
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}
