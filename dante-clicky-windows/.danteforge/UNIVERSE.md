# DanteClicky — Feature Universe
> Generated: 2026-05-05 | 9 OSS repos + 6 competitors analyzed
> Coverage: 40 unique feature line items across 8 categories

---

## Universe Score: 31/40 features defined | DanteClicky coverage: 22/40 (55%)
## Target: 37/40 (92.5%) after Phase 12

---

## Category 1 — Core Platform

| # | Feature | DC Current | screenpipe | Natively | OpenFlux | Cluely | Pluely |
|---|---------|-----------|-----------|---------|---------|--------|--------|
| 1.1 | Windows-native binary | ✅ 9/10 | ✅ | ❌ | ✅ | △ | ✅ |
| 1.2 | System tray + hotkey | ✅ 9/10 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1.3 | Frameless transparent overlay | ✅ 9/10 | ❌ | ✅ | ❌ | ✅ | ✅ |
| 1.4 | Multi-monitor support | ✅ 9/10 | ✅ | △ | △ | △ | △ |
| 1.5 | Auto-start on login | ✅ (wired) | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1.6 | Auto-updater | ❌ Phase 7 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1.7 | Signed installer (.msi/.exe) | ❌ Phase 7 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 1.8 | Stealth / screen-capture-excluded | ❌ P1.3 | ❌ | ✅ | ❌ | △ | ❌ |

**DC Score: 6/8** | Gap: auto-updater, signed installer, stealth overlay

---

## Category 2 — Screen Capture

| # | Feature | DC Current | screenpipe | Natively | OpenFlux | windows-capture | scap |
|---|---------|-----------|-----------|---------|---------|----------------|------|
| 2.1 | GPU-accelerated WGC capture | ✅ 9/10 | ✅ | △ | △ | ✅ | ✅ |
| 2.2 | All monitors, per-monitor metadata | ✅ 9/10 | ✅ | △ | △ | ✅ | ✅ |
| 2.3 | JPEG compression for AI APIs | ✅ 9/10 | ✅ | ❌ | △ | ❌ | ❌ |
| 2.4 | Event-driven capture (change detection) | ❌ Phase 10 | ✅ | ✅ | △ | ✅ | △ |
| 2.5 | Window-specific capture | ❌ future | ✅ | ❌ | ✅ | ✅ | ✅ |
| 2.6 | DXGI duplication fallback | ❌ P2.2 | △ | ❌ | ❌ | ✅ | ✅ |

**DC Score: 3/6** | Gap: event-driven, window capture, DXGI fallback

---

## Category 3 — Voice Pipeline

| # | Feature | DC Current | Natively | Wispr Flow | OpenFlux | ADK-Rust |
|---|---------|-----------|---------|-----------|---------|---------|
| 3.1 | WASAPI audio capture | ✅ 9/10 | ✅ | ✅ | △ | ❌ |
| 3.2 | Cloud STT (AssemblyAI real-time) | ✅ 9/10 | ✅ | △ | ✅ | △ |
| 3.3 | Push-to-talk state machine | ✅ 9/10 | ✅ | △ | △ | △ |
| 3.4 | ElevenLabs TTS | ✅ 9/10 | ❌ | ❌ | ✅ | △ |
| 3.5 | Local Whisper STT | ❌ Phase 11 | ❌ | ✅ | ✅ | ❌ |
| 3.6 | Voice Activity Detection (VAD) | ❌ P0.4 | △ | ✅ | ✅ | △ |
| 3.7 | Zero-copy audio (<500ms latency) | ❌ P1.2 | ✅ | △ | △ | △ |
| 3.8 | Bidirectional realtime voice | ❌ future | ❌ | △ | ✅ | ✅ |

**DC Score: 4/8** | Gap: local Whisper, VAD, zero-copy, realtime voice

---

## Category 4 — AI Intelligence

| # | Feature | DC Current | screenpipe | OpenFlux | ADK-Rust | Cluely |
|---|---------|-----------|-----------|---------|---------|--------|
| 4.1 | Claude (Sonnet/Opus/Haiku) | ✅ 9/10 | △ | ✅ | ✅ | ✅ |
| 4.2 | OpenAI GPT-4o/o3 | ✅ 9/10 | ✅ | ✅ | ✅ | ❌ |
| 4.3 | Grok (xAI) | ✅ 9/10 | ❌ | △ | ❌ | ❌ |
| 4.4 | Local/Ollama models | ❌ future | ✅ | ✅ | ✅ | ❌ |
| 4.5 | Vision (screenshots in context) | ✅ 9/10 | △ | ✅ | ✅ | ✅ |
| 4.6 | Streaming responses (SSE) | ✅ 9/10 | ✅ | ✅ | ✅ | ✅ |

**DC Score: 5/6** | Gap: local Ollama models (optional)

---

## Category 5 — Computer Use / Action

| # | Feature | DC Current | OpenFlux | UI-TARS | Claude CU | ADK-Rust |
|---|---------|-----------|---------|---------|----------|---------|
| 5.1 | Cursor animation to screen points | ✅ partial | △ | ✅ | △ | ❌ |
| 5.2 | enigo click/type/scroll | ❌ Phase 6 | ✅ | ✅ | ✅ | ❌ |
| 5.3 | [POINT] tag parse + wire | ❌ Phase 6 | ❌ | ❌ | ❌ | ❌ |
| 5.4 | Tool-use loop (see → act → verify) | ❌ Phase 6 | ✅ | ✅ | ✅ | ✅ |
| 5.5 | Action safety gate (tier classification) | ❌ Phase 6 | △ | △ | ✅ | △ |
| 5.6 | Multi-step agent (10+ step loops) | ❌ Phase 6+ | ✅ | ✅ | ✅ | ✅ |
| 5.7 | UI-TARS local vision model | ❌ Phase 10 | △ | ✅ | ❌ | ❌ |

**DC Score: 1/7** → Phase 6 will get this to 5/7 | Major gap now

---

## Category 6 — Memory & Context

| # | Feature | DC Current | screenpipe | Natively | OpenFlux | ADK-Rust |
|---|---------|-----------|-----------|---------|---------|---------|
| 6.1 | In-session conversation history | ✅ 8/10 | ✅ | ✅ | ✅ | ✅ |
| 6.2 | SQLite persistent session history | ❌ Phase 8 | ✅ | ✅ | ✅ | ❌ |
| 6.3 | Screen event memory (24/7 recording) | ❌ Phase 8 | ✅ | ❌ | ❌ | ❌ |
| 6.4 | Local vector search / RAG | ❌ P1.1 | ✅ | ✅ | ✅ | ✅ |
| 6.5 | Screenpipe client integration | ❌ Phase 8 | — | ❌ | ❌ | ❌ |

**DC Score: 1/5** → Phase 8 will get this to 4/5 | Critical gap

---

## Category 7 — Integration & Protocol

| # | Feature | DC Current | screenpipe | OpenFlux | rust-sdk |
|---|---------|-----------|-----------|---------|---------|
| 7.1 | MCP server (expose tools via MCP) | ❌ Phase 12 | ✅ | ✅ | ✅ |
| 7.2 | WebSocket bridge (DanteAgents) | ❌ Phase 9 | ❌ | △ | ❌ |
| 7.3 | Official MCP SDK compliance | ❌ Phase 12 | △ | △ | ✅ |
| 7.4 | REST API for external tools | ❌ future | ✅ | ✅ | ❌ |

**DC Score: 0/4** → Phases 9 + 12 will get to 3/4 | Strategic gap

---

## Category 8 — Quality & Distribution

| # | Feature | DC Current | screenpipe | Natively | OpenFlux |
|---|---------|-----------|-----------|---------|---------|
| 8.1 | Unit tests (critical path) | ❌ | ✅ | △ | △ |
| 8.2 | CI/CD pipeline (GitHub Actions) | ❌ | ✅ | ✅ | ✅ |
| 8.3 | Privacy-by-design (local-first) | ✅ | ✅ | ✅ | △ |
| 8.4 | Binary size <50MB | ✅ (Tauri) | △ | △ | △ |
| 8.5 | README + demo GIF | ❌ | ✅ | ✅ | ✅ |
| 8.6 | GitHub Releases + update feed | ❌ Phase 7 | ✅ | ✅ | ✅ |

**DC Score: 2/6** | Gap: tests, CI/CD, README+demo, GitHub Releases

---

## Universe Summary

| Category | DC Score | Max | % | Priority |
|----------|---------|-----|---|---------|
| Platform | 6/8 | 8 | 75% | ⬤ Medium |
| Screen Capture | 3/6 | 6 | 50% | ⬤ Low (WGC is excellent) |
| Voice Pipeline | 4/8 | 8 | 50% | ⬤⬤ High |
| AI Intelligence | 5/6 | 6 | 83% | ✅ Strong |
| Computer Use | 1/7 | 7 | 14% | 🔴 Critical |
| Memory & Context | 1/5 | 5 | 20% | 🔴 Critical |
| Integration | 0/4 | 4 | 0% | ⬤⬤ High |
| Quality/Dist | 2/6 | 6 | 33% | ⬤ Medium |
| **TOTAL** | **22/40** | **40** | **55%** | |

---

## Top Feature Gaps by Competitive Impact

| Rank | Feature | Phase | Effort | Competitors with it | Impact |
|------|---------|-------|--------|--------------------|----|
| 1 | Wire enigo click/type (Phase 6) | 6 | 2h | OpenFlux, UI-TARS, Claude CU | 🔴 Critical |
| 2 | Tool-use loop in AI pipeline | 6 | 4h | All computer-use tools | 🔴 Critical |
| 3 | SQLite session memory | 8 | 4h | screenpipe, Natively, OpenFlux | 🔴 Critical |
| 4 | VAD for whisper-rs | 11 | 2h | Wispr Flow, OpenFlux | ⬤⬤ High |
| 5 | Local Whisper STT | 11 | 6h | Wispr Flow, OpenFlux | ⬤⬤ High |
| 6 | WebSocket DanteAgents bridge | 9 | 6h | Unique to DanteClicky | ⬤⬤ High |
| 7 | Stealth overlay | new | 3h | Natively (2k★ for this alone) | ⬤⬤ High |
| 8 | MCP server (official SDK) | 12 | 5h | screenpipe, OpenFlux | ⬤⬤ High |
| 9 | Local vector RAG | 8+ | 6h | screenpipe, Natively, OpenFlux | ⬤ Medium |
| 10 | Auto-updater | 7 | 3h | Every competitor | ⬤ Medium |

---

## DanteClicky Unique Advantages (Not in ANY competitor)

1. **[POINT:x,y] tag protocol** — AI-native cursor annotation syntax, parsed and rendered in overlay
2. **DanteAgents WebSocket bridge** — Exposes full sensory API to constitutional AI system
3. **Multi-model overlay** — Single hotkey, all providers, with screen context, from system tray
4. **Grok vision support** — Only DanteClicky routes to xAI Grok, including vision tasks
5. **MCP server + voice + computer use** — The only planned tool combining all three

---

*Coverage: 22/40 features (55%) | Target: 37/40 (92.5%) | Registry: .danteforge/oss-registry.json*
