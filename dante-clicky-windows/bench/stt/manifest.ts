/**
 * Audio set manifest schema. Each entry pairs a wav file path with the
 * ground-truth transcript and metadata used to bucket WER (e.g. accent,
 * proper-noun density). Populate `bench/stt/manifest.json` with real entries
 * to run the harness against actual audio.
 */

export type UtteranceCategory =
  | "general"
  | "code-identifiers"
  | "proper-nouns"
  | "accented-english"
  | "noisy-background"
  | "long-form"
  | "spanish"
  | "multilingual";

export interface ManifestEntry {
  /** Relative path under bench/stt/audio/, e.g. "general/u001.wav". */
  audioPath: string;
  /** Ground-truth transcript (case-preserving; WER normalization handles it). */
  reference: string;
  /** Coarse category for slicing the WER table. */
  category: UtteranceCategory;
  /** Approximate duration in seconds. Optional, used for cost estimation. */
  durationSec?: number;
  /** Free-text notes that explain why the utterance is in the set. */
  notes?: string;
}

export interface BenchManifest {
  version: 1;
  description: string;
  entries: ManifestEntry[];
}

export type AblationKey =
  | "baseline"
  | "vad+gain"
  | "+keyterms"
  | "+keyterms+cleanup"
  | "+keyterms+cleanup+ensemble";

export interface AblationResult {
  ablation: AblationKey;
  wer: number;
  insertions: number;
  deletions: number;
  substitutions: number;
  hits: number;
  referenceWordCount: number;
  utteranceCount: number;
  perCategory: Record<string, { wer: number; utteranceCount: number }>;
  /** P50 / P95 latency (ms) from final-PCM-sent to final-transcript-available. */
  latencyP50Ms?: number;
  latencyP95Ms?: number;
}

export interface BenchReport {
  ranAt: string;
  manifestVersion: number;
  manifestEntryCount: number;
  results: AblationResult[];
  /** Bottom line: per-ablation delta vs the baseline ablation. */
  improvements: Record<Exclude<AblationKey, "baseline">, { absoluteWerReduction: number; relativeWerReduction: number }>;
}
