// Dim 16 / Phase 5 — temporal context API.
//
// Builds a prose summary of "what has the user been doing recently" by
// reading the encrypted video keyframe index and rendering one line per
// salient activity. Injected into the agent system prompt as a
// `[temporal context]` block (see `buildSystemPrompt.ts`).
//
// Privacy: skips any keyframe whose segment is flagged
// `incognito | drm_blackout | excluded | paused`. Only `normal` keyframes
// contribute to the prose. Cap on output size keeps the agent token
// budget intact even when the user has been busy.

import { invoke } from "@tauri-apps/api/core";
import { RecentKeyframe, RecentKeyframeZ } from "./videoSchemas";

export interface TemporalContextOptions {
  /** Max keyframes to consider (newest first). */
  maxKeyframes?: number;
  /** Restrict to a single monitor index. */
  monitorIdx?: number | null;
  /** Hard cap on the rendered prose length. */
  maxChars?: number;
  /** Coalesce contiguous same-window keyframes into a single line. */
  coalesce?: boolean;
  /** `Date.now()` injection point for tests. */
  now?: number;
  /** Override the `invoke` function for tests. */
  invokeFn?: typeof invoke;
}

const DEFAULT_OPTIONS: Required<Omit<TemporalContextOptions, "monitorIdx" | "now" | "invokeFn">> & {
  monitorIdx: number | null;
} = {
  maxKeyframes: 24,
  monitorIdx: null,
  maxChars: 1200,
  coalesce: true,
};

const PRIVATE_FLAGS = new Set(["incognito", "drm_blackout", "excluded", "paused"]);

export interface CoalescedKeyframe {
  /** Wall-clock time of the latest keyframe in this group. */
  ts: string;
  /** Cleaned active-window title, or "" if unknown. */
  activeWindow: string;
  /** Number of keyframes folded into this line. */
  count: number;
  /** Newest keyframe id in the group (used for thumbnail extraction). */
  keyframeId: number;
}

/** Pure function for testing — render a list of recent keyframes into prose. */
export function renderTemporalContext(
  keyframes: RecentKeyframe[],
  opts: TemporalContextOptions = {},
): string {
  const cfg = { ...DEFAULT_OPTIONS, ...opts };
  const now = opts.now ?? Date.now();

  const visible = keyframes.filter((k) => !PRIVATE_FLAGS.has(k.privacy_flag));
  if (visible.length === 0) return "";

  const groups: CoalescedKeyframe[] = [];
  for (const k of visible) {
    const win = sanitizeWindow(k.active_window);
    const last = groups[groups.length - 1];
    if (cfg.coalesce && last && last.activeWindow === win) {
      last.count += 1;
      // Newest keyframe wins for ts (visible is newest-first per backend)
      continue;
    }
    groups.push({
      ts: k.start_ts,
      activeWindow: win,
      count: 1,
      keyframeId: k.keyframe_id,
    });
  }

  const lines: string[] = [];
  let used = 0;
  for (const g of groups) {
    const ago = humanDuration(now - parseUtc(g.ts));
    const win = g.activeWindow || "(unknown window)";
    const dwell = g.count > 1 ? ` for ${g.count} captures` : "";
    const line = `${ago} ago — ${win}${dwell}`;
    if (used + line.length + 1 > cfg.maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }

  return lines.join("\n");
}

function sanitizeWindow(raw: string): string {
  if (!raw) return "";
  // Strip URL-ish substrings that may contain PII; keep app name segment.
  const noUrl = raw.replace(/https?:\/\/\S+/gi, "");
  return noUrl.trim().slice(0, 120);
}

function parseUtc(iso: string): number {
  // Backend stores `YYYY-MM-DDTHH:MM:SS` with no zone — treat as UTC.
  const ms = Date.parse(iso.endsWith("Z") ? iso : `${iso}Z`);
  return Number.isFinite(ms) ? ms : 0;
}

function humanDuration(ms: number): string {
  if (ms <= 0) return "now";
  const sec = Math.floor(ms / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  const days = Math.floor(hr / 24);
  return `${days}d`;
}

/** Production async API — calls into the Rust `video_recent_keyframes` command. */
export async function getTemporalContext(opts: TemporalContextOptions = {}): Promise<string> {
  const cfg = { ...DEFAULT_OPTIONS, ...opts };
  const callInvoke = opts.invokeFn ?? invoke;
  try {
    const raw = await callInvoke<unknown[]>("video_recent_keyframes", {
      limit: cfg.maxKeyframes,
      monitorIdx: cfg.monitorIdx,
    });
    const parsed = RecentKeyframeZ.array().parse(raw);
    return renderTemporalContext(parsed, opts);
  } catch {
    // Video subsystem may not be running — return empty context.
    return "";
  }
}
