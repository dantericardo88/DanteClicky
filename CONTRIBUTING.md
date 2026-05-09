# Contributing to DanteClicky

Thank you for contributing to DanteClicky - the AI-powered desktop companion.

---

## Prerequisites

| Tool | Minimum version |
|------|----------------|
| Rust | 1.85+ (install via [rustup](https://rustup.rs)) |
| Node.js | 20+ |
| npm | 10+ (bundled with Node 20) |
| OS | Windows 10/11, current macOS, or a supported Linux desktop session |

Additional Tauri dependencies vary by OS. See `docs/cross-platform-verify.md` for the current platform matrix and smoke gates.

---

## Dev setup

```powershell
# Clone and install
git clone https://github.com/danteforge/dante-clicky-windows.git
cd dante-clicky-windows
npm install

# Start dev server (hot-reload for frontend + Rust)
npm run tauri dev
```

The app window appears with the overlay companion panel.  Press `Ctrl+Alt+Space` to activate voice input.

---

## Architecture map

```
Overlay window (Tauri transparent window, always-on-top)
  └── CompanionPanel.tsx          React root — renders chat bubble, animations
        ├── useVoice.ts            Whisper local transcription hook
        └── companionStore.ts      Zustand store — model selection, history
              └── chat_proxy.rs   Tauri command — routes to AI providers
                    ├── Anthropic Claude (streamOpenAICompat)
                    ├── OpenAI GPT   (streamOpenAICompat)
                    └── Grok xAI     (streamOpenAICompat)

ws_server.rs  (port 9001)         WebSocket bridge to DanteAgents
mcp_server.rs                     MCP tool server exposed to AI providers
```

---

## How to add a new AI provider

1. Open `src-tauri/src/chat_proxy.rs`.
2. Add a new arm to `streamOpenAICompat` (or create a new streaming function if the provider does not support the OpenAI-compatible chat API).
3. Add the model identifier string to `companionStore.ts` in the `models` array so it appears in the UI dropdown.
4. Add the provider's API key name to `.env.example` and document it in this file.

---

## How to add a new MCP tool

1. Open `src-tauri/src/mcp_server.rs`.
2. Add the tool definition to the `tools` list (name, description, input schema).
3. Add a matching arm to the `handle_tool_call` match statement that implements the tool logic.
4. Restart the dev server — the MCP server will advertise the new tool automatically.

---

## How to add a new DanteAgents tool

1. Open `src-tauri/src/ws_server.rs`.
2. Add a new arm to the `dispatch` match statement with the tool name and handler logic.
3. The WebSocket bridge on port 9001 will route incoming messages to the new handler.

---

## Running tests

```powershell
# Rust unit tests
cargo test --manifest-path src-tauri/Cargo.toml

# Frontend unit tests
npm test

# TypeScript type-check (no emit)
npx tsc --noEmit
```

---

## PR template

When opening a pull request, please include:

**Title** — short imperative summary, e.g. `feat: add Gemini provider`

**What changed**
- Bullet list of the key changes

**Why**
- Brief motivation or linked issue

**Test steps**
1. Steps a reviewer can follow to verify the change works
2. Expected outcome at each step

**Checklist**
- [ ] `cargo test` passes
- [ ] `npm test` passes
- [ ] `npx tsc --noEmit` passes
- [ ] No `.rs` or `.tsx`/`.ts` source files modified outside the stated scope
- [ ] `RELEASE_CHECKLIST.md` updated if the change affects build/packaging

---

## Code style

- **Rust**: `cargo fmt` + `cargo clippy -- -D warnings` before committing.
- **TypeScript/React**: Prettier defaults (`npx prettier --write .`).
- Do not introduce new `unsafe` blocks without a comment explaining why.
