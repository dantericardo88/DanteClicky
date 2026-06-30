# DanteClicky Windows — Masterplan
> Converting DanteClicky (macOS Swift menu bar AI companion) to Windows-native  
> With model-agnostic AI support: Claude, OpenAI GPT, xAI Grok  
> Generated: 2026-05-05 | Mode: INFERNO + PARTY + ASCEND

---

## 1. Executive Summary

DanteClicky is a macOS-only AI desktop companion built in Swift/SwiftUI that lives in the system
tray, captures screenshots, listens via push-to-talk, and streams AI responses as a transparent
overlay. The goal is a full Windows-native port using **Tauri 2.0 (Rust + React/TypeScript)** with
a **model-agnostic provider layer** supporting Claude (Anthropic), GPT-4o (OpenAI), and Grok (xAI).

**The Tauri decision is firm.** Research confirms Tauri 2.0 is the dominant Windows AI desktop
framework in 2026: 96% smaller than Electron, native WebView2, first-class system tray, global
hotkey plugin, and a growing plugin ecosystem (120+ plugins). The Pluely open-source project
(direct Cluely/DanteClicky competitor) uses exactly this stack.

---

## 2. Current macOS Architecture (Source of Truth)

```
leanring-buddy (Swift/SwiftUI macOS app)
├── Entry: leanring_buddyApp.swift         → NSApplication + AppDelegate
├── Core:  CompanionManager.swift          → Central state machine (1026 lines)
├── Tray:  MenuBarPanelManager.swift       → NSStatusItem + NSPanel
├── UI:    CompanionPanelView.swift        → Settings/model panel (761 lines)
├── UI:    OverlayWindow.swift             → Full-screen transparent overlay (881 lines)
├── Voice: BuddyDictationManager.swift    → AVAudioEngine push-to-talk pipeline
├── STT:   AssemblyAIStreamingTranscriptionProvider.swift → WebSocket real-time STT
├── AI:    ClaudeAPI.swift                 → Streaming SSE client (Claude)
├── AI:    OpenAIAPI.swift                 → Vision fallback (GPT)
├── TTS:   ElevenLabsTTSClient.swift       → TTS via Cloudflare Worker
├── Caps:  CompanionScreenCaptureUtility.swift → ScreenCaptureKit multi-monitor
├── Caps:  ElementLocationDetector.swift  → Computer Use API coord detection
└── Proxy: worker/src/index.ts            → Cloudflare Worker (secrets proxy)
```

**Key macOS-only dependencies that must be replaced:**

| Component | macOS API | Complexity |
|-----------|-----------|------------|
| System tray icon | NSStatusItem | Low |
| Floating panel | NSPanel + NSScreen | Medium |
| Screen capture | ScreenCaptureKit | High |
| Global hotkey | CGEvent tap | Medium |
| Audio input | AVAudioEngine | Medium |
| Auto-update | Sparkle | Low |
| Login item | SMAppService | Low |
| Window drawing | NSBezierPath | Low |
| Coordinate system | AppKit (bottom-left) | Medium |

---

## 3. Target Windows Architecture

### 3.1 Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| **App shell** | Tauri 2.0 | Rust backend, WebView2 frontend, native Windows |
| **Frontend UI** | React 19 + TypeScript + Tailwind CSS | Port SwiftUI views to React components |
| **Screen capture** | `windows-capture` Rust crate (WGC API) | Fastest Windows Graphics Capture, GPU-accelerated |
| **Global hotkeys** | `tauri-apps/global-hotkey` | Official Tauri plugin, Ctrl+Alt or user-configurable |
| **System tray** | Tauri 2.0 TrayIcon API | First-class support, menu + icon |
| **Audio input** | `cpal` Rust crate + WebAudio | Cross-platform audio capture |
| **AI abstraction** | Vercel AI SDK (`ai` npm) | Unified Claude + OpenAI + Grok provider API |
| **Streaming STT** | AssemblyAI WebSocket (unchanged) | Platform-agnostic |
| **TTS** | ElevenLabs via Worker (unchanged) | Platform-agnostic |
| **Secrets proxy** | Cloudflare Worker (extended) | Add Grok endpoint |
| **Auto-update** | `tauri-plugin-updater` | Drop-in Sparkle replacement |
| **Analytics** | PostHog JS SDK (unchanged) | Platform-agnostic |
| **Installer** | Tauri NSIS/MSI builder | Built-in |

### 3.2 High-Level Windows Architecture

```
DanteClicky Windows (Tauri 2.0)
├── Rust Backend (src-tauri/)
│   ├── main.rs                    ← App entry, tray setup, command registration
│   ├── tray.rs                    ← TrayIcon + context menu lifecycle
│   ├── hotkey.rs                  ← Global hotkey manager (Ctrl+Alt)
│   ├── capture.rs                 ← Screen capture (windows-capture WGC API)
│   ├── audio.rs                   ← Microphone capture (cpal)
│   ├── overlay.rs                 ← Transparent always-on-top window management
│   ├── monitors.rs                ← Multi-monitor detection + coordinate mapping
│   └── updater.rs                 ← Auto-update (tauri-plugin-updater)
│
├── React Frontend (src/)
│   ├── App.tsx                    ← Root + router
│   ├── windows/
│   │   ├── CompanionPanel.tsx     ← Port of CompanionPanelView.swift
│   │   └── OverlayPanel.tsx       ← Port of OverlayWindow.swift
│   ├── providers/
│   │   ├── AIProvider.ts          ← Model-agnostic provider interface
│   │   ├── ClaudeProvider.ts      ← Anthropic via Vercel AI SDK
│   │   ├── OpenAIProvider.ts      ← OpenAI via Vercel AI SDK
│   │   └── GrokProvider.ts        ← xAI Grok via Vercel AI SDK
│   ├── hooks/
│   │   ├── useVoice.ts            ← Push-to-talk state machine
│   │   ├── useScreenCapture.ts    ← Invoke Rust capture command
│   │   ├── useAssemblyAI.ts       ← WebSocket STT (port from Swift)
│   │   └── useElevenLabs.ts       ← TTS playback
│   ├── components/
│   │   ├── ResponseBubble.tsx     ← Port of CompanionResponseOverlay
│   │   ├── Waveform.tsx           ← Audio waveform visualization
│   │   ├── ModelPicker.tsx        ← Claude / GPT / Grok selector
│   │   └── DesignSystem.ts        ← Port of DesignSystem.swift tokens
│   └── state/
│       └── companionStore.ts      ← Zustand store (port of CompanionManager)
│
└── Cloudflare Worker (worker/)    ← Extended with Grok endpoint
    └── src/index.ts
        ├── POST /chat             ← Routes to Claude OR OpenAI OR Grok
        ├── POST /tts              ← ElevenLabs (unchanged)
        └── GET  /transcribe-token ← AssemblyAI token (unchanged)
```

---

## 4. Platform Translation Map (Mac → Windows)

### 4.1 System APIs

| macOS (Swift) | Windows (Rust/Tauri) | Notes |
|---------------|---------------------|-------|
| `NSStatusItem` | `tauri::tray::TrayIconBuilder` | `set_icon()`, `set_menu()` |
| `NSPanel` (floating) | `tauri::WebviewWindowBuilder` | `transparent(true)`, `always_on_top(true)`, `decorations(false)` |
| `ScreenCaptureKit` | `windows-capture` crate | `WindowsCaptureSettings`, frame callbacks |
| `CGEvent` tap | `tauri-apps/global-hotkey` | `GlobalHotKeyManager::new()`, `HotKey` struct |
| `AVAudioEngine` | `cpal::Stream` | `build_input_stream()` |
| `NSScreen.screens` | `winapi::um::winuser::EnumDisplayMonitors` | or `windows` crate |
| `AVAudioPlayer` | `rodio` Rust crate | or WebAudio API in frontend |
| `SMAppService` | Windows registry `HKCU\...\Run` | `tauri-plugin-autostart` handles this |
| `Sparkle` | `tauri-plugin-updater` | Same appcast.xml feed approach |
| `PostHog Swift SDK` | PostHog JS SDK (npm) | Already web-compatible |
| `NSBezierPath` | SVG / Canvas in React | Pure frontend, no change needed |
| AppKit coords (bottom-left) | Win32 coords (top-left) | Flip Y when mapping monitor coords |

### 4.2 Voice Pipeline Translation

```
macOS (Swift)                           Windows (Rust + TypeScript)
─────────────────────────────────────   ──────────────────────────────────────
Ctrl+Option keydown                  →  global-hotkey HotKeyEvent::Pressed
  ↓                                        ↓
AVAudioEngine.start()               →  cpal build_input_stream() → emit to frontend
  ↓                                        ↓
AssemblyAI WebSocket (same)         →  AssemblyAI WebSocket (same)
  ↓                                        ↓
Ctrl+Option keyup                   →  global-hotkey HotKeyEvent::Released
  ↓                                        ↓
ScreenCaptureKit screenshots        →  windows-capture frame grab (all monitors)
  ↓                                        ↓
Claude/OpenAI API via Worker        →  Vercel AI SDK → Worker → Claude/GPT/Grok
  ↓                                        ↓
SSE streaming response              →  streamText() from Vercel AI SDK
  ↓                                        ↓
OverlayWindow text + waveform       →  OverlayPanel React component
  ↓                                        ↓
ElevenLabs TTS via Worker           →  ElevenLabs TTS via Worker (same)
```

### 4.3 Coordinate System Mapping

```
macOS:                              Windows:
- Origin: bottom-left               - Origin: top-left
- NSScreen.frame vs CGDisplay       - MONITORINFO from EnumDisplayMonitors
- ScreenCaptureKit: top-left origin - WGC API: top-left origin (consistent)

Translation needed:
  windows_y = monitor_height - (macos_y + element_height)

Multi-monitor:
- macOS: primary display at bottom-left of arrangement
- Windows: primary display at (0,0), others offset
- Store monitor rects from EnumDisplayMonitors, match to capture frames
```

---

## 5. Model-Agnostic AI Provider Layer

### 5.1 Architecture (Vercel AI SDK)

The Vercel AI SDK (`ai` npm package) provides a **unified interface** for Claude, OpenAI, and Grok
with identical streaming behavior. This is the P0 decision — it replaces the custom `ClaudeAPI.swift`
and `OpenAIAPI.swift` with a single abstraction.

```typescript
// src/providers/AIProvider.ts

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createXai } from '@ai-sdk/xai';
import { streamText, LanguageModel } from 'ai';

export type ProviderType = 'claude' | 'openai' | 'grok';

export interface ModelOption {
  provider: ProviderType;
  modelId: string;
  displayName: string;
  supportsVision: boolean;
}

export const MODEL_OPTIONS: ModelOption[] = [
  // Claude models
  { provider: 'claude', modelId: 'claude-sonnet-4-6',   displayName: 'Claude Sonnet 4.6', supportsVision: true },
  { provider: 'claude', modelId: 'claude-opus-4-7',     displayName: 'Claude Opus 4.7',   supportsVision: true },
  { provider: 'claude', modelId: 'claude-haiku-4-5',    displayName: 'Claude Haiku 4.5',  supportsVision: true },
  // OpenAI models
  { provider: 'openai', modelId: 'gpt-4o',              displayName: 'GPT-4o',            supportsVision: true },
  { provider: 'openai', modelId: 'o3',                  displayName: 'OpenAI o3',         supportsVision: true },
  // Grok models
  { provider: 'grok',   modelId: 'grok-2-vision-1212',  displayName: 'Grok 2 Vision',     supportsVision: true },
  { provider: 'grok',   modelId: 'grok-3',              displayName: 'Grok 3',            supportsVision: false },
];

// All calls go through the Cloudflare Worker — never expose keys in frontend
export async function streamAIResponse({
  model,
  systemPrompt,
  messages,
  images,
  onChunk,
}: {
  model: ModelOption;
  systemPrompt: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
  images?: string[];  // base64 encoded
  onChunk: (text: string) => void;
}): Promise<string> {
  const response = await fetch('https://YOUR-WORKER.workers.dev/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, systemPrompt, messages, images }),
  });
  // Read SSE stream
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    onChunk(chunk);
    fullText += chunk;
  }
  return fullText;
}
```

### 5.2 Cloudflare Worker Extension (Add Grok + Model Router)

```typescript
// worker/src/index.ts — extended

type Provider = 'claude' | 'openai' | 'grok';

async function routeChat(req: Request, env: Env): Promise<Response> {
  const body = await req.json<ChatRequest>();
  const provider: Provider = body.model.provider;

  if (provider === 'claude') {
    return forwardToAnthropic(body, env);
  } else if (provider === 'openai') {
    return forwardToOpenAI(body, env);
  } else if (provider === 'grok') {
    return forwardToGrok(body, env);  // NEW
  }
}

// Grok uses OpenAI-compatible API format
async function forwardToGrok(body: ChatRequest, env: Env): Promise<Response> {
  return fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.GROK_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: body.model.modelId,
      messages: body.messages,
      stream: true,
    }),
  });
}
```

**New Worker secrets needed:**
- `GROK_API_KEY` — xAI API key (same pattern as existing secrets)

---

## 6. Implementation Phases

### Phase 0 — Project Bootstrap (2–3 days)
**Goal:** Running Tauri 2.0 skeleton with system tray and two windows.

```bash
npm create tauri-app@latest dante-clicky-windows -- --template react-ts
cd dante-clicky-windows
cargo add tauri-plugin-global-shortcut tauri-plugin-updater tauri-plugin-autostart
npm install ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/xai
npm install zustand react-query tailwindcss
```

Deliverables:
- [ ] Tauri 2.0 project init with React + TypeScript
- [ ] System tray icon visible (use existing SVG icon asset)
- [ ] `CompanionPanel` window opens from tray click
- [ ] `OverlayPanel` transparent always-on-top window
- [ ] Basic Zustand store (VoiceState enum)
- [ ] Cloudflare Worker updated with Grok endpoint

### Phase 1 — Core Infrastructure (3–5 days)
**Goal:** All platform primitives working independently.

Rust tasks:
- [ ] `hotkey.rs` — Register `Ctrl+Alt` global hotkey, emit `hotkey-down/up` events to frontend
- [ ] `tray.rs` — TrayIcon with menu: Open Panel, Model submenu, Quit
- [ ] `monitors.rs` — Enumerate monitors with MONITORINFO, emit to frontend as JSON
- [ ] `overlay.rs` — Create transparent frameless always-on-top window at cursor position

Frontend tasks:
- [ ] Window positioning logic (port of WindowPositionManager.swift)
- [ ] `useHotkey` hook — listen for Tauri hotkey events
- [ ] `useTray` hook — handle tray menu commands

### Phase 2 — Screen Capture (3–4 days)
**Goal:** Full multi-monitor screenshot on hotkey press.

Rust tasks:
```toml
# Cargo.toml
[dependencies]
windows-capture = "1"
base64 = "0.22"
```
- [ ] `capture.rs` — Capture all monitors with `windows-capture` WGC API
- [ ] Return Vec<(base64_string, monitor_label)> to frontend via Tauri command
- [ ] Coordinate mapping: map Win32 monitor rects to consistent label scheme
- [ ] Handle cursor-monitor identification (which monitor has focus)

Test milestone: press `Ctrl+Alt`, get back labeled base64 screenshots of all monitors.

### Phase 3 — Audio / Voice Pipeline (4–5 days)
**Goal:** Push-to-talk with real-time AssemblyAI transcription.

```toml
[dependencies]
cpal = "0.15"
rodio = "0.17"
```

Rust tasks:
- [ ] `audio.rs` — `cpal` input stream, emit PCM chunks as base64 to frontend via Tauri event
- [ ] Audio format: 16kHz mono 16-bit (AssemblyAI requirement)

Frontend tasks:
- [ ] `useAssemblyAI.ts` — Port WebSocket streaming STT from Swift (same protocol)
- [ ] `useElevenLabs.ts` — Port TTS client (same endpoint, Web Audio API playback)
- [ ] `useVoice.ts` — State machine: idle → listening → processing → responding
- [ ] Waveform visualization component

Test milestone: speak into mic, see AssemblyAI transcript in console.

### Phase 4 — AI Provider Integration (2–3 days)
**Goal:** Full vision + text AI pipeline with model picker.

Frontend tasks:
- [ ] `AIProvider.ts` — Unified provider interface
- [ ] `ClaudeProvider.ts`, `OpenAIProvider.ts`, `GrokProvider.ts`
- [ ] Worker integration — route to correct provider based on selected model
- [ ] Streaming SSE response parsing (port from `ClaudeAPI.swift`)
- [ ] `[POINT:x,y:label:screenN]` tag parser (port from Swift response parsing)
- [ ] Conversation history management

Test milestone: press `Ctrl+Alt`, speak a question, see streaming AI response in overlay.

### Phase 5 — UI Parity (4–5 days)
**Goal:** Full UI matching macOS DanteClicky.

- [ ] `CompanionPanel.tsx` — Port of `CompanionPanelView.swift`
  - Status display (idle/listening/processing/responding)
  - Model picker (Claude Sonnet/Opus/Haiku, GPT-4o/o3, Grok 2/3)
  - Permissions status (microphone, screen recording)
  - DM button
- [ ] `OverlayPanel.tsx` — Port of `OverlayWindow.swift`
  - Response text bubble with streaming reveal
  - Waveform animation
  - Blue cursor dot
  - Loading spinner
- [ ] `DesignSystem.ts` — Port all color tokens, corner radii from `DesignSystem.swift`
- [ ] Cursor/pointer animation for `[POINT:x,y:...]` tags

### Phase 6 — Computer Use / Element Pointing (3–4 days)
**Goal:** AI can point to UI elements on screen (the "cursor animation" feature).

- [ ] Port `ElementLocationDetector.swift` to TypeScript
- [ ] `[POINT:x,y:label:screenN]` → animate Windows cursor to absolute coordinates
- [ ] Use `winapi` in Rust for `SetCursorPos` via Tauri command
- [ ] Multi-monitor coordinate mapping: `screenN` label → monitor HMONITOR → offset
- [ ] Smooth animation (port the CSS transition approach)

### Phase 7 — Packaging & Distribution (3–4 days)
**Goal:** Signed Windows installer that auto-updates.

- [ ] Code signing certificate (EV cert or self-signed for testing)
- [ ] `tauri-plugin-updater` — configure update endpoint (port appcast.xml approach)
- [ ] `tauri-plugin-autostart` — Windows startup (HKCU registry Run key)
- [ ] NSIS installer config in `tauri.conf.json`
- [ ] Build pipeline: `npm run tauri build` → `.msi` + `.exe`
- [ ] Upload to GitHub Releases

---

## 7. OSS Reference Projects

Study these before/during implementation:

| Project | URL | What to Learn |
|---------|-----|---------------|
| `tauri-apps/tauri` | https://github.com/tauri-apps/tauri | System tray, transparent windows, IPC |
| `tauri-apps/global-hotkey` | https://github.com/tauri-apps/global-hotkey | Hotkey registration + event model |
| `NiiightmareXD/windows-capture` | https://github.com/NiiightmareXD/windows-capture | WGC API, frame callbacks, multi-monitor |
| Vercel AI SDK | https://github.com/vercel/ai | Unified Claude/OpenAI/Grok streaming API |
| Pluely (open-source Cluely alt) | search GitHub for "pluely" | Overlay AI assistant, near-identical architecture |
| Computer-Agent | https://www.blog.brightcoding.dev/2026/04/24/computer-agent-control-your-pc-with-natural-language-ai | Tauri + AI desktop control |
| `RustAudio/cpal` | https://github.com/RustAudio/cpal | Cross-platform audio input |
| `RustAudio/rodio` | https://github.com/RustAudio/rodio | Audio playback |

---

## 8. Risk Register

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Windows WGC API requires Windows 10 1803+ | Low | Document minimum OS; ~100% of Windows 10/11 market qualifies |
| `cpal` audio latency on Windows (WASAPI exclusive mode) | Medium | Use shared mode; test with ASIO fallback if needed |
| WebView2 not installed on user machine | Low | Tauri bundles WebView2 bootstrapper in installer |
| Coordinate system bugs (multi-monitor) | High | Write unit tests for coordinate transform math before UI work |
| Global hotkey conflicts (`Ctrl+Alt` common shortcut) | Medium | Make hotkey user-configurable in settings; default to `Ctrl+Alt+Space` |
| xAI Grok API rate limits differ from Claude/OpenAI | Low | Worker handles errors, UI shows provider-specific error messages |
| ElevenLabs TTS playback API (Web Audio vs native) | Low | Web Audio API via WebView2 works well; test buffering latency |
| Tauri transparent window click-through behavior | Medium | Use `set_ignore_cursor_events()` for overlay; toggle on AI response |
| Swift → TypeScript port complexity for state machine | Medium | Port `CompanionManager.swift` to Zustand store incrementally, state by state |

---

## 9. File Structure (Target)

```
dante-clicky-windows/
├── src-tauri/
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── tray.rs
│   │   ├── hotkey.rs
│   │   ├── capture.rs
│   │   ├── audio.rs
│   │   ├── overlay.rs
│   │   ├── monitors.rs
│   │   └── updater.rs
│   ├── icons/                  ← Port from Assets.xcassets
│   ├── Cargo.toml
│   └── tauri.conf.json
├── src/
│   ├── App.tsx
│   ├── main.tsx
│   ├── windows/
│   │   ├── CompanionPanel.tsx
│   │   └── OverlayPanel.tsx
│   ├── providers/
│   │   ├── AIProvider.ts
│   │   ├── ClaudeProvider.ts
│   │   ├── OpenAIProvider.ts
│   │   └── GrokProvider.ts
│   ├── hooks/
│   │   ├── useVoice.ts
│   │   ├── useHotkey.ts
│   │   ├── useScreenCapture.ts
│   │   ├── useAssemblyAI.ts
│   │   └── useElevenLabs.ts
│   ├── components/
│   │   ├── ModelPicker.tsx
│   │   ├── ResponseBubble.tsx
│   │   ├── Waveform.tsx
│   │   ├── CursorOverlay.tsx
│   │   └── PermissionsStatus.tsx
│   ├── state/
│   │   └── companionStore.ts
│   ├── lib/
│   │   ├── designSystem.ts
│   │   ├── pointParser.ts       ← [POINT:x,y:label:screenN] parser
│   │   └── coordinates.ts       ← Multi-monitor coordinate mapping
│   └── types/
│       └── index.ts
├── worker/
│   └── src/index.ts            ← Extended with Grok routing
├── MASTERPLAN.md               ← This document
└── package.json
```

---

## 10. Quick-Start Command Sequence

```bash
# 1. Bootstrap Tauri project
npm create tauri-app@latest dante-clicky-windows -- --template react-ts
cd dante-clicky-windows

# 2. Add Rust dependencies
cargo add windows-capture cpal rodio base64
cargo add tauri-plugin-global-shortcut tauri-plugin-updater tauri-plugin-autostart

# 3. Add frontend dependencies
npm install ai @ai-sdk/anthropic @ai-sdk/openai @ai-sdk/xai
npm install zustand
npm install -D tailwindcss @tailwindcss/vite

# 4. Dev mode (hot reload frontend + Rust rebuild)
npm run tauri dev

# 5. Production build
npm run tauri build
# → outputs: src-tauri/target/release/bundle/nsis/dante-clicky-windows_x.x.x_x64-setup.exe

# 6. Update Cloudflare Worker with Grok
cd worker
wrangler secret put GROK_API_KEY
wrangler deploy
```

---

## 11. Ascend Scoring (Dimensions to Optimize)

Based on the `/ascend` analysis, these are the quality dimensions to drive toward 9/10:

| Dimension | Current (Mac port) | Target | Achievable Autonomously |
|-----------|-------------------|--------|------------------------|
| Platform Fidelity | 0/10 (Swift only) | 9/10 | Yes — full Windows port |
| Model Agnosticism | 3/10 (Claude primary) | 9/10 | Yes — Vercel AI SDK |
| Voice Pipeline | 7/10 (AssemblyAI working) | 9/10 | Yes — port directly |
| Screen Capture | 0/10 (ScreenCaptureKit only) | 9/10 | Yes — windows-capture |
| UI/UX Parity | 0/10 (SwiftUI only) | 8/10 | Yes — React port |
| Developer Experience | 5/10 | 9/10 | Yes — TypeScript, hot reload |
| Packaging/Distribution | 2/10 | 8/10 | Yes — Tauri NSIS/MSI |
| Community Adoption | 2/10 | 4/10 | **CEILING** — needs users/stars |
| Enterprise Readiness | 3/10 | 6/10 | **CEILING** — needs prod validation |

---

## 12. Party Mode Agent Assignments

| Agent | Responsibility | Key Files |
|-------|---------------|-----------|
| **Architect (Rust)** | Rust backend: capture, audio, hotkeys, tray | `src-tauri/src/*.rs` |
| **Dev (Frontend)** | React: UI components, hooks, state | `src/` |
| **PM** | Worker extension, Grok integration, scope | `worker/src/index.ts` |
| **UX** | Design system port, overlay animations | `src/components/`, `src/lib/designSystem.ts` |
| **Scrum Master** | Phase gate verification, testing | Build pipeline, integration tests |

---

*Sources: Tauri 2.0 docs, windows-capture crate, Vercel AI SDK, Pluely OSS, Computer-Agent project*
