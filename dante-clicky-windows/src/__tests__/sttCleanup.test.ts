import { describe, expect, it, vi, beforeEach } from "vitest";
import { __test, cleanupTranscript, selectCleanupModel } from "../lib/sttCleanup";

const { isPlausibleLengthDelta, buildCleanupSystemPrompt, SHORT_INPUT_THRESHOLD } = __test;

vi.mock("../providers/chat", () => ({
  streamChat: vi.fn(),
}));

vi.mock("../lib/telemetry", () => ({
  startTelemetrySpan: () => ({
    context: {} as unknown,
    end: () => undefined,
    fail: () => undefined,
  }),
  recordTelemetryEvent: () => undefined,
  recordTelemetryMetric: () => undefined,
}));

import { streamChat } from "../providers/chat";

describe("sttCleanup length plausibility guard", () => {
  it("accepts equal-length output", () => {
    expect(isPlausibleLengthDelta("hello world", "Hello, world.")).toBe(true);
  });

  it("rejects empty cleanup output", () => {
    expect(isPlausibleLengthDelta("hello world", "")).toBe(false);
  });

  it("rejects bloated cleanup that adds a sentence", () => {
    const raw = "open the file";
    const polished = "Open the file. As a helpful assistant, I'll explain that this is a directive.";
    expect(isPlausibleLengthDelta(raw, polished)).toBe(false);
  });

  it("accepts mild capitalization/punctuation lengthening", () => {
    expect(isPlausibleLengthDelta("hello there", "Hello, there.")).toBe(true);
  });

  it("rejects severe shrinkage on long input (likely lost words)", () => {
    const raw = "I went to the store and bought some groceries and then I came home and put everything away".repeat(2);
    const polished = "I went home";
    expect(isPlausibleLengthDelta(raw, polished)).toBe(false);
  });
});

describe("sttCleanup system prompt", () => {
  it("includes the anti-hallucination contract verbatim", () => {
    const prompt = buildCleanupSystemPrompt({
      rawTranscript: "x",
      mode: "dictation",
      provider: "claude",
      modelId: "claude-haiku-4-5-20251001",
    });
    expect(prompt).toContain("Never add words that were not spoken");
    expect(prompt).toContain("Never invent details");
    expect(prompt).toContain("Do not translate");
  });

  it("embeds the personal dictionary when provided", () => {
    const prompt = buildCleanupSystemPrompt({
      rawTranscript: "x",
      mode: "dictation",
      provider: "claude",
      modelId: "claude-haiku-4-5-20251001",
      personalDictionary: ["Anthropic", "DanteClicky"],
    });
    expect(prompt).toContain("Personal Dictionary");
    expect(prompt).toContain("Anthropic, DanteClicky");
  });

  it("differentiates dictation vs formal polish levels", () => {
    const dictation = buildCleanupSystemPrompt({
      rawTranscript: "x",
      mode: "dictation",
      provider: "claude",
      modelId: "claude-haiku-4-5-20251001",
    });
    const formal = buildCleanupSystemPrompt({
      rawTranscript: "x",
      mode: "formal",
      provider: "claude",
      modelId: "claude-haiku-4-5-20251001",
    });
    expect(dictation).toContain("light dictation polish");
    expect(formal).toContain("formal-style polish");
  });
});

describe("cleanupTranscript orchestration", () => {
  beforeEach(() => {
    vi.mocked(streamChat).mockReset();
  });

  it("returns the input unchanged when mode is off without calling the model", async () => {
    const result = await cleanupTranscript({
      rawTranscript: "hello world",
      mode: "off",
      provider: "claude",
      modelId: "claude-haiku-4-5-20251001",
    });
    expect(result.transcript).toBe("hello world");
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("disabled");
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("skips cleanup for utterances below the short-input threshold", async () => {
    const tooShort = "ok"; // 1 word, below SHORT_INPUT_THRESHOLD
    expect(SHORT_INPUT_THRESHOLD).toBeGreaterThan(1);
    const result = await cleanupTranscript({
      rawTranscript: tooShort,
      mode: "dictation",
      provider: "claude",
      modelId: "claude-haiku-4-5-20251001",
    });
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("skipped_short");
    expect(streamChat).not.toHaveBeenCalled();
  });

  it("applies cleanup when the model returns a plausible polished output", async () => {
    vi.mocked(streamChat).mockResolvedValue("Open the file, please.");
    const result = await cleanupTranscript({
      rawTranscript: "open the file please",
      mode: "dictation",
      provider: "claude",
      modelId: "claude-haiku-4-5-20251001",
    });
    expect(result.transcript).toBe("Open the file, please.");
    expect(result.applied).toBe(true);
    expect(result.reason).toBe("applied");
  });

  it("falls back to the raw transcript when the model balloons output", async () => {
    vi.mocked(streamChat).mockResolvedValue(
      "Sure! As a helpful assistant, I am delighted to help you open the file. Here is what I will do: open the file as you requested.",
    );
    const result = await cleanupTranscript({
      rawTranscript: "open the file",
      mode: "dictation",
      provider: "claude",
      modelId: "claude-haiku-4-5-20251001",
    });
    expect(result.transcript).toBe("open the file");
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("fallback_too_divergent");
  });

  it("falls back gracefully when the model call throws", async () => {
    vi.mocked(streamChat).mockRejectedValue(new Error("network down"));
    const result = await cleanupTranscript({
      rawTranscript: "what is the weather like today",
      mode: "dictation",
      provider: "claude",
      modelId: "claude-haiku-4-5-20251001",
    });
    expect(result.transcript).toBe("what is the weather like today");
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("error");
  });
});

describe("selectCleanupModel", () => {
  it("prefers anthropic when an anthropic key is configured", () => {
    expect(selectCleanupModel({ anthropic: true, openai: true, grok: true })).toMatchObject({
      provider: "claude",
      modelId: expect.stringContaining("haiku"),
    });
  });

  it("falls back to openai when only openai is configured", () => {
    expect(selectCleanupModel({ anthropic: false, openai: true, grok: false })).toMatchObject({
      provider: "openai",
      modelId: "gpt-4o-mini",
    });
  });

  it("returns null when no provider is configured", () => {
    expect(selectCleanupModel({ anthropic: false, openai: false, grok: false })).toBeNull();
  });
});
