// E2E proof script for Dimension 38 (Collaboration / Ambient UX).
//
// Run while DanteClicky is running:  node scripts/test-ambient-bridge.mjs
//
// Demonstrates an external client connecting to the DanteAgents WebSocket
// bridge (ws://127.0.0.1:9001) and successfully retrieving ambient context
// captured by DanteClicky. This is the "shared work" loop in action.

import WebSocket from "ws";

const ENDPOINT = process.env.DANTECLICKY_WS || "ws://127.0.0.1:9001";

const ws = new WebSocket(ENDPOINT);

let timer = setTimeout(() => {
  console.error(`[e2e] timed out waiting for ${ENDPOINT}`);
  process.exit(3);
}, 5000);

ws.on("open", () => {
  console.log(`[e2e] connected to ${ENDPOINT}`);
  console.log("[e2e] requesting ambient_context (last 60 minutes, max 1200 chars)...");
  ws.send(JSON.stringify({
    id: "e2e-1",
    tool: "ambient_context",
    minutes: 60,
    max_chars: 1200,
  }));
});

ws.on("message", (data) => {
  clearTimeout(timer);
  let msg;
  try {
    msg = JSON.parse(data.toString());
  } catch (e) {
    console.error("[e2e] non-JSON response:", data.toString());
    process.exit(2);
    return;
  }

  console.log("[e2e] response:", { id: msg.id, ok: msg.ok, error: msg.error });

  if (msg.ok && typeof msg.result === "string") {
    const preview = msg.result.slice(0, 400);
    console.log("[e2e] ambient context preview:");
    console.log(preview || "(empty — enable ambient mode and wait for a capture cycle)");
  }

  ws.close();
  process.exit(msg.ok ? 0 : 1);
});

ws.on("error", (e) => {
  clearTimeout(timer);
  console.error("[e2e] error:", e.message);
  console.error("[e2e] is DanteClicky running with ambient mode enabled?");
  process.exit(2);
});
