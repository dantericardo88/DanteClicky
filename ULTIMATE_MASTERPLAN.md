# DanteClicky Windows — ULTIMATE MASTERPLAN
> INFERNO + PARTY + ASCEND + COMPETE + LEAPFROG synthesis  
> Generated: 2026-05-05 | Full competitive harvest applied  
> Goal: Leapfrog Cluely, Pluely, WhisperFlow, Screenpipe, Open Interpreter, UI-TARS  
> Foundation: DanteAgents sensory pipeline (vision + voice + desktop control)

---

## 1. Executive Intelligence Brief

### 1.1 The Market Gap (Confirmed by Competitive Harvest)

The AI desktop companion space has fragmented into four categories — and **no single tool owns all four**:

| Category | Best Current Tool | Gap |
|----------|-----------------|-----|
| Screen capture + AI overlay | Cluely ($49/mo, cloud, data breach) | Privacy, cost |
| Persistent screen memory | Screenpipe (24/7 recording) | No action layer |
| Voice dictation | Wispr Flow (macOS-first) | No Windows equivalent |
| Computer use / action | Claude Computer Use, UI-TARS | No voice + no overlay UI |

**DanteClicky's unique position:** The only tool that is simultaneously a **voice-commanded, screen-aware, memory-persistent, model-agnostic, computer-use capable** Windows-native desktop companion — and the sensory runtime for DanteAgents constitutional AI.

### 1.2 Competitive Scores (Pre-Build Baseline)

| Dimension | Cluely | Pluely | Screenpipe | UI-TARS | DanteClicky Target |
|-----------|--------|--------|-----------|---------|------------------|
| Windows Native | 4/10 | 9/10 | 9/10 | 8/10 | **10/10** |
| Voice Pipeline | 6/10 | 2/10 | 5/10 | 0/10 | **9/10** |
| Screen Capture | 7/10 | 5/10 | 9/10 | 9/10 | **9/10** |
| Persistent Memory | 3/10 | 0/10 | 10/10 | 0/10 | **9/10** |
| Computer Use | 2/10 | 0/10 | 0/10 | 9/10 | **9/10** |
| Model Agnostic | 2/10 | 4/10 | 3/10 | 3/10 | **10/10** |
| Privacy / Local-First | 1/10 | 9/10 | 9/10 | 9/10 | **9/10** |
| Binary Size | 2/10 | 10/10 | 7/10 | 5/10 | **9/10** |
| DanteAgents Bridge | 0/10 | 0/10 | 0/10 | 0/10 | **10/10** |
| MCP Protocol | 0/10 | 0/10 | 8/10 | 0/10 | **9/10** |
| **TOTAL** | **27/100** | **39/100** | **60/100** | **43/100** | **93/100** |

---

## 2. Target Architecture — The Ultimate Stack

```
DanteClicky Windows (Tauri 2.0 + Rust)
│
├── [SENSORY LAYER] — Eyes, Ears
│   ├── capture.rs          WGC / screenshots crate — all monitors, GPU-accelerated
│   ├── audio.rs            cpal + WASAPI — 16kHz mono, push-to-talk
│   ├── stt.rs              AssemblyAI WebSocket (real-time) OR whisper-rs (local/offline)
│   └── monitors.rs         Multi-monitor enumeration, Win32 coords, scale factors
│
├── [ACTION LAYER] — Hands
│   ├── hotkey.rs           tauri-plugin-global-hotkey — configurable, not just Ctrl+Alt
│   ├── cursor.rs           Win32 SetCursorPos + smooth animation for [POINT] tags
│   ├── input.rs            enigo — keyboard injection, click, scroll (for computer use)
│   └── computer_use.rs     Full Claude Computer Use tool loop — see, click, type, scroll
│
├── [MEMORY LAYER] — Long-Term Context
│   ├── session.rs          SQLite (rusqlite) — conversation + screenshot history
│   ├── screenpipe.rs       Screenpipe MCP client — query persistent screen memory
│   └── context.rs          Assembles context: session + screenpipe + active screen
│
├── [INTELLIGENCE LAYER] — Brain
│   ├── provider.ts         Vercel AI SDK — Claude / GPT-4o / Grok unified interface
│   ├── ui_tars.rs          UI-TARS 7B optional — local vision model via ONNX/llama.cpp
│   └── worker/index.ts     Cloudflare Worker — secrets proxy + model routing
│
├── [BRIDGE LAYER] — DanteAgents Integration
│   ├── ws_server.rs        Local WebSocket server (port 9001) — DanteAgents connects here
│   ├── mcp_server.rs       MCP protocol server — Claude Desktop, Cursor, VS Code plugins
│   └── tools.rs            Tool definitions: capture, type, click, screenshot, voice
│
└── [UI LAYER] — Face
    ├── tray.rs             System tray — icon, menu, model submenu
    ├── CompanionPanel.tsx  Settings panel — model picker, permissions, DM button
    ├── OverlayPanel.tsx    Transparent overlay — streaming text, waveform, cursor dot
    ├── MemoryPanel.tsx     NEW: Screenpipe memory browser (search what you've seen)
    └── AgentPanel.tsx      NEW: DanteAgents task monitor (active agent, task progress)
```

---

## 3. Leapfrog Opportunities (Competitive Harvest Results)

### 3.1 Leapfrog #1 — Screenpipe Memory Integration (Nobody Does This)
**Gap identified:** Screenpipe has persistent memory but no action layer. Cluely has action but no memory. No competitor combines them.

**Implementation:** DanteClicky queries Screenpipe's SQLite FTS5 database (or its REST API if Screenpipe is running) to assemble context before every AI call. The AI can answer "what was that error I saw yesterday?" by searching the screen memory.

```typescript
// Before every AI call, enrich context with Screenpipe memory
async function assembleContext(query: string) {
  const sessionHistory = await getSessionHistory();
  const screenMemory = await queryScreenpipe(query, { limit: 5 }); // last 5 relevant frames
  const activeScreen = await invoke('capture_screen');
  return { sessionHistory, screenMemory, activeScreen };
}
```

**User pitch:** "The first AI companion that remembers everything you've ever seen on your screen."

---

### 3.2 Leapfrog #2 — Voice + Computer Use (Nobody Does Both)
**Gap identified:**
- Wispr Flow = voice dictation only (no actions)
- Claude Computer Use = computer control only (no voice)
- Open Interpreter = code execution (no voice, no overlay)

**Implementation:** Full pipeline: hold hotkey → speak → transcript → screenshot → AI reasons → executes mouse/keyboard actions → speaks response via ElevenLabs.

```
Ctrl+Alt+Space (hold) → cpal recording → AssemblyAI transcript
                                          ↓
                              WGC screen capture (all monitors)
                                          ↓
                              Vercel AI SDK → Claude (vision + tool use)
                                          ↓
                    computer_use tool loop → click/type/scroll via enigo
                                          ↓
                              ElevenLabs TTS → WebAudio playback
                                          ↓
                              Overlay shows reasoning + cursor animation
```

**User pitch:** "Talk to your computer and watch it work."

---

### 3.3 Leapfrog #3 — Local-First STT Toggle (WhisperFlow for Windows)
**Gap identified:** No Windows-native app offers local Whisper STT with the quality of Wispr Flow. This is a completely open market.

**Implementation:** Phase 11 — add `whisper-rs` as alternative STT backend alongside AssemblyAI. Toggle in settings. `whisper-base.en` = 142MB, ~95% accuracy, fully offline, free.

```rust
// stt.rs — dual-backend STT
pub enum SttBackend {
    AssemblyAI { ws: WebSocket },     // real-time, cloud, $0.37/hr
    WhisperLocal { model: WhisperModel }, // chunk-based, local, free, offline
}

impl SttBackend {
    pub async fn transcribe(&self, pcm_chunk: Vec<i16>) -> Result<String> {
        match self {
            Self::AssemblyAI { ws } => ws_send_chunk(ws, pcm_chunk).await,
            Self::WhisperLocal { model } => model.transcribe(pcm_chunk),
        }
    }
}
```

**User pitch:** "Voice AI that works offline, privately, for free."

---

### 3.4 Leapfrog #4 — DanteAgents Sensory Bridge (Unique Moat)
**Gap identified:** DanteAgents has a 9-step constitutional pipeline but no vision, voice, or desktop action layer. DanteClicky is being built with exactly those capabilities.

**Implementation:** Phase 9 — expose a local WebSocket server from the Tauri Rust backend. DanteAgents connects and calls DanteClicky tools directly, replacing `@nut-tree-fork/nut-js` with GPU-accelerated WGC capture and WASAPI audio.

```rust
// ws_server.rs — DanteAgents connects here
// Tools exposed over WebSocket:
// { tool: "capture_screen" }          → Vec<MonitorFrame>
// { tool: "start_audio" }             → stream audio chunks
// { tool: "stop_audio" }              → Vec<i16> PCM
// { tool: "click", x, y }            → Win32 click
// { tool: "type_text", text }         → enigo keyboard
// { tool: "set_cursor", x, y }        → SetCursorPos
// { tool: "speak", text }             → ElevenLabs TTS
// { tool: "query_memory", q }         → Screenpipe FTS search
```

---

### 3.5 Leapfrog #5 — MCP Protocol Server (Claude Desktop Integration)
**Gap identified:** Screenpipe is the only desktop app that exposes an MCP server. This makes it pluggable into Claude Desktop and Cursor. DanteClicky should do the same — and go further by also exposing voice and computer use via MCP.

**Implementation:** Phase 12 — expose DanteClicky's capabilities as MCP tools. Users can then say "Hey Claude Desktop, take a screenshot and tell me what's wrong with this UI" — and Claude Desktop calls DanteClicky's MCP endpoint.

```json
// mcp-server manifest
{
  "tools": [
    { "name": "clicky_screenshot", "description": "Capture all monitors" },
    { "name": "clicky_click", "description": "Click at coordinates" },
    { "name": "clicky_type", "description": "Type text via keyboard" },
    { "name": "clicky_speak", "description": "Speak text via TTS" },
    { "name": "clicky_memory_search", "description": "Search screen memory" }
  ]
}
```

---

### 3.6 Leapfrog #6 — UI-TARS 7B Local Vision (Optional Power Mode)
**Gap identified:** UI-TARS 7B achieves 18.8% OSWorld success (vs GPT-4o 12.2%) and is trained specifically on Windows UI screenshots. Running it locally on an RTX 3090/4090 means zero API cost for computer use reasoning.

**Implementation:** Phase 10 — optional power mode. If CUDA GPU with 8GB+ VRAM detected, offer UI-TARS 7B as the computer use reasoning model instead of cloud Claude. The Vercel AI SDK handles the provider abstraction — UI-TARS uses OpenAI-compatible API format.

---

## 4. Implementation Phases — ULTIMATE 12-Phase Plan

### STATUS SUMMARY (as of 2026-05-05)
Based on code present in `dante-clicky-windows/`:
- Phase 0: ✅ DONE — Tauri 2.0 scaffold, node_modules installed
- Phase 1: ✅ DONE — `hotkey.rs`, `tray.rs`, `monitors.rs`, `overlay.rs` implemented
- Phase 2: ✅ DONE — `capture.rs` using screenshots crate, multi-monitor, JPEG compression
- Phase 3: ✅ DONE — `audio.rs` using cpal, WASAPI, base64 Tauri events

**Remaining: Phases 4–12**

---

### Phase 4 — AI Provider Integration (CURRENT — Today)
**Goal:** Full vision + text pipeline with model picker working end-to-end.  
**Estimated time:** 4–6 hours with party mode.

```typescript
// src/providers/AIProvider.ts — already designed in MASTERPLAN.md
// Key addition from harvest: use streamText() with tool use loop for computer use

import { streamText, tool } from 'ai';
import { z } from 'zod';

const { textStream } = await streamText({
  model: getModel(selectedProvider),
  system: SYSTEM_PROMPT,
  messages: conversationHistory,
  tools: {
    computer_use: tool({
      description: 'Click, type, scroll, or take a screenshot',
      parameters: z.object({
        action: z.enum(['screenshot', 'click', 'type', 'scroll', 'cursor']),
        x: z.number().optional(),
        y: z.number().optional(),
        text: z.string().optional(),
      }),
      execute: async ({ action, x, y, text }) => {
        return await invoke(`computer_use_${action}`, { x, y, text });
      },
    }),
  },
});
```

**Deliverables:**
- [ ] `AIProvider.ts` — unified interface
- [ ] `ClaudeProvider.ts`, `OpenAIProvider.ts`, `GrokProvider.ts`
- [ ] Cloudflare Worker updated with Grok endpoint + model routing
- [ ] `[POINT:x,y:label:screenN]` tag parser (`src/lib/pointParser.ts`)
- [ ] Conversation history management in Zustand store
- [ ] Test: press Ctrl+Alt+Space, speak question, see streaming AI response

---

### Phase 5 — UI Parity (Tomorrow AM)
**Goal:** Full UI matching macOS DanteClicky with improvements.  
**Estimated time:** 1–2 days with party mode.

**Key components:**
- [ ] `CompanionPanel.tsx` — status, model picker (Claude/GPT/Grok + all submodels), permissions
- [ ] `OverlayPanel.tsx` — streaming text bubble, waveform animation, cursor dot
- [ ] `DesignSystem.ts` — port all color tokens from `DesignSystem.swift`
- [ ] `Waveform.tsx` — animated audio waveform (Web Audio AnalyserNode)
- [ ] `ModelPicker.tsx` — grouped by provider, shows capability badges (vision/speed/cost)
- [ ] `ResponseBubble.tsx` — typewriter effect, markdown rendering, copy button

**Harvest additions vs original MASTERPLAN:**
- Add **loading skeleton** states (Pluely pattern)
- Add **cost indicator** per response (shows tokens + estimated $)
- Add **provider health badge** (green/yellow/red based on last response latency)

---

### Phase 6 — Computer Use & Cursor Animation (Tomorrow PM)
**Goal:** Full computer use pipeline — AI can see, click, type, scroll.  
**Estimated time:** 2–3 days (coordinate math is the hard part).

**New vs original plan — use `enigo` for full input control, not just `SetCursorPos`:**

```toml
# Cargo.toml
[dependencies]
enigo = "0.2"  # Win32 SendInput — click, type, scroll, move cursor
```

```rust
// src-tauri/src/input.rs
use enigo::{Enigo, Mouse, Keyboard, Settings, Button, Key, Direction};

#[tauri::command]
fn computer_use_click(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo.move_mouse(x, y, enigo::Coordinate::Abs).map_err(|e| e.to_string())?;
    enigo.button(Button::Left, Direction::Click).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn computer_use_type(text: String) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo.text(&text).map_err(|e| e.to_string())?;
    Ok(())
}
```

**Deliverables:**
- [ ] `input.rs` — enigo: click, double-click, right-click, type, scroll, drag
- [ ] `cursor.rs` — smooth animated cursor movement (CSS transitions + SetCursorPos)
- [ ] `[POINT:x,y:label:screenN]` → animate overlay cursor dot to coordinates
- [ ] Multi-monitor coordinate mapping: `screenN` label → monitor offset → physical pixels
- [ ] Computer use tool loop: screenshot → reason → act → screenshot → reason (max 10 steps)
- [ ] Safety: PolicyGate-style action classification (Tier 0 safe → Tier 3 destructive)

---

### Phase 7 — Packaging & Distribution (EOW Friday)
**Goal:** Installable Windows app that auto-updates.  
**Note:** Start EV cert application NOW — takes 1-2 weeks from DigiCert.

- [ ] NSIS installer config in `tauri.conf.json`
- [ ] `tauri-plugin-updater` — configure GitHub Releases as update endpoint
- [ ] `tauri-plugin-autostart` — HKCU registry Run key for startup
- [ ] App icon set (generate from SVG via `tauri icon`)
- [ ] `npm run tauri build` → `.msi` + `.exe`
- [ ] Upload v0.1.0-alpha to GitHub Releases

---

### Phase 8 — Screenpipe Memory Integration (Week 2)
**Goal:** AI companion that remembers everything the user has seen.  
**Unique market position:** No competitor does this.

```typescript
// src/lib/screenpipe.ts
// Query Screenpipe's local REST API (port 3030 by default)

export async function queryScreenMemory(query: string, limit = 5) {
  try {
    const res = await fetch(`http://localhost:3030/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    if (!res.ok) return null; // Screenpipe not running — graceful degradation
    return await res.json();
  } catch {
    return null; // Silent fallback
  }
}

// Enrich every AI context call
export async function assembleRichContext(userQuery: string): Promise<Context> {
  const [sessionHistory, screenMemory, activeScreen] = await Promise.all([
    getSessionHistory(),
    queryScreenMemory(userQuery),
    invoke<MonitorFrame[]>('capture_screen'),
  ]);
  return { sessionHistory, screenMemory, activeScreen };
}
```

**UI additions:**
- [ ] `MemoryPanel.tsx` — search "what did I see?" interface
- [ ] Context indicator in overlay: "Using 3 memory frames + current screen"
- [ ] Settings toggle: Enable/disable Screenpipe integration

---

### Phase 9 — DanteAgents Sensory Bridge (Week 2)
**Goal:** Replace `@nut-tree-fork/nut-js` in DanteAgents with DanteClicky as the GPU-native sensory layer.

```rust
// src-tauri/src/ws_server.rs
// Local WebSocket server for DanteAgents integration

use tokio::net::TcpListener;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(tag = "tool")]
enum DanteTool {
    CaptureScreen,
    StartAudio,
    StopAudio,
    Click { x: i32, y: i32 },
    TypeText { text: String },
    SetCursor { x: i32, y: i32 },
    Speak { text: String },
    QueryMemory { query: String },
}

// DanteAgents connects to ws://localhost:9001
// Receives tool calls as JSON, returns results as JSON
// Enables DanteAgents to use DanteClicky as its computer-use execution layer
```

**DanteAgents changes (in DanteAgents project):**
- [ ] `packages/desktop-hands/src/clicky-adapter.ts` — new adapter that calls ws://localhost:9001
- [ ] Feature flag: `DANTE_USE_CLICKY=true` → use DanteClicky instead of nut-js
- [ ] PRD-23 (vision-eye) implementation: DanteAgents calls `CaptureScreen` → feeds to UI-TARS or Claude vision

---

### Phase 10 — UI-TARS 7B Local Vision (Week 3 — GPU Power Mode)
**Goal:** On machines with RTX 3090/4090, run UI-TARS 7B locally for zero-cost computer use reasoning.

**Architecture:**
```rust
// ui_tars.rs — optional local vision model
// If CUDA GPU with 8GB+ VRAM detected:
//   → Download UI-TARS-7B-ONNX (quantized, ~4GB)
//   → Run via ort (ONNX Runtime) crate
//   → Expose as local OpenAI-compatible endpoint on port 11435
//   → Vercel AI SDK createOpenAI({ baseUrl: 'http://localhost:11435' })

// Fallback: if no GPU → use cloud Claude via Worker (existing path)
```

**Detection + download flow:**
- [ ] GPU detection via `nvml` Rust crate (CUDA device query)
- [ ] Model download with progress bar in CompanionPanel
- [ ] Toggle: "Local AI Mode" in settings (requires download)
- [ ] Benchmark comparison display: local vs cloud latency

---

### Phase 11 — Local Whisper STT (Week 3 — Offline Mode)
**Goal:** Windows-native local STT — the WhisperFlow for Windows that doesn't exist yet.

```toml
[dependencies]
whisper-rs = { version = "0.11", features = ["cuda"] }  # CUDA optional
```

```rust
// stt.rs — dual-backend
pub struct SttManager {
    backend: SttBackend,
    model: Option<WhisperContext>,  // loaded when local mode enabled
}

impl SttManager {
    pub fn set_backend(&mut self, mode: SttMode) {
        self.backend = match mode {
            SttMode::Cloud => SttBackend::AssemblyAI,
            SttMode::Local => SttBackend::WhisperRs {
                model: WhisperContext::new("models/ggml-base.en.bin").unwrap(),
            },
        };
    }
}
```

**Model selection UI:**
- [ ] Settings: "Speech Recognition" → Cloud (Real-time) | Local (Private, Offline)
- [ ] Model downloader: tiny (75MB), base (142MB), small (466MB) with accuracy badges
- [ ] Automatic fallback: if AssemblyAI fails → switch to local whisper

---

### Phase 12 — MCP Protocol Server (Week 4 — Ecosystem Integration)
**Goal:** DanteClicky as MCP server — pluggable into Claude Desktop, Cursor, VS Code Continue.

```json
// mcp-manifest.json — Claude Desktop connects here
{
  "name": "dante-clicky",
  "version": "1.0.0",
  "description": "Windows desktop control, screen capture, voice, and memory",
  "transport": { "type": "stdio" },
  "tools": [
    {
      "name": "capture_screen",
      "description": "Capture all monitors, returns base64 JPEG images",
      "inputSchema": { "type": "object", "properties": {} }
    },
    {
      "name": "click",
      "description": "Click at screen coordinates",
      "inputSchema": {
        "type": "object",
        "properties": {
          "x": { "type": "number" },
          "y": { "type": "number" }
        }
      }
    },
    {
      "name": "type_text",
      "description": "Type text via keyboard injection",
      "inputSchema": {
        "type": "object",
        "properties": { "text": { "type": "string" } }
      }
    },
    {
      "name": "speak",
      "description": "Speak text via ElevenLabs TTS",
      "inputSchema": {
        "type": "object",
        "properties": { "text": { "type": "string" } }
      }
    },
    {
      "name": "search_memory",
      "description": "Search what you've seen on screen (via Screenpipe)",
      "inputSchema": {
        "type": "object",
        "properties": { "query": { "type": "string" } }
      }
    }
  ]
}
```

---

## 5. Party Mode — Agent Assignments

| Agent | Phases | Key Files | Token Budget |
|-------|--------|-----------|-------------|
| **Rust Architect** | 6, 9, 10, 11 | `input.rs`, `ws_server.rs`, `ui_tars.rs`, `stt.rs` | INFERNO |
| **Frontend Dev** | 5, 8 | `OverlayPanel.tsx`, `MemoryPanel.tsx`, `ModelPicker.tsx` | MAGIC |
| **AI Pipeline** | 4, 12 | `AIProvider.ts`, `worker/index.ts`, `mcp-server.rs` | MAGIC |
| **UX/Design** | 5 | `DesignSystem.ts`, `Waveform.tsx`, `ResponseBubble.tsx` | NOVA |
| **DanteAgents Bridge** | 9 | `clicky-adapter.ts` in DanteAgents repo | MAGIC |
| **QA/Verify** | All | Build pipeline, integration tests, coordinate math | EMBER |

---

## 6. File Structure — Ultimate Target

```
dante-clicky-windows/
├── src-tauri/src/
│   ├── main.rs              ← App entry
│   ├── lib.rs               ← Plugin registration
│   ├── tray.rs              ✅ DONE
│   ├── hotkey.rs            ✅ DONE
│   ├── capture.rs           ✅ DONE
│   ├── audio.rs             ✅ DONE
│   ├── overlay.rs           ✅ DONE
│   ├── monitors.rs          ✅ DONE
│   ├── input.rs             ← Phase 6: enigo computer use
│   ├── cursor.rs            ← Phase 6: smooth cursor animation
│   ├── session.rs           ← Phase 8: SQLite session history
│   ├── screenpipe.rs        ← Phase 8: Screenpipe client
│   ├── ws_server.rs         ← Phase 9: DanteAgents WebSocket bridge
│   ├── mcp_server.rs        ← Phase 12: MCP protocol server
│   ├── ui_tars.rs           ← Phase 10: Local vision model (optional)
│   ├── stt.rs               ← Phase 11: Dual-backend STT
│   └── updater.rs           ← Phase 7
│
├── src/
│   ├── App.tsx
│   ├── windows/
│   │   ├── CompanionPanel.tsx   ← Phase 5
│   │   └── OverlayPanel.tsx     ← Phase 5
│   ├── panels/
│   │   ├── MemoryPanel.tsx      ← Phase 8: Screenpipe memory browser
│   │   └── AgentPanel.tsx       ← Phase 9: DanteAgents task monitor
│   ├── providers/
│   │   ├── AIProvider.ts        ← Phase 4
│   │   ├── ClaudeProvider.ts    ← Phase 4
│   │   ├── OpenAIProvider.ts    ← Phase 4
│   │   └── GrokProvider.ts      ← Phase 4
│   ├── hooks/
│   │   ├── useVoice.ts          ← Phase 4
│   │   ├── useHotkey.ts         ← Phase 4
│   │   ├── useScreenCapture.ts  ← Phase 4
│   │   ├── useAssemblyAI.ts     ← Phase 4
│   │   ├── useElevenLabs.ts     ← Phase 4
│   │   └── useComputerUse.ts    ← Phase 6
│   ├── components/
│   │   ├── ModelPicker.tsx      ← Phase 5
│   │   ├── ResponseBubble.tsx   ← Phase 5
│   │   ├── Waveform.tsx         ← Phase 5
│   │   ├── CursorOverlay.tsx    ← Phase 6
│   │   ├── MemorySearch.tsx     ← Phase 8
│   │   └── PermissionsStatus.tsx← Phase 5
│   ├── state/
│   │   └── companionStore.ts    ← Phase 4 (Zustand)
│   └── lib/
│       ├── designSystem.ts      ← Phase 5
│       ├── pointParser.ts       ← Phase 4
│       ├── coordinates.ts       ← Phase 6
│       └── screenpipe.ts        ← Phase 8
│
└── worker/
    └── src/index.ts             ← Phase 4 (Grok routing)
```

---

## 7. Risk Register — Updated

| Risk | Severity | Phase | Mitigation |
|------|----------|-------|-----------|
| EV code signing cert takes 2 weeks | HIGH | 7 | Apply to DigiCert TODAY, distribute unsigned for alpha |
| cpal/WASAPI device enumeration fails on some hardware | HIGH | 3 | ✅ Already implemented with format fallbacks |
| Coordinate Y-flip bugs on multi-monitor | HIGH | 6 | Write unit tests for coordinate math BEFORE UI |
| enigo SendInput blocked by some security software | MEDIUM | 6 | Warn user, document exceptions, fallback to user-guided |
| Screenpipe not running on user machine | LOW | 8 | Silent graceful degradation — DanteClicky works without it |
| UI-TARS model download fails / GPU not detected | LOW | 10 | Cloud fallback always available |
| whisper-rs CUDA link failure on non-NVIDIA GPU | MEDIUM | 11 | CPU fallback via feature flag |
| MCP server port conflict (9001 in use) | LOW | 12 | Try 9001 → 9002 → 9003 at startup |
| DanteAgents WebSocket bridge races with Tauri shutdown | MEDIUM | 9 | Register ws_server as managed state, cleanup on exit |

---

## 8. Competitive Leapfrog Summary

| Competitor | We beat them by | ETA |
|-----------|-----------------|-----|
| **Cluely** | Local-first (no breach), cheaper, Windows-native binary | Phase 5 (Fri) |
| **Pluely** | Voice pipeline, computer use, memory, DanteAgents bridge | Phase 6 (Fri) |
| **WhisperFlow** | Windows-native, we ARE the Windows WhisperFlow equivalent | Phase 11 (Wk3) |
| **Screenpipe** | We have action layer + voice; they only record | Phase 8 (Wk2) |
| **Open Interpreter** | Native Windows UI, voice-commanded, overlay UX, no AGPL | Phase 6 (Fri) |
| **UI-TARS desktop** | We add voice, overlay UI, memory, model choice | Phase 6 (Fri) |

---

## 9. Ascend Scoring — Target Arc

| Dimension | Today | EOW (Phase 7) | Wk2 (Phase 9) | Wk4 (Phase 12) |
|-----------|-------|--------------|--------------|---------------|
| Platform Fidelity | 6/10 | **9/10** | 9/10 | 10/10 |
| Voice Pipeline | 7/10 | **9/10** | 9/10 | 9/10 |
| Screen Capture | 8/10 | 9/10 | 9/10 | 9/10 |
| Computer Use | 0/10 | **7/10** | 8/10 | 9/10 |
| Persistent Memory | 0/10 | 0/10 | **8/10** | 9/10 |
| Model Agnosticism | 3/10 | **9/10** | 9/10 | 10/10 |
| DanteAgents Bridge | 0/10 | 0/10 | **9/10** | 10/10 |
| MCP Integration | 0/10 | 0/10 | 0/10 | **9/10** |
| Local/Offline Mode | 0/10 | 0/10 | 0/10 | **8/10** |
| Packaging/Install | 0/10 | **7/10** | 8/10 | 9/10 |
| **COMPOSITE** | **24/100** | **59/100** | **79/100** | **93/100** |

---

## 10. Self-Improvement Lessons Captured

From competitive harvest and DanteAgents architecture review:

1. **Design Rust backend as a service, not a CLI** — expose tools via both Tauri IPC AND WebSocket so DanteAgents can connect without rewriting anything
2. **Screenpipe graceful degradation** — always check if Screenpipe is running before querying; never block the UI waiting for it
3. **enigo over nut-js** — skip the Node.js layer entirely; direct Rust Win32 SendInput is faster and has no runtime dependency
4. **AssemblyAI + whisper-rs dual-backend from day one** — build the abstraction in Phase 4, implement local backend in Phase 11; the interface is free
5. **MCP is the distribution channel** — being an MCP server means Claude Desktop, Cursor, and VS Code users get DanteClicky tools for free; this is viral distribution
6. **UI-TARS 7B is an add-on, not core** — VRAM requirements make it optional; Claude via Worker is the reliable default
7. **Coordinate testing before UI** — write unit tests for `coordinates.rs` multi-monitor math before building any cursor animation UI

---

## 11. Quick-Start (Current State → Phase 4)

```bash
# You are here — Phases 0-3 complete, Phases 4+ needed
cd c:\Projects\DanteClicky\dante-clicky-windows

# Phase 4: Wire up AI providers
# 1. Create src/providers/AIProvider.ts (see MASTERPLAN.md §5.1)
# 2. Create src/providers/ClaudeProvider.ts, OpenAIProvider.ts, GrokProvider.ts
# 3. Update worker/src/index.ts with Grok routing
# 4. Create src/hooks/useVoice.ts state machine
# 5. Wire up src/state/companionStore.ts

# Dev mode
npm run tauri dev

# When Phase 4 complete, Phase 5 UI follows immediately
# Then Phase 6 (computer use), Phase 7 (packaging)
# = WORKING TOOL by EOW
```

---

*Sources: Competitive harvest 2026-05-05 | Cluely, Pluely, Screenpipe, UI-TARS, Open Interpreter, Wispr Flow, Claude Computer Use analysis | DanteAgents v2.1 PRD | OSS harvest: whisper-rs, enigo, cpal, windows-capture, Tauri 2.0, Vercel AI SDK*
