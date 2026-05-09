// Dim 16 — Zod schemas mirroring the Rust Tauri command surface for video.
// Keeps the frontend honest about what the backend actually returns.

import { z } from "zod";

export const VideoStatusZ = z.object({
  running: z.boolean(),
  ram_bytes: z.number(),
  ram_segments: z.number(),
  disk_segments: z.number(),
  disk_bytes: z.number(),
  current_fps: z.number(),
  dropped_frames: z.number(),
  uptime_seconds: z.number(),
});
export type VideoStatus = z.infer<typeof VideoStatusZ>;

export const VideoStartOptsZ = z.object({
  monitors: z.array(z.number()).default([]),
  fps_min: z.number().default(0.5),
  fps_max: z.number().default(10),
  disk_minutes: z.number().int().default(15),
  ram_minutes: z.number().int().default(5),
  segment_seconds: z.number().int().default(60),
});
export type VideoStartOpts = z.infer<typeof VideoStartOptsZ>;

export const TimelineBucketZ = z.object({
  segment_id: z.number(),
  monitor_idx: z.number(),
  start_ts: z.string(),
  end_ts: z.string().nullable().optional(),
  duration_ms: z.number(),
  byte_size: z.number(),
  privacy_flag: z.enum(["normal", "excluded", "drm_blackout", "paused", "incognito"]),
});
export type TimelineBucket = z.infer<typeof TimelineBucketZ>;

export const SeekResultZ = z.object({
  keyframe_id: z.number(),
  segment_id: z.number(),
  pts_ms: z.number(),
  ocr_text: z.string(),
  active_window: z.string(),
  ambient_snapshot_id: z.number().nullable(),
});
export type SeekResult = z.infer<typeof SeekResultZ>;

export const KeyframeHitZ = z.object({
  keyframe_id: z.number(),
  segment_id: z.number(),
  pts_ms: z.number(),
  ocr_snippet: z.string(),
});
export type KeyframeHit = z.infer<typeof KeyframeHitZ>;

// Phase 4 — extract a single keyframe's encrypted JPEG thumb (decrypted to b64).
export const ExtractFrameResultZ = z.object({
  keyframe_id: z.number(),
  jpeg_base64: z.string().nullable(),
});
export type ExtractFrameResult = z.infer<typeof ExtractFrameResultZ>;

// Phase 5 — recent keyframes (newest first) for temporal context + UI strip.
export const RecentKeyframeZ = z.object({
  keyframe_id: z.number(),
  segment_id: z.number(),
  monitor_idx: z.number(),
  start_ts: z.string(),
  pts_ms: z.number(),
  active_window: z.string(),
  privacy_flag: z.enum(["normal", "excluded", "drm_blackout", "paused", "incognito"]),
  has_thumb: z.boolean(),
});
export type RecentKeyframe = z.infer<typeof RecentKeyframeZ>;

/// Parse a natural-language temporal phrase into a target ISO8601 timestamp.
/// Returns null if no temporal phrase recognised. Pure client-side heuristic —
/// the AI layer can refine this when it sees a chat input that didn't match.
export function parseTemporalPhrase(input: string, now: Date = new Date()): string | null {
  const lower = input.trim().toLowerCase();
  // "N (seconds|minutes|hours) ago"
  const m = lower.match(/(\d+)\s*(second|minute|hour)s?\s*ago/);
  if (m) {
    const n = parseInt(m[1], 10);
    const unitMs = m[2] === "second" ? 1000 : m[2] === "minute" ? 60_000 : 3_600_000;
    const t = new Date(now.getTime() - n * unitMs);
    return t.toISOString().replace(/\.\d+Z$/, "");
  }
  // "a few minutes ago" → 3 min default
  if (lower.includes("few minutes ago")) {
    const t = new Date(now.getTime() - 3 * 60_000);
    return t.toISOString().replace(/\.\d+Z$/, "");
  }
  // "earlier today" → 2 hours ago default
  if (lower.includes("earlier today")) {
    const t = new Date(now.getTime() - 2 * 3_600_000);
    return t.toISOString().replace(/\.\d+Z$/, "");
  }
  return null;
}
