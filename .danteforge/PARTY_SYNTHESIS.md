# DanteClicky — Party Mode Synthesis
> Generated: 2026-05-05 | PM + Architect + Dev + UX agents

---

## KEY SURPRISES (vs prior assessments)

### SURPRISE 1: The app is even more complete than ASCEND_REPORT said
- **[POINT] → animate_cursor_to is ALREADY WIRED** in OverlayPanel.tsx line 77. Not a missing feature — it's done. ASCEND said it was missing.
- **API key inputs for all 5 providers already exist** in SettingsSection (lines 655-834)
- **STT mode toggle already exists** (line 883-994) with model downloader!
- **Model picker already built** (line 836-881)

### SURPRISE 2: chat_proxy.rs already exists
Architect found `chat_proxy.rs` in the module list — reqwest streaming is already implemented. The blocker is that API keys are still passed as command params (leak via DevTools), not that the proxy doesn't exist.

### SURPRISE 3: Duplicate logic in useVoice.ts
Dev found that useVoice.ts (lines 229-255) duplicates the [POINT] animation logic already in OverlayPanel.tsx. This causes **double-invocation** of `animate_cursor_to`. This is a bug.

---

## PM Synthesis

### Sprint 1 Deliverables (1 week → ship v0.1.0-alpha)
1. **Fix API key security** — move from command param to Tauri secure store (2h) — most critical
2. **Remove useVoice.ts duplicate [POINT] logic** (lines 229-255) — 30min, fixes double-invocation bug
3. **Add session.rs** — SQLite FTS5 session history (4h) — closes memory_context gap
4. **Add input.rs Phase 6 completion** — enigo click/scroll/type commands (3h)
5. **GitHub Releases v0.1.0-alpha** — NSIS build + upload (1h)
6. **Apply for DigiCert EV cert TODAY** — 2 week lead time, can't start later

**NOT in Sprint 1:** MCP server, Screenpipe integration, local Whisper, ws_server.rs

### Top 5 User Stories (Impact Order)
1. "Hold Ctrl+Alt+Space → speak → watch cursor animate to target → click executes → hear TTS confirmation"
2. "All my data stays local: screenshots, transcripts, API keys — nothing touches any server I don't control"
3. "Ask 'What was in that email I saw earlier?' → AI searches my session history → answers correctly"
4. "Toggle between cloud STT (fast) and local Whisper (private, offline)" — ALREADY BUILT, just needs wire-up
5. "DanteClicky appears in my Claude Desktop as an MCP tool for screen capture + computer use"

---

## Architect Synthesis

### Module Graph (confirmed by code audit)
```
lib.rs (orchestrator)
├── audio.rs      → Arc<Mutex<PcmAccumulator>>
├── capture.rs    → rayon parallel JPEG
├── chat_proxy.rs → reqwest streaming → Tauri events  ← ALREADY EXISTS
├── input.rs      → enigo (computer use)
├── stt.rs        → whisper-rs local fallback
├── ws_server.rs  → tokio WebSocket bridge
├── mcp_server.rs → axum HTTP + SSE :9002
├── hotkey.rs, tray.rs, cursor.rs, monitors.rs
```

### Architectural Debt (ordered)
1. **API keys in JS** — chat_proxy.rs takes api_key as command param → leaked via DevTools
2. **Shared state explosion** — need `AppState` container struct to avoid multiple `manage()` calls
3. **useVoice.ts [POINT] duplication** — double-invocation bug, causes 2x cursor movement
4. **No transaction boundaries** — STT + capture can race; WAL SQLite mitigates but needs explicit serialization in session writes

### State Container Pattern (to implement)
```rust
pub struct AppState {
    audio: Arc<Mutex<AudioState>>,
    session: Arc<SessionDb>,       // WAL mode, no Mutex needed
    // add: voice_vad: Arc<VadGate>,  (Phase 11)
}
// lib.rs: .manage(AppState::new(&app)?)
```

### Concurrency Safety
- Audio capture ↔ STT: safe via VAD flush → `VadDecision::SilenceAfterSpeech`
- AI streaming ↔ WebSocket: needs Tokio channels (queue tokens)
- Session writes: safe after streaming done (Tauri event-driven, not concurrent)
- Input inject ↔ capture: Tauri emit-await pattern serializes correctly

---

## Dev Synthesis

### Confirmed Bugs
1. **Double [POINT] invocation** — useVoice.ts lines 229-255 duplicates OverlayPanel.tsx line 77. Fix: delete useVoice.ts lines 229-255.
2. **DevicePixelRatio bug** — OverlayPanel.tsx line 74: `window.screen.width` returns logical px. Fix: multiply by `window.devicePixelRatio` for correct physical pixel coords on HiDPI displays.
3. **Untyped Tauri invocation** — useVoice.ts line 233: `invoke("animate_cursor_to", {x, y})` should be `invoke<void>("animate_cursor_to", {x, y})`.

### Files to Create (Phase 6 completion)
- `src-tauri/src/session.rs` — NEW, SQLite session history
- `src/__tests__/useVoice.computer-use.test.ts` — NEW, test computer use pipeline

### Files to Modify
- `src-tauri/src/lib.rs` line 146 — add session commands to invoke_handler
- `src-tauri/src/lib.rs` line 145 — `.manage(AppState::new(&app)?)`
- `src/hooks/useVoice.ts` lines 229-255 — DELETE duplicate [POINT] logic
- `src/windows/OverlayPanel.tsx` line 74 — add `* window.devicePixelRatio`

### Critical Test Gaps
- `useVoice.ts` — zero test coverage on hotkey → audio → STT → AI → TTS pipeline
- `denormalize()` / `parsePoints()` — untested coordinate math (HiDPI bug above is evidence)
- `mcp_server.rs` — no end-to-end tool call tests
- `audio.rs` — state machine transitions untested

---

## UX Synthesis

### What's ALREADY BUILT (confirmed)
- ✅ All 5 API key inputs in SettingsSection (CompanionPanel.tsx lines 655-834)
- ✅ STT mode toggle with model downloader (lines 883-994)
- ✅ Model picker with all 7 models (lines 836-881)
- ✅ Voice state machine animations (idle→listening→processing→responding)
- ✅ Waveform bars with staggered animation
- ✅ Point dots with pulse ring animation
- ✅ Auto-dismiss after 8s, click-to-dismiss

### Top 3 UX Gaps (vs Pluely/Cluely)
1. **No stealth mode** — OverlayPanel is full 100vw/100vh visible. Missing: `WDA_EXCLUDEFROMCAPTURE`, hidden cursor, process name disguise. Natively has 2k★ specifically for this feature.
2. **No latency/cost metadata** — ModelPicker shows names only. Pluely shows real-time latency badges. Fix: add `tier`, `costPer1k`, `avgLatencyMs` to model definitions.
3. **ARIA/accessibility gaps** — ModelPicker radio buttons missing `role="radio"` + `aria-checked`. Status pulsing dot missing `role="status"`. No `:focus-visible` rings.

### Voice Animation Gaps
- No transition timing between states (instant jump)
- No "end-of-speech" visual feedback
- Missing `<LatencyIndicator>` during processing ("Thinking... 0.8s")
- No dismiss animation (fade-out + scale-out 200ms)

### State Fields to Add (companionStore.ts)
```typescript
// Add to store:
latencyMs: number | null,          // shown during 'processing' state
sttLatencies: number[],            // rolling avg for latency badge
lastApiCallMs: number | null,      // timestamp
```

---

## Party Mode Final Score Assessment

| Dimension | Prev Score | Party Revised | Change |
|-----------|-----------|--------------|--------|
| Platform Fidelity | 9/10 | 9/10 | — |
| Voice Pipeline | 8/10 | 8.5/10 | +0.5 (STT toggle already built) |
| Screen Capture | 9/10 | 9/10 | — |
| Model Agnostic | 9/10 | 9/10 | — |
| Computer Use | 4/10 | **6/10** | +2.0 ([POINT] wire already done!) |
| UI/UX | 8/10 | **7.5/10** | -0.5 (found ARIA + animation gaps) |
| Memory | 1/10 | 1/10 | — (still needs session.rs) |
| Packaging | 1/10 | 2/10 | +1.0 (NSIS configured) |
| **COMPOSITE** | **48.0** | **52.5** | **+4.5** |

**Revised composite: 52.5/100** (was 48, but [POINT] wire + STT toggle already complete)

---

*Party Mode synthesis: 4 agents × 400 words | 2026-05-05*
