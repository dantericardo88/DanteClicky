// Phase P1-B — MCP (Model Context Protocol) server
// Exposes DanteClicky's computer-use tools to Claude Desktop, Cursor,
// and any MCP-compatible client via HTTP + SSE on port 9002.
//
// Claude Desktop config snippet:
//   "mcpServers": {
//     "danteclicky": { "url": "http://localhost:9002/sse" }
//   }

use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
    Json, Router,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tauri::AppHandle;
use tokio::sync::broadcast;
use uuid::Uuid;

// ── State ─────────────────────────────────────────────────────────────────────

type SessionMap = Arc<Mutex<HashMap<String, broadcast::Sender<String>>>>;

#[derive(Clone)]
struct McpState {
    app: AppHandle,
    sessions: SessionMap,
}

// ── Entry point ───────────────────────────────────────────────────────────────

pub async fn start(app: AppHandle) {
    let sessions: SessionMap = Arc::new(Mutex::new(HashMap::new()));
    let state = McpState {
        app,
        sessions: Arc::clone(&sessions),
    };

    let router = Router::new()
        .route("/sse", get(sse_handler))
        .route("/message", post(message_handler))
        .with_state(state);

    let listener = match tokio::net::TcpListener::bind("127.0.0.1:9002").await {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[mcp] Failed to bind port 9002: {e}");
            return;
        }
    };
    eprintln!("[mcp] MCP server listening on http://127.0.0.1:9002");
    if let Err(e) = axum::serve(listener, router).await {
        eprintln!("[mcp] Server error: {e}");
    }
}

// ── SSE handler ───────────────────────────────────────────────────────────────

async fn sse_handler(State(state): State<McpState>) -> impl IntoResponse {
    let session_id = Uuid::new_v4().to_string();
    let (tx, mut rx) = broadcast::channel::<String>(64);
    state
        .sessions
        .lock()
        .unwrap()
        .insert(session_id.clone(), tx);

    use axum::response::sse::Event;

    let stream = async_stream::stream! {
        yield Ok::<Event, std::convert::Infallible>(
            Event::default().event("endpoint").data(
                serde_json::json!({ "uri": format!("http://localhost:9002/message?sessionId={}", session_id) }).to_string()
            )
        );
        yield Ok::<Event, std::convert::Infallible>(
            Event::default().event("message").data(
                serde_json::to_string(&serde_json::json!({
                    "jsonrpc": "2.0",
                    "method": "tools/list",
                    "result": { "tools": mcp_tools() }
                })).unwrap_or_default()
            )
        );
        loop {
            match rx.recv().await {
                Ok(msg) => yield Ok(Event::default().event("message").data(msg)),
                Err(_) => break,
            }
        }
    };

    axum::response::sse::Sse::new(stream)
        .keep_alive(axum::response::sse::KeepAlive::default())
        .into_response()
}

// ── Message handler ───────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct SessionQuery {
    #[serde(rename = "sessionId")]
    session_id: String,
}

async fn message_handler(
    State(state): State<McpState>,
    Query(q): Query<SessionQuery>,
    Json(rpc): Json<Value>,
) -> impl IntoResponse {
    let id = rpc.get("id").cloned().unwrap_or(Value::Null);
    let method = rpc["method"].as_str().unwrap_or("");
    let params = rpc.get("params").cloned().unwrap_or(Value::Null);

    let result = match method {
        "tools/call" => handle_tool_call(&state.app, &params).await,
        "tools/list" => Ok(json!({ "tools": mcp_tools() })),
        "initialize" => Ok(json!({
            "protocolVersion": "2024-11-05",
            "capabilities": { "tools": {} },
            "serverInfo": { "name": "danteclicky", "version": "1.0.0" }
        })),
        _ => Err(format!("Unknown method: {method}")),
    };

    let response = match result {
        Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
        Err(e) => json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": -32603, "message": e }
        }),
    };

    // Push response to the SSE stream for this session
    if let Some(tx) = state.sessions.lock().unwrap().get(&q.session_id) {
        let _ = tx.send(serde_json::to_string(&response).unwrap_or_default());
    }

    (StatusCode::OK, Json(response))
}

// ── Tool dispatch ─────────────────────────────────────────────────────────────

async fn handle_tool_call(app: &AppHandle, params: &Value) -> Result<Value, String> {
    use crate::{capture, cursor, input, monitors};

    let tool_name = params["name"].as_str().ok_or("Missing tool name")?;
    let args = params.get("arguments").cloned().unwrap_or(Value::Null);

    match tool_name {
        // ── New clicky_* tools ────────────────────────────────────────────────

        "clicky_screenshot" => {
            let screens = capture::capture_all()?;
            let content: Vec<Value> = screens
                .into_iter()
                .map(|s| {
                    json!({
                        "type": "image",
                        "data": s["data"],
                        "mimeType": "image/jpeg",
                        "label": s["label"],
                        "width": s["width"],
                        "height": s["height"],
                        "x": s["x"],
                        "y": s["y"],
                        "is_primary": s["is_primary"]
                    })
                })
                .collect();
            Ok(json!(content))
        }

        "clicky_click" => {
            let x = args["x"].as_i64().ok_or("Missing x")? as i32;
            let y = args["y"].as_i64().ok_or("Missing y")? as i32;
            input::computer_use_click_raw(x, y)?;
            Ok(json!([{ "type": "text", "text": format!("Left-clicked at ({x}, {y})") }]))
        }

        "clicky_double_click" => {
            let x = args["x"].as_i64().ok_or("Missing x")? as i32;
            let y = args["y"].as_i64().ok_or("Missing y")? as i32;
            input::computer_use_double_click(x, y)?;
            Ok(json!([{ "type": "text", "text": format!("Double-clicked at ({x}, {y})") }]))
        }

        "clicky_right_click" => {
            let x = args["x"].as_i64().ok_or("Missing x")? as i32;
            let y = args["y"].as_i64().ok_or("Missing y")? as i32;
            input::computer_use_right_click(x, y)?;
            Ok(json!([{ "type": "text", "text": format!("Right-clicked at ({x}, {y})") }]))
        }

        "clicky_type" => {
            let text = args["text"].as_str().ok_or("Missing text")?;
            input::computer_use_type_raw(text)?;
            Ok(json!([{ "type": "text", "text": format!("Typed: {text}") }]))
        }

        "clicky_scroll" => {
            let x = args["x"].as_i64().ok_or("Missing x")? as i32;
            let y = args["y"].as_i64().ok_or("Missing y")? as i32;
            let dx = args["dx"].as_i64().unwrap_or(0) as i32;
            let dy = args["dy"].as_i64().unwrap_or(0) as i32;
            input::computer_use_scroll_raw(x, y, dx, dy)?;
            Ok(json!([{
                "type": "text",
                "text": format!("Scrolled at ({x},{y}) by dx={dx} dy={dy}")
            }]))
        }

        "clicky_move_cursor" => {
            let x = args["x"].as_i64().ok_or("Missing x")? as i32;
            let y = args["y"].as_i64().ok_or("Missing y")? as i32;
            tokio::task::spawn_blocking(move || cursor::animate_cursor_to_blocking(x, y))
                .await
                .map_err(|e| e.to_string())?;
            Ok(json!([{ "type": "text", "text": format!("Moved cursor to ({x}, {y})") }]))
        }

        "clicky_get_monitors" => {
            let mons = monitors::enumerate(app);
            let list: Vec<Value> = mons
                .iter()
                .map(|m| {
                    json!({
                        "id": m.id,
                        "label": m.label,
                        "x": m.x,
                        "y": m.y,
                        "width": m.width,
                        "height": m.height,
                        "scale_factor": m.scale_factor,
                        "is_primary": m.is_primary
                    })
                })
                .collect();
            Ok(json!([{ "type": "text", "text": serde_json::to_string(&list).unwrap_or_default() }]))
        }

        // ── Legacy tools (kept for backward compatibility) ────────────────────

        "capture_screen" => {
            let b64 = capture::capture_primary()?;
            Ok(json!([{ "type": "image", "data": b64, "mimeType": "image/jpeg" }]))
        }

        "click" => {
            let x = args["x"].as_i64().ok_or("Missing x")? as i32;
            let y = args["y"].as_i64().ok_or("Missing y")? as i32;
            input::computer_use_click_raw(x, y)?;
            Ok(json!([{ "type": "text", "text": format!("Clicked at ({x}, {y})") }]))
        }

        "type_text" => {
            let text = args["text"].as_str().ok_or("Missing text")?;
            input::computer_use_type_raw(text)?;
            Ok(json!([{ "type": "text", "text": format!("Typed: {text}") }]))
        }

        "scroll" => {
            let x = args["x"].as_i64().ok_or("Missing x")? as i32;
            let y = args["y"].as_i64().ok_or("Missing y")? as i32;
            let dx = args["delta_x"].as_i64().unwrap_or(0) as i32;
            let dy = args["delta_y"].as_i64().unwrap_or(0) as i32;
            input::computer_use_scroll_raw(x, y, dx, dy)?;
            Ok(json!([{
                "type": "text",
                "text": format!("Scrolled at ({x},{y}) by ({dx},{dy})")
            }]))
        }

        "move_cursor" => {
            let x = args["x"].as_i64().ok_or("Missing x")? as i32;
            let y = args["y"].as_i64().ok_or("Missing y")? as i32;
            tokio::task::spawn_blocking(move || cursor::animate_cursor_to_blocking(x, y))
                .await
                .map_err(|e| e.to_string())?;
            Ok(json!([{ "type": "text", "text": format!("Moved cursor to ({x}, {y})") }]))
        }

        "get_screen_size" => {
            use screenshots::Screen;
            let screens = Screen::all().map_err(|e| e.to_string())?;
            if let Some(primary) = screens.iter().find(|s| s.display_info.is_primary) {
                let w = primary.display_info.width;
                let h = primary.display_info.height;
                Ok(json!([{
                    "type": "text",
                    "text": format!("{w}x{h}")
                }]))
            } else {
                Err("No primary screen found".into())
            }
        }

        _ => Err(format!("Unknown tool: {tool_name}")),
    }
}

// ── Tool manifest ─────────────────────────────────────────────────────────────

fn mcp_tools() -> Value {
    json!([
        // ── New clicky_* tools ────────────────────────────────────────────────
        {
            "name": "clicky_screenshot",
            "description": "Capture all monitors and return base64 JPEG images with monitor metadata",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        },
        {
            "name": "clicky_click",
            "description": "Left-click at absolute screen coordinates",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "x": { "type": "number", "description": "X coordinate in physical pixels" },
                    "y": { "type": "number", "description": "Y coordinate in physical pixels" }
                },
                "required": ["x", "y"]
            }
        },
        {
            "name": "clicky_double_click",
            "description": "Double left-click at absolute screen coordinates",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "x": { "type": "number", "description": "X coordinate in physical pixels" },
                    "y": { "type": "number", "description": "Y coordinate in physical pixels" }
                },
                "required": ["x", "y"]
            }
        },
        {
            "name": "clicky_right_click",
            "description": "Right-click at absolute screen coordinates",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "x": { "type": "number", "description": "X coordinate in physical pixels" },
                    "y": { "type": "number", "description": "Y coordinate in physical pixels" }
                },
                "required": ["x", "y"]
            }
        },
        {
            "name": "clicky_type",
            "description": "Type text via keyboard injection at the current cursor focus",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string", "description": "Text to type" }
                },
                "required": ["text"]
            }
        },
        {
            "name": "clicky_scroll",
            "description": "Scroll at absolute screen coordinates with horizontal and vertical deltas",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "x":  { "type": "number", "description": "X coordinate in physical pixels" },
                    "y":  { "type": "number", "description": "Y coordinate in physical pixels" },
                    "dx": { "type": "number", "description": "Horizontal scroll delta (positive = right)" },
                    "dy": { "type": "number", "description": "Vertical scroll delta (positive = down)" }
                },
                "required": ["x", "y"]
            }
        },
        {
            "name": "clicky_move_cursor",
            "description": "Smoothly animate the cursor to absolute screen coordinates",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "x": { "type": "number", "description": "X coordinate in physical pixels" },
                    "y": { "type": "number", "description": "Y coordinate in physical pixels" }
                },
                "required": ["x", "y"]
            }
        },
        {
            "name": "clicky_get_monitors",
            "description": "List all connected monitors with their positions, sizes, and scale factors",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        },
        // ── Legacy tools (kept for backward compatibility) ────────────────────
        {
            "name": "capture_screen",
            "description": "Capture the primary monitor as a JPEG screenshot",
            "inputSchema": { "type": "object", "properties": {}, "required": [] }
        },
        {
            "name": "click",
            "description": "Click at screen coordinates (x, y)",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "x": { "type": "integer", "description": "X coordinate in screen pixels" },
                    "y": { "type": "integer", "description": "Y coordinate in screen pixels" }
                },
                "required": ["x", "y"]
            }
        },
        {
            "name": "type_text",
            "description": "Type text on the keyboard",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string", "description": "Text to type" }
                },
                "required": ["text"]
            }
        },
        {
            "name": "scroll",
            "description": "Scroll at coordinates by delta amounts",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "x": { "type": "integer", "description": "X coordinate" },
                    "y": { "type": "integer", "description": "Y coordinate" },
                    "delta_x": { "type": "integer", "description": "Horizontal scroll delta" },
                    "delta_y": { "type": "integer", "description": "Vertical scroll delta" }
                },
                "required": ["x", "y"]
            }
        },
        {
            "name": "move_cursor",
            "description": "Move cursor to screen coordinates with smooth animation",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "x": { "type": "integer", "description": "X coordinate in screen pixels" },
                    "y": { "type": "integer", "description": "Y coordinate in screen pixels" }
                },
                "required": ["x", "y"]
            }
        },
        {
            "name": "get_screen_size",
            "description": "Get primary monitor dimensions as WIDTHxHEIGHT",
            "inputSchema": { "type": "object", "properties": {}, "required": [] }
        }
    ])
}
