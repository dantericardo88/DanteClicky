// Dim 16 — Timeline hook. Polls video_timeline every 5s and exposes typed
// buckets to the React tree. Optional natural-language seek via parseTemporalPhrase.

import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ExtractFrameResult,
  ExtractFrameResultZ,
  KeyframeHit,
  KeyframeHitZ,
  parseTemporalPhrase,
  RecentKeyframe,
  RecentKeyframeZ,
  SeekResult,
  SeekResultZ,
  TimelineBucket,
  TimelineBucketZ,
} from "../lib/videoSchemas";

export interface UseVideoTimelineOpts {
  rangeMinutes?: number;
  monitorIdx?: number | null;
  pollMs?: number;
  enabled?: boolean;
}

export function useVideoTimeline(opts: UseVideoTimelineOpts = {}) {
  const { rangeMinutes = 30, monitorIdx = null, pollMs = 5000, enabled = true } = opts;
  const [buckets, setBuckets] = useState<TimelineBucket[]>([]);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const raw = await invoke<unknown[]>("video_timeline", {
        rangeMinutes,
        monitorIdx: monitorIdx ?? null,
      });
      const parsed = TimelineBucketZ.array().parse(raw);
      setBuckets(parsed);
      setError(null);
    } catch (e: any) {
      setError(typeof e === "string" ? e : e?.message ?? "video_timeline failed");
    }
  }, [rangeMinutes, monitorIdx]);

  useEffect(() => {
    if (!enabled) return;
    refresh();
    timerRef.current = setInterval(refresh, pollMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [enabled, pollMs, refresh]);

  const seekToTimestamp = useCallback(
    async (targetTs: string, monitor?: number | null): Promise<SeekResult | null> => {
      try {
        const raw = await invoke<unknown>("video_seek", {
          targetTs,
          monitorIdx: monitor ?? null,
        });
        if (raw === null || raw === undefined) return null;
        return SeekResultZ.parse(raw);
      } catch (e: any) {
        setError(typeof e === "string" ? e : e?.message ?? "video_seek failed");
        return null;
      }
    },
    [],
  );

  const seekByPhrase = useCallback(
    async (phrase: string): Promise<SeekResult | null> => {
      const ts = parseTemporalPhrase(phrase);
      if (!ts) return null;
      return seekToTimestamp(ts);
    },
    [seekToTimestamp],
  );

  const search = useCallback(async (query: string, limit = 20): Promise<KeyframeHit[]> => {
    try {
      const raw = await invoke<unknown[]>("video_search", { query, limit });
      return KeyframeHitZ.array().parse(raw);
    } catch (e: any) {
      setError(typeof e === "string" ? e : e?.message ?? "video_search failed");
      return [];
    }
  }, []);

  const extractFrame = useCallback(
    async (keyframeId: number): Promise<ExtractFrameResult | null> => {
      try {
        const raw = await invoke<unknown>("video_extract_frame", { keyframeId });
        return ExtractFrameResultZ.parse(raw);
      } catch (e: any) {
        setError(typeof e === "string" ? e : e?.message ?? "video_extract_frame failed");
        return null;
      }
    },
    [],
  );

  const recentKeyframes = useCallback(
    async (limit = 20, monitor?: number | null): Promise<RecentKeyframe[]> => {
      try {
        const raw = await invoke<unknown[]>("video_recent_keyframes", {
          limit,
          monitorIdx: monitor ?? null,
        });
        return RecentKeyframeZ.array().parse(raw);
      } catch (e: any) {
        setError(typeof e === "string" ? e : e?.message ?? "video_recent_keyframes failed");
        return [];
      }
    },
    [],
  );

  return {
    buckets,
    error,
    refresh,
    seekToTimestamp,
    seekByPhrase,
    search,
    extractFrame,
    recentKeyframes,
  };
}
