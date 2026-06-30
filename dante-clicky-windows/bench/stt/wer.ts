/**
 * Word Error Rate (WER) computation using the standard Levenshtein algorithm
 * over tokens (Wagner-Fischer dynamic programming).
 *
 *   WER = (S + D + I) / N
 *
 * where S, D, I are the counts of substitutions, deletions, and insertions
 * needed to transform the hypothesis into the reference, and N is the total
 * number of words in the reference. This matches the `jiwer` Python library
 * and the SCLITE specification used in academic ASR benchmarks.
 *
 * The "norm" preprocessing matches industry convention:
 *   - lowercase
 *   - strip non-alphanumeric except apostrophes (which break contractions)
 *   - collapse multi-space to single
 *   - trim
 *
 * Used by `bench/stt/run.ts` to score every ablation against a held-out set.
 */

export interface WerResult {
  wer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  hits: number;
  referenceWordCount: number;
  hypothesisWordCount: number;
}

const PUNCT_RE = /[^\p{L}\p{N}\s']/gu;
const SPACE_RE = /\s+/g;

export function normalizeForWer(text: string): string {
  return text
    .toLowerCase()
    .replace(PUNCT_RE, " ")
    .replace(SPACE_RE, " ")
    .trim();
}

export function tokenizeForWer(text: string): string[] {
  const norm = normalizeForWer(text);
  if (norm.length === 0) return [];
  return norm.split(" ");
}

/**
 * Compute WER between a single reference and hypothesis. Returns hit counts
 * so a corpus-level WER can be computed by summing across utterances.
 */
export function computeWer(reference: string, hypothesis: string): WerResult {
  const ref = tokenizeForWer(reference);
  const hyp = tokenizeForWer(hypothesis);
  const refLen = ref.length;
  const hypLen = hyp.length;

  if (refLen === 0) {
    return {
      wer: hypLen === 0 ? 0 : 1,
      substitutions: 0,
      deletions: 0,
      insertions: hypLen,
      hits: 0,
      referenceWordCount: 0,
      hypothesisWordCount: hypLen,
    };
  }

  // dp[i][j] = edit distance between ref[..i] and hyp[..j]
  const dp: number[][] = Array.from({ length: refLen + 1 }, () =>
    Array(hypLen + 1).fill(0),
  );
  for (let i = 0; i <= refLen; i++) dp[i][0] = i;
  for (let j = 0; j <= hypLen; j++) dp[0][j] = j;

  for (let i = 1; i <= refLen; i++) {
    for (let j = 1; j <= hypLen; j++) {
      if (ref[i - 1] === hyp[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j - 1], // substitution
          dp[i - 1][j],     // deletion
          dp[i][j - 1],     // insertion
        );
      }
    }
  }

  // Backtrace to count operation types
  let i = refLen;
  let j = hypLen;
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  let hits = 0;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && ref[i - 1] === hyp[j - 1]) {
      hits += 1;
      i -= 1;
      j -= 1;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      substitutions += 1;
      i -= 1;
      j -= 1;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      deletions += 1;
      i -= 1;
    } else {
      insertions += 1;
      j -= 1;
    }
  }

  const errors = substitutions + deletions + insertions;
  return {
    wer: errors / refLen,
    substitutions,
    deletions,
    insertions,
    hits,
    referenceWordCount: refLen,
    hypothesisWordCount: hypLen,
  };
}

export interface CorpusWerResult {
  wer: number;
  substitutions: number;
  deletions: number;
  insertions: number;
  hits: number;
  referenceWordCount: number;
  hypothesisWordCount: number;
  utteranceCount: number;
  perUtterance: WerResult[];
}

export function computeCorpusWer(
  pairs: ReadonlyArray<{ reference: string; hypothesis: string }>,
): CorpusWerResult {
  let substitutions = 0;
  let deletions = 0;
  let insertions = 0;
  let hits = 0;
  let referenceWordCount = 0;
  let hypothesisWordCount = 0;
  const perUtterance: WerResult[] = [];
  for (const pair of pairs) {
    const r = computeWer(pair.reference, pair.hypothesis);
    perUtterance.push(r);
    substitutions += r.substitutions;
    deletions += r.deletions;
    insertions += r.insertions;
    hits += r.hits;
    referenceWordCount += r.referenceWordCount;
    hypothesisWordCount += r.hypothesisWordCount;
  }
  const errors = substitutions + deletions + insertions;
  return {
    wer: referenceWordCount === 0 ? 0 : errors / referenceWordCount,
    substitutions,
    deletions,
    insertions,
    hits,
    referenceWordCount,
    hypothesisWordCount,
    utteranceCount: pairs.length,
    perUtterance,
  };
}
