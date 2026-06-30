import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useCompanionStore } from "../state/companionStore";
import { captureTelemetryError, recordTelemetryEvent, startTelemetrySpan } from "../lib/telemetry";

const AMBIENT_STARTUP_GRACE_MS = 10_000;
const AMBIENT_RETENTION_PRUNE_DELAY_MS = 15_000;

// Pixel-hash: sample every Nth character from the JPEG base64 string.
// Cheap O(1) change detector — catches any significant screen update.
function quickPixelHash(b64: string, samples = 64): string {
  if (!b64) return "";
  const step = Math.max(1, Math.floor(b64.length / samples));
  let hash = 0;
  for (let i = 0; i < b64.length; i += step) {
    hash = ((hash << 5) - hash + b64.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(16);
}

// Normalise a window title for exclusion matching.
function matchesExclusion(windowTitle: string, excludedApps: string): boolean {
  if (!excludedApps.trim() || !windowTitle) return false;
  const lower = windowTitle.toLowerCase();
  return excludedApps
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .some((term) => lower.includes(term));
}

export function useAmbient() {
  const {
    ambientMode,
    ambientIntervalSeconds,
    ambientExcludedApps,
    incognitoMode,
    memoryRetentionDays,
    ambientVisionEnabled,
    moondreamSessionLoaded,
    setLastAmbientWindow,
    setLastAmbientTs,
    setAmbientCapturesToday,
    pushAmbientCaptureDuration,
  } = useCompanionStore();

  // Auto-prune old ambient snapshots on mount using the shared retention setting.
  useEffect(() => {
    if (memoryRetentionDays > 0) {
      const timer = setTimeout(() => {
        invoke("prune_ambient_snapshots", { days: memoryRetentionDays }).catch(() => {});
      }, AMBIENT_RETENTION_PRUNE_DELAY_MS);
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastHashRef = useRef<string>("");
  const isCapturingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firstTickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for values the tick reads — avoids recreating tick (and thus restarting
  // the interval) whenever these change, which would cause an unintended capture.
  const excludedAppsRef = useRef(ambientExcludedApps);
  const incognitoRef = useRef(incognitoMode);
  const ambientVisionEnabledRef = useRef(ambientVisionEnabled);
  const moondreamSessionLoadedRef = useRef(moondreamSessionLoaded);
  useEffect(() => { excludedAppsRef.current = ambientExcludedApps; }, [ambientExcludedApps]);
  useEffect(() => { incognitoRef.current = incognitoMode; }, [incognitoMode]);
  useEffect(() => { ambientVisionEnabledRef.current = ambientVisionEnabled; }, [ambientVisionEnabled]);
  useEffect(() => { moondreamSessionLoadedRef.current = moondreamSessionLoaded; }, [moondreamSessionLoaded]);

  // One ambient tick: capture → hash → OCR if changed → save.
  // Stable identity — only created once. Reads live values via refs.
  const tick = useCallback(async () => {
    if (isCapturingRef.current) {
      recordTelemetryEvent("ambient.capture.skipped", { reason: "overlap" });
      return;
    }
    if (incognitoRef.current) {
      recordTelemetryEvent("ambient.capture.skipped", { reason: "incognito" });
      return;
    }

    isCapturingRef.current = true;
    const span = startTelemetrySpan("ambient.tick", {
      visionEnabled: ambientVisionEnabledRef.current,
      localVisionReady: moondreamSessionLoadedRef.current,
    });
    const tStart = performance.now();
    try {
      // 1. Screenshot primary monitor
      const jpeg: string = await invoke("capture_primary");
      if (!jpeg) {
        span.end({ skipped: "empty_capture" });
        return;
      }

      // 2. Quick change detection
      const hash = quickPixelHash(jpeg);
      const unchanged = hash === lastHashRef.current;
      lastHashRef.current = hash;
      if (unchanged) {
        span.end({ skipped: "unchanged" });
        return;
      }

      // 3. Get active window title
      let windowTitle = "";
      try {
        windowTitle = await invoke<string>("get_active_window_title");
      } catch {
        // non-critical, continue without it
      }

      // 4. Privacy exclusion check (reads live ref — no tick recreation needed)
      if (matchesExclusion(windowTitle, excludedAppsRef.current)) {
        recordTelemetryEvent("ambient.capture.skipped", { reason: "excluded_app" });
        span.end({ skipped: "excluded_app", hasWindowTitle: Boolean(windowTitle) });
        return;
      }

      // 5. OCR
      let ocrText = "";
      try {
        ocrText = await invoke<string>("ocr_screenshot", { jpegB64: jpeg });
      } catch {
        // OCR optional — save with empty text so window tracking still works
      }

      // 6. Local vision (Moondream2 caption with timeout)
      let visionDesc = "";
      if (ambientVisionEnabledRef.current && moondreamSessionLoadedRef.current) {
        try {
          visionDesc = await Promise.race([
            invoke<string>("moondream_caption", { jpeg_b64: jpeg }),
            new Promise<string>((_, reject) => setTimeout(() => reject(new Error("timeout")), 20000)),
          ]);
        } catch {
          // Vision optional — continue without it
        }
      }

      // 7. Persist snapshot (encrypted at rest)
      const ambientSnapshotId = await invoke<number>("save_ambient_snapshot", {
        ocrText: ocrText.slice(0, 4000), // cap at 4k chars
        activeWindow: windowTitle.slice(0, 200),
        pixelHash: hash,
        visionDesc: visionDesc || null,
      });

      // 7b. Dim 16 — link to video timeline so the keyframe is FTS-searchable
      // and `video_seek` can return this frame for "what was I doing N min ago".
      // Failure is non-fatal: ambient capture still works without video timeline.
      try {
        await invoke("link_ambient_to_video", {
          ambientSnapshotId,
          capturedAtTs: new Date().toISOString().replace(/\.\d+Z$/, ""),
          monitorIdx: 0,
          ocrText: ocrText.slice(0, 4000) || null,
          activeWindow: windowTitle.slice(0, 200) || null,
          thumbJpegB64: null, // Phase 4+ will pass a 160x90 thumbnail here
        });
      } catch { /* video timeline optional */ }

      // Record capture latency only on completed saves (D38 perf proof).
      const elapsedMs = Math.round(performance.now() - tStart);
      pushAmbientCaptureDuration(elapsedMs);

      // Update tray tooltip with today's capture count and sync UI state
      try {
        const today = await invoke<number>("count_ambient_today");
        invoke("set_tray_tooltip", { ambientOn: true, captureCount: today }).catch(() => {});
        // Update store with live ambient status for CompanionPanel to display
        setLastAmbientWindow(windowTitle);
        setLastAmbientTs(Date.now());
        setAmbientCapturesToday(today);
      } catch { /* non-critical */ }
      span.end({
        saved: true,
        elapsedMs,
        hasOcr: Boolean(ocrText.trim()),
        hasVision: Boolean(visionDesc.trim()),
        hasWindowTitle: Boolean(windowTitle),
      });
    } catch (err) {
      captureTelemetryError(err, { route: "ambient.tick" });
      span.fail(err);
      // Non-fatal: ambient failures should never block the main UI
    } finally {
      isCapturingRef.current = false;
    }
  // Stable: reads live state via refs, not closure captures.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep tray tooltip in sync with ambient mode.
  useEffect(() => {
    if (!ambientMode) {
      invoke("set_tray_tooltip", { ambientOn: false, captureCount: 0 }).catch(() => {});
    }
  }, [ambientMode]);

  // Start/stop/restart the interval. Covers all three cases:
  // enable, disable, and interval-change (Effect deps cover all three).
  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (firstTickTimerRef.current) {
      clearTimeout(firstTickTimerRef.current);
      firstTickTimerRef.current = null;
    }
    if (!ambientMode) return;

    // Do not compete with app cold start. The first ambient capture runs after a
    // short grace period, then the regular interval takes over.
    firstTickTimerRef.current = setTimeout(tick, Math.min(ambientIntervalSeconds * 1000, AMBIENT_STARTUP_GRACE_MS));
    timerRef.current = setInterval(tick, ambientIntervalSeconds * 1000);

    return () => {
      if (firstTickTimerRef.current) {
        clearTimeout(firstTickTimerRef.current);
        firstTickTimerRef.current = null;
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [ambientMode, ambientIntervalSeconds, tick]);
}

/** Fetch recent ambient context for injection into AI system prompt. */
export async function getAmbientContext(minutes = 10): Promise<string> {
  try {
    return await invoke<string>("get_ambient_context", { minutes, maxChars: 1200 });
  } catch {
    return "";
  }
}
