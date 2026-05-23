import { describe, expect, it, vi } from "vitest";
import { classifyError, timeAgo } from "../windows/companion/utils";

describe("companion panel utilities", () => {
  it("classifies authentication failures as settings-actionable key errors", () => {
    const openSettings = vi.fn();

    const classified = classifyError("401 unauthorized invalid_api_key", openSettings);

    expect(classified.headline).toBe("API key invalid");
    expect(classified.actionLabel).toBe("Open Settings");
    classified.onAction?.();
    expect(openSettings).toHaveBeenCalledOnce();
  });

  it("classifies transport failures as connection issues", () => {
    const classified = classifyError("websocket connection closed before ready", vi.fn());

    expect(classified.headline).toBe("Connection issue");
    expect(classified.detail).toBe("Check your internet connection");
  });

  it("classifies AssemblyAI key failures before generic connection wording", () => {
    const openSettings = vi.fn();

    const classified = classifyError(
      "AssemblyAI connection failed: check your AssemblyAI key. No local fallback was attempted.",
      openSettings
    );

    expect(classified.headline).toBe("API key invalid");
    expect(classified.actionLabel).toBe("Open Settings");
  });

  it("formats recent timestamps using compact relative labels", () => {
    vi.setSystemTime(new Date("2026-05-11T12:00:00Z"));

    expect(timeAgo(Date.parse("2026-05-11T11:57:00Z"))).toBe("3m ago");

    vi.useRealTimers();
  });
});
