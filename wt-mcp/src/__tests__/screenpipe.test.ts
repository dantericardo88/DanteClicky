import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock global fetch before importing screenpipe (which uses it via fetchWithTimeout).
(globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch = vi.fn();

import { isScreenpipeRunning, queryScreenMemory, assembleRichContext } from "../lib/screenpipe";

// Helper to cast mock cleanly
const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("isScreenpipeRunning", () => {
  it("returns false when fetch throws a network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    expect(await isScreenpipeRunning()).toBe(false);
  });

  it("returns false when fetch is aborted (simulated timeout)", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    mockFetch.mockRejectedValueOnce(abortError);
    expect(await isScreenpipeRunning()).toBe(false);
  });

  it("returns false when response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false } as Response);
    expect(await isScreenpipeRunning()).toBe(false);
  });

  it("returns true when response is ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true } as Response);
    expect(await isScreenpipeRunning()).toBe(true);
  });
});

describe("queryScreenMemory", () => {
  it("returns null when Screenpipe is unavailable (fetch throws)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const result = await queryScreenMemory("test query");
    expect(result).toBeNull();
  });

  it("returns null when response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false } as Response);
    const result = await queryScreenMemory("test query");
    expect(result).toBeNull();
  });

  it("returns parsed frames and audio when Screenpipe returns valid data", async () => {
    const fakePayload = {
      frames: [{ timestamp: "2025-01-01", text: "Hello world", app_name: "VSCode" }],
      audio: [{ timestamp: "2025-01-01", transcription: "hello" }],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => fakePayload,
    } as Response);
    const result = await queryScreenMemory("test");
    expect(result).not.toBeNull();
    expect(result!.frames).toHaveLength(1);
    expect(result!.frames[0].text).toBe("Hello world");
    expect(result!.audio).toHaveLength(1);
  });

  it("normalises the data envelope when Screenpipe wraps in { data: ... }", async () => {
    const fakePayload = {
      data: {
        frames: [{ timestamp: "2025-01-01", text: "Wrapped frame" }],
        audio: [],
      },
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => fakePayload,
    } as Response);
    const result = await queryScreenMemory("test");
    expect(result).not.toBeNull();
    expect(result!.frames[0].text).toBe("Wrapped frame");
  });
});

describe("assembleRichContext", () => {
  it("returns empty string when Screenpipe is unavailable", async () => {
    mockFetch.mockRejectedValueOnce(new Error("Network error"));
    const ctx = await assembleRichContext("user query", []);
    expect(ctx).toBe("");
  });

  it("returns empty string when query returns null (non-ok response)", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false } as Response);
    const ctx = await assembleRichContext("user query", []);
    expect(ctx).toBe("");
  });

  it("includes frame text in context when Screenpipe has data", async () => {
    const fakePayload = {
      frames: [{ timestamp: "2025-01-01", text: "  VS Code editor  ", app_name: "Code" }],
      audio: [],
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => fakePayload,
    } as Response);
    const ctx = await assembleRichContext("editor", []);
    expect(ctx).toContain("VS Code editor");
    expect(ctx).toContain("Code");
  });

  it("mentions monitor count when screens are provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ frames: [], audio: [] }),
    } as Response);
    const ctx = await assembleRichContext("query", ["base64screen1", "base64screen2"]);
    expect(ctx).toContain("2 monitor(s)");
  });

  it("returns empty string when both Screenpipe and screens are absent", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ frames: [], audio: [] }),
    } as Response);
    const ctx = await assembleRichContext("query", []);
    expect(ctx).toBe("");
  });
});
