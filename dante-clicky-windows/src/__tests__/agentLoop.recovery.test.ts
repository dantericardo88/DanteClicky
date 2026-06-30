import { describe, it, expect } from "vitest";
import { buildLoopContinuationPrompt, buildVerificationResultText } from "../lib/agentLoop";
import type { ResolvedAgentAction } from "../lib/agentLoop";

function makeAction(): ResolvedAgentAction {
  return {
    id: "a1",
    sequence: 1,
    kind: "click",
    label: "Submit button",
    screenLabel: "screen1",
    normalizedX: 512,
    normalizedY: 512,
    sourceText: "",
    absoluteX: 512,
    absoluteY: 512,
    screen: null,
  };
}

const BASE = { originalTask: "submit the form", stepNumber: 1, maxSteps: 8 };

describe("buildLoopContinuationPrompt — failure recovery signal", () => {
  it("failure path: contains 'failed' not 'may have failed'", () => {
    const prompt = buildLoopContinuationPrompt({
      ...BASE,
      action: makeAction(),
      verification: { success: false, explanation: "button state unchanged" },
    });
    expect(prompt).toContain("failed");
    expect(prompt).not.toContain("may have failed");
    expect(prompt).not.toContain("thinks");
  });

  it("failure path: includes the verification explanation verbatim", () => {
    const prompt = buildLoopContinuationPrompt({
      ...BASE,
      action: makeAction(),
      verification: { success: false, explanation: "dropdown did not open" },
    });
    expect(prompt).toContain("dropdown did not open");
  });

  it("failure path: contains explicit 'do not repeat this action' directive", () => {
    const prompt = buildLoopContinuationPrompt({
      ...BASE,
      action: makeAction(),
      verification: { success: false, explanation: "no change" },
    });
    expect(prompt).toContain("do not repeat this action");
  });

  it("failure path: contains 'different approach' instruction", () => {
    const prompt = buildLoopContinuationPrompt({
      ...BASE,
      action: makeAction(),
      verification: { success: false, explanation: "no change" },
    });
    expect(prompt).toContain("different approach");
  });

  it("success path: does NOT contain replan directive", () => {
    const prompt = buildLoopContinuationPrompt({
      ...BASE,
      action: makeAction(),
      verification: { success: true, explanation: "button clicked" },
    });
    expect(prompt).not.toContain("do not repeat this action");
    expect(prompt).not.toContain("different approach");
  });

  it("success path: contains positive verification signal", () => {
    const prompt = buildLoopContinuationPrompt({
      ...BASE,
      action: makeAction(),
      verification: { success: true, explanation: "form submitted" },
    });
    expect(prompt).toContain("succeeded");
    expect(prompt).toContain("form submitted");
  });
});

describe("buildVerificationResultText — native CU tool result text", () => {
  it("success: formats as 'description: explanation'", () => {
    const text = buildVerificationResultText("click Submit", {
      success: true,
      explanation: "button depressed visually",
    });
    expect(text).toBe("click Submit: button depressed visually");
    expect(text).not.toContain("failed");
  });

  it("failure: includes 'failed' directive and 'do not repeat'", () => {
    const text = buildVerificationResultText("click Submit", {
      success: false,
      explanation: "nothing changed on screen",
    });
    expect(text).toContain("the action failed");
    expect(text).toContain("nothing changed on screen");
    expect(text).toContain("do not repeat this action");
    expect(text).toContain("different approach");
  });

  it("failure: does not produce a plain 'description: explanation' format", () => {
    const text = buildVerificationResultText("type password", {
      success: false,
      explanation: "field not focused",
    });
    expect(text).not.toBe("type password: field not focused");
  });
});
