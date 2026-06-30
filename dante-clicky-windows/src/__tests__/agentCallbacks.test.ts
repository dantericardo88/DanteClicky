import { describe, expect, it } from "vitest";
import {
  AgentCallbackChain,
  accumulateUsage,
  createAgentRunContext,
  type AgentCallbackHandler,
  type AgentRunContext,
} from "../lib/agentCallbacks";

describe("AgentCallbackChain", () => {
  it("dispatches events to all registered handlers in registration order", async () => {
    const events: string[] = [];
    const a: AgentCallbackHandler = {
      name: "a",
      async onRunStart() {
        events.push("a");
      },
    };
    const b: AgentCallbackHandler = {
      name: "b",
      async onRunStart() {
        events.push("b");
      },
    };
    const chain = new AgentCallbackChain().register(a).register(b);
    const ctx = createAgentRunContext({ provider: "openai" });
    await chain.dispatch("onRunStart", ctx);
    expect(events).toEqual(["a", "b"]);
  });

  it("isolates handler errors via onHandlerError without breaking the chain", async () => {
    const errors: Array<{ name: string; event: string }> = [];
    const chain = new AgentCallbackChain({
      onHandlerError(handler, event) {
        errors.push({ name: handler.name, event });
      },
    });

    let calledB = false;
    const a: AgentCallbackHandler = {
      name: "a",
      async onRunStart() {
        throw new Error("boom");
      },
    };
    const b: AgentCallbackHandler = {
      name: "b",
      async onRunStart() {
        calledB = true;
      },
    };
    chain.register(a).register(b);
    const ctx = createAgentRunContext({ provider: "openai" });
    await chain.dispatch("onRunStart", ctx);
    expect(calledB).toBe(true);
    expect(errors).toEqual([{ name: "a", event: "onRunStart" }]);
  });

  it("skips handlers that don't implement the event", async () => {
    const chain = new AgentCallbackChain().register({ name: "noop" });
    const ctx = createAgentRunContext({ provider: "claude" });
    await expect(chain.dispatch("onRunStart", ctx)).resolves.toBeUndefined();
  });

  it("supports unregistering handlers", () => {
    const chain = new AgentCallbackChain();
    const handler: AgentCallbackHandler = { name: "h" };
    chain.register(handler);
    expect(chain.list()).toHaveLength(1);
    expect(chain.unregister(handler)).toBe(true);
    expect(chain.list()).toHaveLength(0);
    expect(chain.unregister(handler)).toBe(false);
  });

  it("createAgentRunContext returns a unique runId per call", () => {
    const a = createAgentRunContext({ provider: "openai" });
    const b = createAgentRunContext({ provider: "openai" });
    expect(a.runId).not.toEqual(b.runId);
    expect(a.totalCostUsd).toBe(0);
    expect(a.actionCount).toBe(0);
  });

  it("accumulateUsage sums tokens and cost into the context", () => {
    const ctx: AgentRunContext = createAgentRunContext({ provider: "openai" });
    accumulateUsage(ctx, { inputTokens: 100, outputTokens: 50, responseCostUsd: 0.01 });
    accumulateUsage(ctx, { inputTokens: 200, outputTokens: 75, responseCostUsd: 0.02 });
    expect(ctx.tokensIn).toBe(300);
    expect(ctx.tokensOut).toBe(125);
    expect(ctx.totalCostUsd).toBeCloseTo(0.03, 5);
  });

  it("accumulateUsage tolerates missing fields", () => {
    const ctx = createAgentRunContext({ provider: "claude" });
    accumulateUsage(ctx, {});
    expect(ctx.tokensIn).toBe(0);
    expect(ctx.tokensOut).toBe(0);
    expect(ctx.totalCostUsd).toBe(0);
  });

  it("dispatches every defined hook without throwing on a fully implemented handler", async () => {
    const calls: string[] = [];
    const handler: AgentCallbackHandler = {
      name: "full",
      onRunStart: () => void calls.push("onRunStart"),
      onRunEnd: () => void calls.push("onRunEnd"),
      onComputerCallStart: () => void calls.push("onComputerCallStart"),
      onComputerCallEnd: () => void calls.push("onComputerCallEnd"),
      onSafetyDecision: () => void calls.push("onSafetyDecision"),
      onScreenshot: () => void calls.push("onScreenshot"),
      onApiStart: () => void calls.push("onApiStart"),
      onApiEnd: () => void calls.push("onApiEnd"),
      onUsage: () => void calls.push("onUsage"),
      onText: () => void calls.push("onText"),
      onFunctionCallStart: () => void calls.push("onFunctionCallStart"),
      onFunctionCallEnd: () => void calls.push("onFunctionCallEnd"),
    };
    const chain = new AgentCallbackChain().register(handler);
    const ctx = createAgentRunContext({ provider: "openai" });
    await chain.dispatch("onRunStart", ctx);
    await chain.dispatch("onRunEnd", ctx, { status: "complete", stepsTaken: 0 });
    await chain.dispatch("onText", ctx, "hello");
    await chain.dispatch("onUsage", ctx, { inputTokens: 1, outputTokens: 1 });
    expect(calls).toEqual(["onRunStart", "onRunEnd", "onText", "onUsage"]);
  });
});
