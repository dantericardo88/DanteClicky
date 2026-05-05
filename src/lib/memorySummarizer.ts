import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ConversationTurn } from "../state/companionStore";

export async function summarizeOldTurns(
  turns: ConversationTurn[],
  hasKey: boolean
): Promise<string> {
  if (!hasKey || turns.length === 0) return "";

  const callId = crypto.randomUUID();
  const body = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 256,
    stream: true,
    system:
      "You are a conversation summarizer. Create a compact, factual summary of the conversation below. Focus on: what the user was doing, what actions were taken, what was on screen, key facts discovered. Keep it under 200 words. Write in past tense.",
    messages: [
      {
        role: "user",
        content:
          "Summarize these conversation turns:\n\n" +
          turns
            .map(
              (t, i) =>
                `Turn ${i + 1}\nUser: ${t.userPrompt}\nAssistant: ${t.assistantResponse}`
            )
            .join("\n\n"),
      },
    ],
  };

  return new Promise<string>((resolve) => {
    let fullText = "";
    const unlisteners: Array<() => void> = [];
    const cleanup = () => unlisteners.forEach((fn) => fn());

    Promise.all([
      listen<string>(`chat-chunk-${callId}`, (e) => {
        fullText += e.payload;
      }),
      listen<string>(`chat-done-${callId}`, () => {
        cleanup();
        resolve(fullText.trim());
      }),
      listen<string>(`chat-error-${callId}`, () => {
        cleanup();
        resolve("");
      }),
    ]).then(([u1, u2, u3]) => {
      unlisteners.push(u1, u2, u3);
      invoke("stream_claude", { body, callId }).catch(() => {
        cleanup();
        resolve("");
      });
    });
  });
}
