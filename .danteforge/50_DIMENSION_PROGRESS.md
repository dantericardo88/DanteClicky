---
name: DanteClicky Dimension Progress
description: Tracks which 50-dimension scores have improved and which remain open. Composite 8.43/10 as of 2026-05-09.
type: danteforge-canonical
source: C:\Users\richa\.claude\projects\c--Projects-DanteClicky\memory\project_dimension_progress.md
importedAt: 2026-05-06
---

# DanteClicky Dimension Progress

Reference this before starting score, compete, leapfrog, ascend, or sprint work. Its job is to prevent duplicated effort and keep the 50-dimension matrix honest.

Current composite: **8.43/10**

Session-start composite: **4.2/10**
## Reconciled 2026-05-09

Canonical score is now **8.43/10** after merging the latest evidenced updates: Dim 9 = 9.0, Dim 16 = 8.7, Dim 29 = 8.0, Dim 46 = 9.0, Dim 47 = 7.0. Authoritative JSON mirror: .danteforge/50_DIMENSION_COMPETITIVE_MATRIX.json.

Next four priority dimensions: **47 Cross-platform proof/native parity**, **13 Context depth / multi-screenshot**, **29 Local vision to UI-TARS parity**, **16 Video / temporal proof-hardening**.

Dims meaningfully improved so far: **38 of 50**

## Closed 2026-05-05

| Dim | What | Score Change | How |
|-----|------|--------------|-----|
| 22 | System prompt quality | 7 -> 10 | TTS-optimized macOS Clicky port: no markdown, seed endings, multi-screen labeling |
| 21 | Coordinate accuracy | 6 -> 9 | Removed duplicate `animate_cursor_to` in `OverlayPanel.tsx` that used wrong screen dims |
| 14 + 40 | Screen-share stealth | 3 -> 9 | WDA_EXCLUDEFROMCAPTURE via `SetWindowDisplayAffinity` in `lib.rs` setup |
| 43 | Hotkey ergonomics | 7 -> 9 | HotkeyHint reads `hotkeyBinding` from store; status label and onboarding card dynamic |
| 6 | TTS latency | 6 -> 9 | Sentence-queue pipeline in `useElevenLabs.ts` plus sentence flushing in `useVoice.ts` |
| 31 + 32 | Session + cross-session memory | 5 -> 8, 0 -> 8 | `session.rs` SQLite FTS5; `save_turn` and `get_recent_turns` wired into voice pipeline |
| 34 | Semantic memory search | 0 -> 7 | `search_history` FTS5 called with current transcript, deduped, merged with recent turns |
| 12 | OCR accuracy | 5 -> 8 | `ocr.rs` via Windows.Media.Ocr WinRT, injected as `[ocr text]` block in system prompt |
| 20 | Tool use / MCP | 4 -> 8 | MCP server gains `recall_memory` and `ocr_screen` tools |
| 48 + 49 | Auto-update + auto-start | 0 -> 8 | tauri-plugin-updater wired; GitHub Actions release workflow builds NSIS + `latest.json` |
| 44 | Windows native quality | 6 -> 8 | Release workflow and NSIS configuration |

## Closed 2026-05-06

| Dim | What | Score Change | How |
|-----|------|--------------|-----|
| 3 | STT local fallback | 0 -> 9 | candle-transformers Whisper pure Rust path; tiny.en safetensors; local mode auto-activates post-download |
| 27 | Multi-step agentic loops | 1 -> 8 | Loop resume after safety-gate confirmation; capturedPending; fresh screens; 12 actions; repeat guard + verification |
| 41 | Settings configurability | 6 -> 9 | Settings tab sectioned; prompt override; CU steps slider; memory toggle; opacity slider; panel position toggle |
| 39 | Visual design polish | 7 -> 9 | Copy button on AI bubbles; pending safety-gate card; chat tab decluttered; reusable settings components |
| 42 | Error handling | 4 -> 8 | Exponential backoff retry for 429/500/502/503/504 in `chat_proxy.rs`; non-retryable errors fail fast |
| 37 | First-run onboarding | 2 -> 9 | 8 passes; cannedDemo skip path; error boundary; mic pull; retry pattern; paste-key bypass |
| 38 | Ambient UX partial | 2 -> 3 | Companion panel always-on-top and tray icon; no passive awareness mode yet |
| 38 | Ambient UX full | 3 -> 7 | Passive capture w/ OCR + vision; encryption; privacy exclusions; WebSocket bridge for DanteAgents sharing |
| 7 | TTS voice variety / cloning | 5 -> 7 | ElevenLabs voice presets, model quality selector, local/cloud toggle, and custom voice ID; no clone API or preview |
| 17 | UI tree / accessibility | 6 -> 7 | UIAutomation tree now feeds Set-of-Mark annotation and loop context; still UIA-limited |
| 23 | Context compression | 4 -> 7 | Token/turn-triggered compression, AI/fallback summarizer, persisted summaries, and coverage in `contextCompression.test.ts` |
| 25 | Click / type actions | 6 -> 7 | enigo covers click/double/right/middle/type/scroll/drag/key and overlay verification badge; no live desktop E2E yet |
| 26 | GUI grounding / Set-of-Mark | 1 -> 6 | `somAnnotator.ts` draws numbered UIA boxes into screenshots; `OverlayPanel.tsx` shows badges; capped by primary-screen/UIA-only grounding |
| 27 | Multi-step agentic loops | 8 -> 9 | Observe-act-verify-replan loop, fresh recapture, safety resume, repeat guard, OpenAI loop tests; capped without live desktop E2E |
| 28 | Computer use safety | 5 -> 7 | Tiered confirmation, screen-context heuristics, pending card, keypress allowlist, coordinate/text clamps; no semantic policy classifier |
| 30 | Agent error recovery | 6 -> 7 | Before/after verifier, failed-verifier closed behavior, and loop replanning/stop reasons |
| 34 | Semantic search | 7 -> 8 | OpenAI embeddings -> WASM MiniLM embeddings -> FTS5 fallback with MemoryPanel reindexing |
| 35 | Memory consolidation | 3 -> 6 | Running summaries saved to SQLite and older turns compacted; no digest browser or bounded retention policy |
| 36 | Memory privacy | 5 -> 6 | Clear-history UI clears turns and summaries; no encrypted DB or export/retention policy |

## Hardened 2026-05-07

| Dim | What | Score Change | How |
|-----|------|--------------|-----|
| 23 | Context compression Sprint 2 | 7 -> 9 | Conservative response/image reserves, hard-limit overflow audit, priority-aware block budgets, summary/context dedup, persisted covered-turn ranges, stalled-stream fallback, schema-safe hydration, retention-safe summary pruning, and focused regression tests |
| 28 | Computer use safety Sprint 2 | 7 -> 9 | Non-confirmable tier-4 block policy, prompt-injection/credential-exfiltration/system-compromise detection, OpenAI pending safety-check acknowledgement, refreshed per-step OCR/UI safety context, and OpenAI resume from voice plus PendingActionCard |
| 33 | Preference learning | honest 8.0 -> 9.1 | Earlier matrix carried 9, but harsh pre-sprint score was 8.0. Now append-only preference events, server-owned weights/idempotency, trait-evidence links, confidence/support/conflict/decay/status, editable Preferences review UI, thumbs-down reasons, queued pre-DB feedback, safe prompt gating, rebuild/delete/clear lifecycle, and TypeScript/Rust replay tests are verified |
| 8 | Multilingual support | 3 -> 9.1 | Persisted speech-language selector, AssemblyAI U3 Pro language detection and prompt hints, local Whisper model switching between tiny.en and multilingual tiny, selected-language token forcing, auto language-token detection, and response-language prompt guidance; capped without live multilingual mic E2E and full UI localization |

## Hardened 2026-05-08

| Dim | What | Score Change | How |
|-----|------|--------------|-----|
| D45* | Observability and telemetry | honest 8.7 -> 9.2 | Privacy-first telemetry facade with strict allowlisted catalog, trace/span correlation, native SQLite diagnostics with 14-day retention, redacted crash marker, Tauri log plugin, incognito suppression, opt-in-only PostHog with autocapture/session replay disabled, bounded sanitized remote FIFO/retry queue, settings diagnostics health/catalog, async diagnostics export, and instrumentation across onboarding, model streaming, voice/STT/TTS, screen capture, ambient capture, and computer-use loop safety. Verified by focused telemetry tests, full Vitest suite, TypeScript/build, and Rust lib tests. |

*The imported canonical matrix still labels numeric Dim 45 as "Installer / distribution"; this row tracks the user's explicit D45 Observability and telemetry target until the matrix taxonomy is reconciled.

## Hardened 2026-05-09

| Dim | What | Score Change | How |
|-----|------|--------------|-----|
| 9 | Wake word / always-on voice | 2 -> 9.0 | Opt-in wake mode now uses native VAD to segment idle mic audio, local Whisper to transcribe wake segments, local phrase matching before opening a normal voice turn, and a hard guard so AssemblyAI/cloud STT only receives audio while `voiceState === "listening"`. Companion settings expose wake enable/phrase/sensitivity/status; onboarding says wake word is off by default; wake telemetry is allowlisted with safe metadata only. Verified by 10 focused wake tests, full Vitest 453/453, TypeScript, production build, cargo check, and Rust lib tests. Capped at 9.0 until live mic false-accept/false-reject benchmark, dedicated ONNX keyword spotter, and long-run CPU/battery trace exist. |
| 46 | Startup time | 6 -> 9.0 | Release executable benchmark passed strict startup gates: `bench/startup/results.json` records 30/30 ok, 0 timeouts, app-ready p50 18ms, app-ready p95 37ms, launch-observed p50 55ms, launch-observed p95 155ms. Startup is now tray/hotkey native-first with no eager companion/onboarding webview, lazy companion/onboarding helpers, queued/drained first-hotkey events, native monitor enumeration before webview creation, markerized startup probe, and SessionDb warmup deferred behind native readiness. Verified by startup architecture tests, full Vitest, TypeScript, production build, Rust check/tests, release build, and 30-run benchmark. |
| 47 | Cross-platform | 3 -> 7.0 | Windows-only native crates are target-gated; Windows hardware capture is behind `all(feature = "video-hw-capture", target_os = "windows")`; accessibility, OCR, cursor, and overlay commands expose safe non-Windows fallbacks; `get_platform_capabilities` reports per-OS support and now appears in Settings; build and release workflows matrix Windows/macOS/Linux with official Tauri Linux deps; release splits macOS ARM and Intel; Tauri v2 updater artifacts are enabled; release artifact verification scripts and smoke scaffolding exist; and the SessionDb Tauri state mismatch is fixed. Verified by focused cross-platform architecture tests 8/8, full Vitest 461/461, TypeScript, production build, cargo check, Rust lib tests 135 passed/2 ignored, and Windows `tauri build --no-bundle`. Capped at 7.0 until macOS/Linux CI artifacts, real signing/notarization, and manual smoke evidence exist. |

## Dims Closed - Full List

Dims improved: **3, 6, 7, 8, 9, 12, 14, 16, 17, 20, 21, 22, 23, 25, 26, 27, 28, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 46, 47, 48, 49**

## Still Open

| Priority | Dim | What | Current | Target | Blocker |
|----------|-----|------|--------:|-------:|---------|
| 1 | 47 | Cross-platform proof/native parity | 7.0 | 9 | Run/fix macOS + Linux CI, produce signed/notarized artifacts and Linux packages, add platform permission flows, and smoke tray/menu bar, global shortcut, screenshot, input, onboarding, chat, close-to-tray, and updater checks on all three OSes |
| 2 | 13 | Context depth / multi-screenshot | 7 | 9 | Multi-window stitching, recent-state retrieval, and history snapshots from Dim 16 ring buffer |
| 3 | 29 | Local vision model | 8 | 9 | Reliable full grounding benchmark or UI-TARS/new Moondream coordinate decoder integration |
| 4 | 16 | Video / temporal context | 8.7 | 9+ | Ignored live-screen test observed passing, manual app smoke run, per-keyframe semantic embedding, and perf benchmark evidence |
| 5 | 50 | OSS / licensing clarity | 8 | 9 | Public repo posture, dependency audit, and release-readiness polish |
| 6 | 26 | GUI grounding / Set-of-Mark hardening | 8.5 | 9 | Multi-monitor SoM, more robust labels, object-region fallback beyond UIAutomation |
| 7 | 7 | TTS voice cloning / preview | 9 | 9.3 | Production clone flow and live preview hardening |
| 8 | 35 | Memory consolidation hardening | 9 | 9.3 | Digest browser, compaction audit trail, bounded retention policy |

