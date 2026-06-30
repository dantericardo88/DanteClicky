import { beforeEach, describe, expect, it, vi } from "vitest";

const handlers = new Map<string, Array<(event: { payload: unknown }) => void>>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((eventName: string, callback: (event: { payload: unknown }) => void) => {
    const list = handlers.get(eventName) ?? [];
    list.push(callback);
    handlers.set(eventName, list);
    return Promise.resolve(() => {
      handlers.set(
        eventName,
        (handlers.get(eventName) ?? []).filter((fn) => fn !== callback)
      );
    });
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn((command: string) => {
    if (command === "stream_openai_compat" || command === "stream_claude") {
      queueMicrotask(() => {
        fire("chat-chunk-", "hello");
        fire("chat-stop-reason-", "end_turn");
        fire("chat-done-", "");
      });
      return Promise.resolve();
    }
    return Promise.resolve({});
  }),
}));

import { getTelemetrySnapshot, resetTelemetryForTests, startTelemetrySpan } from "../lib/telemetry";
import { streamChat } from "../providers/chat";

beforeEach(() => {
  handlers.clear();
  resetTelemetryForTests();
});

describe("chat provider telemetry", () => {
  it("records provider metadata without prompt text or images", async () => {
    const root = startTelemetrySpan("voice.turn", { provider: "openai" });

    await streamChat({
      provider: "openai",
      modelId: "gpt-4o",
      systemPrompt: "secret system prompt",
      messages: [{ role: "user", content: "private user request" }],
      images: ["base64-private-image"],
      onChunk: () => {},
      telemetryContext: root.context,
    });

    const snapshot = getTelemetrySnapshot();
    const serialized = JSON.stringify(snapshot);
    const modelSpan = snapshot.spans.find((span) => span.name === "model.stream");
    const completedEvent = snapshot.events.find((event) => event.name === "model.stream.completed");

    expect(snapshot.events.some((event) => event.name === "model.stream.completed")).toBe(true);
    expect(snapshot.spans.some((span) => span.name === "model.stream")).toBe(true);
    expect(modelSpan?.traceId).toBe(root.context.traceId);
    expect(modelSpan?.parentSpanId).toBe(root.context.spanId);
    expect(completedEvent?.traceId).toBe(root.context.traceId);
    expect(serialized).toContain("gpt-4o");
    expect(serialized).not.toContain("secret system prompt");
    expect(serialized).not.toContain("private user request");
    expect(serialized).not.toContain("base64-private-image");
  });
});

function fire(prefix: string, payload: unknown) {
  for (const [eventName, callbacks] of handlers) {
    if (eventName.startsWith(prefix)) {
      callbacks.forEach((callback) => callback({ payload }));
    }
  }
}
