// Dim 16 — Horizontal timeline scrubber. Each bucket = one fMP4 segment.
// Click selects → caller resolves the seek via useVideoTimeline.seekToTimestamp.

import { CSSProperties } from "react";
import { TimelineBucket } from "../lib/videoSchemas";

export interface TimelineProps {
  buckets: TimelineBucket[];
  onSelect?: (bucket: TimelineBucket) => void;
  selectedSegmentId?: number | null;
  emptyMessage?: string;
}

const styles: Record<string, CSSProperties> = {
  root: {
    width: "100%",
    overflowX: "auto",
    padding: "6px 8px",
    background: "rgba(255,255,255,0.04)",
    borderRadius: 8,
  },
  row: {
    display: "flex",
    gap: 2,
    minHeight: 28,
    alignItems: "stretch",
  },
  bucket: {
    minWidth: 8,
    flexShrink: 0,
    cursor: "pointer",
    borderRadius: 2,
    transition: "transform 60ms ease",
  },
  empty: {
    fontSize: 11,
    opacity: 0.6,
    padding: "8px 0",
    textAlign: "center",
  },
};

function bucketColor(b: TimelineBucket, selected: boolean): string {
  if (selected) return "rgba(10, 132, 255, 0.95)";
  switch (b.privacy_flag) {
    case "excluded":
      return "rgba(255, 200, 0, 0.55)"; // yellow — privacy excluded app
    case "drm_blackout":
      return "rgba(120, 120, 120, 0.7)"; // gray — protected content
    case "incognito":
      return "rgba(180, 60, 200, 0.5)"; // purple — incognito gap
    case "paused":
      return "rgba(160, 160, 160, 0.4)";
    default:
      return "rgba(10, 132, 255, 0.45)"; // blue — captured
  }
}

function bucketTitle(b: TimelineBucket): string {
  const dur = (b.duration_ms / 1000).toFixed(1);
  const mb = (b.byte_size / 1_000_000).toFixed(2);
  return `${b.start_ts} (${dur}s, ${mb} MB) — ${b.privacy_flag}`;
}

export function Timeline({
  buckets,
  onSelect,
  selectedSegmentId = null,
  emptyMessage = "No video captured in this window",
}: TimelineProps) {
  if (buckets.length === 0) {
    return (
      <div style={styles.root}>
        <div style={styles.empty}>{emptyMessage}</div>
      </div>
    );
  }

  // Width per bucket scales with duration so a long segment doesn't get the
  // same visual weight as a 0.5-second one. 1 sec ≈ 2 px (compressible).
  return (
    <div style={styles.root}>
      <div style={styles.row}>
        {buckets.map((b) => {
          const selected = b.segment_id === selectedSegmentId;
          const widthPx = Math.max(8, Math.min(240, (b.duration_ms / 1000) * 2));
          return (
            <div
              key={b.segment_id}
              role="button"
              tabIndex={0}
              title={bucketTitle(b)}
              aria-label={bucketTitle(b)}
              onClick={() => onSelect?.(b)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") onSelect?.(b);
              }}
              style={{
                ...styles.bucket,
                width: widthPx,
                background: bucketColor(b, selected),
                outline: selected ? "1px solid rgba(255,255,255,0.7)" : "none",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
