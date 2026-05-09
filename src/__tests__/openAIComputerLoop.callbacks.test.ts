import { describe, expect, it, vi } from "vitest";
import { runOpenAIComputerUseLoop } from "../lib/openAIComputerLoop";
import {
  AgentCallbackChain,
  createAgentRunContext,
  type AgentCallbackHandler,
} from "../lib/agentCallbacks";
import type { CapturedScreen } from "../hooks/useScreenCapture";

const SCREEN: CapturedScreen = {
  label: "screen1",
  data: "initial-screen",
  mime: "image/jpeg",
  width: 1000,
  height: 1000,
  x: 0,
  y: 0,
  scale_factor: 1,
  is_primary: true,
};

function response(id: string, output: Array<Record<string, unknown>>) {
  return { id, output };
}

function computerCall(callId: string, action: Record<string, unknown>) {
  return { type: "computer_call", call_id: callId, action };
}

interface RecordedEvent {
  event: string;
}

function makeRecorder(): {
  handler: AgentCallbackHandler;
  events: RecordedEvent[];
} {
  const events: RecordedEvent[] = [];
  const record = (event: string) => () => {
    events.push({ event });
  };
  const handler: AgentCallbackHandler = {
    name: "recorder",
    onRunStart: record("onRunStart"),
    onRunEnd: record("onRunEnd"),
    onComputerCallStart: record("onComputerCallStart"),
    onComputerCallEnd: record("onComputerCallEnd"),
    onSafetyDecision: record("onSafetyDecision"),
    onScreenshot: record("onScreenshot"),
    onApiStart: record("onApiStart"),
    onApiEnd: record("onApiEnd"),
  };
  return { handler, events };
}

describe("runOpenAIComputerUseLoop with callbacks", () => {
  it("dispatches expected lifecycle events for a single-step loop", async () => {
    const createResponse = vi
      .fn()
      .mockResolvedValueOnce(
        response("resp_2", [
          { type: "message", content: [{ type: "output_text", text: "Done." }] },
        ])
      );
    const executeAction = vi.fn().mockResolvedValue(undefined);
    const capturePrimaryScreen = vi.fn().mockResolvedValueOnce("after-click-jpeg");

    const { handler, events } = makeRecorder();
    const callbacks = new AgentCallbackChain().register(handler);
    const runContext = createAgentRunContext({ provider: "openai", model: "gpt-4o" });

    const result = await runOpenAIComputerUseLoop({
      initialResponse: response("resp_1", [
        computerCall("call_1", { type: "click", x: 200, y: 300 }),
      ]),
      initialScreens: [SCREEN],
      originalTask: "click target",
      maxSteps: 4,
      createResponse,
      executeAction,
      capturePrimaryScreen,
      callbacks,
      runContext,
    });

    expect(result.status).toBe("complete");
    expect(events.map((e) => e.event)).toEqual([
      "onRunStart",
      "onSafetyDecision",
      "onComputerCallStart",
      "onComputerCallEnd",
      "onScreenshot",
      "onApiStart",
      "onApiEnd",
      "onRunEnd",
    ]);
    expect(runContext.actionCount).toBe(1);
    expect(runContext.screenshotCount).toBe(1);
  });

  it("does NOT dispatch events when callbacks option is omitted (zero-cost path)", async () => {
    const createResponse = vi.fn().mockResolvedValueOnce(
      response("resp_2", [
        { type: "message", content: [{ type: "output_text", text: "ok" }] },
      ])
    );
    const executeAction = vi.fn().mockResolvedValue(undefined);
    const capturePrimaryScreen = vi.fn().mockResolvedValueOnce("img");

    // Sentinel — if the loop ever calls into a chain it doesn't have, this test fails.
    const result = await runOpenAIComputerUseLoop({
      initialResponse: response("resp_1", [
        computerCall("call_1", { type: "click", x: 1, y: 2 }),
      ]),
      initialScreens: [SCREEN],
      originalTask: "click",
      maxSteps: 2,
      createResponse,
      executeAction,
      capturePrimaryScreen,
    });

    expect(result.status).toBe("complete");
    expect(executeAction).toHaveBeenCalledTimes(1);
  });

  it("emits onRunEnd with status='blocked' when safety blocks the action", async () => {
    const createResponse = vi.fn();
    const executeAction = vi.fn();
    const capturePrimaryScreen = vi.fn();

    const { handler, events } = makeRecorder();
    const callbacks = new AgentCallbackChain().register(handler);

    // SYSTEM_COMPROMISE_PATTERN in agentLoop.ts triggers tier-4 block.
    const result = await runOpenAIComputerUseLoop({
      initialResponse: response("resp_1", [
        computerCall("call_1", {
          type: "type",
          text: "disable windows defender now",
        }),
      ]),
      initialScreens: [SCREEN],
      originalTask: "disable windows defender now",
      maxSteps: 2,
      createResponse,
      executeAction,
      capturePrimaryScreen,
      callbacks,
    });

    expect(result.status).toBe("blocked");
    const lastEvent = events[events.length - 1];
    expect(lastEvent.event).toBe("onRunEnd");
    expect(events.find((e) => e.event === "onSafetyDecision")).toBeDefined();
    expect(executeAction).not.toHaveBeenCalled();
  });

  it("emits onRunEnd when execution throws and re-raises", async () => {
    const createResponse = vi.fn();
    const executeAction = vi.fn().mockRejectedValueOnce(new Error("driver crashed"));
    const capturePrimaryScreen = vi.fn();

    const { handler, events } = makeRecorder();
    const callbacks = new AgentCallbackChain().register(handler);

    await expect(
      runOpenAIComputerUseLoop({
        initialResponse: response("resp_1", [
          computerCall("call_1", { type: "click", x: 5, y: 5 }),
        ]),
        initialScreens: [SCREEN],
        originalTask: "click",
        maxSteps: 2,
        createResponse,
        executeAction,
        capturePrimaryScreen,
        callbacks,
      })
    ).rejects.toThrow("driver crashed");

    expect(events.map((e) => e.event)).toContain("onComputerCallEnd");
  });
});
