# DanteClicky MCP Server

Exposes DanteClicky's screen-capture, computer-use, and voice tools to any
MCP-compatible client: Claude Desktop, Cursor, VS Code Connect, and more.

## Prerequisites

- [Node.js](https://nodejs.org/) 18 or later
- DanteClicky running in the system tray (starts the WebSocket bridge on `ws://127.0.0.1:9001`)

## Setup

### 1. Install dependencies

```bash
cd mcp-server
npm install
```

### 2. Add to Claude Desktop

Edit `%APPDATA%\Claude\claude_desktop_config.json` (create it if it does not exist):

```json
{
  "mcpServers": {
    "dante-clicky": {
      "command": "node",
      "args": ["C:/Projects/DanteClicky/dante-clicky-windows/mcp-server/index.js"]
    }
  }
}
```

> Tip: Use forward slashes (`/`) in the path even on Windows.

### 3. Restart Claude Desktop

After saving the config, fully quit and reopen Claude Desktop. The
`dante-clicky` server will appear in the tools panel.

## Available Tools

| Tool | Description |
|------|-------------|
| `clicky_ping` | Health check — returns `"pong"` if DanteClicky is reachable |
| `clicky_screenshot` | Capture all screens; returns a description of what is visible |
| `clicky_click` | Click at `{ x, y }` screen coordinates |
| `clicky_type` | Type `{ text }` at the current cursor position |
| `clicky_move_cursor` | Move the cursor to `{ x, y }` without clicking |

## Troubleshooting

**"DanteClicky is not running. Start it from the system tray."**
The MCP server could not reach `ws://127.0.0.1:9001`. Launch DanteClicky
and wait a few seconds for the bridge to start.

**Tools don't appear in Claude Desktop**
- Confirm the path in `claude_desktop_config.json` is correct.
- Run `node index.js` manually from the `mcp-server/` directory to see startup errors.
- Make sure Node.js 18+ is on your `PATH`.

## Wire Protocol

The MCP server communicates with DanteClicky over a local WebSocket:

- **Request:** `{ "id": "<uuid>", "tool": "<name>", ...params }`
- **Response:** `{ "id": "<uuid>", "ok": true|false, "result": "...", "error": "..." }`

The server reconnects automatically with a 2-second delay if DanteClicky restarts.
