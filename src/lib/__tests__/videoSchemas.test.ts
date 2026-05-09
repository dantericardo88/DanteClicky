// Dim 16 — Frontend schema + temporal parser tests.

import { describe, expect, it } from "vitest";
import {
  KeyframeHitZ,
  parseTemporalPhrase,
  SeekResultZ,
  TimelineBucketZ,
  VideoStartOptsZ,
  VideoStatusZ,
} from "../videoSchemas";

describe("videoSchemas — runtime parsers", () => {
  it("VideoStatusZ accepts the Rust shape", () => {
    const parsed = VideoStatusZ.parse({
      running: true,
      ram_bytes: 0,
      ram_segments: 0,
      disk_segments: 5,
      disk_bytes: 1234567,
      current_fps: 0.5,
      dropped_frames: 0,
      uptime_seconds: 600,
    });
    expect(parsed.running).toBe(true);
    expect(parsed.disk_segments).toBe(5);
  });

  it("VideoStartOptsZ applies sane defaults when fields omitted", () => {
    const parsed = VideoStartOptsZ.parse({});
    expect(parsed.fps_min).toBe(0.5);
    expect(parsed.fps_max).toBe(10);
    expect(parsed.disk_minutes).toBe(15);
  });

  it("TimelineBucketZ enforces privacy_flag enum", () => {
    expect(() =>
      TimelineBucketZ.parse({
        segment_id: 1,
        monitor_idx: 0,
        start_ts: "2026-05-08T10:00:00",
        end_ts: null,
        duration_ms: 60_000,
        byte_size: 1000,
        privacy_flag: "bogus",
      }),
    ).toThrow();
  });

  it("SeekResultZ allows null ambient_snapshot_id", () => {
    const parsed = SeekResultZ.parse({
      keyframe_id: 1,
      segment_id: 2,
      pts_ms: 500,
      ocr_text: "hi",
      active_window: "Notepad",
      ambient_snapshot_id: null,
    });
    expect(parsed.ambient_snapshot_id).toBeNull();
  });

  it("KeyframeHitZ array round-trips", () => {
    const arr = KeyframeHitZ.array().parse([
      { keyframe_id: 1, segment_id: 1, pts_ms: 0, ocr_snippet: "stripe" },
      { keyframe_id: 2, segment_id: 2, pts_ms: 1000, ocr_snippet: "notion" },
    ]);
    expect(arr).toHaveLength(2);
  });
});

describe("parseTemporalPhrase", () => {
  const fixedNow = new Date("2026-05-08T10:00:00Z");

  it("parses 'N minutes ago'", () => {
    const ts = parseTemporalPhrase("show me 5 minutes ago", fixedNow);
    expect(ts).toBe("2026-05-08T09:55:00");
  });

  it("parses 'N seconds ago'", () => {
    const ts = parseTemporalPhrase("what was on screen 30 seconds ago", fixedNow);
    expect(ts).toBe("2026-05-08T09:59:30");
  });

  it("parses 'N hours ago'", () => {
    const ts = parseTemporalPhrase("2 hours ago", fixedNow);
    expect(ts).toBe("2026-05-08T08:00:00");
  });

  it("falls back to default for 'a few minutes ago'", () => {
    const ts = parseTemporalPhrase("a few minutes ago", fixedNow);
    expect(ts).toBe("2026-05-08T09:57:00");
  });

  it("parses 'earlier today' as 2 hours back", () => {
    const ts = parseTemporalPhrase("earlier today", fixedNow);
    expect(ts).toBe("2026-05-08T08:00:00");
  });

  it("returns null for unrecognised phrases", () => {
    expect(parseTemporalPhrase("hello world", fixedNow)).toBeNull();
    expect(parseTemporalPhrase("", fixedNow)).toBeNull();
  });
});
