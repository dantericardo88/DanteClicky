import { describe, expect, it } from "vitest";
import {
  createPendingComputerAction,
  extractAgentActions,
  isComputerActionConfirmation,
  resolveAgentAction,
} from "../lib/agentLoop";
import type { CapturedScreen } from "../hooks/useScreenCapture";

const SCREEN: CapturedScreen = {
  label: "screen1",
  data: "screen",
  mime: "image/jpeg",
  width: 1000,
  height: 1000,
  x: 0,
  y: 0,
  scale_factor: 1,
  is_primary: true,
};

describe("pending computer action confirmation", () => {
  it("creates a resumable pending action payload from a paused action", () => {
    const [action] = extractAgentActions("[POINT:512,512:delete account:screen1]");
    const pending = createPendingComputerAction({
      action: resolveAgentAction(action, [SCREEN]),
      originalTask: "delete my account",
      reason: "destructive or hard-to-reverse action detected",
    });

    expect(pending).toMatchObject({
      originalTask: "delete my account",
      reason: "destructive or hard-to-reverse action detected",
      action: {
        kind: "click",
        absoluteX: 500,
        absoluteY: 500,
        label: "delete account",
      },
    });
    expect(pending.id).toContain("pending-");
  });

  it("recognizes explicit confirmation and rejection phrases", () => {
    expect(isComputerActionConfirmation("yes, confirm that action")).toBe("confirm");
    expect(isComputerActionConfirmation("go ahead")).toBe("confirm");
    expect(isComputerActionConfirmation("no, cancel it")).toBe("cancel");
    expect(isComputerActionConfirmation("what is on screen?")).toBe("none");
  });
});
