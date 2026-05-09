import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ConversationTurn, ProviderType } from "../state/companionStore";
import { fallbackSummarizeTurns } from "./contextCompression";

export interface SummaryProviderOptions {
  provider: ProviderType | string;
  modelId: string;
  anthropicKey?: string;
  openaiKey?: string;
  grokKey?: string;
  maxTokens?: number;
  summaryTimeoutMs?: number;
}

interface SummaryTarget {
  provider: ProviderType | string;
  modelId: string;
}

const SUMMARY_SYSTEM_PROMPT =
  "You are DanteClicky's context compressor. Create a compact factual running summary for a long voice/computer-use session. Preserve: the user's active task, user preferences, exact app names, exact file or project names, screen facts, computer-use actions taken, safety-relevant facts, unresolved blockers, and decisions already made. Drop filler, repeated wording, and chit-chat. Plain prose, past tense.";
const DEFAULT_SUMMARY_TIMEOUT_MS = 12_000;

export async function summarizeOldTurns(
  turns: ConversationTurn[],
  options: SummaryProviderOptions
): Promise<string> {
  if (turns.length === 0) return "";

  const fallback = fallbackSummarizeTurns(turns);
  const target = resolveSummaryTarget(options);
  if (!target) return fallback;

  const userContent =
    "Compress these older conversation turns for future context. Do not omit actions, screen facts, unresolved blockers, safety facts, exact app names, or exact file/project names.\n\n" +
    turns
      .map((t, i) => `Turn ${i + 1}\nUser: ${t.userPrompt}\nAssistant: ${t.assistantResponse}`)
      .join("\n\n");

  const result = await streamSummaryRequest(
    target,
    SUMMARY_SYSTEM_PROMPT,
    userContent,
    options.maxTokens ?? 256,
    options.summaryTimeoutMs ?? DEFAULT_SUMMARY_TIMEOUT_MS
  );
  return result || fallback;
}

export async function compressSummary(
  existing: string,
  options: SummaryProviderOptions
): Promise<string | null> {
  if (!existing.trim()) return null;

  const fallback = deterministicCompressText(existing, 900);
  const target = resolveSummaryTarget(options);
  if (!target) return fallback;

  const system =
    "Compress this accumulated running summary while preserving user preferences, exact technical facts, active tasks, completed actions, unresolved blockers, screen/app/file names, and safety-relevant facts. Keep it under 180 words. Plain prose.";
  const result = await streamSummaryRequest(
    target,
    system,
    existing,
    options.maxTokens ?? 220,
    options.summaryTimeoutMs ?? DEFAULT_SUMMARY_TIMEOUT_MS
  );
  return result || fallback;
}

function resolveSummaryTarget(options: SummaryProviderOptions): SummaryTarget | null {
  if (options.anthropicKey?.trim()) {
    return { provider: "claude", modelId: "claude-haiku-4-5-20251001" };
  }
  if (options.provider === "openai" && options.openaiKey?.trim()) {
    return { provider: "openai", modelId: options.modelId };
  }
  if (options.provider === "grok" && options.grokKey?.trim()) {
    return { provider: "grok", modelId: options.modelId };
  }
  if (options.provider === "claude" && options.anthropicKey?.trim()) {
    return { provider: "claude", modelId: options.modelId };
  }
  return null;
}

async function streamSummaryRequest(
  target: SummaryTarget,
  system: string,
  userContent: string,
  maxTokens: number,
  timeoutMs: number
): Promise<string> {
  const callId = crypto.randomUUID();
  const body =
    target.provider === "claude"
      ? {
          model: target.modelId,
          max_tokens: maxTokens,
          stream: true,
          system,
          messages: [{ role: "user", content: userContent }],
        }
      : {
          model: target.modelId,
          max_tokens: maxTokens,
          stream: true,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userContent },
          ],
        };

  return new Promise<string>((resolve) => {
    let fullText = "";
    let settled = false;
    const unlisteners: Array<() => void> = [];
    const cleanup = () => {
      while (unlisteners.length > 0) {
        unlisteners.pop()?.();
      }
    };
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const settle = (value: string) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      cleanup();
      resolve(value);
    };
    timeoutId = setTimeout(() => settle(""), Math.max(1, timeoutMs));

    Promise.all([
      listen<string>(`chat-chunk-${callId}`, (e) => {
        fullText += e.payload;
      }),
      listen<string>(`chat-done-${callId}`, () => {
        settle(fullText.trim());
      }),
      listen<string>(`chat-error-${callId}`, () => {
        settle("");
      }),
    ]).then(([u1, u2, u3]) => {
      unlisteners.push(u1, u2, u3);
      if (settled) {
        cleanup();
        return;
      }

      if (target.provider === "claude") {
        invoke("stream_claude", { body, callId }).catch(() => {
          settle("");
        });
        return;
      }

      const baseUrl =
        target.provider === "grok" ? "https://api.x.ai/v1" : "https://api.openai.com/v1";
      invoke("stream_openai_compat", {
        baseUrl,
        provider: target.provider,
        body,
        callId,
      }).catch(() => {
        settle("");
      });
    });
  });
}

function deterministicCompressText(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 28)).trimEnd()} [truncated for context]`;
}
