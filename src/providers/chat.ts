import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamChatOptions {
  provider: string;
  modelId: string;
  systemPrompt: string;
  messages: ChatMessage[];
  images?: string[];
  onChunk: (text: string) => void;
}

export async function streamChat(opts: StreamChatOptions): Promise<string> {
  const { provider, modelId, systemPrompt, messages, images = [], onChunk } = opts;
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
        invoke("stream_claude", { body, callId }).catch((err: unknown) => {
          cleanup();
          reject(err);
        });
      } else {
        const baseUrl =
          provider === "grok"
            ? "https://api.x.ai/v1"
            : "https://api.openai.com/v1";
        invoke("stream_openai_compat", { baseUrl, provider, body, callId }).catch(
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
