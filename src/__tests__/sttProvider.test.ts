import { describe, expect, it } from "vitest";
import { findLowConfidenceRuns, spliceSecondaryReadings } from "../hooks/sttProvider";
import type { AssemblyAIWord } from "../lib/assemblyAIStreaming";

const w = (text: string, confidence: number | null): AssemblyAIWord => ({
  text,
  confidence,
  isFinal: false,
});

describe("findLowConfidenceRuns", () => {
  it("returns no runs when every word is above the threshold", () => {
    const words = [w("hello", 0.95), w("world", 0.92)];
    expect(findLowConfidenceRuns(words, 0.6)).toEqual([]);
  });

  it("returns no runs when confidence is unknown (null)", () => {
    const words = [w("hello", null), w("world", null)];
    expect(findLowConfidenceRuns(words, 0.6)).toEqual([]);
  });

  it("groups contiguous low-confidence words into a single run", () => {
    const words = [
      w("open", 0.95),
      w("the", 0.4),
      w("Anthropic", 0.3),
      w("settings", 0.92),
    ];
    const runs = findLowConfidenceRuns(words, 0.6);
    expect(runs).toHaveLength(1);
    expect(runs[0].startIndex).toBe(1);
    expect(runs[0].endIndex).toBe(3);
    expect(runs[0].text).toBe("the Anthropic");
    expect(runs[0].meanConfidence).toBeCloseTo(0.35);
  });

  it("breaks runs longer than maxRunLength into separate spans", () => {
    const words = Array.from({ length: 10 }, (_, i) => w(`x${i}`, 0.3));
    const runs = findLowConfidenceRuns(words, 0.6, 4);
    expect(runs.length).toBe(3); // 4 + 4 + 2
    expect(runs[0].endIndex - runs[0].startIndex).toBe(4);
    expect(runs[2].endIndex - runs[2].startIndex).toBe(2);
  });

  it("does not lump high-confidence words into surrounding low runs", () => {
    const words = [w("a", 0.4), w("b", 0.95), w("c", 0.4)];
    const runs = findLowConfidenceRuns(words, 0.6);
    expect(runs).toHaveLength(2);
    expect(runs[0].text).toBe("a");
    expect(runs[1].text).toBe("c");
  });
});

describe("spliceSecondaryReadings", () => {
  it("returns the primary text unchanged when there are no runs", () => {
    const primary = [w("hello", 0.9), w("world", 0.9)];
    expect(spliceSecondaryReadings(primary, [], {})).toBe("hello world");
  });

  it("replaces a run with its secondary reading when one is provided", () => {
    const primary = [w("open", 0.95), w("antropic", 0.4), w("settings", 0.92)];
    const runs = findLowConfidenceRuns(primary, 0.6);
    const secondary = { 0: "Anthropic" };
    expect(spliceSecondaryReadings(primary, runs, secondary)).toBe("open Anthropic settings");
  });

  it("keeps the primary text for runs without a secondary reading", () => {
    const primary = [w("open", 0.95), w("antropic", 0.4), w("settings", 0.92)];
    const runs = findLowConfidenceRuns(primary, 0.6);
    expect(spliceSecondaryReadings(primary, runs, {})).toBe("open antropic settings");
  });

  it("handles a low-confidence run at the very start of the utterance", () => {
    const primary = [w("antropic", 0.4), w("docs", 0.95)];
    const runs = findLowConfidenceRuns(primary, 0.6);
    expect(spliceSecondaryReadings(primary, runs, { 0: "Anthropic" })).toBe("Anthropic docs");
  });

  it("handles a low-confidence run at the very end of the utterance", () => {
    const primary = [w("open", 0.95), w("antropic", 0.4)];
    const runs = findLowConfidenceRuns(primary, 0.6);
    expect(spliceSecondaryReadings(primary, runs, { 0: "Anthropic" })).toBe("open Anthropic");
  });
});
