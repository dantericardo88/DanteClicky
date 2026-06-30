# DanteClicky — Competitive Leapfrog Analysis
> Generated: 2026-05-05 | 5-Cycle Sprint Plan
> Competitors: Cluely (post-breach), Pluely (open OSS peer), screenpipe, UI-TARS, Wispr Flow

---

## CRITICAL NEW INTELLIGENCE

### Cluely Data Breach (mid-2025)
Cluely suffered a **data breach exposing 83,000 users' personal data, interview transcripts, and screenshots**. This destroyed their market trust. Users are actively fleeing to local-first alternatives. This is the biggest market opening in the space since these tools launched.

**DanteClicky response:** Every marketing message leads with "100% local — your screenshots never leave your device."

### Pluely Is Our Direct OSS Peer
Pluely is built on **Tauri v2 + React 19.1.0 + TypeScript 5.8.3 + Rust backend** — identical stack. ~10MB binary. Zero-server architecture (direct API calls, no proxy). Open source.

**What Pluely has that we DON'T:**
- Stealth (hidden cursor, `WDA_EXCLUDEFROMCAPTURE`)
- Direct API calls (no Cloudflare Worker dependency)
- Signed Windows installer (.exe + .msi)
- Stealth mode hidden from screen recording

**What WE have that Pluely DOESN'T:**
- Multi-monitor screen capture to AI (JPEG 85%)
- Voice pipeline (WASAPI + AssemblyAI + ElevenLabs)
- Computer use (cursor animation, enigo wired)
- DanteAgents WebSocket bridge
- MCP server (Phase 12)
- [POINT] annotation protocol

**Strategy:** Pluely is < 2 weeks away from being beaten across every dimension.

---

## Leapfrog Sprint Cycles (Priority × Gap × Effort)

### Cycle 1 — Leapfrog screenpipe on Memory (Gap: -9.0)
**Dimension:** `memory_context` | 1.0 → 7.5

**Why screenpipe leads:** 24/7 screen recording, FTS5 full-text search, SQLite, REST API, MCP server. Nobody else is close.

**Leapfrog strategy:** Don't compete on 24/7 recording — that's too heavy. Instead: integrate screenpipe as an **optional** data source. If screenpipe is running → query it. If not → DanteClicky's own SQLite session history fills the gap. Result: Screenpipe memory + DanteClicky action = unique combination no competitor has.

**Victory condition:** DanteClicky answers "What was on my screen an hour ago?" correctly by querying either its own SQLite session history OR screenpipe's FTS5 database — whichever is available.

**Score after cycle:** 1.0 → 7.5 ✓ *Leapfrogs Cluely (3.0), Pluely (0.0), UI-TARS (0.0)*

**Implementation (Sprint #1):**
```rust
// session.rs — WAL SQLite, FTS5, conversation + screen events
// screenpipe.rs — graceful client: http://localhost:3030/search
// Tauri commands: save_message, get_history, search_history
```
**OSS harvest:** rusqlite (MIT), screenpipe schema (MIT), sqlite-vec for future RAG (MIT)

---

### Cycle 2 — Leapfrog UI-TARS on Computer Use (Gap: -5.0)
**Dimension:** `computer_use` | 4.0 → 8.0

**Why UI-TARS leads:** Trained specifically on Windows UI screenshots, 18.8% OSWorld success rate, click/type/scroll native.

**Leapfrog strategy:** We can't beat UI-TARS on vision model quality (they trained a 7B model). We leapfrog on **pipeline completeness**: UI-TARS has no voice, no overlay UI, no memory. DanteClicky will be the FIRST tool where you can **speak** a computer use task, **watch** the cursor animate to the target, **hear** confirmation via TTS, and have the **session recorded** in memory.

**Victory condition:** User says "Click the Submit button" → DanteClicky identifies the button via Claude vision, animates cursor to it, clicks it via enigo, announces "Done" via ElevenLabs, records the action in SQLite.

**Score after cycle:** 4.0 → 8.0 ✓ *Approaches UI-TARS (9.0) on computer use while winning on voice+overlay+memory*

**Implementation (Sprint #2):**
```typescript
// OverlayPanel.tsx — wire [POINT] → invoke('animate_cursor_to', {x, y})
// input.rs — enigo click/type/scroll/drag
// useVoice.ts — tool-use loop: parse tool calls → execute → re-submit
// Safety gate: Tier 0 (read), Tier 1 (UI), Tier 2 (files), Tier 3 (system) classification
```

---

### Cycle 3 — Leapfrog Cluely on Privacy (Gap: massive, moral)
**Dimension:** `privacy_local_first` | 7.0 → 9.5

**Why Cluely lost:** Cloud-only architecture + data breach. 83,000 users' interview transcripts and screenshots were exposed.

**Leapfrog strategy:** Remove the Cloudflare Worker dependency. Move to Pluely's zero-server pattern — direct API calls from Tauri frontend to AI providers using `reqwest` in Rust (already in Cargo.toml as Phase 10).

**Victory condition:** DanteClicky works with ZERO server infrastructure. User enters API keys directly in settings. No proxy, no Worker, no breach surface.

**Score after cycle:** 7.0 → 9.5 ✓ *Leapfrogs Cluely (1.0 post-breach) and matches Pluely (9.0)*

**Implementation (Sprint #3):**
```typescript
// Settings UI: Add "AI Provider Keys" panel with API key inputs
// Remove workerBaseUrl from settings, replace with directApiKey fields
// Rust proxy: reqwest-based /chat route (already stubbed in Phase 10 notes)
```
**Note:** This is also the **app-works-without-deploying-anything** fix. Single biggest unblock.

---

### Cycle 4 — Leapfrog Pluely on Packaging (Gap: -6.0 from Cluely)
**Dimension:** `quality_dist` | 2.0 → 7.5

**Pluely has:** MSI + EXE installer, signed, GitHub Releases, auto-updater.
**We have:** NSIS configured but no icons, no signing, no CI.

**Leapfrog strategy:** Ship v0.1.0-alpha to GitHub Releases this week. Add GitHub Actions CI. Apply for EV cert (2 week lead time — START TODAY). Ship unsigned alpha now, signed beta in 2 weeks.

**Victory condition:** User can download, install, run DanteClicky without touching a terminal.

**Score after cycle:** 2.0 → 7.5 ✓

**Implementation (Sprint #4):**
```yaml
# .github/workflows/build.yml
# jobs: test (cargo test + vitest), build (tauri build --target x86_64-pc-windows-msvc)
# artifact: .msi + .exe uploaded to GitHub Releases
```

---

### Cycle 5 — Leapfrog Wispr Flow on Windows STT (Unique Market)
**Dimension:** `voice_pipeline` | 8.0 → 9.5

**Wispr Flow's position:** macOS-first, best-in-class voice dictation, $19/mo. No Windows equivalent exists.

**Leapfrog strategy:** DanteClicky IS the Windows Wispr Flow. Two additions:
1. **VAD** — stop sending silence to AssemblyAI (whisper-cpp-plus-rs pattern)
2. **Local Whisper toggle** — `whisper-base.en` (142MB), offline, free, private

**Victory condition:** User can toggle "Offline Mode" in settings → voice works without internet. No competitor offers this on Windows.

**Score after cycle:** 8.0 → 9.5 ✓ *Leapfrogs Wispr Flow (which is macOS-only)*

**Implementation (Sprint #5):**
```rust
// audio.rs: add VAD gate (silence_duration_ms: 800, min_speech_ms: 200)
// stt.rs: SttBackend enum { AssemblyAI, WhisperLocal }
// Settings: "Speech Mode" toggle Cloud / Local
// Model downloader: tiny (75MB) / base (142MB) / small (466MB)
```

---

## Leapfrog Scorecard

| Competitor | Current | After Cycle | Victory Condition |
|-----------|---------|------------|------------------|
| Cluely (post-breach) | DC = 7/10 edge | After Cycle 3 → **DC 9.5/10** | Privacy = won. No comparison. |
| Pluely | DC = 7/10 edge | After Cycle 4 → **DC 9/10** | Matching stack; DC adds voice+memory+computer-use |
| screenpipe | DC = 4/10 deficit | After Cycle 1 → **DC ties on memory** | DC wins on action layer (unique) |
| UI-TARS | DC = 3/10 deficit | After Cycle 2 → **DC exceeds holistically** | DC adds voice+overlay+memory |
| Wispr Flow | DC = 4/10 deficit (Windows gap) | After Cycle 5 → **DC owns Windows** | DC = Windows Wispr Flow equivalent |

---

## Composite Score After All 5 Cycles

| Dimension | Before | After All Cycles |
|-----------|--------|-----------------|
| memory_context | 1.0 | **7.5** (+6.5) |
| computer_use | 4.0 | **8.0** (+4.0) |
| privacy_local | 7.0 | **9.5** (+2.5) |
| quality_dist | 2.0 | **7.5** (+5.5) |
| voice_pipeline | 8.0 | **9.5** (+1.5) |
| integration_mcp | 0.0 | 0.0 (Phase 12) |
| platform_fidelity | 9.0 | 9.0 |
| screen_capture | 9.0 | 9.0 |
| model_agnostic | 9.0 | 9.0 |
| **COMPOSITE** | **5.3** | **8.3** (+3.0) |

---

## Immediate Action Queue (ordered by unblocking impact)

1. **TODAY:** Remove Cloudflare Worker dependency → direct `reqwest` API calls (Cycle 3) — makes app functional immediately
2. **TODAY:** Apply for DigiCert EV cert — 2 week lead time
3. **This week:** Wire `[POINT] → animate_cursor_to` in OverlayPanel.tsx — 30 minutes, massive UX impact
4. **This week:** Add `input.rs` with enigo click/type/scroll
5. **This week:** Add `session.rs` with SQLite session history (rusqlite)
6. **Next week:** GitHub Actions CI + GitHub Releases v0.1.0-alpha
7. **Next week:** VAD + whisper-rs toggle
8. **Week 3:** DanteAgents ws_server.rs bridge
9. **Week 4:** MCP server with official rust-sdk

---

*Report: .danteforge/LEAPFROG.md | 5-cycle competitive leapfrog | 2026-05-05*
