# DanteClicky OSS Intelligence Report
> Generated: 2026-05-05 | Updated: 2026-05-08 | 12 repos catalogued | Wave 6 Computer-Use Architecture Harvest (cua)

---

## Wave 6 Computer-Use Architecture Harvest (trycua/cua) - 2026-05-08

| Source | Pattern | Adopted for Dim |
|--------|---------|-----------------|
| `cua_agent/callbacks/base.py` | `AsyncCallbackHandler` 16-hook lifecycle protocol (on_run_start/end, on_llm_start/end, on_computer_call_start/end, on_screenshot, on_usage, on_api_start/end, etc.) | New `AgentCallbackHandler` TS interface + `AgentCallbackChain` dispatcher — Dim 50 Extensibility (~6 → 9.0), Dim 27 Agentic loops (9.0 → 9.6) |
| `cua_agent/callbacks/operator_validator.py` | Action-shape normalization (`left_click`→`click`+button, hotkey aliases, coordinate flatten, required-key whitelist) | `OperatorNormalizerCallback` — avoids LLM correction round-trips on malformed computer calls — Dim 28 Computer-Use Safety (9.0 → 9.5) |
| `cua_agent/callbacks/pii_anonymization.py` | Symmetric anonymize-on-send / deanonymize-on-tool-call pattern (text + image redaction with reversible mapping) | `PIIAnonymizationCallback` — wraps existing `redactText` (telemetry.ts:855); image redaction via Canvas overlay reusing somAnnotator pipeline — Dim 36 Privacy (9.3 → 9.6) |
| `cua_agent/callbacks/budget_manager.py` | Per-run dollar-cost tracking with `BudgetExceededError`, configurable reset_after_each_run | `BudgetManagerCallback` consuming `on_usage` — feeds existing telemetry as `agent.budget.tick`/`exceeded` events |
| `cua_agent/callbacks/image_retention.py` | Orphan-pair removal: `call_id`-matched `computer_call`+`computer_call_output`+preceding `reasoning` trio trimming, not just turn-counting | `ImageRetentionCallback` — coexists with existing `contextCompression.ts` 6-turn window; sharper per-image trim — Dim 23 Context Compression (9.0 → 9.3) |
| `cua_agent/callbacks/trajectory_saver.py` | `sanitize_image_urls` recursive helper + full step-by-step audit log to disk | `TrajectorySaverCallback` + new SQLite `agent_trajectories` table — Dim 28 Safety (9.0 → 9.4), Dim 45 Observability (9.2 → 9.7) |
| `cua_agent/decorators.py` | `@register_agent(models=regex, priority=N, tool_type)` decorator-based model registry with regex matching and priority ordering | TS `registerAgent({modelRegex, priority, toolType, adapter})` — replaces hardcoded provider branching in `chat.ts` — Dim 49 Model Coverage (~7 → 8.5), Dim 50 Extensibility |
| `cua_agent/loops/base.py` | `AsyncAgentConfig` protocol: `predict_step`, `predict_click`, `get_capabilities` | TS `AsyncAgentConfig` interface as the plugin API for adding new vendor support |
| `cua_agent/loops/composed_grounded.py` | Two-stage loop: thinking model emits `element_description` strings → grounding model resolves to (x,y); `GROUNDED_COMPUTER_TOOL_SCHEMA` as element-description-based tool schema | `composedGroundedLoop.ts` using existing `somAnnotator.ts` (UIAutomation+SoM) → Moondream2 fallback for Chromium/games — Dim 27 Agentic loops accuracy lift |
| `mcp-server/mcp_server/session_manager.py` | `SessionManager` + `ComputerPool` — per-session computer instances with idle cleanup and max-concurrent limits | Rust refactor of `mcp_server.rs` from `Arc<Mutex<HashMap<String, broadcast::Sender>>>` to explicit pool + session lifecycle — multi-tenant readiness |
| `cua_agent/human_tool/server.py` | Local websocket server for human-in-the-loop approvals (decoupled from console input) | `human_tool.rs` + `HumanApprovalSurface.tsx` ambient overlay — replaces synchronous text confirmation in `agentLoop.ts:386` — Dim 38 Ambient UX (7 → 8.5) |

**License:** MIT (Cua AI, Inc., 2025) — verified at `/tmp/oss-research-cua/LICENSE.md`. 15.8k★. Third-party components (Kasm: MIT, OmniParser: CC-BY-4.0, optional ultralytics: AGPL-3.0) are NOT being adopted.

**Plan reference:** `C:/Users/richa/.claude/plans/foamy-foraging-lynx.md` — full execution map with phases, worktrees, verification gates.

**Outcome target:** composite **7.81 → 8.5/10**. Phase 0a metadata landed 2026-05-08. Phase 0b foundation (`agentCallbacks.ts` + `OperatorNormalizerCallback`) follows. Phases 1+2 dispatched via `/party` across worktrees `wt-cua-pii / wt-cua-budget / wt-cua-retention / wt-cua-trajectory / wt-cua-grounded / wt-cua-registry / wt-cua-mcp / wt-cua-human`. Final gates: `npx tsc --noEmit`, `npm test` (≥358 tests), `npm run build`, `cargo test --lib`, `cargo build`, `/score` ≥ 8.3, `/adversarial-score` clean on Dim 27/28/36/45.

**Explicit non-goals** (documented to prevent scope creep):
- NOT porting Lume/Lumier (macOS Apple Silicon VM management)
- NOT porting Swift `cua-driver` (macOS-native AX surfaces; we use UIAutomation)
- NOT adopting OmniParser (CC-BY-4.0 attribution overhead; somAnnotator is sufficient)
- NOT adopting Presidio for PII (not Windows-friendly; regex+OCR coverage suffices)
- NOT porting all 21 vendor agent loops — only 3 prioritized (Gemini direct, Qwen3-VL, UI-TARS-2)
- NOT replacing `contextCompression.ts` — image retention coexists, doesn't replace
- NOT porting cuabotd.ts as a separate daemon — multi-agent ideas absorbed into ambient mode

---

## Wave 4 Preference Learning Harvest - 2026-05-07

| Source | Pattern | Adopted for Dim 33 |
|--------|---------|--------------------|
| mem0 | Multi-level user/session/agent memory that continuously learns preferences and adapts future responses | Added a persistent preference profile injected into future prompts, not just raw liked examples |
| Letta | Stateful agents with advanced memory that learn and self-improve over time | Added local feedback events as durable learning signals across sessions |
| OpenAkita | Distinguishes memory types including Preference, Rule, Persona trait, and Experience | Added derived `preference_traits` rather than storing only untyped ratings |
| RayClaw | Structured memory rows, explicit remember fast path, confidence/lifecycle controls | Added confidence/support/conflict/decay/status fields, editable lifecycle controls, and evidence review |

Outcome: Dimension 33 was harshly corrected from the previous matrix's over-generous 9 to an honest 8.0 pre-sprint, then moved to **9.1** after implementation and verification. Final gates: `npx tsc --noEmit --pretty false`, `npm test -- --reporter=dot` (17 files, 157 tests), `npm run build`, and `cargo test --manifest-path src-tauri\Cargo.toml --lib --quiet` (27 Rust tests). The remaining 10/10 gaps are live desktop preference replay, longitudinal confidence/decay calibration on real usage, and production-scale DB migration replay.

## Wave 5 Multilingual Speech Harvest - 2026-05-07

| Source | Pattern | Adopted for Dim 8 |
|--------|---------|-------------------|
| OpenAI Whisper README | Keep `.en` models for explicit English but use multilingual checkpoints for non-English and language-specified transcription | Local model downloader now selects `openai/whisper-tiny.en` for English and `openai/whisper-tiny` for auto/non-English selections |
| OpenAI Whisper decode flow | Language can be specified; low-level flow exposes language detection and decode control | Candle Whisper path now resolves selected language tokens and auto-detects a language token from decoder logits when language is Auto |
| AssemblyAI U3 Pro Streaming docs | `speech_model=u3-rt-pro`, language detection, and custom prompt hints are first-class streaming parameters | AssemblyAI WebSocket URL now includes U3 Pro, language detection, and selected-language prompt hints |
| AssemblyAI U3 Pro migration guide | U3 Pro natively code-switches across six major languages and uses prompt guidance rather than old language switching | Cloud STT now uses one streaming model with prompt-based language steering instead of separate provider modes |

Outcome: Dimension 8 moved from **3** to **9.1** after implementation and verification. Final gates: `npx tsc --noEmit --pretty false`, `npm test -- --reporter=dot` (19 files, 170 tests), `npm run build`, and `cargo test --manifest-path src-tauri\Cargo.toml --lib --quiet` (36 Rust tests). Remaining 10/10 gaps are live multilingual microphone E2E, transcript-language confidence UI, and app-wide UI localization.

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
| [cline/cline](https://github.com/cline/cline) | not recorded | Apache-2.0 | Context-window auto-compact + agent safety policy |
| [xlang-ai/OSWorld](https://github.com/xlang-ai/OSWorld) | not recorded | Apache-2.0 | Desktop-agent token limiting + pending safety checks |
| [trycua/cua](https://github.com/trycua/cua) | 15.8k | MIT | Computer-use agent framework: callback lifecycle, composed-grounded loop, MCP session manager, agent registry, 21 vendor loops |

---

## Wave 3 Computer-Use Safety Harvest - 2026-05-07

| Source | Pattern | Adopted for Dim 28 |
|--------|---------|--------------------|
| Cline `autoApprove.ts` / command permissions | Deny-before-allow policy and explicit risk categories for irreversible side effects | Added non-confirmable tier-4 block path for screen prompt injection, credential exfiltration, and system compromise |
| Cline auto-approve docs | Warn about unrestricted approvals for deletion, system settings, network requests, package install/uninstall, and pushes | Expanded safety taxonomy beyond the previous narrow regex set |
| OSWorld OpenAI CUA adapters | Preserve `pending_safety_checks` and echo them as `acknowledged_safety_checks` in computer-call outputs | DanteClicky now carries OpenAI pending safety checks through `computer_call_output` |
| OSWorld trajectory logging pattern | Treat each action as an auditable safety step with provider call identity | Safety events now distinguish blocked actions from confirmable pending actions, with provider call identity preserved |

Outcome: Dimension 28 moved from 7 to 9 in the canonical matrix after implementation and verification. The remaining 10/10 gaps are live desktop E2E safety replay, a configurable app/window/resource boundary policy, and a screenshot-backed safety audit UI.

---

## Wave 2 Context Compression Harvest - 2026-05-07

| Source | Pattern | Adopted for Dim 23 |
|--------|---------|--------------------|
| Cline `docs/features/auto-compact.mdx` | Compact as the context window approaches pressure, preserve technical task state, and fall back to rule-based truncation when needed | Reconfirmed token/turn trigger plus fallback summarizer as table stakes, not enough for 9+ alone |
| Cline `context-window-utils.ts` | Reserve output and tool headroom before deciding usable input budget | Added conservative response, prompt-scaffold, and image/screenshot reserves before context block allocation |
| Cline `contextManagement.ts` | Summary prompts preserve requests, files, technical concepts, pending work, and next step | Kept summary merging structured and added duplicate paragraph suppression |
| OSWorld `MessageTokenLimiter` | Apply explicit token caps, minimum thresholds, and measurable savings | Added hard-limit planning, per-block original/deduped/final token stats, pressure ratio, and saved-token audit |
| OSWorld `TextMessageCompressor` | Compress text blocks only when needed and report compression behavior | Added priority-aware UI/OCR/memory block budgets with truncation and line-dedup audit flags |

Outcome: Dimension 23 moved from 7 to 9 in the canonical matrix after implementation and verification. The remaining 10/10 gaps are exact tokenizer parity and live long-session desktop E2E.

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

*Registry: `.danteforge/oss-registry.json` | 11 repos catalogued, all MIT/Apache-2.0*
