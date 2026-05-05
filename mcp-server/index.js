#!/usr/bin/env node
// DanteClicky MCP Server — Phase 12
// Bridges Claude Desktop / Cursor / VS Code to DanteClicky's WebSocket tool bridge.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import WebSocket from "ws";

const WS_URL = "ws://127.0.0.1:9001";
const RECONNECT_DELAY_MS = 2000;
const CALL_TIMEOUT_MS = 10_000;

// ── WebSocket connection with auto-reconnect ──────────────────────────────────

let ws = null;
const pending = new Map(); // id -> { resolve, reject, timer }

function connect() {
  ws = new WebSocket(WS_URL);

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const entry = pending.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(msg.id);
    if (msg.ok) entry.resolve(msg.result);
    else entry.reject(new Error(msg.error ?? "unknown error"));
  });

  ws.on("close", () => {
    ws = null;
    // Reject all in-flight calls so callers don't hang forever.
    for (const [id, entry] of pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error("DanteClicky disconnected"));
      pending.delete(id);
    }
    setTimeout(connect, RECONNECT_DELAY_MS);
  });

  ws.on("error", () => {
    // "close" fires after "error"; suppress unhandled-error noise.
  });
}

connect();

// ── Send a tool call, return a promise that resolves with result ──────────────

function callTool(payload) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return reject(
        new Error("DanteClicky is not running. Start it from the system tray.")
      );
    }
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("DanteClicky tool call timed out"));
    }, CALL_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, ...payload }));
  });
}

// ── MCP server ────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "dante-clicky",
  version: "1.0.0",
});

// clicky_ping
server.tool("clicky_ping", "Health check — returns 'pong' if DanteClicky is running.", {}, async () => {
  const result = await callTool({ tool: "ping" });
  return { content: [{ type: "text", text: String(result) }] };
});

// clicky_screenshot
server.tool(
  "clicky_screenshot",
  "Capture the current screen(s) and return descriptions of what is visible.",
  {},
  async () => {
    const result = await callTool({ tool: "capture_screen" });
    const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
    return { content: [{ type: "text", text }] };
  }
);

// clicky_click
server.tool(
  "clicky_click",
  "Click the mouse at the specified screen coordinates.",
  { x: z.number().int().describe("X coordinate in pixels"), y: z.number().int().describe("Y coordinate in pixels") },
  async ({ x, y }) => {
    const result = await callTool({ tool: "click", x, y });
    return { content: [{ type: "text", text: String(result) }] };
  }
);

// clicky_type
server.tool(
  "clicky_type",
  "Type the given text using the keyboard at the current cursor position.",
  { text: z.string().describe("Text to type") },
  async ({ text }) => {
    const result = await callTool({ tool: "type_text", text });
    return { content: [{ type: "text", text: String(result) }] };
  }
);

// clicky_move_cursor
server.tool(
  "clicky_move_cursor",
  "Move the mouse cursor to the specified screen coordinates without clicking.",
  { x: z.number().int().describe("X coordinate in pixels"), y: z.number().int().describe("Y coordinate in pixels") },
  async ({ x, y }) => {
    const result = await callTool({ tool: "set_cursor", x, y });
    return { content: [{ type: "text", text: String(result) }] };
  }
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
