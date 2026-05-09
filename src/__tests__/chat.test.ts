import { vi, describe, it, expect } from "vitest";

// Mock Tauri APIs before importing chat.ts, which imports them at module level.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { buildClaudeBody, buildOpenAIBody, buildOpenAIResponsesComputerBody } from "../providers/chat";
import type { ChatMessage } from "../providers/chat";

const MESSAGES: ChatMessage[] = [
  { role: "user", content: "hello" },
  { role: "assistant", content: "hi there" },
  { role: "user", content: "what is the weather?" },
];

const SINGLE_MSG: ChatMessage[] = [{ role: "user", content: "single message" }];

describe("buildClaudeBody", () => {
  it("includes system prompt in top-level field", () => {
    const body = buildClaudeBody("claude-3-5-sonnet-20241022", "You are helpful.", SINGLE_MSG, []);
    expect(body.system).toBe("You are helpful.");
  });

  it("puts images in last user message content array", () => {
    const imgData = "base64encodeddata";
    const body = buildClaudeBody("claude-3-5-sonnet-20241022", "sys", SINGLE_MSG, [imgData]);
    const msgs = body.messages as Array<{ role: string; content: unknown }>;
    const lastMsg = msgs[msgs.length - 1];
    const content = lastMsg.content as Array<{ type: string; source?: { data: string } }>;
    const imageItems = content.filter((c) => c.type === "image");
    expect(imageItems).toHaveLength(1);
    expect(imageItems[0].source?.data).toBe(imgData);
  });

  it("has stream: true", () => {
    const body = buildClaudeBody("claude-3-5-sonnet-20241022", "sys", SINGLE_MSG, []);
    expect(body.stream).toBe(true);
  });

  it("has max_tokens: 4096", () => {
    const body = buildClaudeBody("claude-3-5-sonnet-20241022", "sys", SINGLE_MSG, []);
    expect(body.max_tokens).toBe(4096);
  });

  it("allows max_tokens override for small summarization calls", () => {
    const body = buildClaudeBody("claude-3-5-sonnet-20241022", "sys", SINGLE_MSG, [], undefined, undefined, 200);
    expect(body.max_tokens).toBe(200);
  });

  it("preserves conversation history before last message", () => {
    const body = buildClaudeBody("model", "sys", MESSAGES, []);
    const msgs = body.messages as Array<{ role: string; content: unknown }>;
    expect(msgs[0]).toMatchObject({ role: "user", content: "hello" });
    expect(msgs[1]).toMatchObject({ role: "assistant", content: "hi there" });
  });

  it("uses the current Claude 4.6 computer-use tool version and beta header", () => {
    const body = buildClaudeBody("claude-sonnet-4-6", "sys", SINGLE_MSG, [], 1280, 800);

    expect(body.tools).toEqual([
      {
        type: "computer_20251124",
        name: "computer",
        display_width_px: 1280,
        display_height_px: 800,
      },
    ]);
    expect(body.betas).toEqual(["computer-use-2025-11-24"]);
  });

  it("uses the older Claude computer-use tool for 4.5 models", () => {
    const body = buildClaudeBody("claude-haiku-4-5-20251001", "sys", SINGLE_MSG, [], 1280, 800);
    expect(body.tools).toMatchObject([{ type: "computer_20250124" }]);
    expect(body.betas).toEqual(["computer-use-2025-01-24"]);
  });

  it("preserves Claude tool_result content blocks in the last user message", () => {
    const body = buildClaudeBody(
      "claude-sonnet-4-6",
      "sys",
      [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: "clicked",
            },
          ],
        },
      ],
      []
    );
    const msgs = body.messages as Array<{ role: string; content: unknown }>;
    expect(msgs.at(-1)?.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "toolu_1",
        content: "clicked",
      },
    ]);
  });
});

describe("buildOpenAIBody", () => {
  it("has system message as first message", () => {
    const body = buildOpenAIBody("gpt-4o", "You are a helpful assistant.", SINGLE_MSG, []);
    expect(body.messages[0]).toMatchObject({ role: "system", content: "You are a helpful assistant." });
  });

  it("uses image_url format for images", () => {
    const imgData = "base64encodeddata";
    const body = buildOpenAIBody("gpt-4o", "sys", SINGLE_MSG, [imgData]);
    const lastMsg = body.messages[body.messages.length - 1];
    const content = lastMsg.content as Array<{ type: string; image_url?: { url: string } }>;
    const imageItems = content.filter((c) => c.type === "image_url");
    expect(imageItems).toHaveLength(1);
    expect(imageItems[0].image_url?.url).toContain("base64,base64encodeddata");
  });

  it("has stream: true", () => {
    const body = buildOpenAIBody("gpt-4o", "sys", SINGLE_MSG, []);
    expect(body.stream).toBe(true);
  });

  it("has max_tokens: 1024", () => {
    const body = buildOpenAIBody("gpt-4o", "sys", SINGLE_MSG, []);
    expect(body.max_tokens).toBe(1024);
  });

  it("allows max_tokens override for compact helper calls", () => {
    const body = buildOpenAIBody("gpt-4o", "sys", SINGLE_MSG, [], 160);
    expect(body.max_tokens).toBe(160);
  });

  it("preserves conversation history after system message", () => {
    const body = buildOpenAIBody("gpt-4o", "sys", MESSAGES, []);
    // system is index 0; then previous turns follow
    expect(body.messages[0]).toMatchObject({ role: "system" });
    expect(body.messages[1]).toMatchObject({ role: "user", content: "hello" });
    expect(body.messages[2]).toMatchObject({ role: "assistant", content: "hi there" });
  });
});

describe("buildOpenAIResponsesComputerBody", () => {
  it("builds a Responses API computer-use request body", () => {
    const body = buildOpenAIResponsesComputerBody({
      model: "gpt-5.5",
      input: "click search",
      screenWidth: 1280,
      screenHeight: 800,
    });

    expect(body).toMatchObject({
      model: "gpt-5.5",
      tools: [
        {
          type: "computer",
          display_width: 1280,
          display_height: 800,
          environment: "windows",
        },
      ],
      input: "click search",
    });
  });
});
