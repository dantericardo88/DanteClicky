import { invoke } from "@tauri-apps/api/core";

export interface DigestFact {
  id?: number;
  fact: string;
  category: string;
  confidence: number;
  source_turn_ids?: string | null;
  last_seen?: string | null;
  created_at?: string | null;
}

interface TurnRow {
  id: number;
  user_prompt: string;
  assistant_response: string;
  created_at: string;
}

const CONSOLIDATION_BATCH = 8;
const MIN_TURNS_TO_TRIGGER = 5;

const EXTRACT_PROMPT = `Analyze these conversation turns and extract 3-8 key facts about the user.
Focus on:
- Preferences and working style ("prefers concise answers", "uses dark mode")
- Project and technical context ("working on DanteClicky desktop app in Tauri+Rust")
- Recurring patterns ("often asks about UI bugs", "uses Claude as AI model")
- Personal or professional context if relevant

Return ONLY a JSON array. Each item: {"fact": "...", "category": "preference|context|pattern", "confidence": 0.5-1.0}
No prose, no explanation. JSON array only.

Conversations:
`;

export async function runConsolidation(params: {
  anthropicKey: string;
  openaiKey: string;
  modelId: string;
  provider: string;
}): Promise<void> {
  if (!params.anthropicKey && !params.openaiKey) return;

  const lastId = await invoke<number>("get_last_consolidated_turn_id").catch(() => 0);
  const turns = await invoke<TurnRow[]>("get_turns_to_consolidate", {
    sinceTurnId: lastId,
    limit: CONSOLIDATION_BATCH,
  }).catch(() => [] as TurnRow[]);

  if (turns.length < MIN_TURNS_TO_TRIGGER) return;

  const turnText = turns
    .map(
      (t, i) =>
        `Turn ${i + 1}:\nUser: ${t.user_prompt.slice(0, 300)}\nAssistant: ${t.assistant_response.slice(0, 400)}`
    )
    .join("\n\n");

  const prompt = EXTRACT_PROMPT + turnText;

  let raw = "";
  try {
    raw = await invoke<string>("extract_facts_oneshot", {
      prompt,
      provider: params.provider,
      modelId: params.modelId,
    });
  } catch {
    return;
  }

  const facts = parseFacts(raw, turns.map((t) => t.id));
  if (facts.length === 0) return;

  await invoke("save_digest_facts", { facts }).catch(() => {});
  const maxId = Math.max(...turns.map((t) => t.id));
  await invoke("update_consolidation_state", { lastTurnId: maxId }).catch(() => {});
}

function parseFacts(raw: string, sourceIds: number[]): DigestFact[] {
  const jsonStart = raw.indexOf("[");
  const jsonEnd = raw.lastIndexOf("]");
  if (jsonStart === -1 || jsonEnd === -1) return [];
  try {
    const arr = JSON.parse(raw.slice(jsonStart, jsonEnd + 1));
    if (!Array.isArray(arr)) return [];
    return arr
      .filter(
        (f: unknown) =>
          typeof (f as { fact?: unknown }).fact === "string" &&
          (f as { fact: string }).fact.trim()
      )
      .map((f: { fact: string; category?: string; confidence?: number }) => ({
        fact: f.fact.trim().slice(0, 200),
        category: ["preference", "context", "pattern"].includes(f.category ?? "")
          ? f.category!
          : "general",
        confidence: Math.min(1.0, Math.max(0.1, f.confidence ?? 0.8)),
        source_turn_ids: JSON.stringify(sourceIds),
      }));
  } catch {
    return [];
  }
}
