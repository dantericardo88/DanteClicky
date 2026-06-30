# DanteClicky - AI Desktop Companion

> Voice-commanded, screen-aware, computer-use capable AI desktop companion.  
> 100% local-first. Your screenshots never leave your device.

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue)
![Stack](https://img.shields.io/badge/stack-Tauri%202%20%2B%20Rust%20%2B%20React-orange)
![Score](https://img.shields.io/badge/score-76%2F100-green)
![License](https://img.shields.io/badge/license-MIT-brightgreen)

---

## What it does

Press `Ctrl+Alt+Space` → speak → watch the cursor animate to the target → AI executes the action → hear TTS confirmation.

A local-first desktop companion that combines:
- **Voice push-to-talk** (AssemblyAI U3 Pro multilingual STT + local Whisper language selector)
- **Screen capture** (native desktop capture with platform capability reporting)
- **Computer use** (click, type, scroll via enigo — AI controls your desktop)
- **Model-agnostic** (Claude Sonnet/Opus/Haiku, GPT-4o/o3, Grok 2/3)
- **DanteAgents bridge** (WebSocket on :9001 — AI agents get GPU vision + desktop control)
- **MCP server** (Claude Desktop / Cursor integration on :9002)
- **Local-first privacy** — no proxy server, no data breach surface

> After Cluely's 2025 data breach exposed 83,000 users' interview transcripts and screenshots, we built the alternative: everything stays on your machine.

---

## Quick start

```bash
# Prerequisites: Rust 1.85+, Node 20+, Tauri desktop prerequisites for your OS
git clone https://github.com/dantericardo88/DanteClicky.git
cd DanteClicky
npm install
npm run tauri:dev
```

`npm run tauri:dev` starts the app with SQLCipher enabled so local dev can read the same encrypted memory database used by installed builds. Use `npm run tauri:dev:plain` only for isolated plain-SQLite debugging with a separate test profile.

Enter your API keys in the Settings panel (gear icon in tray). No server to deploy.

---

## Architecture

```
DanteClicky (Tauri 2.0)
│
├── SENSORY    capture.rs   native screen capture, all monitors, JPEG 85%
│              audio.rs     cpal audio input, push-to-talk accumulator
│              stt.rs       AssemblyAI cloud OR candle Whisper local (language-aware)
│
├── ACTION     input.rs     enigo: click, double-click, right-click, type, scroll, move
│              cursor.rs    platform cursor bridge with smooth animation to [POINT] coords
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
| Local | whisper-tiny.en or whisper-tiny multilingual STT (offline download) |

---

## Tech stack

| Layer | Tech |
|-------|------|
| Shell | Tauri 2.0 |
| Backend | Rust 1.85 |
| Frontend | React 19.1 + TypeScript 5.8 + Vite 7 |
| State | Zustand 5 |
| AI SDK | Vercel AI SDK 6 |
| Audio | cpal 0.15 |
| Screen | screenshots 0.8 with platform capability reporting |
| Input | enigo 0.2 |
| STT | AssemblyAI U3 Pro WebSocket + candle-transformers Whisper |
| TTS | ElevenLabs Web Audio API |
| HTTP | reqwest 0.12, axum 0.7 |
| WS | tokio-tungstenite 0.24 |

---

## Competitive position

| | DanteClicky | Cluely | Pluely | screenpipe | UI-TARS |
|-|-------------|--------|--------|-----------|---------|
| Desktop reach | Windows proven; macOS/Linux CI configured | macOS/Windows | cross-platform | cross-platform | cross-platform |
| Voice pipeline | ✅ | ✅ | ⚠️ | ⚠️ | ❌ |
| Computer use | ✅ | ⚠️ | ❌ | ❌ | ✅ |
| Local-first | ✅ | **❌ (breach)** | ✅ | ✅ | ✅ |
| DanteAgents bridge | ✅ | ❌ | ❌ | ❌ | ❌ |
| MCP server | ✅ | ❌ | ❌ | ✅ | ❌ |
| Free/open source | ✅ | ❌ | ✅ | ✅ | ✅ |

---

## Development score

Current: **84.2/100** -> Target: **93/100**  
See `.danteforge/ASCEND_REPORT.md` for full dimension breakdown and sprint plan.

---

## Contributing

See `CONTRIBUTING.md`. Architecture map: overlay window → ws_server → input.rs → capture.rs.

Run tests:
```bash
cargo test
npm test
```

---

## License

DanteClicky is licensed under the **MIT License**. See [LICENSE](./LICENSE) for full details.

### Dependency Licenses

All dependencies are validated for MIT, Apache-2.0, BSD, ISC, or MPL-2.0 compatibility. See `deny.toml` for audit configuration.

**Key OSS dependencies:**
- **Tauri 2.0** — Apache-2.0 / MIT  
- **Rust ecosystem** — MIT / Apache-2.0 / 0BSD  
- **React 19** — MIT  
- **Vercel AI SDK** — Apache-2.0  
- **candle-transformers** (Hugging Face) — Apache-2.0 (local Whisper)

For commercial use, personal use, modification, and distribution: fully permitted under MIT.

---

## Questions?

- Issues: [GitHub Issues](https://github.com/dantericardo88/DanteClicky/issues)
- Discussions: [GitHub Discussions](https://github.com/dantericardo88/DanteClicky/discussions)
