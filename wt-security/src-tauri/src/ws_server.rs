// Phase 9 — DanteAgents WebSocket bridge
// Listens on ws://127.0.0.1:9001 (falls back to 9002..9010 if busy).
// DanteAgents sends JSON tool-call messages; this module dispatches them
// to the existing capture / input subsystems and returns JSON results.

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::net::SocketAddr;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::{accept_async, tungstenite::Message};

use crate::{capture, input};

// ── Public entry point ────────────────────────────────────────────────────────

/// Start the WebSocket bridge on a background Tokio task.
/// Called from lib.rs `.setup()` via `tauri::async_runtime::spawn`.
pub async fn start(_app: tauri::AppHandle) {
    let listener = bind_with_fallback(9001, 9010).await;
    match listener {
        Some((listener, addr)) => {
            println!("[ws_server] DanteAgents bridge listening on ws://{addr}");
            run(listener).await;
        }
        None => {
            eprintln!("[ws_server] Could not bind on ports 9001-9010; bridge disabled.");
        }
    }
}

// ── TCP bind with port fallback ───────────────────────────────────────────────

async fn bind_with_fallback(
    first: u16,
    last: u16,
) -> Option<(TcpListener, SocketAddr)> {
    for port in first..=last {
        let addr: SocketAddr = format!("127.0.0.1:{port}").parse().unwrap();
        match TcpListener::bind(addr).await {
            Ok(listener) => {
                let bound = listener.local_addr().unwrap_or(addr);
                return Some((listener, bound));
            }
            Err(e) => {
                eprintln!("[ws_server] Port {port} unavailable: {e}; trying next…");
            }
        }
    }
    None
}

// ── Accept loop ───────────────────────────────────────────────────────────────

async fn run(listener: TcpListener) {
    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                println!("[ws_server] Connection from {peer}");
                tokio::spawn(handle_connection(stream));
            }
            Err(e) => {
                eprintln!("[ws_server] Accept error: {e}");
            }
        }
    }
}

// ── Per-connection handler ────────────────────────────────────────────────────

async fn handle_connection(stream: TcpStream) {
    let ws = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[ws_server] WebSocket handshake failed: {e}");
            return;
        }
    };

    let (mut tx, mut rx) = ws.split();

    while let Some(msg) = rx.next().await {
        let msg = match msg {
            Ok(m) => m,
            Err(e) => {
                eprintln!("[ws_server] Receive error: {e}");
                break;
            }
        };

        // Only process text frames; skip ping/pong/binary/close.
        let text = match msg {
            Message::Text(t) => t,
            Message::Close(_) => break,
            _ => continue,
        };

        let response = dispatch(&text);
        if let Ok(reply) = serde_json::to_string(&response) {
            if tx.send(Message::Text(reply.into())).await.is_err() {
                break;
            }
        }
    }
}

// ── Tool dispatcher ───────────────────────────────────────────────────────────

fn dispatch(raw: &str) -> Value {
    // Parse the incoming JSON.
    let msg: Value = match serde_json::from_str(raw) {
        Ok(v) => v,
        Err(e) => {
            return json!({ "id": null, "ok": false, "error": format!("invalid JSON: {e}") });
        }
    };

    let id = msg.get("id").cloned().unwrap_or(Value::Null);
    let tool = msg
        .get("tool")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    match tool {
        // ── ping ──────────────────────────────────────────────────────────────
        "ping" => json!({ "id": id, "ok": true, "result": "pong" }),

        // ── capture_screen ────────────────────────────────────────────────────
        "capture_screen" => match capture::capture_all() {
            Ok(screens) => json!({ "id": id, "ok": true, "result": screens }),
            Err(e) => json!({ "id": id, "ok": false, "error": e }),
        },

        // ── click ─────────────────────────────────────────────────────────────
        "click" => {
            let x = int_field(&msg, "x");
            let y = int_field(&msg, "y");
            match (x, y) {
                (Some(x), Some(y)) => match input::computer_use_click(x, y) {
                    Ok(_) => json!({ "id": id, "ok": true, "result": "clicked" }),
                    Err(e) => json!({ "id": id, "ok": false, "error": e }),
                },
                _ => json!({ "id": id, "ok": false, "error": "click requires x and y" }),
            }
        }

        // ── type_text ─────────────────────────────────────────────────────────
        "type_text" => {
            let text = msg
                .get("text")
                .and_then(|v| v.as_str())
                .map(|s| s.to_owned());
            match text {
                Some(t) => match input::computer_use_type(t) {
                    Ok(_) => json!({ "id": id, "ok": true, "result": "typed" }),
                    Err(e) => json!({ "id": id, "ok": false, "error": e }),
                },
                None => json!({ "id": id, "ok": false, "error": "type_text requires text" }),
            }
        }

        // ── set_cursor ────────────────────────────────────────────────────────
        "set_cursor" => {
            let x = int_field(&msg, "x");
            let y = int_field(&msg, "y");
            match (x, y) {
                (Some(x), Some(y)) => {
                    match input::computer_use_move(x, y) {
                        Ok(_) => json!({ "id": id, "ok": true, "result": "cursor moved" }),
                        Err(e) => json!({ "id": id, "ok": false, "error": e }),
                    }
                }
                _ => json!({ "id": id, "ok": false, "error": "set_cursor requires x and y" }),
            }
        }

        // ── unknown ───────────────────────────────────────────────────────────
        other => json!({
            "id": id,
            "ok": false,
            "error": format!("unknown tool: {other}")
        }),
    }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/// Extract a JSON field as i32, accepting both integer and float JSON numbers.
fn int_field(msg: &Value, field: &str) -> Option<i32> {
    msg.get(field).and_then(|v| {
        if let Some(n) = v.as_i64() {
            Some(n as i32)
        } else if let Some(f) = v.as_f64() {
            Some(f as i32)
        } else {
            None
        }
    })
}
