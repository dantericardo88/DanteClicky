// Dim 16 / Phase 6 — lifecycle & status hook for the video subsystem.
//
// Mirrors `useAmbient` style: when the user toggles `videoEnabled` ON in the
// companion store, we call `video_start` (with retention/FPS settings) and
// begin polling `video_status` every 5s. When toggled OFF or on unmount, we
// call `video_stop`.
//
// Privacy: keeps the Rust runtime privacy snapshot in sync with the store's
// `incognitoMode` and `ambientExcludedApps` settings via `video_set_privacy`.
//
// Retention: schedules `video_prune_old` once per hour using the user's
// configured `videoRetentionMinutes` setting (converted to days).

import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useCompanionStore } from "../state/companionStore";
import { VideoStatusZ } from "../lib/videoSchemas";
import { recordTelemetryEvent, captureTelemetryError } from "../lib/telemetry";

const STATUS_POLL_MS = 5000;
const PRUNE_INTERVAL_MS = 60 * 60 * 1000; // hourly

export function useVideoSubsystem() {
  const {
    videoEnabled,
    videoRetentionMinutes,
    videoFpsMin,
    videoFpsMax,
    setVideoStatus,
    incognitoMode,
    ambientExcludedApps,
  } = useCompanionStore();

  const statusTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pruneTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync privacy snapshot whenever the relevant store keys change.
  useEffect(() => {
    const exclusions = ambientExcludedApps
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    invoke("video_set_privacy", {
      incognito: incognitoMode,
      paused: false,
      excludedApps: exclusions,
    }).catch(() => {
      // Subsystem may not be running yet — non-fatal.
    });
  }, [incognitoMode, ambientExcludedApps]);

  // Lifecycle: enable/disable + status polling.
  useEffect(() => {
    if (!videoEnabled) {
      invoke("video_stop").catch(() => {});
      setVideoStatus({
        running: false,
        currentFps: 0,
        ramBytes: 0,
        diskBytes: 0,
        droppedFrames: 0,
        uptimeSeconds: 0,
      });
      if (statusTimerRef.current) {
        clearInterval(statusTimerRef.current);
        statusTimerRef.current = null;
      }
      return;
    }

    const startedAt = Date.now();
    invoke("video_start", {
      opts: {
        monitors: [],
        fps_min: videoFpsMin,
        fps_max: videoFpsMax,
        disk_minutes: videoRetentionMinutes,
        ram_minutes: 5,
        segment_seconds: 60,
      },
    })
      .then(() => {
        recordTelemetryEvent("video.start", {
          fps_min: videoFpsMin,
          fps_max: videoFpsMax,
          retention_minutes: videoRetentionMinutes,
        });
      })
      .catch((err) => {
        captureTelemetryError(err, { route: "video.start" });
      });

    let lastRamSegments = 0;
    const poll = async () => {
      try {
        const raw = await invoke<unknown>("video_status");
        const parsed = VideoStatusZ.parse(raw);
        setVideoStatus({
          running: parsed.running,
          currentFps: parsed.current_fps,
          ramBytes: parsed.ram_bytes,
          diskBytes: parsed.disk_bytes,
          droppedFrames: parsed.dropped_frames,
          uptimeSeconds: parsed.uptime_seconds,
        });
        // Phase A7 — emit a `video.tick` event whenever the RAM ringbuf grew
        // since the last poll (i.e. at least one keyframe landed). This makes
        // capture activity verifiable post-hoc from `observability.db`
        // without needing to launch the app and watch.
        if (parsed.ram_segments > lastRamSegments) {
          recordTelemetryEvent("video.tick", {
            current_fps_bucket: parsed.current_fps < 1 ? "low" : parsed.current_fps < 5 ? "mid" : "high",
            ram_segments_delta: parsed.ram_segments - lastRamSegments,
          });
          lastRamSegments = parsed.ram_segments;
        }
      } catch {
        // Suppress — subsystem may briefly stutter on rotation.
      }
    };
    poll();
    statusTimerRef.current = setInterval(poll, STATUS_POLL_MS);

    return () => {
      if (statusTimerRef.current) {
        clearInterval(statusTimerRef.current);
        statusTimerRef.current = null;
      }
      invoke("video_stop").catch(() => {});
      recordTelemetryEvent("video.stop", {
        runtime_ms: Date.now() - startedAt,
      });
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoEnabled, videoRetentionMinutes, videoFpsMin, videoFpsMax]);

  // Hourly retention prune.
  useEffect(() => {
    if (!videoEnabled) return;
    const tick = () => {
      const days = Math.max(1, Math.ceil(videoRetentionMinutes / 1440));
      invoke<number>("video_prune_old", { days }).catch(() => {});
    };
    tick();
    pruneTimerRef.current = setInterval(tick, PRUNE_INTERVAL_MS);
    return () => {
      if (pruneTimerRef.current) {
        clearInterval(pruneTimerRef.current);
        pruneTimerRef.current = null;
      }
    };
  }, [videoEnabled, videoRetentionMinutes]);
}

/** Format bytes as "12.3 MB" / "1.2 GB" — small util used by the UI. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Format an uptime in seconds as "1h 23m" / "45m" / "12s". */
export function formatUptime(secs: number): string {
  if (secs < 60) return `${secs}s`;
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
