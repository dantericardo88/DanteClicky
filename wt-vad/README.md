# DanteClicky — Windows AI Companion

> Voice-commanded, screen-aware, computer-use capable AI desktop companion for Windows.  
> 100% local-first. Your screenshots never leave your device.

![Platform](https://img.shields.io/badge/platform-Windows-blue)
![Stack](https://img.shields.io/badge/stack-Tauri%202%20%2B%20Rust%20%2B%20React-orange)
![Score](https://img.shields.io/badge/score-76%2F100-green)
![License](https://img.shields.io/badge/license-MIT-brightgreen)

---

## What it does

Press `Ctrl+Alt+Space` → speak → watch the cursor animate to the target → AI executes the action → hear TTS confirmation.

The only Windows-native tool that combines:
- **Voice push-to-talk** (AssemblyAI real-time STT + local Whisper toggle)
- **Screen capture** (GPU-accelerated WGC, all monitors)
- **Computer use** (click, type, scroll via enigo — AI controls your desktop)
- **Model-agnostic** (Claude Sonnet/Opus/Haiku, GPT-4o/o3, Grok 2/3)
- **DanteAgents bridge** (WebSocket on :9001 — AI agents get GPU vision + desktop control)
- **MCP server** (Claude Desktop / Cursor integration on :9002)
- **Local-first privacy** — no proxy server, no data breach surface

> After Cluely's 2025 data breach exposed 83,000 users' interview transcripts and screenshots, we built the alternative: everything stays on your machine.

---

## Quick start

```bash
# Prerequisites: Rust 1.85+, Node 20+, Windows 10/11
git clone https://github.com/dantericardo88/DanteClicky.git
cd DanteClicky
npm install
npm run tauri dev
```

Enter your API keys in the Settings panel (gear icon in tray). No server to deploy.

---

## Architecture

```
DanteClicky (Tauri 2.0)
│
├── SENSORY    capture.rs   WGC GPU screen capture, all monitors, JPEG 85%
│              audio.rs     cpal WASAPI 16kHz, push-to-talk accumulator
│              stt.rs       AssemblyAI cloud OR whisper-rs local (toggle in settings)
│
├── ACTION     input.rs     enigo: click, double-click, right-click, type, scroll, move
│              cursor.rs    Win32 SetCursorPos smooth animation to [POINT] coords
│
├── BRAIN      chat_proxy.rs  reqwest SSE streaming → Claude / OpenAI / Grok
│              mcp_server.rs  axum SSE on :9002 — Claude Desktop / Cursor integration
│
├── BRIDGE     ws_server.rs   tokio WebSocket on :9001 — DanteAgents tool dispatch
│
└── UI         CompanionPanel.tsx  settings, model picker, STT toggle, API keys
               OverlayPanel.tsx    streaming response, waveform, cursor dot, [POINT] pins
```

---

## Claude Desktop integration (MCP)

Add to your `claude_desktop_config.json`:

```json
"mcpServers": {
  "danteclicky": {
    "url": "http://localhost:9002/sse"
  }
}
```

DanteClicky exposes: `capture_screen`, `click`, `type_text`, `scroll`, `speak` as MCP tools.

---

## DanteAgents bridge

Connect DanteAgents (or any agent) to `ws://localhost:9001`:

```json
{ "tool": "capture_screen" }
{ "tool": "click", "x": 960, "y": 540 }
{ "tool": "type_text", "text": "Hello world" }
{ "tool": "set_cursor", "x": 100, "y": 200 }
```

---

## Models

| Provider | Models |
|----------|--------|
| Anthropic | claude-sonnet-4-5, claude-opus-4-5, claude-haiku-4-5 |
| OpenAI | gpt-4o, gpt-4o-mini, o3-mini |
| xAI | grok-2-vision-1212, grok-3-mini-beta |
| Local | whisper-base.en STT (offline, 142MB download) |

---

## Tech stack

| Layer | Tech |
|-------|------|
| Shell | Tauri 2.0 |
| Backend | Rust 1.85 |
| Frontend | React 19.1 + TypeScript 5.8 + Vite 7 |
| State | Zustand 5 |
| AI SDK | Vercel AI SDK 6 |
| Audio | cpal 0.15 (WASAPI) |
| Screen | screenshots 0.8 (WGC) |
| Input | enigo 0.2 |
| STT | AssemblyAI WebSocket + whisper-rs 0.13 |
| TTS | ElevenLabs Web Audio API |
| HTTP | reqwest 0.12, axum 0.7 |
| WS | tokio-tungstenite 0.24 |

---

## Competitive position

| | DanteClicky | Cluely | Pluely | screenpipe | UI-TARS |
|-|-------------|--------|--------|-----------|---------|
| Windows native | ✅ | ⚠️ | ✅ | ✅ | ✅ |
| Voice pipeline | ✅ | ✅ | ⚠️ | ⚠️ | ❌ |
| Computer use | ✅ | ⚠️ | ❌ | ❌ | ✅ |
| Local-first | ✅ | **❌ (breach)** | ✅ | ✅ | ✅ |
| DanteAgents bridge | ✅ | ❌ | ❌ | ❌ | ❌ |
| MCP server | ✅ | ❌ | ❌ | ✅ | ❌ |
| Free/open source | ✅ | ❌ | ✅ | ✅ | ✅ |

---

## Development score

Current: **76/100** → Target: **93/100**  
See `.danteforge/ASCEND_REPORT.md` for full dimension breakdown and sprint plan.

---

## Contributing

See `CONTRIBUTING.md`. Architecture map: overlay window → ws_server → input.rs → capture.rs.

Run tests:
```bash
cargo test
npm test
```
