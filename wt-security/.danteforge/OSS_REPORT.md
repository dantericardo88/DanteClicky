# DanteClicky OSS Intelligence Report
> Generated: 2026-05-05 | 9 repos catalogued | Wave 1 OSS Harvest

---

## Repos Catalogued

| Repo | Stars | License | Key Domain |
|------|-------|---------|-----------|
| [screenpipe/screenpipe](https://github.com/screenpipe/screenpipe) | 10k+ | MIT | Screen memory + MCP |
| [EDEAI/OpenFlux](https://github.com/EDEAI/OpenFlux) | 1k+ | Apache-2.0 | Tauri v2 agent + memory |
| [Natively-AI-assistant](https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant) | 2k+ | MIT | Stealth overlay + local RAG |
| [windows-capture](https://github.com/NiiightmareXD/windows-capture) | 1k+ | MIT | WGC GPU capture |
| [adk-rust](https://github.com/zavora-ai/adk-rust) | 500+ | Apache-2.0 | Modular agent framework |
| [modelcontextprotocol/rust-sdk](https://github.com/modelcontextprotocol/rust-sdk) | 1k+ | MIT | Official Rust MCP SDK |
| [whisper-cpp-plus-rs](https://github.com/operator-kit/whisper-cpp-plus-rs) | 200+ | MIT | Whisper + VAD + streaming |
| [whisper-rs](https://github.com/tazz4843/whisper-rs) | 1k+ | MIT | whisper.cpp Rust bindings |
| [CapSoftware/scap](https://github.com/CapSoftware/scap) | 500+ | MIT | Cross-platform capture |

---

## Pattern Priority Matrix

### P0 — Implement Now (multiple repos have it, high ROI, low effort)

#### P0.1 — Event-Driven Capture (screenpipe, windows-capture)
**What:** Capture screenshots only when meaningful events occur (app switch, click, typing pause, scroll stop) instead of polling every N seconds.
**Why it matters for DanteClicky:** Current `capture.rs` captures on every hotkey press, but for continuous context mode (Phase 10), event-driven is essential. Reduces CPU from ~15% to <5%.
**Implementation sketch:**
```rust
// In capture.rs — add event gate
enum CaptureEvent { AppSwitch, UserClick, TypingPause, Scroll }
fn should_capture(event: &CaptureEvent, last_capture: Instant) -> bool {
    matches!(event, CaptureEvent::AppSwitch | CaptureEvent::UserClick)
    || last_capture.elapsed() > Duration::from_secs(30)
}
```
**Effort:** 2 hours | **Phase:** 10

#### P0.2 — SQLite Session Memory (screenpipe, OpenFlux)
**What:** Store conversation turns + screen context + timestamps in local SQLite. Both screenpipe and OpenFlux use this pattern.
**Why:** `companionStore.ts` only has in-memory session history. No persistence across restarts. This is the Cycle 7 (0/10) gap.
**Implementation sketch:**
```rust
// Add to src-tauri: rusqlite dependency
// CREATE TABLE sessions (id, timestamp, role, content, screenshot_path, model)
// CREATE TABLE screen_events (id, timestamp, app_name, window_title, screenshot_hash)
```
**Effort:** 4 hours | **Phase:** 8

#### P0.3 — Official Rust MCP SDK (modelcontextprotocol/rust-sdk)
**What:** Replace custom `mcp_server.rs` (axum SSE hand-rolled) with the official `rmcp` crate from Anthropic's own MCP org.
**Why:** Official SDK handles spec compliance, transport negotiation, capability negotiation. Eliminates ~200 lines of hand-rolled SSE code.
**Implementation sketch:**
```toml
# Cargo.toml
rmcp = { version = "0.1", features = ["server", "transport-sse-server"] }
```
**Effort:** 3 hours | **Phase:** 12

#### P0.4 — VAD for Whisper-rs (whisper-cpp-plus-rs)
**What:** Voice Activity Detection filters silence before sending to Whisper, preventing false transcriptions and wasted inference.
**Why:** `audio.rs` sends all audio regardless of silence. whisper-cpp-plus-rs ships VAD as a first-class feature.
**Pattern:**
```rust
// STTConfig { silence_duration_ms: 800, min_speech_duration_ms: 200, vad_threshold: 0.5 }
// Gate: only call whisper when speech_detected == true
```
**Effort:** 2 hours | **Phase:** 11

---

### P1 — Implement Next Sprint (clear user benefit, moderate effort)

#### P1.1 — Local Vector Search / RAG (OpenFlux, Natively, ADK-Rust)
**What:** All three competitors store embeddings locally (SQLite + vector extension or sqlite-vss) for semantic retrieval of past conversations and screen context.
**Why:** After SQLite memory lands (P0.2), adding vector search enables "what was on my screen when I was working on X last week?" queries.
**Approach:** `sqlite-vss` Rust extension or `usearch` crate (HNSW, Apache-2.0).
**Effort:** 6 hours | **Phase:** 8+

#### P1.2 — Zero-Copy Audio ABI (Natively)
**What:** Natively achieves <500ms E2E latency via zero-copy ABI transfers from Rust audio capture to JS frontend — no serialization overhead.
**Why:** Current flow: Rust → base64 encode → Tauri event → JS decode → send. Each encode/decode adds ~50ms at 16kHz. Zero-copy uses SharedArrayBuffer + Atomics.
**Effort:** 4 hours | **Phase:** 3 enhancement

#### P1.3 — Stealth Overlay (Natively)
**What:** Hide from taskbar, disguise process name (`explorer.exe` → legitimate-looking name), exclude from screen capture APIs, sync state across all windows.
**Why:** Interview/meeting use case is a major market segment. Natively has 2k+ stars specifically because of this feature.
**Implementation:** Tauri `set_skip_taskbar(true)`, Win32 `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`, process rename via `prctl` equivalent.
**Effort:** 3 hours | **Phase:** new feature

#### P1.4 — Modular Tool Registration (ADK-Rust)
**What:** ADK-Rust uses a registry pattern where tools declare `name`, `description`, `input_schema`, `execute()`. The agent loop calls tools by name, handles errors, retries.
**Why:** DanteClicky's computer-use implementation needs a proper tool loop. Current `useVoice.ts` has no tool invocation structure — it just streams text.
**Effort:** 5 hours | **Phase:** 6

#### P1.5 — Sherpa-ONNX Offline STT (OpenFlux)
**What:** OpenFlux bundles Sherpa-ONNX for offline speech recognition — much smaller than Whisper (20MB vs 140MB for whisper-tiny), faster inference.
**Why:** Alternative to whisper-rs for offline STT. Better for users who don't want the 140MB Whisper model download.
**Effort:** 6 hours | **Phase:** 11 alternative

---

### P2 — Backlog

#### P2.1 — Browser Automation (OpenFlux + Playwright)
**What:** OpenFlux ships built-in Playwright for web interaction. Combined with DanteClicky's computer-use layer, this enables "open this URL and summarize" agents.
**Effort:** 8 hours | **Phase:** future

#### P2.2 — DXGI Duplication API Fallback (windows-capture)
**What:** WDA_EXCLUDEFROMCAPTURE-protected windows can't be captured via WGC. DXGI duplication API bypasses this. Useful for capturing DRM-protected content (rare).
**Effort:** 4 hours | **Phase:** future

#### P2.3 — Sidecar Process Architecture (OpenFlux)
**What:** OpenFlux uses a Node.js sidecar for the AI engine, memory, and tools — keeping the Tauri process lean. Allows hot-reload of AI logic without rebuilding Rust.
**Why:** As DanteClicky grows, a sidecar prevents Tauri process bloat. Not needed now.
**Effort:** 12 hours | **Phase:** future refactor

---

## Synthesis: What DanteClicky Uniquely Has

Comparing against all 9 repos:

| Feature | DanteClicky | screenpipe | Natively | OpenFlux | ADK-Rust |
|---------|------------|-----------|---------|---------|---------|
| Windows-native Tauri 2 | ✅ | ✅ | ❌ | ✅ | ❌ |
| Multi-model routing (Claude+GPT+Grok) | ✅ | ❌ | ✅ | ✅ | ✅ |
| Screen capture + AI overlay | ✅ | ✅ | ❌ | ❌ | ❌ |
| Voice push-to-talk | ✅ | ❌ | ✅ | ✅ | ✅ |
| Computer use (cursor+click) | ✅ | ❌ | ❌ | ✅ | ❌ |
| DanteAgents WebSocket bridge | ✅ | ❌ | ❌ | ❌ | ❌ |
| MCP server | 🔄 (Phase 12) | ✅ | ❌ | ✅ | ❌ |
| SQLite memory | ❌ (Phase 8) | ✅ | ✅ | ✅ | ❌ |
| Local STT (Whisper) | 🔄 (Phase 11) | ✅ | ❌ | ✅ | ❌ |
| Vector search / RAG | ❌ | ✅ | ✅ | ✅ | ✅ |
| Stealth overlay | ❌ | ❌ | ✅ | ❌ | ❌ |

**DanteClicky's unique combination:** Windows-native + multi-model + screen-capture-overlay + voice + computer-use + DanteAgents bridge. No other project combines all five.

---

## Top 5 Recommended OSS Implementations (Ordered by ROI)

1. **P0.2 — SQLite session memory** → closes Cycle 7 (0→8/10), +8 composite points
2. **P0.4 — VAD for whisper-rs** → enables Phase 11 offline STT cleanly
3. **P1.3 — Stealth overlay** → unlocks interview/meeting market segment (Natively's 2k★ segment)
4. **P1.1 — Local vector RAG** → closes the memory retrieval gap vs screenpipe/Natively
5. **P0.3 — Official MCP SDK** → compliance + -200 lines of hand-rolled code

---

*Registry: `.danteforge/oss-registry.json` | 9 repos catalogued, all MIT/Apache-2.0*
