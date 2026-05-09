// Dim 16 / Phase 6 — CompanionPanel section for video & temporal context.
//
// Renders status (running, FPS, RAM/disk usage, dropped frames, uptime),
// the master toggle, retention slider, and FPS bounds editor. The actual
// start/stop/poll is owned by `useVideoSubsystem` (mounted at the panel
// level) — this component is presentational + dispatches setters.

import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useCompanionStore } from "../state/companionStore";
import { formatBytes, formatUptime } from "../hooks/useVideoSubsystem";
import {
  ExtractFrameResultZ,
  RecentKeyframeZ,
  type RecentKeyframe,
} from "../lib/videoSchemas";

interface ThumbnailEntry {
  keyframe: RecentKeyframe;
  jpegBase64: string | null;
}

/** Polls recent-keyframes + lazily fetches thumbs while video is enabled.
 * Cached by keyframe_id so we don't re-fetch the same image repeatedly. */
function useRecentThumbs(videoEnabled: boolean, videoRunning: boolean): ThumbnailEntry[] {
  const [entries, setEntries] = useState<ThumbnailEntry[]>([]);
  const cacheRef = useRef<Map<number, string | null>>(new Map());

  useEffect(() => {
    if (!videoEnabled || !videoRunning) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    const refresh = async () => {
      try {
        const raw = await invoke<unknown[]>("video_recent_keyframes", { limit: 6, monitorIdx: null });
        const keyframes = RecentKeyframeZ.array().parse(raw);
        const next: ThumbnailEntry[] = [];
        for (const k of keyframes) {
          let thumb = cacheRef.current.get(k.keyframe_id);
          if (thumb === undefined && k.has_thumb) {
            try {
              const r = await invoke<unknown>("video_extract_frame", { keyframeId: k.keyframe_id });
              const parsed = ExtractFrameResultZ.parse(r);
              thumb = parsed.jpeg_base64;
              cacheRef.current.set(k.keyframe_id, thumb);
            } catch {
              thumb = null;
            }
          }
          next.push({ keyframe: k, jpegBase64: thumb ?? null });
        }
        if (!cancelled) setEntries(next);
      } catch {
        // Subsystem may stutter; leave previous entries.
      }
    };
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [videoEnabled, videoRunning]);

  return entries;
}

export function VideoControls() {
  const {
    videoEnabled,
    setVideoEnabled,
    videoRetentionMinutes,
    setVideoRetentionMinutes,
    videoFpsMin,
    setVideoFpsMin,
    videoFpsMax,
    setVideoFpsMax,
    videoRunning,
    videoCurrentFps,
    videoRamBytes,
    videoDiskBytes,
    videoDroppedFrames,
    videoUptimeSeconds,
  } = useCompanionStore();

  const retentionLabel =
    videoRetentionMinutes < 60
      ? `${videoRetentionMinutes} min`
      : videoRetentionMinutes < 1440
        ? `${Math.round(videoRetentionMinutes / 60)} hr`
        : `${Math.round(videoRetentionMinutes / 1440)} day${
            videoRetentionMinutes >= 2880 ? "s" : ""
          }`;

  return (
    <section
      className="video-controls"
      aria-label="Video and temporal context"
      style={{
        padding: "12px",
        borderTop: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "8px",
        }}
      >
        <strong>Video & temporal context</strong>
        <label style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <input
            type="checkbox"
            checked={videoEnabled}
            onChange={(e) => setVideoEnabled(e.target.checked)}
            aria-label="Enable video capture"
          />
          <span>{videoEnabled ? "On" : "Off"}</span>
        </label>
      </header>

      {videoEnabled && <ThumbnailStrip videoRunning={videoRunning} />}

      {videoEnabled ? (
        <div className="video-status" style={{ fontSize: "12px", opacity: 0.85 }}>
          <div>
            <span data-testid="video-running-chip">
              {videoRunning ? "● Running" : "○ Idle"}
            </span>
            {" · "}
            <span>{videoCurrentFps.toFixed(1)} fps</span>
            {" · "}
            <span>RAM {formatBytes(videoRamBytes)}</span>
            {" · "}
            <span>Disk {formatBytes(videoDiskBytes)}</span>
          </div>
          <div style={{ marginTop: "4px" }}>
            <span>Up {formatUptime(videoUptimeSeconds)}</span>
            {videoDroppedFrames > 0 && (
              <>
                {" · "}
                <span>{videoDroppedFrames} dropped</span>
              </>
            )}
          </div>
        </div>
      ) : (
        <p style={{ fontSize: "12px", opacity: 0.7, margin: 0 }}>
          Capture is off. Enable to record motion-keyframed activity for "what
          was I doing N minutes ago" and timeline scrub.
        </p>
      )}

      <details style={{ marginTop: "10px" }}>
        <summary style={{ cursor: "pointer", fontSize: "12px" }}>
          Advanced settings
        </summary>
        <div style={{ display: "grid", gap: "8px", marginTop: "8px", fontSize: "12px" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <span>Retention: {retentionLabel}</span>
            <input
              type="range"
              min={15}
              max={10080} // 7 days
              step={15}
              value={videoRetentionMinutes}
              onChange={(e) => setVideoRetentionMinutes(parseInt(e.target.value, 10))}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <span>Min FPS (idle): {videoFpsMin.toFixed(1)}</span>
            <input
              type="range"
              min={0.1}
              max={2}
              step={0.1}
              value={videoFpsMin}
              onChange={(e) => setVideoFpsMin(parseFloat(e.target.value))}
            />
          </label>

          <label style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
            <span>Max FPS (active): {videoFpsMax.toFixed(0)}</span>
            <input
              type="range"
              min={1}
              max={15}
              step={1}
              value={videoFpsMax}
              onChange={(e) => setVideoFpsMax(parseFloat(e.target.value))}
            />
          </label>
        </div>
      </details>
    </section>
  );
}

function ThumbnailStrip({ videoRunning }: { videoRunning: boolean }) {
  const thumbs = useRecentThumbs(true, videoRunning);
  if (thumbs.length === 0) {
    return (
      <div
        data-testid="video-thumbnail-strip-empty"
        style={{ marginTop: "8px", fontSize: "11px", opacity: 0.55 }}
      >
        {videoRunning ? "Capturing… thumbnails will appear here as motion is detected." : "Idle."}
      </div>
    );
  }
  return (
    <div
      data-testid="video-thumbnail-strip"
      style={{
        marginTop: "8px",
        display: "flex",
        gap: "6px",
        overflowX: "auto",
        paddingBottom: "4px",
      }}
    >
      {thumbs.map((entry) => (
        <div
          key={entry.keyframe.keyframe_id}
          title={`${entry.keyframe.start_ts} (+${entry.keyframe.pts_ms}ms) — ${entry.keyframe.active_window}`}
          style={{
            flex: "0 0 auto",
            width: "80px",
            height: "45px",
            borderRadius: "4px",
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.08)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            overflow: "hidden",
          }}
        >
          {entry.jpegBase64 ? (
            <img
              src={`data:image/jpeg;base64,${entry.jpegBase64}`}
              alt={entry.keyframe.active_window || "keyframe"}
              data-testid="video-thumbnail"
              style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
            />
          ) : (
            <span style={{ fontSize: "9px", opacity: 0.5 }}>
              {entry.keyframe.privacy_flag !== "normal"
                ? entry.keyframe.privacy_flag
                : "—"}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
