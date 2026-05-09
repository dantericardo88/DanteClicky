import { describe, expect, it } from "vitest";
import { buildKeytermsForUtterance, __test } from "../lib/voiceContext";
import { sanitizeKeyterms, ASSEMBLYAI_KEYTERMS_MAX } from "../lib/speechLanguages";

const { extractFromWindowTitle, extractIdentifiersFromText } = __test;

describe("voiceContext keyterms assembly", () => {
  it("extracts both app and document names from a separator-styled title", () => {
    const out = extractFromWindowTitle("Visual Studio Code — useVoice.ts");
    expect(out).toEqual(["Visual Studio Code", "useVoice.ts"]);
  });

  it("ignores trivially short title fragments", () => {
    const out = extractFromWindowTitle("X — Y");
    expect(out).toEqual([]);
  });

  it("pulls proper nouns and identifiers out of free text", () => {
    const out = extractIdentifiersFromText(
      "Anthropic shipped Claude Haiku 4.5 with prompt_caching support",
      20,
    );
    expect(out).toContain("Anthropic");
    expect(out).toContain("Claude");
    expect(out).toContain("Haiku");
    expect(out).toContain("prompt_caching");
  });

  it("prioritizes personal dictionary over seed vocabulary", () => {
    const personal = ["Acme Corp", "Foo Bar"];
    const result = buildKeytermsForUtterance(
      {
        personalDictionary: personal,
      },
      50,
    );
    expect(result.slice(0, 2)).toEqual(personal);
  });

  it("respects the total budget when sources overflow", () => {
    const big = Array.from({ length: 500 }, (_, i) => `Term${i}`);
    const result = buildKeytermsForUtterance(
      {
        personalDictionary: big,
      },
      30,
    );
    expect(result.length).toBe(30);
  });

  it("produces no duplicates regardless of source overlap", () => {
    const result = buildKeytermsForUtterance({
      focusedWindowTitle: "Anthropic Console",
      selectedText: "Anthropic Anthropic anthropic",
      personalDictionary: ["Anthropic"],
    });
    const lowercased = result.map((t) => t.toLowerCase());
    const uniqueCount = new Set(lowercased).size;
    expect(uniqueCount).toBe(lowercased.length);
  });
});

describe("sanitizeKeyterms (defense-in-depth at the URL boundary)", () => {
  it("returns an empty array for null/empty input", () => {
    expect(sanitizeKeyterms(null)).toEqual([]);
    expect(sanitizeKeyterms([])).toEqual([]);
    expect(sanitizeKeyterms(undefined)).toEqual([]);
  });

  it("strips whitespace-only and over-long terms", () => {
    const out = sanitizeKeyterms([
      "ok",
      "   ",
      "",
      "a".repeat(100),
      "AssemblyAI",
    ]);
    expect(out).toEqual(["ok", "AssemblyAI"]);
  });

  it("casefold-deduplicates while preserving the first occurrence's casing", () => {
    const out = sanitizeKeyterms(["Anthropic", "anthropic", "ANTHROPIC"]);
    expect(out).toEqual(["Anthropic"]);
  });

  it("respects the maximum-term-count cap", () => {
    const huge = Array.from({ length: ASSEMBLYAI_KEYTERMS_MAX + 50 }, (_, i) => `Term${i}`);
    const out = sanitizeKeyterms(huge);
    expect(out.length).toBeLessThanOrEqual(ASSEMBLYAI_KEYTERMS_MAX);
  });

  it("respects the byte-budget cap and stops before exceeding it", () => {
    const wideTerm = "X".repeat(40);
    const many = Array.from({ length: 500 }, (_, i) => `${wideTerm}_${i}`);
    const out = sanitizeKeyterms(many);
    const totalBytes = out.reduce((acc, t) => acc + new TextEncoder().encode(t).length + 1, 0);
    expect(totalBytes).toBeLessThanOrEqual(6_000);
  });
});
