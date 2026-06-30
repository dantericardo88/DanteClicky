import { describe, expect, it } from "vitest";
import {
  DEFAULT_RECENT_TURN_COUNT,
  buildCompressedContext,
  estimateTokens,
  fallbackSummarizeTurns,
  getCoveredTurnRange,
  mergeRunningSummary,
  shouldCompressContext,
} from "../lib/contextCompression";
import type { ConversationTurn } from "../state/companionStore";

function turn(index: number, size = 20): ConversationTurn {
  return {
    id: index,
    userPrompt: `user turn ${index} ${"u".repeat(size)}`,
    assistantResponse: `assistant turn ${index} ${"a".repeat(size)}`,
  };
}

describe("context compression policy", () => {
  it("does not summarize nine short turns", () => {
    const turns = Array.from({ length: 9 }, (_, i) => turn(i + 1));
    const plan = buildCompressedContext({
      provider: "claude",
      modelId: "claude-sonnet-4-6",
      turns,
      currentUserPrompt: "current request",
    });

    expect(plan.shouldCompress).toBe(false);
    expect(plan.retainedTurns).toEqual(turns);
    expect(plan.turnsToSummarize).toHaveLength(0);
  });

  it("triggers by estimated token budget, not only turn count", () => {
    const turns = [turn(1), turn(2)];
    const plan = buildCompressedContext({
      provider: "openai",
      modelId: "gpt-4o",
      turns,
      currentUserPrompt: "current request",
      memoryContext: "m".repeat(4_000),
      inputBudgetTokens: 1_000,
    });

    expect(plan.shouldCompress).toBe(true);
    expect(plan.triggerReason).toBe("token_budget");
    expect(shouldCompressContext({
      provider: "openai",
      modelId: "gpt-4o",
      turns,
      memoryContext: "m".repeat(4_000),
      inputBudgetTokens: 1_000,
    })).toBe(true);
  });

  it("handles nine old turns plus the current completed turn without dropping the newest turn", () => {
    const turns = Array.from({ length: 10 }, (_, i) => turn(i + 1));
    const plan = buildCompressedContext({
      provider: "claude",
      modelId: "claude-sonnet-4-6",
      turns,
      currentUserPrompt: "next request",
      inputBudgetTokens: 200_000,
    });

    expect(plan.shouldCompress).toBe(true);
    expect(plan.triggerReason).toBe("turn_count");
    expect(plan.retainedTurns).toHaveLength(DEFAULT_RECENT_TURN_COUNT);
    expect(plan.retainedTurns.at(-1)?.userPrompt).toContain("turn 10");
    expect(plan.turnsToSummarize.at(0)?.userPrompt).toContain("turn 1");
  });

  it("builds a bounded fallback summary and keeps recent turns verbatim", () => {
    const turns = Array.from({ length: 100 }, (_, i) => turn(i + 1, 600));
    const plan = buildCompressedContext({
      provider: "grok",
      modelId: "grok-3",
      turns,
      conversationSummary: "existing project state",
      currentUserPrompt: "what next?",
      inputBudgetTokens: 5_000,
    });

    expect(plan.shouldCompress).toBe(true);
    expect(plan.retainedTurns).toHaveLength(DEFAULT_RECENT_TURN_COUNT);
    expect(plan.conversationSummary).toContain("existing project state");
    expect(plan.conversationSummary).toContain("Earlier conversation summary");
    expect(plan.estimatedTokensAfter).toBeLessThan(plan.estimatedTokensBefore);
  });

  it("merges running summaries and estimates tokens deterministically", () => {
    expect(mergeRunningSummary("old", "new")).toBe("old\n\nnew");
    expect(mergeRunningSummary("", "new")).toBe("new");
    expect(estimateTokens("12345")).toBe(2);
    expect(fallbackSummarizeTurns([turn(1)])).toContain("Turn 1");
  });

  it("deduplicates repeated summary paragraphs instead of accumulating stale context", () => {
    expect(
      mergeRunningSummary(
        "User is editing DanteClicky.\n\nThe active task is context compression.",
        "The active task is context compression.\n\nVerifier passed."
      )
    ).toBe("User is editing DanteClicky.\n\nThe active task is context compression.\n\nVerifier passed.");
  });

  it("uses priority-aware block budgets and records per-block compression audit data", () => {
    const plan = buildCompressedContext({
      provider: "claude",
      modelId: "claude-sonnet-4-6",
      turns: Array.from({ length: 12 }, (_, i) => turn(i + 1)),
      currentUserPrompt: "continue the task",
      memoryContext: Array.from({ length: 400 }, (_, i) => `screen memory line ${i}`).join("\n"),
      sqliteMemory: Array.from({ length: 400 }, (_, i) => `sqlite memory line ${i}`).join("\n"),
      ocrText: Array.from({ length: 400 }, (_, i) => `ocr text line ${i}`).join("\n"),
      uiTreeText: Array.from(
        { length: 400 },
        (_, i) => `button "Run ${i}" -> [POINT:512,512:Run ${i}:screen1]`
      ).join("\n"),
      inputBudgetTokens: 1_200,
    });

    expect(plan.audit.pressureRatio).toBeGreaterThan(1);
    expect(plan.audit.tokensSaved).toBeGreaterThan(0);
    expect(plan.audit.blockStats.uiTreeText.budgetTokens).toBeGreaterThan(
      plan.audit.blockStats.memoryContext.budgetTokens
    );
    expect(plan.audit.blockStats.ocrText.budgetTokens).toBeGreaterThan(
      plan.audit.blockStats.memoryContext.budgetTokens
    );
    expect(plan.audit.blockStats.uiTreeText.truncated).toBe(true);
  });

  it("keeps bounded context blocks inside the hard limit when fixed context fits", () => {
    const plan = buildCompressedContext({
      provider: "openai",
      modelId: "gpt-4o",
      turns: [turn(1), turn(2)],
      currentUserPrompt: "current request",
      memoryContext: "memory ".repeat(2_000),
      sqliteMemory: "sqlite ".repeat(2_000),
      ocrText: "ocr ".repeat(2_000),
      uiTreeText: "ui ".repeat(2_000),
      inputBudgetTokens: 1_000,
    });

    expect(plan.shouldCompress).toBe(true);
    expect(plan.estimatedTokensAfter).toBeLessThanOrEqual(plan.hardLimitTokens);
    expect(plan.audit.hardLimitExceeded).toBe(false);
  });

  it("reserves response and screenshot headroom for vision-capable providers", () => {
    const plan = buildCompressedContext({
      provider: "claude",
      modelId: "claude-sonnet-4-6",
      turns: [turn(1), turn(2)],
      currentUserPrompt: "what is on my screen?",
      ocrText: "ocr ".repeat(2_000),
      uiTreeText: "ui ".repeat(2_000),
      inputBudgetTokens: 4_000,
      imageCount: 2,
      supportsVision: true,
    });

    expect(plan.reservedTokens).toBeGreaterThanOrEqual(3_000);
    expect(plan.hardLimitTokens).toBeLessThan(Math.floor(4_000 * 0.8));
    expect(plan.audit.hardLimitExceeded).toBe(false);
  });

  it("reports fixed-context overflow instead of pretending compression succeeded", () => {
    const plan = buildCompressedContext({
      provider: "openai",
      modelId: "gpt-4o",
      turns: Array.from({ length: 8 }, (_, i) => turn(i + 1, 1_000)),
      conversationSummary: "summary ".repeat(2_000),
      sessionNotes: "session ".repeat(2_000),
      systemPromptOverride: "override ".repeat(2_000),
      currentUserPrompt: "prompt ".repeat(2_000),
      inputBudgetTokens: 1_000,
    });

    expect(plan.audit.hardLimitExceeded).toBe(true);
    expect(plan.audit.overBudgetTokens).toBeGreaterThan(0);
    expect(plan.audit.recommendedAction).toBe("reduce_fixed_context");
  });

  it("deduplicates repeated lines inside auxiliary context blocks before truncating", () => {
    const duplicateMemory = [
      "[2026-05-06] user: context compression -> me: summarized",
      "[2026-05-06] user: context compression -> me: summarized",
      "[2026-05-06] user: verify build -> me: build passed",
    ].join("\n");
    const plan = buildCompressedContext({
      provider: "grok",
      modelId: "grok-3",
      turns: Array.from({ length: 10 }, (_, i) => turn(i + 1)),
      sqliteMemory: duplicateMemory,
      inputBudgetTokens: 2_000,
    });

    expect(plan.blocks.sqliteMemory.match(/context compression/g)).toHaveLength(1);
    expect(plan.audit.blockStats.sqliteMemory.dedupedLines).toBe(1);
  });

  it("derives covered turn id ranges for persisted compression audit rows", () => {
    expect(getCoveredTurnRange([turn(4), turn(5), turn(6)])).toEqual({
      coveredTurnStartId: 4,
      coveredTurnEndId: 6,
    });
    expect(getCoveredTurnRange([{ userPrompt: "unsaved", assistantResponse: "turn" }])).toEqual({
      coveredTurnStartId: null,
      coveredTurnEndId: null,
    });
  });
});
