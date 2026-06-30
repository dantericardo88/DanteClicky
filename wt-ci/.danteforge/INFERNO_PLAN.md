# DanteClicky — INFERNO Synthesis Plan
> Generated: 2026-05-05 | Maximum-depth | Score: 52.5/100 baseline

---

## Verified Baseline
- **Composite: 52.5/100** (revised up from 48 after Party audit confirmed [POINT] wire + STT toggle + API key UI already built)
- **3 confirmed bugs** (HiDPI coords, double-invocation, API keys in IPC)
- **Security issue:** API keys passed as Tauri command params → appear in IPC log
- **Sprint trajectory:** 52.5 → 70.5 → 82.5 → 90.5 (3 weeks)

---

## TODAY — 2 Hours (Immediate Fixes)

### Fix 1: Security — API Keys in Tauri IPC (CRITICAL)
**File:** `src-tauri/src/lib.rs` + new `src-tauri/src/keystore.rs`
**Problem:** `chat.ts` passes API keys as Tauri command params → logged in IPC

```rust
// keystore.rs
use std::collections::HashMap;
use tauri::State;

pub struct KeyStore(pub std::sync::Mutex<HashMap<String, String>>);

#[tauri::command]
pub fn set_api_key(store: State<'_, KeyStore>, provider: String, key: String) {
    store.0.lock().unwrap().insert(provider, key);
}
// Used internally: store.0.lock().unwrap().get("anthropic").cloned()
```

**In lib.rs:** `.manage(KeyStore(Default::default()))` + register `set_api_key` command
**In chat.ts:** Call `invoke("set_api_key", {provider, key})` on settings save; remove `apiKey` from `StreamChatOptions`

### Fix 2: Double-Invocation — [POINT] Cursor
**File:** `OverlayPanel.tsx` lines 69-78 — DELETE the entire `useEffect` on `points`
**Reason:** `useVoice.ts` is the correct source of truth (uses physical coords via `primaryScreen.width`). OverlayPanel's effect fires second with logical pixel coords → wrong coordinates.
**After fix:** Single `animate_cursor_to` call from `useVoice.ts` only.

### Fix 3: HiDPI Cursor Bug
**File:** `OverlayPanel.tsx` line 74
**Change:** `window.screen.width` → `window.screen.width * window.devicePixelRatio`
**Note:** After Fix 2 this line is deleted anyway. Verify `useVoice.ts` uses physical coords (it does via `primaryScreen.width`). ✅

---

## Sprint 1 — This Week (+18 pts → ~70.5/100)

### S1.1 — SQLite Session Memory (session.rs) — +6.5 pts
**Files to create:** `src-tauri/src/session.rs`
**Cargo.toml additions:**
```toml
rusqlite = { version = "0.31", features = ["bundled"] }
chrono = { version = "0.4", features = ["serde"] }
```
**Schema:** `turns` table `(id, session_id, role, content, ts INTEGER)` + WAL mode + FTS5
**Tauri commands:** `db_push_turn`, `db_get_recent_turns(n)`, `db_get_summary`
**Frontend:** `useVoice.ts` — call `db_push_turn` after each `pushConversationTurn`; hydrate history from DB on startup
**Test:** `src/__tests__/session.test.ts` — mock invoke, verify 5-turn round-trip
**Score impact:** memory_context 1.0 → 7.5

### S1.2 — KeyStore Rust State (completes security fix) — +2 pts
As above in TODAY section. Also remove `apiKey` from all proxy command signatures.
**Score impact:** privacy_local 7.0 → 9.0

### S1.3 — ARIA Accessibility Pass — +2 pts
**Files:** `CompanionPanel.tsx`, `OverlayPanel.tsx`
- Add `role="status"` + `aria-live="polite"` to ResponseBubble
- Add `aria-label` to ModelPicker select elements
- Add `role="alert"` to error display in status card
- Add `aria-checked` + `role="radio"` to model picker options
**Score impact:** ui_ux 7.5 → 8.5

### S1.4 — useVoice.ts Unit Tests — +2 pts
**File to create:** `src/__tests__/useVoice.test.ts`
**Test cases:**
1. Double-invocation guard — second hotkey press before first resolves is ignored
2. `parsePoints` round-trip with coordinate math
3. `summarizeOldTurns` triggers at exactly 10 turns
4. State machine: idle → listening → processing → responding → idle
**Score impact:** quality_dist 2.0 → 4.0

### S1.5 — GitHub Releases v0.1.0-alpha — +5 pts
**tauri.conf.json:** Add `nsis` + `msi` bundle targets
**GitHub Actions:** `build.yml` — `npm ci → cargo test → npm test → cargo tauri build → upload .msi`
**README.md:** One-command setup + MCP config snippet + demo GIF
**Score impact:** quality_dist 4.0 → 7.5

---

## Sprint 2 — Next Week (+12 pts → ~82.5/100)

### S2.1 — ws_server.rs — JSON-RPC 2.0 Compliance
**Cargo.toml addition:** `rmcp = { version = "0.1", features = ["server", "transport-io"] }`
**Change:** Replace bespoke envelope `{tool, id, ok}` with JSON-RPC 2.0 `{jsonrpc, method, params, id}`
**Why:** Makes ws_server.rs + mcp_server.rs share wire format → DanteAgents interops with any MCP client
**Note:** Keep axum for `mcp_server.rs` — it works, Claude Desktop tested. Use rmcp only for ws_server.rs.
**Score impact:** integration_mcp 0.0 → 5.0

### S2.2 — Silero VAD Gate
**Cargo.toml:** `ort = { version = "2", features = ["download-binaries"] }`
**File:** `src-tauri/src/audio.rs` — add `VadGate` struct, energy threshold + silence counter
**Config:** `silence_threshold_rms: 0.01`, `silence_frames_required: 24` (~800ms at 16kHz/512)
**Score impact:** voice_pipeline 8.5 → 9.0 + -60% AssemblyAI billing

### S2.3 — Screenpipe Client Enhancement
**File:** `src/lib/screenpipe.ts` — add `content_type=all`, 200ms timeout, 5s result cache
**Inject into system prompt:** app_name context filter
**Test:** Graceful degradation when Screenpipe not running (already confirmed graceful)
**Score impact:** memory_context 7.5 → 8.5

### S2.4 — Stealth Overlay
**File:** `src-tauri/src/overlay.rs` — add `WDA_EXCLUDEFROMCAPTURE` via Win32 `SetWindowDisplayAffinity`
**Tauri command:** `set_stealth_mode(enabled: bool)`
**Frontend toggle:** Add to CompanionPanel settings → "Hide from screen recordings"
**Market significance:** This alone drove Natively to 2k★
**Score impact:** platform_fidelity 9.0 → 10.0

---

## Sprint 3 — Week 3 (+8 pts → ~90.5/100)

### S3.1 — Full MCP Server Compliance
**mcp_server.rs:** Add remaining tool definitions from manifest:
- `clicky_speak` (ElevenLabs TTS)
- `clicky_memory_search` (FTS5 query)
**Score impact:** integration_mcp 5.0 → 8.0

### S3.2 — Local Whisper STT Toggle
**Feature flag:** `--features local-stt` (already in Cargo.toml as optional whisper-rs)
**Settings:** STT mode toggle already built — wire backend
**Model downloader:** Already in settings UI — wire download + load
**Score impact:** voice_pipeline 9.0 → 9.5

### S3.3 — DanteAgents Bridge (ws_server.rs complete)
Wire all tool dispatch: `capture_screen`, `click`, `type_text`, `speak`, `query_memory`
**Score impact:** danteagents_bridge 0.0 → 8.0

### S3.4 — auto-updater
**Cargo.toml:** `tauri-plugin-updater = "2"`
**Config:** GitHub Releases endpoint in `tauri.conf.json`
**Frontend:** Startup update check dialog in CompanionPanel
**Score impact:** quality_dist 7.5 → 9.0

---

## Architecture Decisions (6-month impact)

### Decision 1: SQLite as primary memory, Screenpipe as optional enrichment
**Why:** Local-first addresses Cluely breach. No Screenpipe dependency. Works offline. Screenpipe adds historical OCR context when available.
**Implication:** `session.rs` is always present; `screenpipe.ts` checks port 3030 and silently skips if unavailable.

### Decision 2: Keep axum for mcp_server.rs; use rmcp only for ws_server.rs
**Why:** Migrating mcp_server.rs to rmcp SDK is 2+ days for zero user-facing benefit. axum works and is Claude Desktop-tested. rmcp is needed for ws_server.rs JSON-RPC 2.0 compliance (DanteAgents interop).
**Implication:** rmcp at 0.1 is fine for ws_server.rs. Wait for 0.2 stable before considering mcp_server.rs migration.

---

## Score Projection

| Sprint | Composite | Key Gains |
|--------|-----------|-----------|
| TODAY (2h) | 52.5 | Bug fixes, security |
| Sprint 1 (week 1) | **70.5** | +18: memory, security, tests, alpha release |
| Sprint 2 (week 2) | **82.5** | +12: ws_server, VAD, stealth, screenpipe |
| Sprint 3 (week 3) | **90.5** | +8: MCP, whisper, DanteAgents, auto-updater |
| Target | **93.0** | Community adoption + enterprise |

---

## INFERNO Retro

- **What worked:** OSS harvest found critical patterns (rusqlite, claude_streaming_proxy, rmcp)
- **What surprised:** App is 80% done, not 48% done. [POINT], STT toggle, API keys UI all built.
- **What to watch:** Double-invocation bug must be fixed before ANY computer use demo — or cursor moves wrong
- **Lesson captured:** "Score the code, not the plan. Code audit always reveals implementations that MASTERPLAN said were missing."

*Report: .danteforge/INFERNO_PLAN.md | 2026-05-05*
