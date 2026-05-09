import { describe, expect, it } from "vitest";
import {
  buildLoopContinuationPrompt,
  classifyAgentActionSafety,
  describeAgentAction,
  extractAgentActions,
  hasExecutableAction,
  resolveAgentAction,
  type AgentAction,
} from "../lib/agentLoop";
import type { CapturedScreen } from "../hooks/useScreenCapture";

const PRIMARY_SCREEN: CapturedScreen = {
  label: "screen1",
  data: "primary",
  mime: "image/jpeg",
  width: 1920,
  height: 1080,
  x: 0,
  y: 0,
  scale_factor: 1,
  is_primary: true,
};

const SECONDARY_SCREEN: CapturedScreen = {
  label: "screen2",
  data: "secondary",
  mime: "image/jpeg",
  width: 1280,
  height: 720,
  x: 1920,
  y: 120,
  scale_factor: 1,
  is_primary: false,
};

describe("extractAgentActions", () => {
  it("turns response tags into executable action groups", () => {
    const actions = extractAgentActions(
      'Open search [POINT:120,240:search:screen1] [TYPE:"weather"] then scroll [POINT:500,900:list:screen1] [SCROLL:-3]'
    );

    expect(actions).toMatchObject([
      { kind: "type", label: "search", text: "weather", screenLabel: "screen1" },
      { kind: "scroll", label: "list", scrollDelta: -3, screenLabel: "screen1" },
    ]);
  });

  it("treats no-action as a terminal non-executable action", () => {
    const actions = extractAgentActions(
      "done [POINT:none:none:screen1] [POINT:500,500:should not happen:screen1]"
    );

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "none", screenLabel: "screen1" });
    expect(hasExecutableAction(actions)).toBe(false);
  });
});

describe("resolveAgentAction", () => {
  it("uses the requested screen label and includes monitor offsets", () => {
    const [action] = extractAgentActions("[POINT:512,512:center:screen2]");
    const resolved = resolveAgentAction(action, [PRIMARY_SCREEN, SECONDARY_SCREEN]);

    expect(resolved.absoluteX).toBe(1920 + 640);
    expect(resolved.absoluteY).toBe(120 + 360);
    expect(resolved.screen?.label).toBe("screen2");
  });

  it("clamps normalized coordinates before converting to pixels", () => {
    const action: AgentAction = {
      id: "a",
      sequence: 1,
      kind: "click",
      label: "outside",
      screenLabel: "screen1",
      normalizedX: 2048,
      normalizedY: -20,
      sourceText: "",
    };

    const resolved = resolveAgentAction(action, [PRIMARY_SCREEN]);
    expect(resolved.absoluteX).toBe(1920);
    expect(resolved.absoluteY).toBe(0);
  });
});

describe("classifyAgentActionSafety", () => {
  it("allows ordinary navigation clicks", () => {
    const [action] = extractAgentActions("[POINT:100,100:settings tab:screen1]");

    expect(classifyAgentActionSafety(action, "open settings", "")).toMatchObject({
      decision: "allow",
      tier: 1,
    });
  });

  it("requires confirmation for destructive or sensitive actions", () => {
    const [action] = extractAgentActions('[POINT:800,800:delete account:screen1] [TYPE:"confirm delete"]');

    expect(classifyAgentActionSafety(action, "delete my account", "")).toMatchObject({
      decision: "needs_confirmation",
      tier: 3,
    });
  });

  it("uses screen context to pause high-impact UI actions even when the prompt is benign", () => {
    const [action] = extractAgentActions("[POINT:800,800:focused button:screen1]");

    expect(
      classifyAgentActionSafety(action, "continue", "", {
        screenContext: 'button "Submit payment" -> [POINT:800,800:Submit payment:screen1]',
      })
    ).toMatchObject({
      decision: "needs_confirmation",
      tier: 3,
    });
  });

  it("requires confirmation for high-risk keypresses on dangerous screens", () => {
    const action: AgentAction = {
      id: "enter",
      sequence: 1,
      kind: "key",
      label: "keyboard",
      screenLabel: "screen1",
      normalizedX: null,
      normalizedY: null,
      key: "Enter",
      sourceText: "",
    };

    expect(
      classifyAgentActionSafety(action, "continue", "", {
        screenContext: 'dialog "Delete account permanently"',
      })
    ).toMatchObject({
      decision: "needs_confirmation",
      tier: 3,
    });
  });
});

describe("loop continuation prompts", () => {
  it("feeds verification back into the next decision", () => {
    const [action] = extractAgentActions("[POINT:100,100:submit:screen1]");
    const resolved = resolveAgentAction(action, [PRIMARY_SCREEN]);
    const prompt = buildLoopContinuationPrompt({
      originalTask: "submit the form",
      stepNumber: 2,
      maxSteps: 10,
      action: resolved,
      verification: { success: false, explanation: "button stayed disabled" },
    });

    expect(prompt).toContain("step 2 of 10");
    expect(prompt).toContain("failed");
    expect(prompt).toContain("button stayed disabled");
    expect(describeAgentAction(action)).toBe("click submit");
  });
});
