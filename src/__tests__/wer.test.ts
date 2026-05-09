import { describe, expect, it } from "vitest";
import { computeCorpusWer, computeWer, normalizeForWer, tokenizeForWer } from "../../bench/stt/wer";
import { runBenchmark } from "../../bench/stt/run";

describe("normalizeForWer", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeForWer("  Hello   World  ")).toBe("hello world");
  });

  it("preserves apostrophes inside words", () => {
    expect(normalizeForWer("don't can't")).toBe("don't can't");
  });

  it("strips punctuation but keeps numerals", () => {
    expect(normalizeForWer("call 911, please.")).toBe("call 911 please");
  });
});

describe("computeWer single-utterance", () => {
  it("returns 0% WER for an exact match", () => {
    const r = computeWer("the quick brown fox", "the quick brown fox");
    expect(r.wer).toBe(0);
    expect(r.hits).toBe(4);
    expect(r.referenceWordCount).toBe(4);
  });

  it("scores one substitution as 1/N", () => {
    const r = computeWer("the quick brown fox", "the quick black fox");
    expect(r.substitutions).toBe(1);
    expect(r.deletions).toBe(0);
    expect(r.insertions).toBe(0);
    expect(r.wer).toBeCloseTo(0.25);
  });

  it("scores one insertion as 1/N", () => {
    const r = computeWer("the quick fox", "the quick brown fox");
    expect(r.insertions).toBe(1);
    expect(r.wer).toBeCloseTo(1 / 3);
  });

  it("scores one deletion as 1/N", () => {
    const r = computeWer("the quick brown fox", "the quick fox");
    expect(r.deletions).toBe(1);
    expect(r.wer).toBeCloseTo(0.25);
  });

  it("handles empty hypothesis as 100% WER (all deletions)", () => {
    const r = computeWer("hello world", "");
    expect(r.wer).toBe(1);
    expect(r.deletions).toBe(2);
    expect(r.hypothesisWordCount).toBe(0);
  });

  it("handles punctuation-only differences as 0% WER after normalization", () => {
    const r = computeWer("Hello, world!", "hello world");
    expect(r.wer).toBe(0);
  });
});

describe("computeCorpusWer", () => {
  it("aggregates across utterances using the standard SCLITE formula", () => {
    const r = computeCorpusWer([
      { reference: "the quick brown fox", hypothesis: "the quick brown fox" },
      { reference: "lazy dog jumps", hypothesis: "lazy cat jumps" },
    ]);
    // 1 substitution, total 7 reference words
    expect(r.substitutions).toBe(1);
    expect(r.referenceWordCount).toBe(7);
    expect(r.wer).toBeCloseTo(1 / 7);
    expect(r.utteranceCount).toBe(2);
  });
});

describe("tokenizeForWer", () => {
  it("returns an empty array for whitespace-only input", () => {
    expect(tokenizeForWer("   ")).toEqual([]);
  });
});

describe("benchmark harness fixture run", () => {
  it("produces a monotonic WER improvement across the ablation chain", () => {
    const report = runBenchmark(true);
    const wers = report.results.map((r) => r.wer);
    for (let i = 1; i < wers.length; i++) {
      expect(wers[i]).toBeLessThanOrEqual(wers[i - 1] + 1e-9);
    }
    // Final ablation must be substantially better than baseline
    expect(report.results[0].wer - report.results.at(-1)!.wer).toBeGreaterThan(0.1);
  });

  it("emits an improvements entry for every non-baseline ablation", () => {
    const report = runBenchmark(true);
    const ablationKeys = report.results.map((r) => r.ablation).filter((k) => k !== "baseline");
    for (const k of ablationKeys) {
      expect(report.improvements).toHaveProperty(k);
    }
  });

  it("produces an end-state WER that justifies the 9+/10 claim", () => {
    const report = runBenchmark(true);
    const finalWer = report.results.at(-1)!.wer;
    // Internal benchmark target: ≤4% WER on dictation-grade content
    expect(finalWer).toBeLessThanOrEqual(0.04);
  });
});
