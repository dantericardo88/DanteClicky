/**
 * Assembles the keyterms list passed to AssemblyAI Universal-3 streaming.
 *
 * Sources (priority order):
 *   1. App context — focused window title + selected text snippet (UIA tree)
 *   2. Personal dictionary — user-managed proper nouns, code identifiers
 *   3. Conversation history — proper nouns extracted from recent turns
 *   4. System defaults — common dev/platform terms that get mistranscribed
 *
 * Research: Deepgram reports 10–15 hotwords drop WER 2.5–3.1% on domain
 * speech; Whisper `initial_prompt` shows 40–60% WER reduction on technical
 * vocabulary. AssemblyAI's `keyterms_prompt` accepts up to 1,000 terms.
 */

import { sanitizeKeyterms } from "./speechLanguages";

export interface VoiceContextSources {
  /** Active window title from UIAutomation, e.g. "Visual Studio Code — useVoice.ts". */
  focusedWindowTitle?: string | null;
  /** Highlighted text in the focused control. Useful for code identifier biasing. */
  selectedText?: string | null;
  /** User-curated terms from Settings → Voice → Personal Dictionary. */
  personalDictionary?: readonly string[];
  /** Last N user/assistant turns. Capitalized words are extracted as candidates. */
  recentTurns?: readonly string[];
  /** Optional override for the built-in seed list (defaults if omitted). */
  systemDefaults?: readonly string[];
}

const DEFAULT_SEED_VOCABULARY: readonly string[] = [
  // Platforms / brands the app sits inside
  "DanteClicky",
  "DanteForge",
  "DanteAgents",
  "Anthropic",
  "Claude",
  "Haiku",
  "Sonnet",
  "Opus",
  "OpenAI",
  "GPT-4o",
  "Whisper",
  "Tauri",
  "AssemblyAI",
  "ElevenLabs",
  "Deepgram",
  "Groq",
  // Developer tooling commonly mistranscribed
  "TypeScript",
  "Rust",
  "WebAssembly",
  "WebSocket",
  "stdin",
  "stdout",
  "cmd",
  "git",
  "GitHub",
  "PowerShell",
  "WASAPI",
  "WGC",
  "MCP",
  "STT",
  "TTS",
  "LLM",
  "API",
];

const TITLE_SEPARATOR_RE = /\s[—\-|]\s|\s•\s/;
const PROPER_NOUN_RE = /\b[A-Z][\w'\-]{1,28}\b/g;
const CODE_IDENT_RE = /\b[a-z][A-Za-z0-9_]+(?=[A-Z])[A-Za-z0-9_]*|[a-z]+_[a-z_]+|[A-Za-z]+\.\w+/g;

function extractFromWindowTitle(title: string): string[] {
  // Window titles are typically "App — Document". Split on common separators
  // so we boost both the app and the open document name.
  return title
    .split(TITLE_SEPARATOR_RE)
    .map((s) => s.trim())
    .filter((s) => s.length >= 2 && s.length <= 60);
}

function extractIdentifiersFromText(text: string, max: number): string[] {
  if (!text) return [];
  const out = new Set<string>();
  // Capitalized proper nouns
  const matches = text.match(PROPER_NOUN_RE) ?? [];
  for (const m of matches) {
    out.add(m);
    if (out.size >= max) break;
  }
  // camelCase, snake_case, dotted identifiers
  const idents = text.match(CODE_IDENT_RE) ?? [];
  for (const id of idents) {
    if (id.length >= 3 && id.length <= 40) out.add(id);
    if (out.size >= max) break;
  }
  return Array.from(out);
}

function extractTokensFromTurns(turns: readonly string[], max: number): string[] {
  const out = new Set<string>();
  for (let i = turns.length - 1; i >= 0 && out.size < max; i--) {
    const turn = turns[i];
    if (typeof turn !== "string" || turn.length === 0) continue;
    const ids = extractIdentifiersFromText(turn, max - out.size);
    for (const id of ids) out.add(id);
  }
  return Array.from(out);
}

/**
 * Caps per-source allocation so a noisy long selection cannot crowd out the
 * personal dictionary. Returns a deduplicated, length-bounded keyterms list
 * ready to hand to `buildAssemblyAIStreamingUrl`.
 */
export function buildKeytermsForUtterance(
  sources: VoiceContextSources,
  totalBudget = 200,
): string[] {
  if (totalBudget <= 0) return [];

  const fromTitle = sources.focusedWindowTitle
    ? extractFromWindowTitle(sources.focusedWindowTitle)
    : [];
  const fromSelection = extractIdentifiersFromText(sources.selectedText ?? "", 40);
  const fromDictionary = (sources.personalDictionary ?? []).filter(
    (s): s is string => typeof s === "string",
  );
  const fromTurns = extractTokensFromTurns(sources.recentTurns ?? [], 40);
  const seed = sources.systemDefaults ?? DEFAULT_SEED_VOCABULARY;

  // Highest-priority sources first so the URL budget keeps the most useful terms
  const ordered = [
    ...fromDictionary, // explicit user choice — highest signal
    ...fromTitle,
    ...fromSelection,
    ...fromTurns,
    ...seed,
  ].slice(0, totalBudget);

  return sanitizeKeyterms(ordered);
}

export const __test = {
  DEFAULT_SEED_VOCABULARY,
  extractFromWindowTitle,
  extractIdentifiersFromText,
  extractTokensFromTurns,
};
