# DanteClicky Developer Guide

Time to first custom tool: **~10 minutes**.

## Quick Start

### Prerequisites

- Node.js 18+ and Rust 1.77+ (rustup)
- Windows 10/11
- DanteClicky app running (`npm run tauri dev` or installed)

### 1. Verify the REST API is up

```powershell
curl http://127.0.0.1:9002/health
# → {"ok":true,"sessions":0}
```

### 2. Install the TypeScript SDK

```bash
# From the repo root:
npm install ./dante-clicky-windows/packages/danteclicky-client

# Or via local path in your package.json:
# "@danteclicky/client": "file:../dante-clicky-windows/packages/danteclicky-client"
```

### 3. Build your first tool (< 5 minutes)

Create a file `my-tool-server.js`:

```javascript
import express from 'express';
import { DanteClickyClient } from '@danteclicky/client';

const app = express();
app.use(express.json());
const dc = new DanteClickyClient();

// 1. Register your tool with DanteClicky
await dc.registerPlugin({
  name: 'my_summarize',
  description: 'Summarize the current screen content',
  input_schema: { type: 'object', properties: {} },
  callback_url: 'http://localhost:9999/tool/my_summarize',
});
console.log('Tool registered!');

// 2. Handle tool calls from DanteClicky
app.post('/tool/my_summarize', async (req, res) => {
  const screenshot = await dc.screenshot();
  res.json({ result: `Screenshot captured: ${screenshot.width}x${screenshot.height}` });
});

app.listen(9999, () => console.log('Tool server on :9999'));
```

```bash
node my-tool-server.js
# Ask Claude (via DanteClicky): "Use my_summarize to describe the screen"
```

### 4. Shell integration (PowerShell)

```powershell
# Install helper functions
Invoke-RestMethod http://127.0.0.1:9002/v1/tools | ConvertTo-Json

# Or use the built-in shell module (after install_shell_hooks Tauri command):
. "$env:APPDATA\DanteClicky\shell\dante.psm1"
dc_status        # health check
dc_tools         # list tools
dc_screenshot    # capture + show metadata
dc_events -Limit 5  # recent events
```

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  DanteClicky Windows (Tauri 2.0)                │
│  ┌─────────────┐  ┌────────────┐  ┌──────────┐ │
│  │ Rust backend │  │ React/TS   │  │ WebView2 │ │
│  │ (src-tauri/) │  │ frontend   │  │ overlay  │ │
│  └──────┬──────┘  └────────────┘  └──────────┘ │
│         │                                       │
│  ┌──────▼──────────────────────────────────┐   │
│  │  Axum HTTP server on port 9002           │   │
│  │  MCP SSE  |  REST API  |  Webhooks      │   │
│  └──────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘
```

## REST API Reference

Base URL: `http://127.0.0.1:9002`
Full OpenAPI spec: `GET /openapi.json`

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/v1/tools` | GET | List all tools |
| `/v1/tool/:name` | POST | Call a tool |
| `/v1/screenshot` | GET | Capture screen |
| `/v1/active-window` | GET | Active window title |
| `/v1/tools/register` | POST | Register plugin tool |
| `/v1/tools/registered` | GET | List plugins |
| `/v1/events` | GET | Recent events (pull) |
| `/v1/events/stream` | GET | Live event SSE stream |
| `/v1/webhook` | POST | Inbound webhook trigger |
| `/openapi.json` | GET | OpenAPI 3.0 spec |

## Available Tauri Commands

Key commands callable from the frontend (`window.__TAURI__.invoke`):

| Command | Description |
|---------|-------------|
| `compress_context` | Trim messages to token budget |
| `scan_prompt_for_injection` | Security scan before AI call |
| `scan_and_redact_pii` | Redact PII patterns |
| `validate_url_security` | SSRF/HTTPS validation |
| `bus_publish` | Publish to event bus |
| `bus_recent` | Get recent bus events |
| `screenpipe_status` | Check screenpipe running |
| `screenpipe_search` | Search screenpipe index |
| `read_clipboard_for_ai` | Safe clipboard read with PII scan |
| `get_window_context` | Active window category |
| `get_recent_files` | Recently opened files |
| `send_os_notification` | Windows toast notification |
| `install_shell_hooks` | Install PowerShell/bash helpers |

## Plugin Tool Contract

When DanteClicky calls your plugin tool, it sends a POST to your `callback_url`:

```json
POST http://localhost:9999/tool/my_tool
{
  "name": "my_tool",
  "input": { /* your tool's input_schema values */ }
}
```

Your server must respond with:

```json
{ "result": "any string or JSON" }
```

Timeout: 10 seconds. No authentication by default (local-only).

## Webhook Security

To verify inbound webhooks, set `DANTE_WEBHOOK_SECRET` before launching:

```powershell
$env:DANTE_WEBHOOK_SECRET = "mysecret"
# Then sign your payloads:
# X-DC-Signature: sha256=<hmac-sha256-hex>
```

## Event Bus Topics

| Topic | When |
|-------|------|
| `hotkey.fired` | Global hotkey pressed |
| `wake-word-detected` | Wake word trigger |
| `webhook.inbound` | Inbound webhook received |
| `screenshot.captured` | Screen captured |

Subscribe via SSE: `GET /v1/events/stream`

## Running Tests

```bash
# Rust unit tests
cd dante-clicky-windows && cargo test

# Frontend tests
cd dante-clicky-windows && npm run test:ci

# Latency benchmarks
node scripts/benchmark-e2e-latency.mjs --iterations 5

# Cold-start benchmark
pwsh -File scripts/benchmark-cold-start.ps1 -Iterations 3
```
