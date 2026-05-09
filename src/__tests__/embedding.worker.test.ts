import { vi, describe, it, expect, beforeEach } from "vitest";

const mockPipeline = vi.fn();
vi.mock("@huggingface/transformers", () => ({
  pipeline: mockPipeline,
  env: {
    allowLocalModels: false,
    useBrowserCache: true,
    backends: { onnx: { wasm: {} } },
  },
}));

describe("embedding.worker message protocol", () => {
  let messageHandler: ((e: MessageEvent) => Promise<void>) | null = null;
  let postMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    mockPipeline.mockReset();
    postMessage = vi.fn();
    messageHandler = null;

    vi.stubGlobal("self", {
      addEventListener: vi.fn((event: string, handler: (e: MessageEvent) => Promise<void>) => {
        if (event === "message") messageHandler = handler;
      }),
      postMessage,
    });

    await import("../workers/embedding.worker");
  });

  it("posts ready when load succeeds", async () => {
    mockPipeline.mockResolvedValue(vi.fn());
    await messageHandler!({ data: { type: "load" } } as MessageEvent);
    expect(mockPipeline).toHaveBeenCalledWith(
      "feature-extraction",
      "Xenova/all-MiniLM-L6-v2",
      expect.objectContaining({ dtype: "q8" })
    );
    expect(postMessage).toHaveBeenCalledWith({ type: "ready" });
  });

  it("posts error when load fails", async () => {
    mockPipeline.mockRejectedValue(new Error("WASM load failed"));
    await messageHandler!({ data: { type: "load" } } as MessageEvent);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", error: expect.stringContaining("WASM load failed") })
    );
  });

  it("posts embedding with 384-element array when embed succeeds", async () => {
    const fakeData = new Float32Array(384).fill(0.5);
    const fakeEmbedder = vi.fn().mockResolvedValue({ data: fakeData });
    mockPipeline.mockResolvedValue(fakeEmbedder);
    await messageHandler!({ data: { type: "load" } } as MessageEvent);
    postMessage.mockClear();
    await messageHandler!({ data: { type: "embed", text: "hello world", id: "42" } } as MessageEvent);
    expect(fakeEmbedder).toHaveBeenCalledWith("hello world", { pooling: "mean", normalize: true });
    const call = postMessage.mock.calls[0][0];
    expect(call.type).toBe("embedding");
    expect(call.id).toBe("42");
    expect(call.embedding).toHaveLength(384);
    expect(call.embedding[0]).toBeCloseTo(0.5, 3);
  });

  it("posts error with id when embed fails", async () => {
    const fakeEmbedder = vi.fn().mockRejectedValue(new Error("inference failed"));
    mockPipeline.mockResolvedValue(fakeEmbedder);
    await messageHandler!({ data: { type: "load" } } as MessageEvent);
    postMessage.mockClear();
    await messageHandler!({ data: { type: "embed", text: "boom", id: "7" } } as MessageEvent);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "error", id: "7" })
    );
  });

  it("ignores embed when embedder not loaded", async () => {
    await messageHandler!({ data: { type: "embed", text: "hello", id: "1" } } as MessageEvent);
    expect(postMessage).not.toHaveBeenCalled();
  });
});
