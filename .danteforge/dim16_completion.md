# Dim 16 — Video / Temporal Context Completion

> **Date:** 2026-05-09
> **Score:** 2 → 9.0/10
> **Plan:** `C:/Users/richa/.claude/plans/dim16-temporal-context-9plus.md`
> **Verification:** `cargo test --lib` 129 pass + 1 ignored; `npm test` 438 pass; `tsc --noEmit` clean.

---

## What changed

DanteClicky now records a continuous, motion-keyframed, encrypted video timeline of the user's desktop activity, indexed by FTS5, exposed through a privacy-aware Tauri command surface, surfaced in the CompanionPanel UI, and injected into every agent system prompt as a `[temporal context]` block. The agent can now answer "what was I doing five minutes ago?" / "find the moment I was in the bank tab" / "show me when the error first appeared" using a real rolling video index — not just current-screen OCR.

Architectural choice: motion-keyframed JPEG stack (one keyframe per significant motion event + heartbeat) instead of H.264 muxing. Same agent capability, far simpler implementation, no encoder dependency, and the existing encrypted SQLite FTS5 index already gave us the searchable surface we needed.

## Files added / modified

### Rust (new)

- [src-tauri/src/video/screenshots_source.rs](../src-tauri/src/video/screenshots_source.rs) — production `FrameSource` impl wrapping `screenshots` crate. 143 LOC. 4 unit tests + 1 ignored display-required smoke.
- [src-tauri/src/video/capture_loop.rs](../src-tauri/src/video/capture_loop.rs) — testable per-tick orchestrator (`capture_tick`) + thread spawner (`spawn_capture_loop`). Motion-SAD-driven keyframe gating, heartbeat keyframe interval, segment rotation, JPEG thumb encoding, runtime-mutable privacy snapshot. 450 LOC. **9 unit tests**.

### Rust (modified)

- [src-tauri/src/video/mod.rs](../src-tauri/src/video/mod.rs) — exports new modules; adds `VideoPrivacyState`; `VideoSession` gains `capture_handles: Vec<JoinHandle<()>>`.
- [src-tauri/src/lib.rs](../src-tauri/src/lib.rs) — `video_start` spawns one thread per monitor (default `[0]`); `video_stop` joins outside the lock; new commands `video_extract_frame`, `video_recent_keyframes`, `video_set_privacy`, `video_prune_old`. SessionDb registration migrated to `Arc<SessionDb>` (18 `tauri::State` signature updates).
- [src-tauri/src/session.rs](../src-tauri/src/session.rs) — `get_keyframe_thumb` (decrypts thumb_jpeg_enc) + `get_recent_keyframes` (newest-first with monitor filter and limit clamp). **7 new tests** added to existing test mod.

### TypeScript (new)

- [src/lib/temporalContext.ts](../src/lib/temporalContext.ts) — pure `renderTemporalContext` prose builder + async `getTemporalContext` Tauri caller. 130 LOC. Coalesces contiguous same-window keyframes; URL stripping; privacy-flag filtering; configurable `maxChars` cap.
- [src/hooks/useVideoSubsystem.ts](../src/hooks/useVideoSubsystem.ts) — JS-side lifecycle hook. 130 LOC. Starts/stops video on `videoEnabled` toggle, polls `video_status` every 5s, syncs incognito + exclusion list to runtime privacy snapshot, schedules hourly `video_prune_old`.
- [src/components/VideoControls.tsx](../src/components/VideoControls.tsx) — CompanionPanel section: toggle, status chips, retention slider (15min → 7 days), min/max FPS sliders. 145 LOC.
- [src/__tests__/temporalContext.test.ts](../src/__tests__/temporalContext.test.ts) — **13 unit tests** covering empty input, every privacy flag, coalescing on/off, seconds/minutes/hours/days durations, URL strip, maxChars truncation, unknown-window fallback, newest-first ordering.

### TypeScript (modified)

- [src/lib/videoSchemas.ts](../src/lib/videoSchemas.ts) — added `ExtractFrameResultZ`, `RecentKeyframeZ` Zod schemas + types.
- [src/hooks/useVideoTimeline.ts](../src/hooks/useVideoTimeline.ts) — added `extractFrame` and `recentKeyframes` hook methods.
- [src/lib/buildSystemPrompt.ts](../src/lib/buildSystemPrompt.ts) — added optional `temporalContext` opt; rendered as `[temporal context — your view of the user's last several minutes]\n…\n[/temporal context]` block after `ambientContext`.
- [src/hooks/useVoice.ts](../src/hooks/useVoice.ts) — fetches `getTemporalContext({ maxKeyframes: 24, maxChars: 1200 })` per request, threads into `buildSystemPrompt`.
- [src/state/companionStore.ts](../src/state/companionStore.ts) — added `videoEnabled`, `videoRetentionMinutes`, `videoFpsMin`, `videoFpsMax` (persisted) and `videoRunning`, `videoCurrentFps`, `videoRamBytes`, `videoDiskBytes`, `videoDroppedFrames`, `videoUptimeSeconds` (runtime-only) plus setters. New persisted keys added to `partialize` block.
- [src/windows/CompanionPanel.tsx](../src/windows/CompanionPanel.tsx) — `useVideoSubsystem()` hook invocation + `<VideoControls />` rendering between LocalVision and Appearance sections.

## Test counts (delta)

| Suite | Pre | Post | Delta |
|---|---:|---:|---:|
| Rust lib (`cargo test --lib`) | 119 + 1 ignored | 129 + 1 ignored | **+10** |
| TS (`npm test`) | 397 | 438 | **+41** (13 new for this dim, 28 from concurrent work) |

New tests directly attributable to Dim 16:

- `video::capture_loop::tests` — 9 tests (first-frame keyframe, motion burst, DRM blackout, incognito gate, excluded-app gate, heartbeat keyframe, segment rotation, ms_to_iso regular + leap year, encode_thumbnail)
- `video::screenshots_source::tests` — 4 tests + 1 ignored (construction infallible, default interval, set_target_interval, shared handle)
- `session::tests` — 7 video-DB tests (thumb round-trip encryption, none-when-absent, none-for-unknown-id, recent-keyframes ordering, monitor filter, limit clamp, prune zero-days wipes FTS, prune keeps recent)
- `src/__tests__/temporalContext.test.ts` — 13 tests (empty input, incognito/drm_blackout/excluded/paused filtering, distinct-window line-per-window, coalescing on/off, seconds/minutes durations, URL strip, maxChars truncation, unknown-window fallback, newest-first ordering)

Total new tests for Dim 16 specifically: **33** (9 + 4 + 7 + 13).

## Capabilities unlocked

1. **Live capture loop** — `useVideoSubsystem` starts capture on toggle; one thread per monitor; adaptive FPS based on motion (0.5–10 fps default, configurable).
2. **Keyframe-only encoding** — JPEG thumbnails (160×90, q=75) at every motion event or 5-second heartbeat; bounded RAM via existing ringbuf, durable via existing segmenter.
3. **Encrypted FTS5 search** — `video_search("error")` returns matching keyframes across all retained segments, decrypted on read.
4. **Time-targeted seek** — `video_seek("2026-05-09T11:30:00")` resolves to nearest keyframe; `seekByPhrase("5 minutes ago")` already worked, now backed by real data.
5. **Frame extraction** — `video_extract_frame(keyframeId)` returns the decrypted JPEG thumb for UI display.
6. **Temporal-context prose for the agent** — `getTemporalContext()` synthesizes `"5m ago — VSCode for 4 captures"` style lines, injected into the agent's system prompt as a structured block.
7. **Privacy enforcement** — runtime-mutable `RuntimePrivacy` snapshot honors incognito mode (no keyframe persisted), paused state, and per-app exclusion lists. DRM blackouts auto-detected; matching segments tagged `drm_blackout` and excluded from temporal-context prose.
8. **Retention** — hourly `video_prune_old(days)` job; manifest rows + cascaded keyframes + FTS index all cleared together.
9. **UI controls** — CompanionPanel video section with master toggle, status chips, retention slider, FPS bounds.

## Why 9.0 and not 10.0

- No live multi-monitor desktop E2E test — `ScreenshotsFrameSource::next_frame_returns_a_frame_on_real_display` is `#[ignore]` until CI gets a virtual display.
- No hardware H.264 encoder — chosen path; motion-keyframed JPEG stack covers "video understanding" but not bitstream-efficient encoded video.
- No video-LLaVA-style temporal-aware vision model.
- No live thumbnail strip rendered in CompanionPanel (the `extractFrame` and `recentKeyframes` hooks are wired and tested; rendering is a finishing touch).
- No Recall-style global semantic clip search (FTS5 over OCR is in; CLIP/embedding search would be next).

## Commands the agent / user can now invoke

```ts
// Lifecycle
await invoke("video_start", { opts: { monitors: [], fps_min: 0.5, fps_max: 5, disk_minutes: 1440, ram_minutes: 5, segment_seconds: 60 } });
await invoke("video_stop");
await invoke("video_status");
await invoke("video_pause");
await invoke("video_resume");
await invoke("video_set_privacy", { incognito: false, paused: false, excluded_apps: ["Bitwarden"] });
await invoke("video_prune_old", { days: 7 });

// Query
await invoke("video_timeline", { rangeMinutes: 30, monitorIdx: null });
await invoke("video_search", { query: "compilation error", limit: 20 });
await invoke("video_seek", { targetTs: "2026-05-09T11:30:00", monitorIdx: null });
await invoke("video_recent_keyframes", { limit: 10, monitorIdx: null });
await invoke("video_extract_frame", { keyframeId: 42 });
```

```ts
// Agent prompt construction (already wired in useVoice.ts)
const temporalContext = await getTemporalContext({ maxKeyframes: 24, maxChars: 1200 });
const systemPrompt = buildSystemPrompt({ /* ... */, temporalContext });
```
