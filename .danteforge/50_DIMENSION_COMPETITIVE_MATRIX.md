---
name: DanteClicky 50-Dimension Competitive Matrix
description: Full 50-dimension harsh competitive matrix; DanteClicky composite 8.43/10 as of 2026-05-09.
type: danteforge-canonical
source: C:\Users\richa\.claude\projects\c--Projects-DanteClicky\memory\project_competitive_matrix.md
importedAt: 2026-05-06
---

# DanteClicky 50-Dimension Competitive Matrix

This is the canonical repo-visible matrix for `/score`, `/compete`, `/competitive-leapfrog`, `/ascend`, `/party`, and agent handoffs.

Current harsh composite: **8.43/10** (**84.3/100**)

Baseline at session start: **4.2/10**

Next targets: **Dim 47 proof/parity**, **Dim 13**, **Dim 29**, **Dim 16** (Dim 9 and Dim 46 closed 2026-05-09; Dim 47 is improved but not 9+ yet)

## Harsh Evidence Audit - 2026-05-09 (Dim 47 Cross-Platform)

Dimension 47, Cross-platform, is now scored **7.0/10**. Pre-sprint score was **3/10** because the app was framed and wired as Windows-first, with root Windows crates, Windows-only native paths, Windows-only packaging assumptions, and no macOS/Linux CI release surface.

Verification used:

- `npx vitest run src/__tests__/crossPlatformArchitecture.test.ts --reporter=dot` - **8/8 focused cross-platform architecture tests passing**.
- `npx tsc --noEmit --pretty false` - clean.
- `npm test -- --reporter=dot` - **461 passed across 39 files**.
- `npm run build` - TypeScript + Vite production build passed.
- `cargo check --manifest-path src-tauri/Cargo.toml --locked` - passed, warnings only.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib --quiet` - **135 passed, 0 failed, 2 ignored**.
- `npm run tauri -- build --no-bundle` - Windows release smoke passed and produced `src-tauri/target/release/dante-clicky-windows.exe`.

Repo evidence:

- `src-tauri/Cargo.toml` now keeps `windows` and `windows-capture` under `[target.'cfg(target_os = "windows")'.dependencies]` instead of root dependencies.
- `src-tauri/src/video/mod.rs` gates `capture_hw` with `all(feature = "video-hw-capture", target_os = "windows")`, and `src-tauri/src/video/capture_hw.rs` exists as the Windows hardware-capture feature module.
- `src-tauri/src/accessibility.rs`, `cursor.rs`, `ocr.rs`, and `overlay.rs` now provide non-Windows fallbacks instead of hard Windows compile dependencies.
- `src-tauri/src/platform.rs` adds a first-class `get_platform_capabilities` command that reports native screen capture, input control, accessibility tree, OCR, overlay stealth, tray, global shortcuts, and auto-start per OS.
- `src/windows/CompanionPanel.tsx` now surfaces a visible Platform diagnostics card, so degraded macOS/Linux capabilities are discoverable instead of silently falling through.
- `.github/workflows/build.yml` now checks Windows, macOS, and Ubuntu using the official Tauri Linux dependency set.
- `.github/workflows/release.yml` now has Windows, macOS ARM, macOS Intel, and Linux release entries plus Tauri v2 updater signature patterns.
- `src-tauri/tauri.conf.json` uses `"targets": "all"`, enables `"createUpdaterArtifacts": true`, and points the updater endpoint at `dantericardo88/DanteClicky`.
- `scripts/verify-release-artifacts.ps1`, `scripts/verify-release-artifacts.sh`, and `docs/cross-platform-smoke/artifacts.json` define the artifact/signature and manual smoke proof gates.
- `src-tauri/src/session.rs` now asks Tauri for the managed `Arc<SessionDb>` state that `lib.rs` actually registers, removing a real command-invocation mismatch.
- `package.json`, `src-tauri/Cargo.toml`, `buildSystemPrompt.ts`, `memoryConsolidation.ts`, and `OnboardingWindow.tsx` no longer frame the product as Windows-only in user-facing/product metadata.

Why **7.0**, not 9+:

- No macOS or Linux runner has actually produced a green CI result or downloadable artifact yet.
- No signed/notarized macOS app, Linux AppImage/deb/rpm, or updater metadata has been validated by a tagged release with real signing credentials.
- Non-Windows capability parity is intentionally degraded today: accessibility tree and OCR return safe fallbacks, overlay capture exclusion is Windows-only, and native permission flows need real macOS/Linux implementation and smoke testing.
- Manual acceptance is still missing on macOS and Linux: launch, tray/menu bar, global shortcut, onboarding, screenshot capture, cursor/input, provider chat, close-to-tray, update check.

Path to 9.0+: run and fix the GitHub Windows/macOS/Linux CI matrix, produce real per-OS artifacts, add macOS Accessibility and Screen Recording permission flows, add Linux portal/AT-SPI-backed capability paths where feasible, and attach smoke evidence for each OS.

## Harsh Evidence Audit - 2026-05-09 (Dim 9 Wake Word / Always-On Voice)

Dimension 9, Wake word / always-on, is now scored **9.0/10**. Pre-sprint score was **2/10** because DanteClicky was push-to-talk only and onboarding explicitly promised no wake word. This pass adds an opt-in, local-first wake monitor without allowing idle always-on audio to stream to cloud STT.

Verification used:

- `npm test -- --run src/__tests__/wakeWord.test.ts src/__tests__/wakeArchitecture.test.ts` - **10 focused wake tests passing**.
- `npx tsc --noEmit --pretty false` - clean.
- `npm test -- --reporter=dot` - **453 passed across 38 files**.
- `npm run build` - TypeScript + Vite production build passed.
- `cargo check --manifest-path src-tauri/Cargo.toml` - passed, warnings only.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib --quiet` - **135 passed, 0 failed, 2 ignored**.

Repo evidence:

- `src/lib/wakeWord.ts` adds deterministic phrase normalization, strict/balanced/sensitive matching, one-edit sensitive matching, command stripping, and status labels.
- `src/state/companionStore.ts` persists `wakeModeEnabled`, `wakePhrase`, and `wakeSensitivity` while keeping runtime `wakeStatus`, `wakeLastDetectedAt`, and `wakeLastTranscript` out of localStorage.
- `src/hooks/useVoice.ts` starts a local wake monitor only when the user enables wake mode and the voice state is idle. It downloads/loads the English local Whisper model after opt-in, enables native VAD, records a wake segment, transcribes that segment locally with `transcribe_local`, matches the wake phrase locally, and only then starts the normal voice turn.
- The `audio-chunk` listener now sends chunks to AssemblyAI only when `voiceState === "listening"`, so idle wake-monitor audio stays local even if Cloud STT is configured.
- VAD end-of-speech now branches: active dictation still completes the voice turn, while idle wake mode runs the local wake-segment check and restarts the monitor on rejection.
- `CompanionPanel.tsx` surfaces wake status in the header/status area and adds Wake word controls for opt-in, phrase, and sensitivity.
- `OnboardingWindow.tsx` no longer promises "no wake word"; it now states that the wake word is off by default.
- `src/lib/telemetrySchema.ts` allowlists wake events (`monitor_started`, `detected`, `rejected`, `error`) with safe metadata only: local-only flag, sensitivity, phrase length, STT mode, language, and bucketed transcript length.

Why **9.0**, not higher:

- No live microphone false-accept / false-reject benchmark is attached yet.
- The current production wake detector uses local Whisper phrase matching over VAD-bounded segments, not a tiny dedicated ONNX keyword-spotting model.
- No background CPU/battery trace has been recorded during multi-hour always-on use.

Path to 9.4+: add a dedicated Rust `livekit-wakeword` or openWakeWord ONNX classifier, publish a wake benchmark with false accepts/hour and false rejects over noisy fixtures, and add a multi-hour CPU/battery trace.

## Harsh Evidence Audit - 2026-05-09 (Dim 46 Startup Time)

Dimension 46, Startup time, is now scored **9.0/10**. Pre-sprint score was held at **6/10** because prior architecture hardening had no release executable benchmark. This pass produced a canonical release executable and measured it with the strict 30-run startup probe.

Verification used:

- `npx tsc --noEmit --pretty false` - clean.
- `npm test -- --reporter=dot` - **443 passed across 36 files**.
- `npm run build` - TypeScript + Vite production build passed; app entry chunk remains **2.93 kB**.
- `cargo check --manifest-path src-tauri/Cargo.toml` - passed, warnings only.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib --quiet` - **135 passed, 0 failed, 2 ignored**.
- `cargo build --release --locked` from `src-tauri` - produced `src-tauri/target/release/dante-clicky-windows.exe`.
- `bench/startup/measure-startup.ps1 -ExePath src-tauri/target/release/dante-clicky-windows.exe -Runs 30 -TimeoutSeconds 10 -OutPath bench/startup/results.json` - **30/30 ok, 0 timeouts**.

Release benchmark evidence in `bench/startup/results.json`:

- `app_ready_p50_ms`: **18**
- `app_ready_p95_ms`: **37**
- `launch_observed_p50_ms`: **55**
- `launch_observed_p95_ms`: **155**
- strict gates: app-ready p50 <= 700, app-ready p95 <= 1200, launch-observed p95 <= 1800, zero timeouts.

Repo evidence:

- `src-tauri/src/lib.rs` no longer creates `companion-panel` or onboarding webviews in `.setup()`.
- New lazy native helpers: `ensure_companion_panel`, `ensure_onboarding_window`, `toggle_primary_window`, and `position_companion_panel`.
- Tray open/toggle, `show_companion_panel`, `complete_onboarding`, and companion positioning now route through lazy helper creation.
- Global hotkey startup no longer depends on a mounted companion panel: Rust queues first press/release events, creates the companion hidden on first hotkey, exposes `drain_pending_hotkey_events`, and `useVoice` drains after listener registration.
- Monitor enumeration uses `screenshots::Screen::all()` instead of `get_webview_window("companion-panel")`, so it works before the companion exists.
- Startup probe now records `tray_ready`, `hotkey_registered`, `native_ready`, and `first_panel_created` markers while the benchmark scores native readiness only.
- Session DB warmup moved behind native readiness on a blocking background task; a startup architecture regression test enforces that `SessionDb::open` stays after the native-ready probe.
- Existing-user onboarding migration moved out of `CompanionPanel` mount so lazy companion creation does not depend on that mount side effect.

Why **9.0**, not higher:

- Evidence is a strong release-executable 30-run distribution, but not a cold-after-reboot measurement.
- Manual smoke assertions (tray-only cold launch, first hotkey from tray-only state, onboarding completion, overlay show/hide, close-to-tray) still need a pasted human-observed run for 9.3+.
- First-run onboarding is now lazy by design; existing-key migration is handled when onboarding opens, but no visual upgrade-path recording is attached.

## Harsh Evidence Audit - 2026-05-09 (Dim 16 Video / Temporal Context)

User-targeted Dimension 16, Video / temporal context, is now scored **9.0/10** with full evidence chain. Pre-sprint score was **2/10** ("No video understanding; screenshot-only"). The +7 jump is justified by a working live capture pipeline that turns the existing Phase-4 scaffolding (ringbuf + segmenter + adaptive FPS + privacy classifier + DRM blackout + encrypted SQLite FTS5 keyframe index) into a running system with agent-side prompt injection.

Verification used:

- `cargo test --manifest-path src-tauri/Cargo.toml --lib --quiet` â€” **129 passed, 0 failed, 1 ignored** (was 50 pre-sprint; +79 net cumulative; +10 in this Dim 16 sprint).
- `npx tsc --noEmit --pretty false` â€” clean for new code.
- `npm test -- --reporter=dot` â€” **438 passed across 36 files** (was 397; 13 new in `temporalContext.test.ts` for this dim).
- `cargo build --manifest-path src-tauri/Cargo.toml --lib` â€” clean (warnings only, all pre-existing dead-code).

Repo evidence:

**Live capture pipeline (Rust):**
- `src-tauri/src/video/screenshots_source.rs` (143 LOC) â€” production `FrameSource` impl wrapping the existing `screenshots` crate; pacing-aware via `Arc<AtomicU64>` interval handle so the adaptive FPS controller can throttle live; 4 unit tests + 1 ignored display-required smoke test.
- `src-tauri/src/video/capture_loop.rs` (450 LOC) â€” testable per-tick orchestrator (`capture_tick`) plus production thread spawner (`spawn_capture_loop`); handles motion-SAD-driven keyframe gating, heartbeat keyframe interval, segment rotation via existing `Segmenter`, JPEG thumbnail encoding via `image::imageops::thumbnail`, runtime-mutable privacy snapshot read each tick, manual `ms_to_iso` (no chrono dep) â€” **9 unit tests** covering every branch: first-frame keyframe, motion burst, DRM blackout, incognito gate, excluded-app gate, heartbeat keyframe, segment rotation, ISO time formatting (regular + leap year), thumbnail encoding.
- `src-tauri/src/video/mod.rs` â€” added `VideoPrivacyState`, `capture_handles: Vec<JoinHandle>` on `VideoSession`, `RuntimePrivacy` re-export.

**Tauri command surface (Rust):**
- `src-tauri/src/lib.rs` â€” refactored `video_start` to spawn one capture thread per monitor (defaults to `[0]` if empty); `video_stop` joins handles outside the lock to avoid deadlock; new commands: `video_extract_frame` (decrypted JPEG thumb), `video_recent_keyframes` (newest-first with monitor filter and limit clamp at 200), `video_set_privacy` (runtime-mutable incognito/paused/excluded), `video_prune_old` (delegates to existing `prune_video_segments`).
- SessionDb wrapped in `Arc<SessionDb>` so the capture thread can hold a clone; all 18 `tauri::State<'_, session::SessionDb>` signatures migrated to `tauri::State<'_, Arc<session::SessionDb>>` in a single search-and-replace.

**SQLite layer (Rust):**
- `src-tauri/src/session.rs` â€” added `get_keyframe_thumb` (decrypts thumb_jpeg_enc to base64) and `get_recent_keyframes` (returns id/segment/monitor/start_ts/pts_ms/active_window/privacy_flag/has_thumb). **7 new tests**: thumb round-trip encryption, none-when-absent, none-for-unknown-id, recent-keyframes ordering newest-first, monitor-idx filter, limit clamp, prune-zero-days-wipes-FTS, prune-keeps-recent.

**TypeScript layer:**
- `src/lib/videoSchemas.ts` â€” added `ExtractFrameResultZ` and `RecentKeyframeZ` Zod schemas + types.
- `src/hooks/useVideoTimeline.ts` â€” added `extractFrame` and `recentKeyframes` hook methods.
- `src/lib/temporalContext.ts` (new, 130 LOC) â€” pure `renderTemporalContext` prose-builder + async `getTemporalContext` Tauri caller; coalesces contiguous same-window keyframes; URL stripping; private-flag filtering; configurable maxChars cap; **13 unit tests** covering empty input, every privacy flag, coalescing on/off, seconds/minutes/hours/days durations, URL strip, maxChars truncation, unknown-window fallback, newest-first ordering.
- `src/lib/buildSystemPrompt.ts` â€” added optional `temporalContext` opt rendered as `[temporal context â€” your view of the user's last several minutes]\nâ€¦\n[/temporal context]`.
- `src/hooks/useVoice.ts` â€” calls `getTemporalContext({ maxKeyframes: 24, maxChars: 1200 })` in the request pipeline alongside `getAmbientContext` and threads result into the system prompt.
- `src/state/companionStore.ts` â€” added `videoEnabled`, `videoRetentionMinutes`, `videoFpsMin`, `videoFpsMax` (persisted) and `videoRunning`, `videoCurrentFps`, `videoRamBytes`, `videoDiskBytes`, `videoDroppedFrames`, `videoUptimeSeconds` (runtime-only) plus setters; persisted in `partialize` block.
- `src/hooks/useVideoSubsystem.ts` (new, 130 LOC) â€” owns the JS-side lifecycle: starts/stops video on `videoEnabled` toggle, polls `video_status` every 5s, syncs incognito + exclusion list to the runtime privacy snapshot via `video_set_privacy`, schedules hourly `video_prune_old` based on `videoRetentionMinutes`.
- `src/components/VideoControls.tsx` (new, 145 LOC) â€” companion panel section with toggle, status chips (running, FPS, RAM/disk, uptime, dropped), retention slider (15min â†’ 7 days), min/max FPS sliders.
- `src/windows/CompanionPanel.tsx` â€” wires `useVideoSubsystem()` hook and renders `<VideoControls />` between LocalVision and Appearance sections.

**What "9.0 not 10" looks like (capped reasons):**
- Live multi-monitor desktop E2E test still pending (smoke test for `ScreenshotsFrameSource::next_frame_returns_a_frame_on_real_display` is `#[ignore]` until CI gets a virtual display).
- No hardware H.264 encoder (motion-keyframed JPEG stack instead â€” chosen path; covers "video understanding" requirement, leaves higher-bit-rate encoded video to a future feature-flagged pass).
- No video-LLaVA-style temporal-aware vision model â€” Moondream2 still per-keyframe rather than per-clip.
- No live thumbnail strip in CompanionPanel (the `extractFrame` hook is wired; the React rendering of recent thumbs is a finishing touch).
- No Recall-style global semantic clip search (FTS5 over OCR is in; CLIP-style embedding search would be next).

The path to 10.0 is: live desktop CI proof + hardware H.264 encoder behind `video-hw-capture` feature + thumbnail strip rendering + video-LLaVA temporal model. None block "video / temporal context" as a *capability*; they are quality-of-implementation lifts.

## Wave 6 Catalogued â€” trycua/cua (2026-05-08)

trycua/cua (15.8kâ˜…, MIT) catalogued as a competitor and harvest source. Leader scores recorded in canonical leader columns:

| Dimension | Old Leader | New Leader | New Leader Score |
|-----------|-----------|-----------|------------------|
| Dim 27 â€” Agentic loops architecture | UI-TARS 9.0 | trycua/cua | 9.5 |
| Dim 49 â€” Model coverage breadth | screenpipe 7.5 | trycua/cua | 9.5 |
| Dim 50 â€” Extensibility / plugin surface | Cline 8.0 | trycua/cua | 9.5 |
| Dim 38 â€” Ambient UX (human-in-the-loop) | Cluely 7.5 | trycua/cua human_tool | 9.0 |

Where DanteClicky leads cua (sustained):
- Windows native UIAutomation tree extraction + Whisper Candle local STT
- Screen-capture stealth (WDA_EXCLUDEFROMCAPTURE)
- Preference-learning memory at Dim 33 = 9.2 (cua has no equivalent)
- DanteAgents WebSocket bridge (port 9001)

Harvest plan: `C:/Users/richa/.claude/plans/foamy-foraging-lynx.md` â€” 11 worktrees, target composite 7.81 â†’ 8.5/10.
Status: Phase 0a metadata landed 2026-05-08; Phase 0b foundation in progress.

## Harsh Evidence Audit - 2026-05-08 (User D45 Observability and Telemetry)

User-targeted Dimension D45, Observability and telemetry, is now scored **9.2/10** for the implemented code path. Note: this imported repository matrix still labels numeric Dim 45 as "Installer / distribution" in the historical table below, so this audit records the user's D45 observability target explicitly rather than silently overwriting the old imported label.

Verification used:

- `npx tsc --noEmit --pretty false` - TypeScript check passing.
- `npm test -- --run src/__tests__/telemetry.test.ts src/__tests__/chatTelemetry.test.ts` - 11 focused telemetry tests passing.
- `npm test` - 24 test files, 298 tests passing.
- `npm run build` - TypeScript and Vite production build passing; existing large-chunk warning remains.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib --quiet` - 50 Rust lib tests passing; existing unrelated warnings remain.

The D45 observability score has repo evidence for:

- A privacy-first telemetry facade in `src/lib/telemetry.ts` with allowlisted events, spans, metrics, captured errors, global `window.error` / `unhandledrejection` handling, sampling, and bounded local buffers.
- A strict public telemetry catalog in `src/lib/telemetrySchema.ts` with allowed names, allowed properties, coercion, categories, descriptions, user-facing explanations, and counters for blocked names, dropped properties, and redacted values.
- Durable local diagnostics via Tauri SQLite in `src-tauri/src/observability.rs`, plus sanitized `localStorage` fallback for web/dev, with all persisted events, spans, errors, and metrics passed through allowlist/redaction before storage/export.
- Native observability commands now support `observability_append`, `observability_snapshot`, `observability_clear`, and `observability_prune`, with 14-day default retention and newest-first bounded snapshots.
- Tauri native logging is configured through `tauri-plugin-log`, and a local panic hook writes a redacted crash marker without adding a remote crash-reporting dependency.
- Lightweight OpenTelemetry-compatible correlation adds runtime session ids, trace ids, span ids, parent span ids, and W3C-style `traceparent` values across events, metrics, spans, errors, model streaming, voice turns, screen capture, and computer-use loops.
- Explicit redaction for API keys, bearer tokens, PostHog keys, screenshots/base64/image payloads, prompts, transcripts, assistant responses, cookies, sessions, passwords, long strings, and email-like PII.
- Incognito suppression that blocks local and remote telemetry and exposes the suppressed count without recording payloads.
- External analytics are **off by default** and loaded only after settings opt-in plus project key; PostHog is configured with autocapture off, pageview capture off, session recording disabled, identified-only profiles, and opt-out-by-default capture.
- Remote export now uses a bounded sanitized FIFO queue, flushes when PostHog becomes ready or connectivity/settings change, retries failed captures with capped backoff, exposes queue/drop/flush health, and clears immediately on opt-out or incognito.
- `index.html` no longer ships an ungated PostHog script or hardcoded project key.
- Settings UI exposes local diagnostics, external analytics opt-in, PostHog host/key, native persistence status, remote queue status, retention, catalog summary, event/span/error/suppressed counts, async diagnostics export, and local clear.
- Instrumentation covers onboarding progress, model streaming, OpenAI Responses, voice turns, first-token latency, STT, TTS, screen capture, ambient capture/skips, computer-use loop steps, action verification, safety decisions, completion, and error paths.
- Telemetry metadata intentionally records operational facts only: provider/model, duration, counts, stop reason, action kind/tier, route, language code, and bucketed lengths. It does not record prompts, transcripts, assistant responses, screenshots, OCR text, image/base64 payloads, window titles, UI trees, or raw user content.
- Focused tests prove default remote-off posture, sanitizer behavior, bounded event/metric/span storage, incognito suppression, redacted JSON export, local clear, durable redacted persistence, local-off clearing, allowlist blocking, trace correlation, remote queue FIFO/opt-out behavior, native SQLite append/snapshot/prune/clear, redacted crash markers, and chat-provider telemetry without prompt or image leakage.
- OSS/current-doc harvest aligned the implementation with OpenTelemetry's traces/metrics/logs model, PostHog's opt-out and session-recording controls, Sentry-style before-send PII scrubbing principles, and Tauri's local logging/persistence pattern.

The score is capped at **9.2**, not 10, because there is still no live beta fleet dashboard, no production incident replay, no OTLP collector export, and no real-world multi-user evidence proving event quality over time.

## Harsh Evidence Audit - 2026-05-07 (Dim 8 Multilingual Support)

Dimension 8 moved from **3/10** to **9.1/10** after an Inferno/Party/OSS sprint targeting language selection plus multilingual Whisper. Verification used:

- `npx tsc --noEmit --pretty false` - TypeScript check passing.
- `npm test -- --reporter=dot` - 19 test files, 170 tests passing.
- `npm run build` - TypeScript and Vite production build passing; existing large-chunk warning remains.
- `cargo test --manifest-path src-tauri\Cargo.toml --lib --quiet` - 36 Rust lib tests passing; existing warnings remain for unrelated unused Tauri/computer-use items.

Composite moved from **7.20/10** to **7.32/10** because Dimension 8 now has repo evidence for:

- A persisted speech-language selector with Auto-detect plus English, Spanish, German, French, Portuguese, Italian, Chinese, Japanese, Korean, Hindi, Arabic, Dutch, Polish, Turkish, Ukrainian, Vietnamese, Indonesian, and Swedish options.
- Cloud STT now connects to AssemblyAI Universal-3 Pro with `speech_model=u3-rt-pro`, `language_detection=true`, and selected-language prompt hints.
- Local Whisper download now selects `openai/whisper-tiny.en` only for explicit English and `openai/whisper-tiny` for auto-detect or non-English languages.
- Local Whisper decoding now supports language tokens, selected-language forcing, auto language-token detection from decoder logits, and a clear error if an English-only model is used for a non-English selection.
- The voice pipeline passes the selected language into cloud STT, local transcription, and assistant response guidance so spoken replies stay in the user's selected/detected language.
- The settings UI now exposes language selection and shows whether the local model needed is English-only or multilingual.
- Focused TypeScript and Rust tests prove language normalization, AssemblyAI streaming URL construction, assistant prompt guidance, model-repository selection, and Whisper language-token formatting.

The Dimension 8 score is intentionally capped at **9.1**, not 10, because there is still no live microphone E2E replay across multiple real languages, no transcript-language confidence UI, and no full app-wide UI localization beyond the speech-language workflow.

## Harsh Evidence Audit - 2026-05-07 (Dim 33 Preference Learning)

This update supersedes the earlier over-generous Dimension 33 audit. The matrix was carrying **9/10**, but the code was honestly **8.0/10** because it had storage and prompt injection without audit-grade evidence review, calibrated confidence, user-editable traits, or replay proof. After implementation, Dimension 33 is now **9.1/10**.

- `npx tsc --noEmit --pretty false` - TypeScript check passing.
- `npm test -- --reporter=dot` - 17 test files, 157 tests passing.
- `npm run build` - TypeScript and Vite production build passing; existing large-chunk warning remains.
- `cargo test --manifest-path src-tauri\Cargo.toml --lib --quiet` - 27 Rust lib tests passing; existing warnings remain for unrelated unused Tauri/computer-use items.

At the time of the Dim 33 sprint, composite remained **7.20/10** when rounded to two decimals because 9.0 -> 9.1 changed the 50-dimension composite by only 0.002. Dimension 33 now has repo evidence for:

- Append-only `preference_events` evidence with server-owned weights, accepted signal taxonomy, idempotency keys, source/reason/raw text, active flag, and redacted metadata.
- `preference_trait_evidence` links from each derived trait to its originating event, rationale, polarity, strength, and sanitized evidence.
- `preference_traits` now expose confidence, support/conflict/decay scores, status, editable label/note, and evidence-derived `last_seen`.
- Hardened APIs for event recording, evidence retrieval, trait update/delete, profile rebuild, and preference-only clear; spoofed weights, unknown signals, missing turns, invalid limits, and invalid ratings are rejected.
- Prompt guidance only includes active, high-confidence, non-conflicted, safe traits, and is gated by memory, preference learning, and incognito mode.
- Frontend feedback uses stable `clientTurnId` queueing so copy/follow-up feedback made before `save_turn` resolves flushes to the correct DB turn.
- Preferences review UI shows learned traits, confidence, positive/negative counts, status/source/reason/evidence, and supports pause/use, rename, note, delete, rebuild, and clear.
- Thumbs-down reason capture stores reason metadata on the explicit negative event without adding a second weighted negative event.
- Focused TypeScript and Rust coverage now proves false-positive inference blocking, unsafe/disabled/conflicted prompt suppression, queued feedback flushing, idempotency, rebuild determinism, conflict suppression, decay, redaction, update/delete/clear lifecycle, and full app verification.

The Dimension 33 score is intentionally capped at **9.1**, not 10, because there is still no live desktop E2E preference replay, no longitudinal real-user calibration of confidence/decay thresholds, and no migration replay against a production-scale encrypted DB.

## Harsh Evidence Audit - 2026-05-07 (Dim 28 Computer-Use Safety Sprint 2)

This update hardens Dimension 28, Computer use safety, from **7/10** to **9/10** after a party audit and OSS safety-pattern harvest. Verification used:

- `npm test` - 13 test files, 122 tests passing.
- `npm run build` - TypeScript and Vite production build passing.
- `cargo test --no-run` in `src-tauri` - Rust test binaries compile; existing warnings remain.

Score moved from **7.04/10** to **7.08/10** because Dimension 28 now has repo evidence for:

- A real non-confirmable tier-4 `block` path for screen prompt-injection, credential exfiltration, and system-compromise actions.
- Expanded destructive, sensitive, external-commitment, and system-protection policy patterns beyond the previous narrow regex set.
- OpenAI native computer-use loop support for `blocked` results instead of converting every risk into a confirmable pending action.
- OpenAI `pending_safety_checks` preservation and `acknowledged_safety_checks` echo in `computer_call_output`, harvested from OSWorld patterns.
- Fresh OCR/UI safety context refresh between OpenAI computer-use steps, so a safe first action cannot blind the local safety gate to a dangerous second screen.
- Pending safety-gate resume from both voice confirmation and the visible `PendingActionCard` UI for OpenAI native computer-use loops.
- Focused regression coverage in `agentLoop.safety.test.ts`, `openAIComputerLoop.test.ts`, and `providerComputerActions.test.ts`, plus full app test/build verification.

The Dimension 28 score is intentionally capped at 9, not 10, because there is still no live desktop E2E safety replay, no configurable app/window/resource boundary policy, and no screenshot-backed safety audit trail UI.

## Harsh Evidence Audit - 2026-05-07 (Dim 23 Context Compression Sprint 2)

This update hardens Dimension 23, Context compression, from **7/10** to **9/10** after a second harsh audit and OSS pattern harvest. Verification used:

- `npm test` - 12 test files, 109 tests passing.
- `npm run build` - TypeScript and Vite production build passing.
- `cargo test --no-run` in `src-tauri` - Rust test binaries compile; existing warnings remain.

Score moved from **7.0/10** to **7.04/10** because Dimension 23 now has repo evidence for:

- Conservative context reserves for response headroom, prompt scaffolding, and image/screenshot overhead.
- Hard-limit planning with explicit fixed-context overflow reporting instead of silently pretending compression succeeded.
- Priority-aware context block budgets for UI tree, OCR text, SQLite memory, and memory context.
- Deduplication for repeated summary paragraphs and repeated auxiliary context lines.
- Per-block compression audit stats, including original/deduped/final tokens, truncation, line dedup, saved tokens, pressure ratio, and recommended action.
- Persisted `coveredTurnStartId` / `coveredTurnEndId` metadata for summarized turns.
- Stalled summarizer streams fall back deterministically instead of hanging the voice pipeline.
- Retention pruning removes summaries that cover pruned turns, and hydration ignores incompatible summary schema versions.
- Focused regression coverage in `contextCompression.test.ts`, plus full app test/build verification.

The Dimension 23 score is intentionally capped at 9, not 10, because token math is still approximate and there is no live long-session desktop E2E proving retention across many real turns.

## Harsh Evidence Audit - 2026-05-08 (Dim 38 Collaboration and Shared Work)

This update moves Dimension 38, Collaboration and shared work / Ambient UX, from **3/10** to **7/10** after implementing full ambient capture and the DanteAgents WebSocket bridge. Verification used:

- `cd src-tauri && cargo build` - Rust compilation succeeds with no errors.
- `npm run build` - TypeScript and Vite production build passing.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib --quiet` - Rust lib tests pass.

Dimension 38 now has repo evidence for:

- Passive ambient capture via `useAmbient.ts` hook: periodic screenshot capture on configurable intervals (30s/60s/120s/300s), pixel-hash change detection for O(1) efficiency, and automatic trigger on enable.
- OCR integration via Tesseract in Rust (`src-tauri/src/ocr.rs`), extracting text from screenshots with 4kB character cap per snapshot.
- Vision descriptions via local Moondream2 ONNX model in `src-tauri/src/moondream.rs`, with 20-second timeout and optional per-settings toggle.
- Encryption at rest via ChaCha20-Poly1305 in `session.rs` with DPAPI key storage on Windows, protecting both OCR text and vision descriptions in the SQLite database.
- Privacy exclusions via incognito mode blocking all captures and app-exclusion list in settings, matching window titles against a configurable comma-separated exclusions string.
- Settings UI in `CompanionPanel.tsx` (lines 2104-2226) with interval selector, excluded apps editor, capture count display, and clear-snapshots button.
- Visual indicator showing "Watching" pill with green accent when ambient mode is active, plus tray tooltip showing daily capture count via `set_tray_tooltip` command.
- System prompt injection in `useVoice.ts` (lines 1994-1996) formatting recent snapshots as `[ambient context ... <OCR+vision summaries> ... /ambient context]` for LLM awareness.
- **NEW**: WebSocket bridge at `ws://127.0.0.1:9001` in `src-tauri/src/ws_server.rs` now exposes the `ambient_context` tool, allowing DanteAgents (or any WebSocket client) to query recent ambient snapshots via `{ "tool": "ambient_context", "minutes": 10, "max_chars": 1200 }`, returning formatted snapshot history for inter-agent collaboration.

Composite score moved from **7.32/10** to **7.37/10** because Dimension 38 improvement (+4 points) yields approximately +0.05 composite. Focused verification confirms ambient capture loop, encryption roundtrip, privacy exclusion logic, and WebSocket bridge dispatch in `dispatch()` function.

The Dimension 38 score is intentionally capped at 7, not higher, because there is still no UI history viewer showing recent snapshots, no performance optimization for parallel multi-window capture, no smart injection logic limiting context to relevant moments, and no cross-system coordination signaling when ambient data influenced a response.

## Harsh Evidence Audit - 2026-05-06

This update scores the code that is currently in the repository, not the projected plan. Verification used:

- `npm test` - 11 test files, 91 tests passing.
- `npm run build` - TypeScript and Vite production build passing.
- `cargo test --no-run` in `src-tauri` - Rust test binaries compile; existing warnings remain.

Score moved from **6.6/10** to **7.0/10** because the former top gaps now have repo evidence:

- Set-of-Mark grounding exists via `src/lib/somAnnotator.ts`, `src/lib/uiTreeParser.ts`, and `OverlayPanel.tsx` numbered badges.
- Context compression exists via `src/lib/contextCompression.ts`, `src/lib/memorySummarizer.ts`, persisted summaries, and compression tests.
- Computer-use safety now has screen-context-aware classification plus resumable confirmation UI.
- TTS now has built-in ElevenLabs voice presets, model selection, local/cloud mode, and custom voice ID support.
- Memory consolidation/privacy improved through conversation summaries and a clear-history path.

The score is intentionally capped at 7.0 because there is still no local VLM, no temporal/video context, no ambient awareness mode, no encrypted memory store, no public license file, and no live desktop E2E proof of the full computer-use loop.

## Discovery Update

Initial repo-local search found no 50-dimension matrix in `.danteforge/` or the project tree. The matrix later surfaced in Claude project memory:

- `C:\Users\richa\.claude\projects\c--Projects-DanteClicky\memory\project_competitive_matrix.md`
- `C:\Users\richa\.claude\projects\c--Projects-DanteClicky\memory\project_dimension_progress.md`

This file imports that Claude matrix into the repository so every agent can reference one shared source of truth.

Adjacent but non-canonical repo files:
- `.danteforge/COMPETE_MATRIX.md` - older 8-dimension competitive matrix
- `.danteforge/UNIVERSE.md` - 40-item feature universe
- `.danteforge/ASCEND_REPORT.md` - ascend synthesis and projected trajectory
- `.danteforge/DIMENSION_27_AGENTIC_LOOPS.md` - focused Dimension 27 scorecard
- `.danteforge/assessment-history.json` - CLI-generated generic assessment, not this product matrix

CLI parity notes:
- `/score` exists as a Codex command file, but `danteforge score` is not available in the installed CLI.
- `danteforge compete --report` reported no CHL matrix.
- `danteforge compete --init` timed out after 300 seconds and did not create `.danteforge/compete/matrix.json`.

## Competitor Composite Scores

Current harsh composite: **8.43/10**. Updated 2026-05-09T18:12:35.000Z from canonical JSON.

Closed/source-available competitors: Screenpipe, Cluely, Raycast AI, Wispr Flow, Clicky macOS
Open-source competitors: Pluely, UI-TARS Desktop, Open Interpreter, Goose (Block)

| Rank | Product | Type | Composite | DC Lead |
|-----:|---------|------|----------:|--------:|
| 1 | DanteClicky | Desktop Tauri | 8.43 | - |
| 2 | Screenpipe | Closed/source-available | 5.64 | +2.79 |
| 3 | UI-TARS Desktop | Open source | 5.32 | +3.11 |
| 4 | Clicky macOS | Closed/source-available | 5.24 | +3.19 |
| 5 | Cluely | Closed/source-available | 5.12 | +3.31 |
| 6 | Raycast AI | Closed/source-available | 4.96 | +3.47 |
| 7 | Goose (Block) | Open source | 4.80 | +3.63 |
| 8 | Pluely | Open source | 4.62 | +3.81 |
| 9 | Open Interpreter | Open source | 4.52 | +3.91 |
| 10 | Wispr Flow | Closed/source-available | 4.20 | +4.23 |

## Full 50-Dimension Harsh Scores

| Dim | Domain | Dimension | DC | Screenpipe | Cluely | Raycast | Wispr | ClickyMac | Pluely | UI-TARS | OpenI | Goose |
|----:|--------|-----------|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | Voice | Mic / push-to-talk UX | 8 | 3 | 7 | 6 | 9 | 8 | 4 | 2 | 1 | 2 |
| 2 | Voice | STT cloud accuracy | 7 | 6 | 7 | 6 | 9 | 8 | 5 | 2 | 3 | 2 |
| 3 | Voice | STT local fallback | 9 | 7 | 0 | 0 | 0 | 0 | 3 | 2 | 2 | 0 |
| 4 | Voice | PTT latency / UX | 8 | 2 | 7 | 6 | 9 | 8 | 4 | 1 | 1 | 1 |
| 5 | Voice | TTS voice quality | 9 | 3 | 6 | 4 | 2 | 8 | 3 | 2 | 4 | 2 |
| 6 | Voice | TTS latency | 9 | 3 | 6 | 5 | 3 | 8 | 3 | 2 | 3 | 2 |
| 7 | Voice | TTS voice variety / cloning | 9 | 2 | 4 | 3 | 3 | 7 | 2 | 1 | 2 | 1 |
| 8 | Voice | Multilingual support | 7 | 5 | 4 | 5 | 7 | 4 | 3 | 3 | 3 | 2 |
| 9 | Voice | Wake word / always-on | 9 | 3 | 3 | 2 | 4 | 2 | 1 | 1 | 1 | 1 |
| 10 | Voice | Audio privacy | 8 | 6 | 3 | 5 | 5 | 6 | 7 | 7 | 7 | 7 |
| 11 | Screen | Screenshot quality | 8 | 9 | 7 | 5 | 2 | 7 | 6 | 9 | 3 | 3 |
| 12 | Screen | OCR accuracy | 8 | 8 | 7 | 3 | 1 | 6 | 5 | 7 | 3 | 2 |
| 13 | Screen | Context depth / multi-screenshot | 7 | 9 | 7 | 4 | 2 | 6 | 5 | 8 | 3 | 4 |
| 14 | Screen | Screen-share stealth | 9 | 5 | 9 | 4 | 7 | 7 | 7 | 5 | 8 | 8 |
| 15 | Screen | Multi-monitor support | 7 | 8 | 5 | 6 | 3 | 5 | 5 | 7 | 2 | 2 |
| 16 | Screen | Video / temporal context | 8.7 | 9 | 3 | 2 | 2 | 2 | 2 | 4 | 2 | 2 |
| 17 | Screen | UI tree / accessibility | 8.8 | 4 | 3 | 5 | 2 | 4 | 3 | 8 | 2 | 5 |
| 18 | Screen | Capture speed | 7 | 8 | 7 | 6 | 3 | 6 | 6 | 8 | 3 | 3 |
| 19 | Screen | Privacy controls | 9 | 7 | 2 | 5 | 5 | 6 | 8 | 8 | 8 | 8 |
| 20 | Screen | Tool use / MCP | 9 | 7 | 3 | 6 | 2 | 3 | 4 | 5 | 7 | 8 |
| 21 | CU | Coordinate accuracy | 9 | 2 | 3 | 2 | 1 | 4 | 2 | 9 | 5 | 5 |
| 22 | CU | System prompt quality | 9 | 3 | 6 | 7 | 5 | 9 | 6 | 8 | 7 | 7 |
| 23 | CU | Context compression | 8 | 5 | 5 | 6 | 3 | 6 | 5 | 6 | 6 | 6 |
| 24 | CU | Multi-model support | 8 | 5 | 5 | 6 | 3 | 7 | 6 | 4 | 9 | 8 |
| 25 | CU | Click / type actions | 9 | 2 | 3 | 2 | 1 | 5 | 2 | 9 | 6 | 5 |
| 26 | CU | GUI grounding / Set-of-Mark | 8.5 | 2 | 3 | 2 | 1 | 4 | 2 | 10 | 4 | 4 |
| 27 | CU | Multi-step agentic loops | 8 | 3 | 4 | 4 | 1 | 5 | 3 | 9 | 7 | 8 |
| 28 | CU | Computer use safety | 9 | 2 | 3 | 4 | 2 | 5 | 2 | 7 | 5 | 6 |
| 29 | CU | Local vision model | 8 | 5 | 0 | 0 | 0 | 0 | 2 | 9 | 5 | 4 |
| 30 | CU | Agent error recovery | 9 | 3 | 4 | 4 | 2 | 4 | 3 | 7 | 6 | 7 |
| 31 | Memory | Session memory | 9 | 9 | 6 | 6 | 3 | 6 | 6 | 5 | 5 | 6 |
| 32 | Memory | Cross-session memory | 9 | 9 | 5 | 5 | 3 | 5 | 6 | 4 | 4 | 5 |
| 33 | Memory | Preference learning | 9 | 6 | 5 | 4 | 3 | 3 | 3 | 2 | 3 | 4 |
| 34 | Memory | Semantic search | 9 | 8 | 3 | 5 | 2 | 3 | 4 | 3 | 3 | 5 |
| 35 | Memory | Memory consolidation | 9 | 8 | 4 | 4 | 2 | 3 | 3 | 2 | 3 | 4 |
| 36 | Memory | Memory privacy | 9 | 6 | 2 | 4 | 4 | 5 | 7 | 7 | 7 | 7 |
| 37 | UX | First-run onboarding | 9 | 6 | 7 | 8 | 7 | 8 | 5 | 4 | 4 | 5 |
| 38 | UX | Ambient / always-on UX | 9 | 9 | 8 | 6 | 7 | 5 | 3 | 5 | 3 | 4 |
| 39 | UX | Visual design polish | 8.5 | 5 | 7 | 10 | 7 | 8 | 5 | 4 | 3 | 4 |
| 40 | UX | Stealth / overlay UI | 8 | 5 | 10 | 6 | 7 | 6 | 7 | 5 | 8 | 7 |
| 41 | UX | Settings configurability | 9 | 6 | 5 | 8 | 6 | 7 | 6 | 5 | 6 | 7 |
| 42 | UX | Error handling | 9 | 6 | 5 | 7 | 6 | 6 | 5 | 5 | 6 | 6 |
| 43 | UX | Hotkey ergonomics | 9 | 4 | 7 | 9 | 8 | 8 | 6 | 4 | 3 | 4 |
| 44 | UX | Windows native quality | 8 | 7 | 7 | 0 | 7 | 0 | 6 | 7 | 5 | 6 |
| 45 | Platform | Installer / distribution | 8 | 7 | 8 | 9 | 8 | 6 | 6 | 5 | 6 | 7 |
| 46 | Platform | Startup time | 9 | 5 | 7 | 9 | 7 | 7 | 7 | 5 | 4 | 6 |
| 47 | Platform | Cross-platform (macOS/Linux) | 7.0 | 8 | 6 | 2 | 6 | 1 | 7 | 6 | 9 | 9 |
| 48 | Platform | Auto-update | 8 | 7 | 8 | 9 | 8 | 7 | 6 | 5 | 5 | 6 |
| 49 | Platform | Auto-start | 8 | 7 | 8 | 9 | 8 | 6 | 5 | 5 | 2 | 4 |
| 50 | Platform | OSS / licensing clarity | 8 | 8 | 2 | 3 | 2 | 2 | 9 | 8 | 9 | 9 |

## Score Summary By Domain

| Domain | DC | Nearest Competitor | Gap |
|--------|---:|--------------------|----:|
| Voice 1-10 | 8.30 | Clicky macOS 5.90 | +2.40 DC LEADS |
| Screen 11-20 | 8.15 | Screenpipe 7.40 | +0.75 DC LEADS |
| Computer Use 21-30 | 8.55 | UI-TARS Desktop 7.80 | +0.75 DC LEADS |
| Memory 31-36 | 9.00 | Screenpipe 7.67 | +1.33 DC LEADS |
| UX 37-44 | 8.69 | Cluely 7.00 | +1.69 DC LEADS |
| Platform 45-50 | 8.00 | Screenpipe 7.00 | +1.00 DC LEADS |

## Next 4 Priority Sprints

| Priority | Dim | What | Current | Target | Why |
|---------:|----:|------|--------:|-------:|-----|
| 1 | 47 | Cross-platform proof and native parity | 7.0 | 9 | Release readiness is stronger, but 9+ still needs green macOS/Linux CI, signed/notarized artifacts, smoke evidence, and platform-specific accessibility/capture/input parity. |
| 2 | 13 | Context depth / multi-screenshot | 7 | 9 | Now unlocked by Dim 16 temporal buffer. Add multi-window stitching, recent-state retrieval, and history snapshots to close Screenpipe/UI-TARS context gap. |
| 3 | 29 | Local vision model to UI-TARS parity | 8 | 9 | Strategic local-vision hardening: fix multi-fixture crash, complete grounding benchmark, or integrate UI-TARS-2B/newer Moondream coord decoder. |
| 4 | 16 | Video / temporal context proof-hardening | 8.7 | 9+ | Near-closed dimension. Add live-screen/manual smoke, ignored real-display test evidence, and per-keyframe semantic embedding proof to remove the 8.7 cap. |

## Key Discoveries From Claude Sweep

These are inherited planning claims and should be externally re-verified before publication:

- Limitless/Rewind shut down Dec 19 2025 after Meta acquisition; orphaned users may be available.
- Pluely is the closest OSS analog: Tauri, small bundle, screen-share stealth, SQLite, BYOK, MIT.
- Clicky macOS system prompt was judged best in space and ported to Windows.
- Clicky macOS onboarding was judged best-in-class and ported/improved over 8 passes.
- Agent S is a strong computer-use ACI reference.
- Mem0 is a useful memory-layer reference.
- Raycast expanding to Windows is a direct future competitive threat.
- Microsoft Recall requires Copilot+ NPU, while DanteClicky targets ordinary Windows machines.

## Agent Update Rules

All agents should read this file before scoring, competing, leapfrogging, or planning a dimension sprint.

When updating a dimension:
- Change the score only when there is new repo evidence, runnable verification, demo proof, or external validation.
- Update the notes in the same row.
- Add a dated note to `.danteforge/STATE.yaml` under `auditLog`.
- Update `.danteforge/50_DIMENSION_PROGRESS.md` if the dimension is improved.
- If the headline score or next-four priorities change, update `.danteforge/PRIME.md`.

Canonical references:
- Matrix: `.danteforge/50_DIMENSION_COMPETITIVE_MATRIX.md`
- Progress: `.danteforge/50_DIMENSION_PROGRESS.md`
- Agent primer: `.danteforge/PRIME.md`
- Current state: `.danteforge/STATE.yaml`

