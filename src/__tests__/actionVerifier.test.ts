import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyAction } from "../lib/actionVerifier";

const CALL_ID = "test-verify-id";

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, Array<(event: { payload: string }) => void>>();
  const invoke = vi.fn();
  const listen = vi.fn((name: string, cb: (event: { payload: string }) => void) => {
    const list = handlers.get(name) ?? [];
    list.push(cb);
    handlers.set(name, list);
    return Promise.resolve(() => {
      handlers.set(name, (handlers.get(name) ?? []).filter((h) => h !== cb));
    });
  });
  return { handlers, invoke, listen };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));

function fire(name: string, payload = "") {
  for (const cb of mocks.handlers.get(name) ?? []) {
    cb({ payload });
  }
}

beforeEach(() => {
  mocks.handlers.clear();
  mocks.invoke.mockReset();
  mocks.listen.mockClear();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(
    CALL_ID as `${string}-${string}-${string}-${string}-${string}`
  );
});

describe("verifyAction", () => {
  it("resolves success:true when Claude confirms the action succeeded", async () => {
    mocks.invoke.mockImplementation(() => {
      queueMicrotask(() => {
        fire(`chat-chunk-${CALL_ID}`, '{"success":true,"explanation":"button clicked"}');
        fire(`chat-done-${CALL_ID}`);
      });
      return Promise.resolve();
    });
    const result = await verifyAction("b64before", "b64after", "click OK button");
    expect(result).toEqual({ success: true, explanation: "button clicked" });
  });

  it("resolves success:false when Claude says action did not succeed", async () => {
    mocks.invoke.mockImplementation(() => {
      queueMicrotask(() => {
        fire(`chat-chunk-${CALL_ID}`, '{"success":false,"explanation":"no change detected"}');
        fire(`chat-done-${CALL_ID}`);
      });
      return Promise.resolve();
    });
    const result = await verifyAction("b64before", "b64after", "click OK button");
    expect(result).toEqual({ success: false, explanation: "no change detected" });
  });

  it("resolves parse error when done fires with non-JSON text", async () => {
    mocks.invoke.mockImplementation(() => {
      queueMicrotask(() => {
        fire(`chat-chunk-${CALL_ID}`, "not valid json at all");
        fire(`chat-done-${CALL_ID}`);
      });
      return Promise.resolve();
    });
    const result = await verifyAction("b64before", "b64after", "click OK button");
    expect(result).toEqual({ success: false, explanation: "Verification parse error" });
  });

  it("resolves unavailable when chat-error event fires", async () => {
    mocks.invoke.mockImplementation(() => {
      queueMicrotask(() => {
        fire(`chat-error-${CALL_ID}`);
      });
      return Promise.resolve();
    });
    const result = await verifyAction("b64before", "b64after", "click OK button");
    expect(result).toEqual({ success: false, explanation: "Verification unavailable" });
  });

  it("resolves invoke error when invoke() rejects", async () => {
    mocks.invoke.mockRejectedValue(new Error("stream_claude invoke failed"));
    const result = await verifyAction("b64before", "b64after", "click OK button");
    expect(result).toEqual({ success: false, explanation: "Verification invoke error" });
  });
});
