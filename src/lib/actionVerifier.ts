import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface VerifyResult {
  success: boolean;
  explanation: string;
}

/**
 * Asks Claude Haiku to compare before/after screenshots and determine whether
 * a computer-use click action succeeded.  Uses the existing stream_claude IPC
 * so no extra HTTP logic is needed.  Failure is always soft — errors resolve
 * with { success: true } so the user is never blocked.
 */
export async function verifyAction(
  beforeScreenshot: string,
  afterScreenshot: string,
  actionDescription: string
): Promise<VerifyResult> {
  const callId = crypto.randomUUID();

  const body = {
    model: "claude-haiku-4-5-20251001",
    max_tokens: 100,
    stream: true,
    system:
      'You are a computer-use action verifier. Respond with JSON only: {"success": true/false, "explanation": "brief reason"}',
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Action performed: "${actionDescription}"\n\nDid this action succeed? Compare the before and after screenshots. Look for: window opened/closed, button state changed, text appeared, cursor position changed, UI element highlighted.\n\nRespond with JSON only.`,
          },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: beforeScreenshot,
            },
          },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: afterScreenshot,
            },
          },
        ],
      },
    ],
  };

  return new Promise<VerifyResult>((resolve) => {
    let fullText = "";
    const unlisteners: Array<() => void> = [];
    const cleanup = () => unlisteners.forEach((fn) => fn());

    Promise.all([
      listen<string>(`chat-chunk-${callId}`, (e) => {
        fullText += e.payload;
      }),
      listen<string>(`chat-done-${callId}`, () => {
        cleanup();
        try {
          const json = JSON.parse(fullText.trim());
          resolve({
            success: !!json.success,
            explanation: json.explanation ?? "",
          });
        } catch {
          // Claude didn't return valid JSON — assume success so we don't block the user
          resolve({ success: true, explanation: "Verification parse error" });
        }
      }),
      listen<string>(`chat-error-${callId}`, () => {
        cleanup();
        resolve({ success: true, explanation: "Verification unavailable" });
      }),
    ]).then(([u1, u2, u3]) => {
      unlisteners.push(u1, u2, u3);
      invoke("stream_claude", { body, callId }).catch(() => {
        cleanup();
        resolve({ success: true, explanation: "Verification invoke error" });
      });
    });
  });
}
