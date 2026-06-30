import { describe, expect, it, vi } from "vitest";
import {
  createClientTurnId,
  createPreferenceFeedbackQueue,
  shouldUsePreferenceLearning,
  type PreferenceFeedbackEvent,
} from "../lib/preferenceClient";

const gates = {
  memoryEnabled: true,
  preferenceLearningEnabled: true,
  incognitoMode: false,
};

const event: PreferenceFeedbackEvent = {
  signal: "copied_response",
  reason: "user copied the answer",
  rawText: "short answer: restart the service.",
};

describe("preference client helpers", () => {
  it("centralizes the memory/preference/incognito gate", () => {
    expect(shouldUsePreferenceLearning(gates)).toBe(true);
    expect(shouldUsePreferenceLearning({ ...gates, memoryEnabled: false })).toBe(false);
    expect(shouldUsePreferenceLearning({ ...gates, preferenceLearningEnabled: false })).toBe(false);
    expect(shouldUsePreferenceLearning({ ...gates, incognitoMode: true })).toBe(false);
  });

  it("queues feedback until the saved database turn id is available", async () => {
    const record = vi.fn().mockResolvedValue(1);
    const queue = createPreferenceFeedbackQueue({ record });
    const clientTurnId = createClientTurnId();

    await queue.recordForTurn({ clientTurnId }, event, gates);
    expect(record).not.toHaveBeenCalled();

    await queue.flushTurnId(clientTurnId, 42);
    expect(record).toHaveBeenCalledWith({
      turnId: 42,
      signal: "copied_response",
      reason: "user copied the answer",
      rawText: "short answer: restart the service.",
      idempotencyKey: expect.stringContaining(clientTurnId),
    });
  });

  it("does not record or queue feedback when learning is gated off", async () => {
    const record = vi.fn().mockResolvedValue(1);
    const queue = createPreferenceFeedbackQueue({ record });
    await queue.recordForTurn(
      { clientTurnId: "turn-a", id: 10 },
      event,
      { ...gates, incognitoMode: true }
    );

    expect(record).not.toHaveBeenCalled();
    await queue.flushTurnId("turn-a", 10);
    expect(record).not.toHaveBeenCalled();
  });

  it("drops queued feedback if learning is gated off before flush", async () => {
    const record = vi.fn().mockResolvedValue(1);
    const queue = createPreferenceFeedbackQueue({ record });

    await queue.recordForTurn({ clientTurnId: "turn-b" }, event, gates);
    await queue.flushTurnId("turn-b", 11, { ...gates, incognitoMode: true });

    expect(record).not.toHaveBeenCalled();
  });
});
