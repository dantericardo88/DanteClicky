import { describe, expect, it } from "vitest";
import {
  buildClaudeComputerToolResult,
  buildOpenAIComputerCallOutput,
  claudeToolUseToAgentActions,
  extractOpenAIComputerCalls,
  openAIComputerCallToAgentActions,
} from "../lib/providerComputerActions";

describe("claudeToolUseToAgentActions", () => {
  it("maps native Claude left_click coordinates into normalized internal actions", () => {
    const actions = claudeToolUseToAgentActions(
      {
        type: "tool_use",
        id: "toolu_1",
        name: "computer",
        input: { action: "left_click", coordinate: [960, 540] },
      },
      { screenWidth: 1920, screenHeight: 1080 }
    );

    expect(actions).toMatchObject([
      {
        kind: "click",
        provider: "claude",
        providerCallId: "toolu_1",
        normalizedX: 512,
        normalizedY: 512,
        screenLabel: "screen1",
      },
    ]);
  });

  it("maps enhanced Claude actions into the shared action contract", () => {
    const actions = claudeToolUseToAgentActions(
      {
        type: "tool_use",
        id: "toolu_2",
        name: "computer",
        input: {
          action: "left_click_drag",
          start_coordinate: [100, 200],
          coordinate: [500, 600],
        },
      },
      { screenWidth: 1000, screenHeight: 1000 }
    );

    expect(actions[0]).toMatchObject({
      kind: "drag",
      normalizedX: 102,
      normalizedY: 205,
      targetNormalizedX: 512,
      targetNormalizedY: 614,
    });
  });

  it("maps additional Claude click variants", () => {
    expect(
      claudeToolUseToAgentActions(
        {
          type: "tool_use",
          id: "toolu_5",
          name: "computer",
          input: { action: "middle_click", coordinate: [100, 200] },
        },
        { screenWidth: 1000, screenHeight: 1000 }
      )[0]
    ).toMatchObject({ kind: "middle_click" });

    expect(
      claudeToolUseToAgentActions(
        {
          type: "tool_use",
          id: "toolu_6",
          name: "computer",
          input: { action: "triple_click", coordinate: [100, 200] },
        },
        { screenWidth: 1000, screenHeight: 1000 }
      )[0]
    ).toMatchObject({ kind: "triple_click" });
  });

  it("maps screenshot and key requests without requiring coordinates", () => {
    expect(
      claudeToolUseToAgentActions(
        {
          type: "tool_use",
          id: "toolu_3",
          name: "computer",
          input: { action: "screenshot" },
        },
        { screenWidth: 1000, screenHeight: 1000 }
      )[0]
    ).toMatchObject({ kind: "screenshot", normalizedX: null, normalizedY: null });

    expect(
      claudeToolUseToAgentActions(
        {
          type: "tool_use",
          id: "toolu_4",
          name: "computer",
          input: { action: "key", text: "ctrl+s" },
        },
        { screenWidth: 1000, screenHeight: 1000 }
      )[0]
    ).toMatchObject({ kind: "key", key: "ctrl+s" });
  });
});

describe("openAIComputerCallToAgentActions", () => {
  it("preserves OpenAI pending safety checks from native computer calls", () => {
    const calls = extractOpenAIComputerCalls({
      output: [
        {
          type: "computer_call",
          call_id: "call_safe",
          action: { type: "click", x: 100, y: 200 },
          pending_safety_checks: [
            { id: "sc_1", code: "external_side_effect", message: "Confirm before sending." },
          ],
        },
      ],
    });

    expect(calls[0]).toMatchObject({
      call_id: "call_safe",
      pendingSafetyChecks: [
        { id: "sc_1", code: "external_side_effect", message: "Confirm before sending." },
      ],
    });
  });

  it("maps OpenAI computer_call action arrays into ordered internal actions", () => {
    const actions = openAIComputerCallToAgentActions(
      {
        type: "computer_call",
        call_id: "call_123",
        actions: [
          { type: "click", x: 100, y: 200 },
          { type: "type", text: "penguin" },
          { type: "scroll", x: 300, y: 400, scroll_y: 5 },
        ],
      },
      { screenWidth: 1000, screenHeight: 1000 }
    );

    expect(actions).toMatchObject([
      { kind: "click", provider: "openai", providerCallId: "call_123" },
      { kind: "type", text: "penguin" },
      { kind: "scroll", scrollDelta: 5 },
    ]);
    expect(actions.map((action) => action.sequence)).toEqual([1, 2, 3]);
  });

  it("maps OpenAI button variants and drag paths from the Responses computer tool", () => {
    const actions = openAIComputerCallToAgentActions(
      {
        type: "computer_call",
        call_id: "call_456",
        actions: [
          { type: "click", button: "right", x: 100, y: 200 },
          {
            type: "drag",
            path: [
              { x: 10, y: 20 },
              { x: 90, y: 120 },
            ],
          },
          { type: "scroll", x: 300, y: 400, scrollY: -120 },
        ],
      },
      { screenWidth: 1000, screenHeight: 1000 }
    );

    expect(actions).toMatchObject([
      { kind: "right_click" },
      {
        kind: "drag",
        normalizedX: 10,
        normalizedY: 20,
        targetNormalizedX: 92,
        targetNormalizedY: 123,
      },
      { kind: "scroll", scrollDelta: -30 },
    ]);
  });
});

describe("provider result builders", () => {
  it("builds Claude tool_result blocks with text and screenshot content", () => {
    const result = buildClaudeComputerToolResult("toolu_1", {
      text: "clicked search",
      screenshotBase64: "jpeg-data",
    });

    expect(result).toMatchObject({
      type: "tool_result",
      tool_use_id: "toolu_1",
      content: [
        { type: "text", text: "clicked search" },
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "jpeg-data" } },
      ],
    });
  });

  it("builds OpenAI computer_call_output payloads", () => {
    expect(buildOpenAIComputerCallOutput("call_123", "jpeg-data")).toMatchObject({
      type: "computer_call_output",
      call_id: "call_123",
      output: {
        type: "computer_screenshot",
        image_url: "data:image/jpeg;base64,jpeg-data",
        detail: "original",
      },
    });
  });

  it("acknowledges OpenAI pending safety checks in computer_call_output payloads", () => {
    expect(
      buildOpenAIComputerCallOutput("call_123", "jpeg-data", [
        { id: "sc_1", code: "external_side_effect" },
      ])
    ).toMatchObject({
      type: "computer_call_output",
      call_id: "call_123",
      acknowledged_safety_checks: [{ id: "sc_1", code: "external_side_effect" }],
    });
  });
});
