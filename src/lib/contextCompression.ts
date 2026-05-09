import type { ConversationTurn, ProviderType } from "../state/companionStore";

export const CONTEXT_SUMMARY_SCHEMA_VERSION = 2;
export const DEFAULT_RECENT_TURN_COUNT = 6;
export const DEFAULT_TURN_COUNT_TRIGGER = 10;
export const SOFT_BUDGET_RATIO = 0.7;
export const HARD_BUDGET_RATIO = 0.8;
export const SUMMARY_RECOMPRESS_TOKENS = 500;

export interface ContextCompressionBlocks {
  memoryContext?: string;
  sqliteMemory?: string;
  ocrText?: string;
  uiTreeText?: string;
}

export interface ContextCompressionInput extends ContextCompressionBlocks {
  provider: ProviderType | string;
  modelId: string;
  systemPrompt?: string;
  conversationSummary?: string;
  sessionNotes?: string;
  systemPromptOverride?: string;
  currentUserPrompt?: string;
  turns: ConversationTurn[];
  recentTurnCount?: number;
  turnCountTrigger?: number;
  inputBudgetTokens?: number;
  imageCount?: number;
  supportsVision?: boolean;
}

export interface CompressedContextPlan {
  shouldCompress: boolean;
  triggerReason: "token_budget" | "turn_count" | "none";
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  inputBudgetTokens: number;
  softLimitTokens: number;
  hardLimitTokens: number;
  reservedTokens: number;
  turnsToSummarize: ConversationTurn[];
  retainedTurns: ConversationTurn[];
  conversationSummary: string;
  blocks: Required<ContextCompressionBlocks>;
  audit: ContextCompressionAudit;
  schemaVersion: number;
}

export interface ContextCompressionAudit {
  pressureRatio: number;
  tokensSaved: number;
  hardLimitExceeded: boolean;
  overBudgetTokens: number;
  recommendedAction: "none" | "reduce_fixed_context";
  blockStats: Record<keyof Required<ContextCompressionBlocks>, ContextBlockStat>;
}

export interface ContextBlockStat {
  originalTokens: number;
  dedupedTokens: number;
  finalTokens: number;
  budgetTokens: number;
  truncated: boolean;
  dedupedLines: number;
}

export function estimateTokens(text: string | undefined | null): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function estimateTurnTokens(turn: ConversationTurn): number {
  return estimateTokens(`${turn.userPrompt}\n${turn.assistantResponse}`);
}

export function getModelInputBudgetTokens(
  provider: ProviderType | string,
  modelId: string
): number {
  const normalizedProvider = provider.toLowerCase();
  const normalizedModel = modelId.toLowerCase();

  if (normalizedProvider === "claude") {
    return normalizedModel.includes("haiku") ? 80_000 : 160_000;
  }
  if (normalizedProvider === "openai") {
    return normalizedModel.includes("gpt-4o") ? 96_000 : 120_000;
  }
  if (normalizedProvider === "grok") {
    return 96_000;
  }
  return 80_000;
}

export function mergeRunningSummary(existing: string | undefined, update: string | undefined): string {
  const left = existing?.trim() ?? "";
  const right = update?.trim() ?? "";
  if (!left) return right;
  if (!right) return left;
  return dedupeParagraphs(`${left}\n\n${right}`);
}

export function fallbackSummarizeTurns(turns: ConversationTurn[], maxChars = 1_200): string {
  if (turns.length === 0) return "";

  const excerpts = turns.map((turn, index) => {
    const user = compactWhitespace(turn.userPrompt).slice(0, 260);
    const assistant = compactWhitespace(turn.assistantResponse).slice(0, 360);
    return `Turn ${index + 1}: user asked "${user}". Dante answered "${assistant}".`;
  });

  return truncateText(
    `Earlier conversation summary: ${excerpts.join(" ")}`,
    maxChars
  );
}

export function shouldCompressContext(input: ContextCompressionInput): boolean {
  return buildCompressedContext(input).shouldCompress;
}

export function buildCompressedContext(
  input: ContextCompressionInput,
  generatedSummary?: string
): CompressedContextPlan {
  const inputBudgetTokens =
    input.inputBudgetTokens ?? getModelInputBudgetTokens(input.provider, input.modelId);
  const reservedTokens = getReservedTokens(input);
  const softLimitTokens = Math.floor(inputBudgetTokens * SOFT_BUDGET_RATIO);
  const hardLimitTokens = Math.max(
    512,
    Math.floor(inputBudgetTokens * HARD_BUDGET_RATIO) - reservedTokens
  );
  const estimatedTokensBefore = estimateContextTokens(input);
  const turnCountTrigger = input.turnCountTrigger ?? DEFAULT_TURN_COUNT_TRIGGER;
  const tokenTriggered = estimatedTokensBefore >= softLimitTokens;
  const turnTriggered = input.turns.length >= turnCountTrigger;
  const shouldCompress = tokenTriggered || turnTriggered;
  const triggerReason = tokenTriggered
    ? "token_budget"
    : turnTriggered
      ? "turn_count"
      : "none";

  const recentTurnCount = input.recentTurnCount ?? DEFAULT_RECENT_TURN_COUNT;
  const turnsToSummarize = shouldCompress
    ? input.turns.slice(0, Math.max(0, input.turns.length - recentTurnCount))
    : [];
  const retainedTurns = shouldCompress ? input.turns.slice(-recentTurnCount) : input.turns;
  const summaryUpdate =
    generatedSummary ?? (shouldCompress ? fallbackSummarizeTurns(turnsToSummarize) : "");
  const conversationSummary = shouldCompress
    ? mergeRunningSummary(input.conversationSummary, summaryUpdate)
    : input.conversationSummary?.trim() ?? "";
  const bounded = boundContextBlocks({
    input,
    retainedTurns,
    conversationSummary,
    hardLimitTokens,
  });
  const estimatedTokensAfter = estimateContextTokens({
    ...input,
    ...bounded.blocks,
    conversationSummary,
    turns: retainedTurns,
  });
  const audit: ContextCompressionAudit = {
    pressureRatio: ratio(estimatedTokensBefore, hardLimitTokens),
    tokensSaved: Math.max(0, estimatedTokensBefore - estimatedTokensAfter),
    hardLimitExceeded: estimatedTokensAfter > hardLimitTokens,
    overBudgetTokens: Math.max(0, estimatedTokensAfter - hardLimitTokens),
    recommendedAction:
      estimatedTokensAfter > hardLimitTokens ? "reduce_fixed_context" : "none",
    blockStats: bounded.blockStats,
  };

  return {
    shouldCompress,
    triggerReason,
    estimatedTokensBefore,
    estimatedTokensAfter,
    inputBudgetTokens,
    softLimitTokens,
    hardLimitTokens,
    reservedTokens,
    turnsToSummarize,
    retainedTurns,
    conversationSummary,
    blocks: bounded.blocks,
    audit,
    schemaVersion: CONTEXT_SUMMARY_SCHEMA_VERSION,
  };
}

export function estimateContextTokens(input: ContextCompressionInput): number {
  const turnTokens = input.turns.reduce((total, turn) => total + estimateTurnTokens(turn), 0);
  return (
    estimateTokens(input.systemPrompt) +
    estimateTokens(input.conversationSummary) +
    estimateTokens(input.sessionNotes) +
    estimateTokens(input.systemPromptOverride) +
    estimateTokens(input.currentUserPrompt) +
    estimateTokens(input.memoryContext) +
    estimateTokens(input.sqliteMemory) +
    estimateTokens(input.ocrText) +
    estimateTokens(input.uiTreeText) +
    turnTokens
  );
}

function boundContextBlocks(input: {
  input: ContextCompressionInput;
  retainedTurns: ConversationTurn[];
  conversationSummary: string;
  hardLimitTokens: number;
}): {
  blocks: Required<ContextCompressionBlocks>;
  blockStats: ContextCompressionAudit["blockStats"];
} {
  const rawBlocks = {
    memoryContext: input.input.memoryContext ?? "",
    sqliteMemory: input.input.sqliteMemory ?? "",
    ocrText: input.input.ocrText ?? "",
    uiTreeText: input.input.uiTreeText ?? "",
  };
  const normalizedBlocks = {
    memoryContext: dedupeLines(rawBlocks.memoryContext),
    sqliteMemory: dedupeLines(rawBlocks.sqliteMemory),
    ocrText: dedupeLines(rawBlocks.ocrText),
    uiTreeText: dedupeLines(rawBlocks.uiTreeText),
  };
  const fixedTokens = estimateContextTokens({
    ...input.input,
    memoryContext: "",
    sqliteMemory: "",
    ocrText: "",
    uiTreeText: "",
    turns: input.retainedTurns,
    conversationSummary: input.conversationSummary,
  });
  const available = Math.max(0, input.hardLimitTokens - fixedTokens);
  const budgets = allocateBlockBudgets(available);
  const memoryContext = truncateToTokenBudget(
    normalizedBlocks.memoryContext.text,
    budgets.memoryContext
  );
  const sqliteMemory = truncateToTokenBudget(
    normalizedBlocks.sqliteMemory.text,
    budgets.sqliteMemory
  );
  const ocrText = truncateToTokenBudget(normalizedBlocks.ocrText.text, budgets.ocrText);
  const uiTreeText = truncateToTokenBudget(
    normalizedBlocks.uiTreeText.text,
    budgets.uiTreeText
  );

  return {
    blocks: {
      sqliteMemory,
      memoryContext,
      ocrText,
      uiTreeText,
    },
    blockStats: {
      sqliteMemory: buildBlockStat(
        rawBlocks.sqliteMemory,
        normalizedBlocks.sqliteMemory,
        sqliteMemory,
        budgets.sqliteMemory
      ),
      memoryContext: buildBlockStat(
        rawBlocks.memoryContext,
        normalizedBlocks.memoryContext,
        memoryContext,
        budgets.memoryContext
      ),
      ocrText: buildBlockStat(rawBlocks.ocrText, normalizedBlocks.ocrText, ocrText, budgets.ocrText),
      uiTreeText: buildBlockStat(
        rawBlocks.uiTreeText,
        normalizedBlocks.uiTreeText,
        uiTreeText,
        budgets.uiTreeText
      ),
    },
  };
}

function truncateToTokenBudget(text: string, tokenBudget: number): string {
  if (tokenBudget <= 0) return "";
  if (!text || estimateTokens(text) <= tokenBudget) return text;
  const charBudget = Math.max(1, tokenBudget * 4);
  return truncateText(text, charBudget);
}

function truncateText(text: string, maxChars: number): string {
  const clean = compactWhitespace(text);
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, Math.max(0, maxChars - 28)).trimEnd()} [truncated for context]`;
}

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function dedupeParagraphs(text: string): string {
  const seen = new Set<string>();
  const paragraphs: string[] = [];
  for (const paragraph of text.split(/\n{2,}/)) {
    const clean = compactWhitespace(paragraph);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    paragraphs.push(clean);
  }
  return paragraphs.join("\n\n");
}

function dedupeLines(text: string): { text: string; dedupedLines: number } {
  if (!text.trim()) return { text: "", dedupedLines: 0 };
  const seen = new Set<string>();
  const lines: string[] = [];
  let dedupedLines = 0;
  for (const line of text.split(/\r?\n/)) {
    const clean = compactWhitespace(line);
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (seen.has(key)) {
      dedupedLines++;
      continue;
    }
    seen.add(key);
    lines.push(clean);
  }
  return { text: lines.join("\n"), dedupedLines };
}

function allocateBlockBudgets(
  availableTokens: number
): Record<keyof Required<ContextCompressionBlocks>, number> {
  const weighted = {
    sqliteMemory: 0.22,
    memoryContext: 0.13,
    ocrText: 0.28,
    uiTreeText: 0.37,
  } satisfies Record<keyof Required<ContextCompressionBlocks>, number>;
  const budgets = {
    sqliteMemory: Math.floor(availableTokens * weighted.sqliteMemory),
    memoryContext: Math.floor(availableTokens * weighted.memoryContext),
    ocrText: Math.floor(availableTokens * weighted.ocrText),
    uiTreeText: Math.floor(availableTokens * weighted.uiTreeText),
  };
  let remaining =
    availableTokens -
    budgets.sqliteMemory -
    budgets.memoryContext -
    budgets.ocrText -
    budgets.uiTreeText;
  for (const key of ["uiTreeText", "ocrText", "sqliteMemory", "memoryContext"] as const) {
    if (remaining <= 0) break;
    budgets[key]++;
    remaining--;
  }
  return budgets;
}

function buildBlockStat(
  rawText: string,
  deduped: { text: string; dedupedLines: number },
  finalText: string,
  budgetTokens: number
): ContextBlockStat {
  const originalTokens = estimateTokens(rawText);
  const dedupedTokens = estimateTokens(deduped.text);
  const finalTokens = estimateTokens(finalText);
  return {
    originalTokens,
    dedupedTokens,
    finalTokens,
    budgetTokens,
    truncated: finalTokens < dedupedTokens,
    dedupedLines: deduped.dedupedLines,
  };
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return numerator > 0 ? Number.POSITIVE_INFINITY : 0;
  return Number((numerator / denominator).toFixed(3));
}

function getReservedTokens(input: ContextCompressionInput): number {
  const responseReserve = 1_024;
  const promptScaffoldReserve = 512;
  const imageCount = Math.max(0, input.imageCount ?? 0);
  const imageReserve =
    input.supportsVision || imageCount > 0 ? imageCount * 768 : 0;
  return responseReserve + promptScaffoldReserve + imageReserve;
}

export function getCoveredTurnRange(turns: ConversationTurn[]): {
  coveredTurnStartId: number | null;
  coveredTurnEndId: number | null;
} {
  const ids = turns
    .map((turn) => turn.id)
    .filter((id): id is number => typeof id === "number" && Number.isFinite(id));
  if (ids.length !== turns.length || ids.length === 0) {
    return { coveredTurnStartId: null, coveredTurnEndId: null };
  }
  return {
    coveredTurnStartId: Math.min(...ids),
    coveredTurnEndId: Math.max(...ids),
  };
}
