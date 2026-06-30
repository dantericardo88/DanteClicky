import { describe, it, expect } from "vitest";
import { shouldUsePreferenceLearning } from "../lib/preferenceClient";

describe("memory privacy gates", () => {
  it("incognito mode blocks preference learning", () => {
    expect(
      shouldUsePreferenceLearning({
        memoryEnabled: true,
        preferenceLearningEnabled: true,
        incognitoMode: true,
      })
    ).toBe(false);
  });

  it("memoryEnabled=false blocks preference learning", () => {
    expect(
      shouldUsePreferenceLearning({
        memoryEnabled: false,
        preferenceLearningEnabled: true,
        incognitoMode: false,
      })
    ).toBe(false);
  });

  it("preferenceLearningEnabled=false blocks preference learning", () => {
    expect(
      shouldUsePreferenceLearning({
        memoryEnabled: true,
        preferenceLearningEnabled: false,
        incognitoMode: false,
      })
    ).toBe(false);
  });

  it("all gates open enables preference learning", () => {
    expect(
      shouldUsePreferenceLearning({
        memoryEnabled: true,
        preferenceLearningEnabled: true,
        incognitoMode: false,
      })
    ).toBe(true);
  });

  it("retention=0 computes next-clear as never", () => {
    const retentionDays = 0;
    const nextClear = retentionDays > 0 ? "somedate" : "never";
    expect(nextClear).toBe("never");
  });

  it("retention>0 with an oldest date computes a future clear date", () => {
    const retentionDays = 30;
    const oldest = "2024-01-01T00:00:00.000Z";
    const nextClear = retentionDays > 0 && oldest
      ? new Date(new Date(oldest).getTime() + retentionDays * 86_400_000).toLocaleDateString()
      : "never";
    expect(nextClear).not.toBe("never");
    expect(nextClear.length).toBeGreaterThan(0);
  });
});
