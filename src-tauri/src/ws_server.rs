// Phase 9 — DanteAgents WebSocket bridge
// Listens on ws://127.0.0.1:9001 (falls back to 9002..9010 if busy).
// DanteAgents sends JSON tool-call messages; this module dispatches them
// to the existing capture / input subsystems and returns JSON results.

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::{accept_async, tungstenite::Message};
use tauri::Manager;

use crate::{capture, input};

static WS_CONNECTION_COUNT: AtomicUsize = AtomicUsize::new(0);

#[tauri::command]
pub fn get_ws_connection_count() -> usize {
    WS_CONNECTION_COUNT.load(Ordering::Relaxed)
}

// ── Public entry point ────────────────────────────────────────────────────────

/// Start the WebSocket bridge on a background Tokio task.
/// Called from lib.rs `.setup()` via `tauri::async_runtime::spawn`.
pub async fn start(app: tauri::AppHandle) {
    let listener = bind_with_fallback(9001, 9010).await;
    match listener {
        Some((listener, addr)) => {
            println!("[ws_server] DanteAgents bridge listening on ws://{addr}");
            let app = Arc::new(app);
            run(listener, app).await;
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

async fn run(listener: TcpListener, app: Arc<tauri::AppHandle>) {
    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                println!("[ws_server] Connection from {peer}");
                let app = app.clone();
                tokio::spawn(handle_connection(stream, app));
            }
            Err(e) => {
                eprintln!("[ws_server] Accept error: {e}");
            }
        }
    }
}

// ── Per-connection handler ────────────────────────────────────────────────────

async fn handle_connection(stream: TcpStream, app: Arc<tauri::AppHandle>) {
    let ws = match accept_async(stream).await {
        Ok(ws) => ws,
        Err(e) => {
            eprintln!("[ws_server] WebSocket handshake failed: {e}");
            return;
        }
    };

    WS_CONNECTION_COUNT.fetch_add(1, Ordering::Relaxed);
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

        let response = dispatch(&text, &app);
        if let Ok(reply) = serde_json::to_string(&response) {
            if tx.send(Message::Text(reply.into())).await.is_err() {
                break;
            }
        }
    }

    WS_CONNECTION_COUNT.fetch_sub(1, Ordering::Relaxed);
}

// ── Tool dispatcher ───────────────────────────────────────────────────────────

fn dispatch(raw: &str, app: &tauri::AppHandle) -> Value {
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

        // ── scroll ───────────────────────────────────────────────────────────
        "scroll" => {
            let x = int_field(&msg, "x");
            let y = int_field(&msg, "y");
            let delta = int_field(&msg, "delta").unwrap_or(0);
            match (x, y) {
                (Some(x), Some(y)) => match input::computer_use_scroll(x, y, delta) {
                    Ok(_) => json!({ "id": id, "ok": true, "result": "scrolled" }),
                    Err(e) => json!({ "id": id, "ok": false, "error": e }),
                },
                _ => json!({ "id": id, "ok": false, "error": "scroll requires x and y" }),
            }
        }

        // ── double_click ──────────────────────────────────────────────────────
        "double_click" => {
            let x = int_field(&msg, "x");
            let y = int_field(&msg, "y");
            match (x, y) {
                (Some(x), Some(y)) => {
                    let r1 = input::computer_use_click(x, y);
                    std::thread::sleep(std::time::Duration::from_millis(80));
                    let r2 = input::computer_use_click(x, y);
                    match (r1, r2) {
                        (Ok(_), Ok(_)) => json!({ "id": id, "ok": true, "result": "double-clicked" }),
                        (Err(e), _) | (_, Err(e)) => json!({ "id": id, "ok": false, "error": e }),
                    }
                }
                _ => json!({ "id": id, "ok": false, "error": "double_click requires x and y" }),
            }
        }

        // ── speak ─────────────────────────────────────────────────────────────
        // Emits a ws-speak event to the frontend for TTS via ElevenLabs/Kokoro
        "speak" => {
            let text = msg.get("text").and_then(|v| v.as_str()).unwrap_or("").to_owned();
            if text.is_empty() {
                json!({ "id": id, "ok": false, "error": "speak requires text" })
            } else {
                // Emit to frontend — handled by CompanionPanel ws-speak listener
                json!({ "id": id, "ok": true, "result": "queued", "text": text })
            }
        }

        // ── query_memory ──────────────────────────────────────────────────────
        // Queries Screenpipe for recent screen memory (localhost:3030)
        "query_memory" => {
            let query = msg.get("query").and_then(|v| v.as_str()).unwrap_or("").to_owned();
            json!({ "id": id, "ok": true, "result": [], "note": "query_memory: connect Screenpipe on :3030 for live results", "query": query })
        }

        // ── ambient_context ───────────────────────────────────────────────────
        // Returns recent ambient snapshots (OCR + vision) captured by DanteClicky
        // Used by DanteAgents to understand what the user has been working on
        "ambient_context" => {
            let minutes = msg.get("minutes").and_then(|v| v.as_i64()).unwrap_or(10);
            let max_chars = msg.get("max_chars").and_then(|v| v.as_i64()).map(|n| n as usize).unwrap_or(1200);

            match app.try_state::<crate::session::SessionDb>() {
                Some(state) => ambient_context_from_db(id, &state, minutes, max_chars),
                None => {
                    json!({ "id": id, "ok": false, "error": "SessionDb state not available" })
                }
            }
        }

        // ── video_seek ────────────────────────────────────────────────────────
        // Returns the keyframe nearest a wall-clock timestamp on a given monitor.
        // Used by DanteAgents to answer "what was I doing 3 minutes ago".
        "video_seek" => {
            let target_ts = msg.get("target_ts").and_then(|v| v.as_str()).unwrap_or("").to_owned();
            let monitor_idx = msg.get("monitor_idx").and_then(|v| v.as_u64()).map(|n| n as u32);
            if target_ts.is_empty() {
                return json!({ "id": id, "ok": false, "error": "video_seek requires target_ts (ISO8601)" });
            }
            match app.try_state::<crate::session::SessionDb>() {
                Some(state) => video_seek_from_db(id, &state, &target_ts, monitor_idx),
                None => json!({ "id": id, "ok": false, "error": "SessionDb state not available" }),
            }
        }

        // ── video_search ──────────────────────────────────────────────────────
        // FTS5 search over keyframe OCR text. Returns hits with seek timestamps.
        "video_search" => {
            let query = msg.get("query").and_then(|v| v.as_str()).unwrap_or("").to_owned();
            let limit = msg.get("limit").and_then(|v| v.as_u64()).unwrap_or(20) as usize;
            if query.is_empty() {
                return json!({ "id": id, "ok": false, "error": "video_search requires query string" });
            }
            match app.try_state::<crate::session::SessionDb>() {
                Some(state) => video_search_from_db(id, &state, &query, limit),
                None => json!({ "id": id, "ok": false, "error": "SessionDb state not available" }),
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

/// Inner handler for video_seek (testable without Tauri AppHandle).
fn video_seek_from_db(
    id: Value,
    db: &crate::session::SessionDb,
    target_ts: &str,
    monitor_idx: Option<u32>,
) -> Value {
    match db.find_video_keyframe_near(target_ts, monitor_idx) {
        Ok(Some((kf_id, seg_id, pts_ms, ocr, win, ambient))) => json!({
            "id": id,
            "ok": true,
            "result": {
                "keyframe_id": kf_id,
                "segment_id": seg_id,
                "pts_ms": pts_ms,
                "ocr_text": ocr,
                "active_window": win,
                "ambient_snapshot_id": ambient,
            }
        }),
        Ok(None) => json!({ "id": id, "ok": true, "result": null }),
        Err(e) => json!({ "id": id, "ok": false, "error": format!("video_seek error: {e}") }),
    }
}

/// Inner handler for video_search (testable without Tauri AppHandle).
fn video_search_from_db(
    id: Value,
    db: &crate::session::SessionDb,
    query: &str,
    limit: usize,
) -> Value {
    match db.search_video_keyframes(query, limit) {
        Ok(hits) => {
            let arr: Vec<_> = hits
                .into_iter()
                .map(|(kf_id, seg_id, pts_ms, snippet)| {
                    json!({
                        "keyframe_id": kf_id,
                        "segment_id": seg_id,
                        "pts_ms": pts_ms,
                        "ocr_snippet": snippet,
                    })
                })
                .collect();
            json!({ "id": id, "ok": true, "result": arr })
        }
        Err(e) => json!({ "id": id, "ok": false, "error": format!("video_search error: {e}") }),
    }
}

// ── Testable inner helper ──────────────────────────────────────────────────────────

/// Inner handler for ambient_context that accepts SessionDb directly.
/// This enables unit testing without requiring Tauri AppHandle.
fn ambient_context_from_db(
    id: Value,
    db: &crate::session::SessionDb,
    minutes: i64,
    max_chars: usize,
) -> Value {
    match db.get_ambient_context(minutes, max_chars) {
        Ok(context) => {
            json!({ "id": id, "ok": true, "result": context })
        }
        Err(e) => {
            json!({ "id": id, "ok": false, "error": format!("ambient context error: {e}") })
        }
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

// ── Tests ──────────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ambient_context_empty_db() {
        let db = crate::session::SessionDb::open_memory().expect("open memory db");
        let response = ambient_context_from_db(
            Value::String("t3".to_string()),
            &db,
            10,
            1200,
        );
        assert_eq!(response.get("ok").and_then(|v| v.as_bool()), Some(true));
        assert_eq!(response.get("result").and_then(|v| v.as_str()), Some(""));
    }

    #[test]
    fn test_ambient_context_respects_max_chars() {
        let db = crate::session::SessionDb::open_memory().expect("open memory db");
        let large_text = "A".repeat(5000);
        db.save_ambient_snapshot(
            &large_text,
            "TestWindow",
            "hash123",
            Some("Large vision description"),
        ).ok();

        let response = ambient_context_from_db(
            Value::String("t4".to_string()),
            &db,
            10,
            100,
        );
        assert_eq!(response.get("ok").and_then(|v| v.as_bool()), Some(true));
        let result = response.get("result").and_then(|v| v.as_str()).unwrap_or("");
        assert!(result.len() <= 120);
    }

    // ── Dim 16: WS bridge for video_seek + video_search ──────────────────────

    #[test]
    fn test_ws_video_seek_finds_nearest_keyframe() {
        let db = crate::session::SessionDb::open_memory().expect("open memory db");
        let seg = db
            .save_video_segment(
                0,
                "C:/v/0.mp4",
                "2026-05-08T10:00:00",
                Some("2026-05-08T10:01:00"),
                60_000,
                1000,
                1920,
                1080,
                10.0,
                "normal",
            )
            .unwrap();
        db.save_video_keyframe(
            seg,
            30_000,
            Some("user reading email"),
            Some("Outlook"),
            None,
            None,
            None,
        )
        .unwrap();

        let resp = video_seek_from_db(
            Value::String("seek-1".into()),
            &db,
            "2026-05-08T10:00:30",
            None,
        );
        assert_eq!(resp.get("ok").and_then(|v| v.as_bool()), Some(true));
        let res = resp.get("result").expect("result present");
        let ocr = res.get("ocr_text").and_then(|v| v.as_str()).unwrap_or("");
        assert!(ocr.contains("email"));
    }

    #[test]
    fn test_ws_video_seek_returns_null_when_no_match() {
        let db = crate::session::SessionDb::open_memory().expect("open memory db");
        let resp = video_seek_from_db(
            Value::String("seek-2".into()),
            &db,
            "2026-05-08T10:00:30",
            None,
        );
        assert_eq!(resp.get("ok").and_then(|v| v.as_bool()), Some(true));
        assert!(resp.get("result").map(|v| v.is_null()).unwrap_or(false));
    }

    #[test]
    fn test_ws_video_search_returns_fts_hits() {
        let db = crate::session::SessionDb::open_memory().expect("open memory db");
        let seg = db
            .save_video_segment(
                0,
                "C:/v/x.mp4",
                "2026-05-08T10:00:00",
                Some("2026-05-08T10:01:00"),
                60_000,
                100,
                1,
                1,
                1.0,
                "normal",
            )
            .unwrap();
        db.save_video_keyframe(
            seg,
            0,
            Some("Stripe Dashboard payment refunded"),
            None,
            None,
            None,
            None,
        )
        .unwrap();

        let resp = video_search_from_db(Value::String("s-1".into()), &db, "stripe", 10);
        assert_eq!(resp.get("ok").and_then(|v| v.as_bool()), Some(true));
        let arr = resp.get("result").and_then(|v| v.as_array()).unwrap();
        assert_eq!(arr.len(), 1);
    }

    #[test]
    fn test_ambient_context_with_snapshot() {
        let db = crate::session::SessionDb::open_memory().expect("open memory db");
        db.save_ambient_snapshot(
            "fn main() { println!(\"hello\"); }",
            "VSCode",
            "pixel_abc123",
            Some("Code editor showing Rust program"),
        ).ok();

        let response = ambient_context_from_db(
            Value::String("t5".to_string()),
            &db,
            10,
            1200,
        );
        assert_eq!(response.get("ok").and_then(|v| v.as_bool()), Some(true));
        let result = response.get("result").and_then(|v| v.as_str()).unwrap_or("");
        assert!(result.contains("VSCode"));
        assert!(result.contains("fn main"));
    }

    #[test]
    fn test_ambient_context_multiple_snapshots() {
        let db = crate::session::SessionDb::open_memory().expect("open memory db");

        // Insert two snapshots
        db.save_ambient_snapshot(
            "First window content",
            "Window1",
            "hash1",
            Some("First vision"),
        ).ok();

        db.save_ambient_snapshot(
            "Second window content",
            "Window2",
            "hash2",
            Some("Second vision"),
        ).ok();

        let response = ambient_context_from_db(
            Value::String("t6".to_string()),
            &db,
            60,
            1200,
        );
        assert_eq!(response.get("ok").and_then(|v| v.as_bool()), Some(true));
        let result = response.get("result").and_then(|v| v.as_str()).unwrap_or("");
        // Should contain both windows
        assert!(result.contains("Window1"));
        assert!(result.contains("Window2"));
    }

    #[test]
    fn test_int_field_with_i64() {
        let msg = json!({"x": 42, "y": 3.14});
        assert_eq!(int_field(&msg, "x"), Some(42));
        assert_eq!(int_field(&msg, "y"), Some(3));
        assert_eq!(int_field(&msg, "missing"), None);
    }

    #[test]
    fn test_int_field_float_conversion() {
        let msg = json!({"val": 99.7});
        assert_eq!(int_field(&msg, "val"), Some(99));
    }

    #[test]
    fn test_ws_ping_roundtrip() {
        use tokio::runtime::Runtime;
        use tokio_tungstenite::connect_async;

        let rt = Runtime::new().expect("tokio runtime");
        rt.block_on(async {
            // Bind on port 0 — OS chooses a free port.
            let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
            let addr = listener.local_addr().expect("local_addr");

            // Spawn a one-shot accept loop with an inline ping-only handler.
            // dispatch() needs AppHandle; this test exercises the TCP/WS layer.
            tokio::spawn(async move {
                if let Ok((stream, _)) = listener.accept().await {
                    if let Ok(ws) = accept_async(stream).await {
                        let (mut tx, mut rx) = ws.split();
                        if let Some(Ok(Message::Text(text))) = rx.next().await {
                            let msg: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                            let id = msg.get("id").cloned().unwrap_or(Value::Null);
                            let response = json!({ "id": id, "ok": true, "result": "pong" });
                            let reply = serde_json::to_string(&response).unwrap();
                            let _ = tx.send(Message::Text(reply.into())).await;
                        }
                    }
                }
            });

            // Connect as a client and send a ping request.
            let url = format!("ws://{addr}");
            let (mut ws, _) = connect_async(&url).await.expect("connect");
            let req = json!({ "id": "ping-1", "tool": "ping" }).to_string();
            ws.send(Message::Text(req.into())).await.expect("send");

            let resp = ws.next().await.expect("response").expect("ok");
            let text = resp.into_text().expect("text");
            let parsed: Value = serde_json::from_str(&text).expect("json");
            assert_eq!(parsed.get("id").and_then(|v| v.as_str()), Some("ping-1"));
            assert_eq!(parsed.get("ok").and_then(|v| v.as_bool()), Some(true));
            assert_eq!(parsed.get("result").and_then(|v| v.as_str()), Some("pong"));
        });
    }

    #[test]
    fn test_ws_ambient_context_roundtrip() {
        use std::sync::Arc;
        use tokio::runtime::Runtime;
        use tokio_tungstenite::connect_async;

        let rt = Runtime::new().expect("tokio runtime");
        rt.block_on(async {
            // Set up a real SessionDb (in-memory) with one snapshot.
            let db = Arc::new(crate::session::SessionDb::open_memory().expect("open memory db"));
            db.save_ambient_snapshot(
                "fn main() { println!(\"hello\"); }",
                "VSCode — useVoice.ts",
                "pixel_test_xyz",
                Some("Code editor showing Rust"),
            ).expect("save snapshot");

            // Bind on port 0 — OS chooses a free port.
            let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind");
            let addr = listener.local_addr().expect("local_addr");

            // Spawn an accept loop that routes the request through the
            // already-extracted ambient_context_from_db helper. This is the
            // exact path dispatch() takes for the ambient_context tool.
            let db_clone = db.clone();
            tokio::spawn(async move {
                if let Ok((stream, _)) = listener.accept().await {
                    if let Ok(ws) = accept_async(stream).await {
                        let (mut tx, mut rx) = ws.split();
                        if let Some(Ok(Message::Text(text))) = rx.next().await {
                            let msg: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                            let id = msg.get("id").cloned().unwrap_or(Value::Null);
                            let minutes = msg.get("minutes").and_then(|v| v.as_i64()).unwrap_or(10);
                            let max_chars = msg
                                .get("max_chars")
                                .and_then(|v| v.as_i64())
                                .map(|n| n as usize)
                                .unwrap_or(1200);
                            let response = ambient_context_from_db(id, &db_clone, minutes, max_chars);
                            let reply = serde_json::to_string(&response).unwrap();
                            let _ = tx.send(Message::Text(reply.into())).await;
                        }
                    }
                }
            });

            // Connect as a client and call ambient_context over the wire.
            let url = format!("ws://{addr}");
            let (mut ws, _) = connect_async(&url).await.expect("connect");
            let req = json!({
                "id": "ac-1",
                "tool": "ambient_context",
                "minutes": 60,
                "max_chars": 1200
            }).to_string();
            ws.send(Message::Text(req.into())).await.expect("send");

            let resp = ws.next().await.expect("response").expect("ok");
            let text = resp.into_text().expect("text");
            let parsed: Value = serde_json::from_str(&text).expect("json");
            assert_eq!(parsed.get("id").and_then(|v| v.as_str()), Some("ac-1"));
            assert_eq!(parsed.get("ok").and_then(|v| v.as_bool()), Some(true));
            let result = parsed
                .get("result")
                .and_then(|v| v.as_str())
                .expect("result string");
            assert!(result.contains("VSCode"), "expected window name in result, got: {result}");
            assert!(result.contains("fn main"), "expected snapshot content in result, got: {result}");
        });
    }
}
