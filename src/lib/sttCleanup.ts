/**
 * One-shot LLM polish pass over the AssemblyAI raw transcript.
 *
 * Why this exists: AssemblyAI Universal-3 returns transcripts that are
 * accurate at the word level but raw — disfluencies present, punctuation
 * inconsistent, proper nouns sometimes mistranscribed. Running the result
 * through a small fast model (Haiku 4.5 or gpt-4o-mini) closes most of the
 * perceptual gap to Wispr Flow's polished output. Research shows this
 * pipeline (ASR + LLM cleanup) is what differentiates dictation-grade tools.
 *
 * Anti-hallucination contract (from FreeFlow MIT-licensed pattern):
 * the model MUST fix only what was spoken — never add or invent words.
 * The system prompt enforces this; we also fall back to the raw transcript
 * if the cleaned output deviates implausibly in length.
 */

import { streamChat, type ChatMessage } from "../providers/chat";
import type { ProviderType } from "../state/companionStore";
import { recordTelemetryEvent, recordTelemetryMetric, startTelemetrySpan } from "./telemetry";

export type SttCleanupMode = "off" | "dictation" | "formal";

export interface SttCleanupOptions {
  /** Raw AssemblyAI final transcript (may contain disfluencies, partial caps). */
  rawTranscript: string;
  /** Polish strength. "off" returns the input unchanged. */
  mode: SttCleanupMode;
  /** Provider whose API key is currently loaded. */
  provider: ProviderType;
  /** Model id to use. Should be a fast/cheap model. */
  modelId: string;
  /** Optional vocabulary to bias spelling. Enforced via the cleanup prompt. */
  personalDictionary?: readonly string[];
  /** Active window title for app-aware formatting. */
  focusedWindowTitle?: string | null;
  /** Speech-language hint so the cleanup model preserves non-English content. */
  languageHint?: string | null;
  /** Internal: raise to allow longer cleanup outputs (defaults conservative). */
  maxOutputTokens?: number;
}

export interface SttCleanupResult {
  /** Final transcript handed to the rest of the pipeline. */
  transcript: string;
  /** Whether cleanup actually replaced the raw text (false if disabled or fallback). */
  applied: boolean;
  /** Reason for the decision — useful for telemetry and UI hints. */
  reason: "disabled" | "applied" | "skipped_short" | "fallback_too_divergent" | "error";
  /** Latency in milliseconds. */
  latencyMs: number;
}

const SHORT_INPUT_THRESHOLD = 3; // words — below this, cleanup risks > value

/**
 * Allowable length divergence between raw and polished output. The polished
 * version may shrink (filler removal) but should never balloon — protects
 * against the model "improving" by elaborating.
 */
function isPlausibleLengthDelta(raw: string, polished: string): boolean {
  if (polished.length === 0) return false;
  const rawLen = raw.length;
  const polishedLen = polished.length;
  // Must not exceed 1.4× the raw length (allows punctuation + capitalization headroom)
  if (polishedLen > Math.max(rawLen * 1.4, rawLen + 30)) return false;
  // Must not shrink to less than 35% of raw (filler removal is rarely that aggressive)
  if (rawLen > 50 && polishedLen < Math.floor(rawLen * 0.35)) return false;
  return true;
}

function buildCleanupSystemPrompt(opts: SttCleanupOptions): string {
  const dictionary = (opts.personalDictionary ?? [])
    .filter((s) => typeof s === "string" && s.trim().length > 0)
    .slice(0, 60); // cleanup prompt budget; keyterms already biases STT
  const dictionaryBlock =
    dictionary.length > 0
      ? `\n\n# Personal Dictionary (preserve exact spelling/casing)\n${dictionary.join(", ")}`
      : "";
  const appBlock = opts.focusedWindowTitle
    ? `\n\n# Active Window\n${opts.focusedWindowTitle.slice(0, 120)}`
    : "";
  const langBlock = opts.languageHint
    ? `\n\n# Language\nThe transcript is in ${opts.languageHint}. Do not translate.`
    : "";

  const polishLevel =
    opts.mode === "formal"
      ? `Apply formal-style polish: full sentences, paragraph breaks where appropriate, formal capitalization, no contractions if clearer. Do not add greetings, sign-offs, or sentences not present in the input.`
      : `Apply light dictation polish only: capitalize sentence beginnings and proper nouns, add punctuation that the spoken cadence implies, and strip filler words ("um", "uh", "like" when used as filler).`;

  return [
    `You are a transcript polish step in a real-time voice assistant pipeline.`,
    `Your input is the raw output of an automatic speech recognizer.`,
    ``,
    `# Hard rules`,
    `1. Output ONLY the corrected transcript. No commentary, no preamble, no quotation marks.`,
    `2. Preserve the speaker's meaning EXACTLY. Never add words that were not spoken.`,
    `3. Never invent details, names, dates, or facts that are not in the input.`,
    `4. If the input is gibberish or empty, return it unchanged.`,
    `5. Do not translate. Do not summarize. Do not "improve" wording.`,
    ``,
    `# Polish level`,
    polishLevel + dictionaryBlock + appBlock + langBlock,
  ].join("\n");
}

export async function cleanupTranscript(opts: SttCleanupOptions): Promise<SttCleanupResult> {
  const started = performance.now();
  const span = startTelemetrySpan("stt.cleanup", {
    mode: opts.mode,
    provider: opts.provider,
    modelId: opts.modelId,
    rawLengthBucket: bucketLength(opts.rawTranscript.length),
  });

  if (opts.mode === "off") {
    span.end({ skipped: "mode_off" });
    return {
      transcript: opts.rawTranscript,
      applied: false,
      reason: "disabled",
      latencyMs: 0,
    };
  }

  const wordCount = opts.rawTranscript.trim().split(/\s+/).filter((w) => w.length > 0).length;
  if (wordCount < SHORT_INPUT_THRESHOLD) {
    // For very short utterances cleanup overhead exceeds the perceptual benefit.
    span.end({ skipped: "short_input" });
    return {
      transcript: opts.rawTranscript,
      applied: false,
      reason: "skipped_short",
      latencyMs: Math.round(performance.now() - started),
    };
  }

  const systemPrompt = buildCleanupSystemPrompt(opts);
  const userMessage: ChatMessage = {
    role: "user",
    content: opts.rawTranscript.trim(),
  };

  try {
    let polished = "";
    polished = await streamChat({
      provider: opts.provider,
      modelId: opts.modelId,
      systemPrompt,
      messages: [userMessage],
      maxTokens: opts.maxOutputTokens ?? 400,
      onChunk: () => {
        /* swallow chunks — cleanup is a one-shot use of streaming */
      },
      telemetryContext: span.context,
    });

    polished = polished.trim();
    if (!isPlausibleLengthDelta(opts.rawTranscript, polished)) {
      span.end({ fallback: "length_divergence", polishedLen: polished.length });
      recordTelemetryEvent("stt.cleanup.fallback", {
        reason: "length_divergence",
        rawLength: opts.rawTranscript.length,
        polishedLength: polished.length,
      });
      return {
        transcript: opts.rawTranscript,
        applied: false,
        reason: "fallback_too_divergent",
        latencyMs: Math.round(performance.now() - started),
      };
    }

    const latencyMs = Math.round(performance.now() - started);
    recordTelemetryMetric("stt.cleanup.latency_ms", latencyMs, { mode: opts.mode });
    span.end({ applied: true, latencyMs, polishedLengthBucket: bucketLength(polished.length) });
    return { transcript: polished, applied: true, reason: "applied", latencyMs };
  } catch (err) {
    span.fail(err, { stage: "cleanup_call" });
    recordTelemetryEvent("stt.cleanup.error", {
      message: err instanceof Error ? err.message : String(err),
    });
    return {
      transcript: opts.rawTranscript,
      applied: false,
      reason: "error",
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

function bucketLength(n: number): "<20" | "20-100" | "100-300" | "300+" {
  if (n < 20) return "<20";
  if (n < 100) return "20-100";
  if (n < 300) return "100-300";
  return "300+";
}

// Exported for tests
export const __test = { isPlausibleLengthDelta, buildCleanupSystemPrompt, SHORT_INPUT_THRESHOLD };

/**
 * Fast model selection — prefers Haiku (Anthropic), gpt-4o-mini (OpenAI),
 * grok-mini (xAI). Returns null if no key is configured for any provider.
 */
export function selectCleanupModel(
  available: { anthropic: boolean; openai: boolean; grok: boolean },
): { provider: ProviderType; modelId: string } | null {
  if (available.anthropic) return { provider: "claude", modelId: "claude-haiku-4-5-20251001" };
  if (available.openai) return { provider: "openai", modelId: "gpt-4o-mini" };
  if (available.grok) return { provider: "grok", modelId: "grok-3" };
  return null;
}
