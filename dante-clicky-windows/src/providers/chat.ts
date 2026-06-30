import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { providerForModel } from "../lib/providerRegistry";
import {
  captureTelemetryError,
  recordTelemetryEvent,
  startTelemetrySpan,
  type TelemetryContext,
} from "../lib/telemetry";
import type { ProviderType } from "../state/companionStore";

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
    | Array<
        | { type: "text"; text: string }
        | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
      >;
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
  content: string | Array<Record<string, unknown>>;
}

export interface StreamChatOptions {
  provider: string;
  modelId: string;
  systemPrompt: string;
  messages: ChatMessage[];
  images?: string[];
  screenWidth?: number;
  screenHeight?: number;
  maxTokens?: number;
  onChunk: (text: string) => void;
  onToolUse?: (toolUse: ToolUseBlock) => void;
  onStopReason?: (stopReason: string) => void;
  telemetryContext?: TelemetryContext;
}

export async function streamChat(opts: StreamChatOptions): Promise<string> {
  const {
    provider,
    modelId,
    systemPrompt,
    messages,
    images = [],
    screenWidth,
    screenHeight,
    maxTokens,
    onChunk,
    onToolUse,
    onStopReason,
    telemetryContext,
  } = opts;
  const callId = crypto.randomUUID();
  const span = startTelemetrySpan("model.stream", {
    provider,
    modelId,
    imageCount: images.length,
    messageCount: messages.length,
    maxTokens: maxTokens ?? null,
    hasScreenDimensions: Boolean(screenWidth && screenHeight),
  }, telemetryContext);
  let chunkCount = 0;
  let toolUseCount = 0;
  let stopReason = "unknown";

  const providerDefinition = providerForModel(provider as ProviderType);
  const body =
    providerDefinition.kind === "anthropic"
      ? buildClaudeBody(modelId, systemPrompt, messages, images, screenWidth, screenHeight, maxTokens)
      : buildOpenAIBody(modelId, systemPrompt, messages, images, maxTokens);

  return new Promise<string>((resolve, reject) => {
    let fullText = "";
    const unlisteners: Array<() => void> = [];
    const cleanup = () => unlisteners.forEach((fn) => fn());

    Promise.all([
      listen<string>(`chat-chunk-${callId}`, (e) => {
        chunkCount++;
        onChunk(e.payload);
        fullText += e.payload;
      }),
      listen<string>(`chat-done-${callId}`, () => {
        cleanup();
        span.end({
          stopReason,
          chunkCount,
          toolUseCount,
          outputLengthBucket: bucketLength(fullText.length),
        });
        recordTelemetryEvent(
          "model.stream.completed",
          {
            provider,
            modelId,
            stopReason,
            chunkCount,
            toolUseCount,
            outputLengthBucket: bucketLength(fullText.length),
          },
          span.context
        );
        resolve(fullText);
      }),
      listen<string>(`chat-error-${callId}`, (e) => {
        cleanup();
        captureTelemetryError(
          e.payload,
          {
            provider,
            modelId,
            route: "streamChat.event",
          },
          span.context
        );
        span.fail(e.payload, { chunkCount, toolUseCount });
        reject(new Error(e.payload));
      }),
      listen<ToolUseBlock>(`chat-tool-use-${callId}`, (e) => {
        toolUseCount++;
        onToolUse?.(e.payload);
      }),
      listen<string>(`chat-stop-reason-${callId}`, (e) => {
        stopReason = e.payload;
        onStopReason?.(e.payload);
      }),
    ]).then(([u1, u2, u3, u4, u5]) => {
      unlisteners.push(u1, u2, u3, u4, u5);

      if (providerDefinition.kind === "anthropic") {
        console.log("[chat] invoking stream_claude callId=%s model=%s", callId, modelId);
        invoke("stream_claude", { body, callId }).catch((err: unknown) => {
          console.error("[chat] stream_claude invoke FAILED callId=%s err=%s", callId, String(err));
          cleanup();
          captureTelemetryError(
            err,
            {
              provider,
              modelId,
              route: "streamChat.invoke",
            },
            span.context
          );
          span.fail(err, { chunkCount, toolUseCount });
          reject(err);
        });
      } else {
        console.log("[chat] invoking stream_openai_compat callId=%s provider=%s model=%s baseUrl=%s",
          callId, provider, modelId, providerDefinition.baseUrl);
        invoke("stream_openai_compat", { baseUrl: providerDefinition.baseUrl, provider, body, callId }).catch(
          (err: unknown) => {
            console.error("[chat] stream_openai_compat invoke FAILED callId=%s provider=%s err=%s",
              callId, provider, String(err));
            cleanup();
            captureTelemetryError(
              err,
              {
                provider,
                modelId,
                route: "streamChat.invoke",
              },
              span.context
            );
            span.fail(err, { chunkCount, toolUseCount });
            reject(err);
          }
        );
      }
    }).catch((err: unknown) => {
      console.error("[chat] listener setup FAILED callId=%s err=%s", callId, String(err));
      cleanup();
      span.fail(err, { chunkCount, toolUseCount });
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

export function buildClaudeBody(
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  images: string[],
  screenWidth?: number,
  screenHeight?: number,
  maxTokens = 4096,
) {
  const lastMessageContent = messages.at(-1)?.content ?? "";
  const lastUserContent: Array<object> = Array.isArray(lastMessageContent)
    ? [...lastMessageContent]
    : [{ type: "text", text: lastMessageContent }];
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

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: anthropicMessages,
    stream: true,
  };

  // Include the computer_use tool when screen dimensions are known.
  // This enables Claude's native coordinate grounding in addition to our [POINT] tags.
  if (screenWidth && screenHeight) {
    const tool = claudeComputerToolForModel(model);
    body.tools = [{
      type: tool.type,
      name: "computer",
      display_width_px: screenWidth,
      display_height_px: screenHeight,
    }];
    // Required beta header is sent via the Rust proxy
    body["betas"] = [tool.beta];
  }

  return body;
}

export function claudeComputerToolForModel(model: string): { type: string; beta: string } {
  const normalized = model.toLowerCase();
  const supportsLatestTool =
    normalized.includes("4-6") ||
    normalized.includes("4.6") ||
    normalized.includes("4-7") ||
    normalized.includes("4.7") ||
    normalized.includes("opus-4-5") ||
    normalized.includes("opus-4.5");

  return supportsLatestTool
    ? { type: "computer_20251124", beta: "computer-use-2025-11-24" }
    : { type: "computer_20250124", beta: "computer-use-2025-01-24" };
}

export function buildOpenAIBody(
  model: string,
  systemPrompt: string,
  messages: ChatMessage[],
  images: string[],
  maxTokens = 4096
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
  return { model, messages: openAIMessages, stream: true, max_tokens: maxTokens };
}

export function buildOpenAIResponsesComputerBody(opts: {
  model: string;
  input: string | Array<Record<string, unknown>>;
  screenWidth: number;
  screenHeight: number;
  previousResponseId?: string;
}) {
  const body: Record<string, unknown> = {
    model: opts.model,
    tools: [
      {
        type: "computer",
        display_width: opts.screenWidth,
        display_height: opts.screenHeight,
        environment: "windows",
      },
    ],
    input: opts.input,
  };

  if (opts.previousResponseId) {
    body.previous_response_id = opts.previousResponseId;
  }

  return body;
}

function bucketLength(length: number): string {
  if (length <= 0) return "empty";
  if (length < 500) return "<500";
  if (length < 2_000) return "500-2k";
  if (length < 8_000) return "2k-8k";
  return "8k+";
}

export async function sendOpenAIResponse(
  body: Record<string, unknown>,
  telemetryContext?: TelemetryContext
): Promise<unknown> {
  const span = startTelemetrySpan("model.openai_responses", {
    modelId: typeof body.model === "string" ? body.model : "unknown",
    inputKind: Array.isArray(body.input) ? "array" : typeof body.input,
    inputItemCount: Array.isArray(body.input) ? body.input.length : 1,
    hasPreviousResponse: Boolean(body.previous_response_id),
  }, telemetryContext);
  try {
    const response = await invoke("send_openai_response", { body });
    span.end();
    return response;
  } catch (err) {
    captureTelemetryError(err, { route: "sendOpenAIResponse" }, span.context);
    span.fail(err);
    throw err;
  }
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
      invoke("stream_claude", { body, callId }).catch(
        (err: unknown) => {
          unlisteners.forEach((fn) => fn());
          reject(err);
        }
      );
    }).catch((err: unknown) => reject(err));
  });
}
