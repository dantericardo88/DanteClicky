import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content:
    | string
    | Array<{
        type: "image";
        source: { type: "base64"; media_type: string; data: string };
      }>;
}

export interface StreamChatWithToolsOptions {
  provider: string;
  modelId: string;
  apiKey: string;
  systemPrompt: string;
  messages: Array<{ role: "user" | "assistant"; content: string | unknown[] }>;
  images: string[];
  tools: unknown[];
  onChunk: (chunk: string) => void;
  onToolUse: (toolUse: ToolUseBlock) => void;
  onDone: (stopReason: string) => void;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamChatOptions {
  provider: string;
  modelId: string;
  apiKey: string;
  systemPrompt: string;
  messages: ChatMessage[];
  images?: string[];
  onChunk: (text: string) => void;
}

export async function streamChat(opts: StreamChatOptions): Promise<string> {
  const { provider, modelId, apiKey, systemPrompt, messages, images = [], onChunk } = opts;
  const callId = crypto.randomUUID();

  const body =
    provider === "claude"
      ? buildClaudeBody(modelId, systemPrompt, messages, images)
      : buildOpenAIBody(modelId, systemPrompt, messages, images);

  return new Promise<string>((resolve, reject) => {
    let fullText = "";
    const unlisteners: Array<() => void> = [];
    const cleanup = () => unlisteners.forEach((fn) => fn());

    Promise.all([
      listen<string>(`chat-chunk-${callId}`, (e) => {
        onChunk(e.payload);
        fullText += e.payload;
      }),
      listen<string>(`chat-done-${callId}`, () => {
        cleanup();
        resolve(fullText);
      }),
      listen<string>(`chat-error-${callId}`, (e) => {
        cleanup();
        reject(new Error(e.payload));
      }),
    ]).then(([u1, u2, u3]) => {
      unlisteners.push(u1, u2, u3);

      if (provider === "claude") {
        invoke("stream_claude", { apiKey, body, callId }).catch((err: unknown) => {
          cleanup();
          reject(err);
        });
      } else {
        const baseUrl =
          provider === "grok"
            ? "https://api.x.ai/v1"
            : "https://api.openai.com/v1";
        invoke("stream_openai_compat", { baseUrl, apiKey, body, callId }).catch(
          (err: unknown) => {
            cleanup();
            reject(err);
          }
        );
      }
    });
  });
}

export function buildClaudeBody(
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  images: string[]
) {
  const lastUserContent: Array<object> = [
    { type: "text", text: messages.at(-1)?.content ?? "" },
  ];
  for (let i = 0; i < images.length; i++) {
    lastUserContent.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: images[i] },
    });
  }
  const anthropicMessages = [
    ...messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: lastUserContent },
  ];
  return { model, max_tokens: 1024, system: systemPrompt, messages: anthropicMessages, stream: true };
}

export function buildOpenAIBody(
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  images: string[]
) {
  const lastContent: Array<object> = [
    { type: "text", text: messages.at(-1)?.content ?? "" },
  ];
  for (const img of images) {
    lastContent.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${img}` } });
  }
  const openAIMessages = [
    { role: "system", content: systemPrompt },
    ...messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: lastContent },
  ];
  return { model, messages: openAIMessages, stream: true, max_tokens: 1024 };
}

export async function streamChatWithTools(
  opts: StreamChatWithToolsOptions
): Promise<void> {
  // Only Claude supports native tool use
  if (opts.provider !== "claude") {
    // Fallback: use regular chat without tools
    await streamChat({
      provider: opts.provider,
      modelId: opts.modelId,
      apiKey: opts.apiKey,
      systemPrompt: opts.systemPrompt,
      messages: opts.messages as Array<{
        role: "user" | "assistant";
        content: string;
      }>,
      images: opts.images,
      onChunk: opts.onChunk,
    });
    opts.onDone("end_turn");
    return;
  }

  const callId = crypto.randomUUID();
  const unlisteners: Array<() => void> = [];
  let stopReason = "end_turn";

  await new Promise<void>((resolve, reject) => {
    Promise.all([
      listen<string>(`chat-chunk-${callId}`, (e) => opts.onChunk(e.payload)),
      listen<string>(`chat-stop-reason-${callId}`, (e) => {
        stopReason = e.payload;
      }),
      listen<ToolUseBlock>(`chat-tool-use-${callId}`, (e) =>
        opts.onToolUse(e.payload)
      ),
      listen(`chat-done-${callId}`, () => {
        unlisteners.forEach((fn) => fn());
        opts.onDone(stopReason);
        resolve();
      }),
      listen<string>(`chat-error-${callId}`, (e) => {
        unlisteners.forEach((fn) => fn());
        reject(new Error(e.payload));
      }),
    ]).then((fns) => {
      unlisteners.push(...fns);
      // Reuse the existing stream_claude command — tool_use blocks in the
      // response will arrive as text chunks; the loop in useVoice.ts parses them.
      const body = buildClaudeBody(
        opts.modelId,
        opts.systemPrompt,
        opts.messages as ChatMessage[],
        opts.images
      );
      invoke("stream_claude", { apiKey: opts.apiKey, body, callId }).catch(
        (err: unknown) => {
          unlisteners.forEach((fn) => fn());
          reject(err);
        }
      );
    });
  });
}
