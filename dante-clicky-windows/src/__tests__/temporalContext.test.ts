import { describe, expect, it } from "vitest";
import { getTemporalSnapshotContext, renderTemporalContext } from "../lib/temporalContext";
import type { RecentKeyframe } from "../lib/videoSchemas";

const NOW_MS = Date.parse("2026-05-09T12:00:00Z");

function frame(overrides: Partial<RecentKeyframe>): RecentKeyframe {
  return {
    keyframe_id: 1,
    segment_id: 1,
    monitor_idx: 0,
    start_ts: "2026-05-09T11:59:00",
    pts_ms: 0,
    active_window: "Notepad",
    privacy_flag: "normal",
    has_thumb: true,
    ...overrides,
  };
}

describe("renderTemporalContext", () => {
  it("returns empty string when no keyframes", () => {
    expect(renderTemporalContext([], { now: NOW_MS })).toBe("");
  });

  it("filters out incognito segments", () => {
    const out = renderTemporalContext(
      [
        frame({ active_window: "Bank", privacy_flag: "incognito" }),
      ],
      { now: NOW_MS },
    );
    expect(out).toBe("");
  });

  it("filters out drm_blackout segments", () => {
    const out = renderTemporalContext(
      [
        frame({ active_window: "Netflix", privacy_flag: "drm_blackout" }),
      ],
      { now: NOW_MS },
    );
    expect(out).toBe("");
  });

  it("filters out excluded and paused segments", () => {
    const out = renderTemporalContext(
      [
        frame({ active_window: "A", privacy_flag: "excluded" }),
        frame({ active_window: "B", privacy_flag: "paused" }),
      ],
      { now: NOW_MS },
    );
    expect(out).toBe("");
  });

  it("renders one line per distinct active window", () => {
    const out = renderTemporalContext(
      [
        frame({ keyframe_id: 1, start_ts: "2026-05-09T11:59:30", active_window: "Notepad" }),
        frame({ keyframe_id: 2, start_ts: "2026-05-09T11:58:00", active_window: "Chrome" }),
      ],
      { now: NOW_MS },
    );
    const lines = out.split("\n");
    expect(lines.length).toBe(2);
    expect(lines[0]).toContain("Notepad");
    expect(lines[1]).toContain("Chrome");
  });

  it("coalesces contiguous same-window keyframes by default", () => {
    const out = renderTemporalContext(
      [
        frame({ keyframe_id: 1, start_ts: "2026-05-09T11:59:30", active_window: "Notepad" }),
        frame({ keyframe_id: 2, start_ts: "2026-05-09T11:59:20", active_window: "Notepad" }),
        frame({ keyframe_id: 3, start_ts: "2026-05-09T11:59:10", active_window: "Notepad" }),
      ],
      { now: NOW_MS },
    );
    const lines = out.split("\n");
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("3 captures");
  });

  it("does not coalesce when option is false", () => {
    const out = renderTemporalContext(
      [
        frame({ keyframe_id: 1, start_ts: "2026-05-09T11:59:30", active_window: "Notepad" }),
        frame({ keyframe_id: 2, start_ts: "2026-05-09T11:59:20", active_window: "Notepad" }),
      ],
      { now: NOW_MS, coalesce: false },
    );
    expect(out.split("\n").length).toBe(2);
  });

  it("includes seconds-grade duration for very recent keyframes", () => {
    const out = renderTemporalContext(
      [frame({ start_ts: "2026-05-09T11:59:55", active_window: "VSCode" })],
      { now: NOW_MS },
    );
    expect(out).toContain("VSCode");
    // 5 seconds ago → "5s ago" or similar (humanDuration uses bare seconds)
    expect(/\b\d+s\b ago/.test(out)).toBe(true);
  });

  it("includes minutes-grade duration", () => {
    const out = renderTemporalContext(
      [frame({ start_ts: "2026-05-09T11:55:00", active_window: "VSCode" })],
      { now: NOW_MS },
    );
    expect(out).toMatch(/5m ago/);
  });

  it("strips URLs from the active-window string", () => {
    const out = renderTemporalContext(
      [
        frame({
          active_window: "Chrome — https://bank.example.com/login",
          start_ts: "2026-05-09T11:59:00",
        }),
      ],
      { now: NOW_MS },
    );
    expect(out).not.toContain("https://");
    expect(out).not.toContain("bank.example.com");
    expect(out).toContain("Chrome");
  });

  it("respects maxChars cap by truncating to whole lines", () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      frame({
        keyframe_id: i + 1,
        start_ts: "2026-05-09T11:00:00",
        active_window: `App-${i}`,
      }),
    );
    const out = renderTemporalContext(many, { now: NOW_MS, maxChars: 80 });
    expect(out.length).toBeLessThanOrEqual(80);
    // No line should be split mid-string
    for (const line of out.split("\n")) {
      expect(line.length).toBeGreaterThan(0);
    }
  });

  it("treats unknown window as '(unknown window)'", () => {
    const out = renderTemporalContext(
      [frame({ active_window: "", start_ts: "2026-05-09T11:59:00" })],
      { now: NOW_MS },
    );
    expect(out).toContain("(unknown window)");
  });

  it("orders newest first (matching backend ORDER BY DESC)", () => {
    const out = renderTemporalContext(
      [
        frame({ keyframe_id: 1, start_ts: "2026-05-09T11:59:30", active_window: "Newest" }),
        frame({ keyframe_id: 2, start_ts: "2026-05-09T11:55:00", active_window: "Older" }),
      ],
      { now: NOW_MS },
    );
    const lines = out.split("\n");
    expect(lines[0]).toContain("Newest");
    expect(lines[1]).toContain("Older");
  });

  it("includes monitor labels and keyframe anchors", () => {
    const out = renderTemporalContext(
      [
        frame({ keyframe_id: 42, monitor_idx: 1, active_window: "Terminal" }),
      ],
      { now: NOW_MS },
    );

    expect(out).toContain("screen2");
    expect(out).toContain("Terminal");
    expect(out).toContain("keyframe #42");
  });

  it("does not coalesce identical windows across different monitors", () => {
    const out = renderTemporalContext(
      [
        frame({ keyframe_id: 1, monitor_idx: 0, active_window: "VS Code" }),
        frame({ keyframe_id: 2, monitor_idx: 1, active_window: "VS Code" }),
      ],
      { now: NOW_MS },
    );

    expect(out.split("\n")).toHaveLength(2);
  });

  it("builds bounded temporal snapshot images without private keyframes", async () => {
    const invokeFn = async <T>(command: string, args?: unknown): Promise<T> => {
      if (command === "video_recent_keyframes") {
        return [
          frame({ keyframe_id: 1, monitor_idx: 0, active_window: "Newest App", has_thumb: true }),
          frame({ keyframe_id: 2, monitor_idx: 1, active_window: "Bank", privacy_flag: "incognito", has_thumb: true }),
          frame({ keyframe_id: 3, monitor_idx: 1, active_window: "Older App", has_thumb: true }),
        ] as T;
      }
      if (command === "video_extract_frame") {
        const keyframeId = typeof args === "object" && args !== null && "keyframeId" in args
          ? (args as { keyframeId: unknown }).keyframeId
          : null;
        return {
          keyframe_id: keyframeId,
          jpeg_base64: `thumb-${keyframeId}`,
        } as T;
      }
      throw new Error(`unexpected command ${command}`);
    };

    const out = await getTemporalSnapshotContext({
      now: NOW_MS,
      maxImages: 5,
      invokeFn,
    });

    expect(out.text).toContain("Newest App");
    expect(out.text).toContain("Older App");
    expect(out.text).not.toContain("Bank");
    expect(out.images).toEqual(["thumb-1", "thumb-3"]);
    expect(out.imageKeyframes).toEqual([1, 3]);
  });
});
