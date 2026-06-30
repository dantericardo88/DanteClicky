import { vi, describe, it, expect } from "vitest";

// Mock Tauri APIs before importing chat.ts, which imports them at module level.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { buildClaudeBody, buildOpenAIBody } from "../providers/chat";
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
    const lastMsg = body.messages[body.messages.length - 1];
    const content = lastMsg.content as Array<{ type: string; source?: { data: string } }>;
    const imageItems = content.filter((c) => c.type === "image");
    expect(imageItems).toHaveLength(1);
    expect(imageItems[0].source?.data).toBe(imgData);
  });

  it("has stream: true", () => {
    const body = buildClaudeBody("claude-3-5-sonnet-20241022", "sys", SINGLE_MSG, []);
    expect(body.stream).toBe(true);
  });

  it("has max_tokens: 1024", () => {
    const body = buildClaudeBody("claude-3-5-sonnet-20241022", "sys", SINGLE_MSG, []);
    expect(body.max_tokens).toBe(1024);
  });

  it("preserves conversation history before last message", () => {
    const body = buildClaudeBody("model", "sys", MESSAGES, []);
    // First two messages (user + assistant) should be in message array before last user
    expect(body.messages[0]).toMatchObject({ role: "user", content: "hello" });
    expect(body.messages[1]).toMatchObject({ role: "assistant", content: "hi there" });
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

  it("preserves conversation history after system message", () => {
    const body = buildOpenAIBody("gpt-4o", "sys", MESSAGES, []);
    // system is index 0; then previous turns follow
    expect(body.messages[0]).toMatchObject({ role: "system" });
    expect(body.messages[1]).toMatchObject({ role: "user", content: "hello" });
    expect(body.messages[2]).toMatchObject({ role: "assistant", content: "hi there" });
  });
});
