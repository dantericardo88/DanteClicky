import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface VerifyResult {
  success: boolean;
  explanation: string;
}

export interface MoondreamStatus {
  available: boolean;
  model_path: string | null;
  session_loaded: boolean;
  last_description: string | null;
  last_inference_ms: number | null;
}

/**
 * Asks Claude Haiku to compare before/after screenshots and determine whether
 * a computer-use action succeeded. Verifier failures resolve as unsuccessful
 * so the agent loop can replan or stop instead of blindly continuing.
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
      listen<string>(`chat-chunk-${callId}`, (event) => {
        fullText += event.payload;
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
          resolve({ success: false, explanation: "Verification parse error" });
        }
      }),
      listen<string>(`chat-error-${callId}`, () => {
        cleanup();
        resolve({ success: false, explanation: "Verification unavailable" });
      }),
    ]).then(([unlistenChunk, unlistenDone, unlistenError]) => {
      unlisteners.push(unlistenChunk, unlistenDone, unlistenError);
      invoke("stream_claude", { body, callId }).catch(() => {
        cleanup();
        resolve({ success: false, explanation: "Verification invoke error" });
      });
    });
  });
}

/**
 * Verify action using local Moondream2 ONNX model if available,
 * otherwise fall back to cloud-based Claude Haiku verification.
 * Uses local vision inference to avoid API calls when the model is loaded.
 */
export async function verifyActionLocal(
  beforeScreenshot: string,
  afterScreenshot: string,
  actionDescription: string
): Promise<VerifyResult> {
  try {
    // Check if Moondream2 session is loaded
    const status = await invoke<MoondreamStatus>("get_moondream_status");
    if (status.session_loaded) {
      // Use local model for verification
      return invoke<VerifyResult>("moondream_verify_action", {
        before_b64: beforeScreenshot,
        after_b64: afterScreenshot,
        action: actionDescription,
      });
    }
  } catch (err) {
    console.warn("Local verification failed, falling back to cloud:", err);
  }

  // Fall back to cloud verification
  return verifyAction(beforeScreenshot, afterScreenshot, actionDescription);
}
