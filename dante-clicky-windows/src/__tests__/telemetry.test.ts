import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTelemetryBuffer,
  configureTelemetry,
  captureTelemetryError,
  exportTelemetryJson,
  flushTelemetryRemoteQueue,
  getTelemetrySnapshot,
  recordTelemetryEvent,
  recordTelemetryMetric,
  resetTelemetryForTests,
  sanitizeTelemetryProperties,
  startTelemetrySpan,
} from "../lib/telemetry";

describe("privacy-first telemetry", () => {
  beforeEach(() => {
    resetTelemetryForTests();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps local diagnostics on by default and remote telemetry off by default", () => {
    const snapshot = getTelemetrySnapshot();

    expect(snapshot.settings.localEnabled).toBe(true);
    expect(snapshot.settings.remoteEnabled).toBe(false);
    expect(snapshot.remoteStatus).toBe("disabled");
  });

  it("redacts sensitive fields and bounds long values before storage/export", () => {
    const sanitized = sanitizeTelemetryProperties({
      apiKey: "sk-secret",
      authorization: "Bearer token",
      transcript: "read the screen",
      screenshot_b64: "a".repeat(500),
      provider: "openai",
      nested: {
        password: "hunter2",
        safe: "ok",
      },
    });

    expect(sanitized.apiKey).toBe("[redacted]");
    expect(sanitized.authorization).toBe("[redacted]");
    expect(sanitized.transcript).toBe("[redacted]");
    expect(sanitized.screenshot_b64).toBe("[redacted]");
    expect(sanitized.provider).toBe("openai");
    expect(sanitized.nested).toEqual({ password: "[redacted]", safe: "ok" });
  });

  it("records bounded local events, metrics, and spans", () => {
    configureTelemetry({ maxEvents: 2, maxSpans: 2 });

    recordTelemetryEvent("app.telemetry_configured", { localEnabled: true });
    recordTelemetryMetric("voice.first_token_ms", 120, { provider: "claude" });
    const span = startTelemetrySpan("voice.turn", { provider: "claude" });
    span.end({ stopReason: "end_turn" });
    recordTelemetryEvent("diagnostics.export_requested");
    recordTelemetryEvent("voice.turn.completed", { provider: "claude" });

    const snapshot = getTelemetrySnapshot();
    expect(snapshot.events.map((e) => e.name)).toEqual(["diagnostics.export_requested", "voice.turn.completed"]);
    expect(snapshot.metrics.voice_first_token_ms.count).toBe(1);
    expect(snapshot.metrics.voice_first_token_ms.p95).toBe(120);
    expect(snapshot.spans).toHaveLength(1);
    expect(snapshot.spans[0]).toMatchObject({
      name: "voice.turn",
      status: "ok",
      attributes: { provider: "claude", stopReason: "end_turn" },
    });
    expect(snapshot.spans[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("suppresses local and remote recording while incognito is active", () => {
    configureTelemetry({ incognito: true, remoteEnabled: true, remoteProjectKey: "phc_test" });

    recordTelemetryEvent("voice.turn.completed", { provider: "openai" });
    recordTelemetryMetric("voice.first_token_ms", 25);
    captureTelemetryError(new Error("boom"), { area: "voice" });

    const snapshot = getTelemetrySnapshot();
    expect(snapshot.events).toHaveLength(0);
    expect(snapshot.spans).toHaveLength(0);
    expect(snapshot.errors).toHaveLength(0);
    expect(snapshot.suppressedCount).toBe(3);
    expect(snapshot.remoteStatus).toBe("privacy-paused");
  });

  it("exports diagnostics without API keys or user content", () => {
    recordTelemetryEvent("model.stream.completed", {
      modelId: "gpt-4o",
      prompt: "private user text",
      openaiKey: "sk-secret",
    });
    captureTelemetryError("Invalid API key sk-secret", {
      assistantResponse: "private reply",
      route: "streamChat",
    });

    const parsed = JSON.parse(exportTelemetryJson()) as ReturnType<typeof getTelemetrySnapshot>;
    expect(JSON.stringify(parsed)).not.toContain("sk-secret");
    expect(JSON.stringify(parsed)).not.toContain("private user text");
    expect(JSON.stringify(parsed)).not.toContain("private reply");
    expect(parsed.events[0].properties.openaiKey).toBeUndefined();
    expect(parsed.events[0].properties.prompt).toBeUndefined();
    expect(parsed.errors[0].message).toContain("[redacted]");
  });

  it("clears the local diagnostics buffer", () => {
    recordTelemetryEvent("app.telemetry_configured");
    captureTelemetryError(new Error("boom"));

    clearTelemetryBuffer();

    const snapshot = getTelemetrySnapshot();
    expect(snapshot.events).toHaveLength(0);
    expect(snapshot.errors).toHaveLength(0);
    expect(snapshot.metrics).toEqual({});
  });

  it("persists only redacted local diagnostics and removes them when local telemetry is disabled", () => {
    const storage = createMemoryStorage();
    vi.stubGlobal("window", { localStorage: storage });
    resetTelemetryForTests();

    recordTelemetryEvent("model.stream.completed", {
      provider: "openai",
      prompt: "private request",
      apiKey: "sk-secret",
    });

    const raw = storage.getItem("dante-clicky.telemetry.v1");
    expect(raw).toContain("model.stream.completed");
    expect(raw).toContain("openai");
    expect(raw).not.toContain("private request");
    expect(raw).not.toContain("sk-secret");

    configureTelemetry({ localEnabled: false });
    recordTelemetryMetric("voice.first_token_ms", 25);

    expect(storage.getItem("dante-clicky.telemetry.v1")).toBeNull();
    expect(getTelemetrySnapshot().metrics).toEqual({});
  });

  it("blocks unknown names and drops unknown properties before storage or export", () => {
    const blocked = recordTelemetryEvent("not.allowed", { provider: "openai" });
    const allowed = recordTelemetryEvent("app.telemetry_configured", {
      localEnabled: true,
      remoteEnabled: false,
      harmlessButUnknown: "should not persist",
      prompt: "private request",
    });

    expect(blocked).toBeNull();
    expect(allowed?.properties).toEqual({ localEnabled: true, remoteEnabled: false });

    const snapshot = getTelemetrySnapshot();
    expect(snapshot.droppedUnknownEventCount).toBe(1);
    expect(snapshot.droppedUnknownPropertyCount).toBe(2);
    expect(JSON.stringify(snapshot)).not.toContain("should not persist");
    expect(JSON.stringify(snapshot)).not.toContain("private request");
  });

  it("correlates events, metrics, errors, and child spans with trace context", () => {
    const root = startTelemetrySpan("voice.turn", { provider: "openai" });
    const child = startTelemetrySpan("model.stream", { provider: "openai" }, root.context);

    recordTelemetryEvent("voice.stt.completed", { sttMode: "cloud" }, root.context);
    recordTelemetryMetric("voice.first_token_ms", 120, { provider: "openai" }, child.context);
    captureTelemetryError(new Error("boom"), { route: "voice.ai_pipeline" }, root.context);

    child.end({ stopReason: "end_turn" });
    root.end({ stopReason: "end_turn" });

    const snapshot = getTelemetrySnapshot();
    const sttEvent = snapshot.events.find((event) => event.name === "voice.stt.completed");
    const metric = snapshot.metricSamples.voice_first_token_ms?.[0];
    const modelSpan = snapshot.spans.find((span) => span.name === "model.stream");
    const error = snapshot.errors[0];

    expect(root.context.runtimeSessionId).toBeTruthy();
    expect(root.context.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(child.context.traceId).toBe(root.context.traceId);
    expect(child.context.parentSpanId).toBe(root.context.spanId);
    expect(sttEvent?.traceId).toBe(root.context.traceId);
    expect(metric?.traceId).toBe(root.context.traceId);
    expect(metric?.spanId).toBe(child.context.spanId);
    expect(modelSpan?.parentSpanId).toBe(root.context.spanId);
    expect(error.traceId).toBe(root.context.traceId);
  });

  it("queues remote events while PostHog is loading, flushes FIFO, and clears on opt-out", () => {
    const storage = createMemoryStorage();
    const capture = vi.fn();
    vi.stubGlobal("window", createTelemetryWindow(storage));
    vi.stubGlobal("document", createTelemetryDocument());
    resetTelemetryForTests();

    configureTelemetry({ remoteEnabled: true, remoteProjectKey: "phc_test" });
    recordTelemetryEvent("app.telemetry_configured", { localEnabled: true, remoteEnabled: true });
    recordTelemetryEvent("diagnostics.export_requested");

    expect(getTelemetrySnapshot().queuedRemoteCount).toBe(2);
    expect(capture).not.toHaveBeenCalled();

    (window as unknown as { posthog: { capture: typeof capture; opt_in_capturing: () => void } }).posthog = {
      capture,
      opt_in_capturing: vi.fn(),
    };
    flushTelemetryRemoteQueue();

    expect(capture.mock.calls.map((call) => call[0])).toEqual([
      "app.telemetry_configured",
      "diagnostics.export_requested",
    ]);
    expect(getTelemetrySnapshot().queuedRemoteCount).toBe(0);

    recordTelemetryEvent("diagnostics.export_requested");
    expect(getTelemetrySnapshot().queuedRemoteCount).toBe(0);
    configureTelemetry({ remoteEnabled: false });
    expect(getTelemetrySnapshot().queuedRemoteCount).toBe(0);
  });
});

function createMemoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(values.keys())[index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function createTelemetryWindow(storage: Storage): Window {
  return {
    localStorage: storage,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as Window;
}

function createTelemetryDocument(): Document {
  return {
    createElement: vi.fn(() => ({ async: false, crossOrigin: "", src: "", onload: null, onerror: null })),
    head: { appendChild: vi.fn() },
  } as unknown as Document;
}
