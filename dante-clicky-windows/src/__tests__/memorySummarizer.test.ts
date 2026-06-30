import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ConversationTurn } from "../state/companionStore";

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, Array<(event: { payload: string }) => void>>();
  const invoke = vi.fn();
  const listen = vi.fn((name: string, cb: (event: { payload: string }) => void) => {
    const list = handlers.get(name) ?? [];
    list.push(cb);
    handlers.set(name, list);
    return Promise.resolve(() => {
      handlers.set(name, (handlers.get(name) ?? []).filter((handler) => handler !== cb));
    });
  });
  return { handlers, invoke, listen };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

import { compressSummary, summarizeOldTurns } from "../lib/memorySummarizer";

const CALL_ID = "00000000-0000-4000-8000-000000000000";

function fire(name: string, payload = "") {
  for (const cb of mocks.handlers.get(name) ?? []) {
    cb({ payload });
  }
}

function sampleTurns(): ConversationTurn[] {
  return [
    {
      userPrompt: "Open Notepad and save C:/Projects/demo.txt",
      assistantResponse: "I opened Notepad and typed the draft.",
    },
    {
      userPrompt: "Do not delete anything.",
      assistantResponse: "I paused before a destructive action and kept the file.",
    },
  ];
}

describe("memorySummarizer", () => {
  beforeEach(() => {
    vi.useRealTimers();
    mocks.handlers.clear();
    mocks.invoke.mockReset();
    mocks.listen.mockClear();
    vi.spyOn(crypto, "randomUUID").mockReturnValue(CALL_ID);
  });

  it("returns deterministic fallback without registering streams when no provider key exists", async () => {
    const result = await summarizeOldTurns(sampleTurns(), {
      provider: "openai",
      modelId: "gpt-4o",
    });

    expect(result).toContain("Earlier conversation summary");
    expect(result).toContain("Notepad");
    expect(mocks.invoke).not.toHaveBeenCalled();
    expect(mocks.listen).not.toHaveBeenCalled();
  });

  it("returns empty text for empty turn input", async () => {
    await expect(
      summarizeOldTurns([], {
        provider: "claude",
        modelId: "claude-sonnet-4-6",
        anthropicKey: "key",
      })
    ).resolves.toBe("");
  });

  it("streams Claude Haiku summary chunks and cleans listeners on done", async () => {
    mocks.invoke.mockImplementation(() => {
      queueMicrotask(() => {
        fire(`chat-chunk-${CALL_ID}`, " summary");
        fire(`chat-chunk-${CALL_ID}`, " text ");
        fire(`chat-done-${CALL_ID}`);
      });
      return Promise.resolve();
    });

    const result = await summarizeOldTurns(sampleTurns(), {
      provider: "openai",
      modelId: "gpt-4o",
      anthropicKey: "anthropic",
      openaiKey: "openai",
    });

    expect(result).toBe("summary text");
    expect(mocks.invoke).toHaveBeenCalledWith("stream_claude", {
      callId: CALL_ID,
      body: expect.objectContaining({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 256,
        system: expect.stringContaining("unresolved blockers"),
        messages: [
          expect.objectContaining({
            content: expect.stringContaining("Do not omit actions"),
          }),
        ],
      }),
    });
    expect(mocks.handlers.get(`chat-done-${CALL_ID}`)).toHaveLength(0);
  });

  it("returns fallback and cleans up on stream errors", async () => {
    mocks.invoke.mockImplementation(() => {
      queueMicrotask(() => fire(`chat-error-${CALL_ID}`, "boom"));
      return Promise.resolve();
    });

    const result = await summarizeOldTurns(sampleTurns(), {
      provider: "claude",
      modelId: "claude-sonnet-4-6",
      anthropicKey: "key",
    });

    expect(result).toContain("Earlier conversation summary");
    expect(mocks.handlers.get(`chat-error-${CALL_ID}`)).toHaveLength(0);
  });

  it("returns fallback when invoke rejects", async () => {
    mocks.invoke.mockRejectedValue(new Error("network"));

    const result = await summarizeOldTurns(sampleTurns(), {
      provider: "claude",
      modelId: "claude-sonnet-4-6",
      anthropicKey: "key",
    });

    expect(result).toContain("Earlier conversation summary");
  });

  it("returns fallback and cleans up when a summary stream stalls", async () => {
    vi.useFakeTimers();
    mocks.invoke.mockResolvedValue(undefined);

    const result = summarizeOldTurns(sampleTurns(), {
      provider: "claude",
      modelId: "claude-sonnet-4-6",
      anthropicKey: "key",
      summaryTimeoutMs: 5,
    });

    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(6);

    await expect(result).resolves.toContain("Earlier conversation summary");
    expect(mocks.handlers.get(`chat-chunk-${CALL_ID}`)).toHaveLength(0);
    expect(mocks.handlers.get(`chat-done-${CALL_ID}`)).toHaveLength(0);
    expect(mocks.handlers.get(`chat-error-${CALL_ID}`)).toHaveLength(0);
  });

  it("uses OpenAI-compatible stream and max token override for non-Claude compression", async () => {
    mocks.invoke.mockImplementation(() => {
      queueMicrotask(() => {
        fire(`chat-chunk-${CALL_ID}`, "compressed");
        fire(`chat-done-${CALL_ID}`);
      });
      return Promise.resolve();
    });

    const result = await compressSummary("long ".repeat(300), {
      provider: "openai",
      modelId: "gpt-4o",
      openaiKey: "key",
      maxTokens: 123,
    });

    expect(result).toBe("compressed");
    expect(mocks.invoke).toHaveBeenCalledWith("stream_openai_compat", {
      baseUrl: "https://api.openai.com/v1",
      provider: "openai",
      callId: CALL_ID,
      body: expect.objectContaining({
        model: "gpt-4o",
        max_tokens: 123,
      }),
    });
  });
});
