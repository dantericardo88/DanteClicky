// Phase 8 — Computer-use input control
// Exposes Tauri commands for mouse + keyboard injection via the `enigo` crate.

use enigo::{
    Button, Coordinate,
    Direction::Click,
    Enigo, Keyboard, Mouse, Settings,
};

// ── helpers ───────────────────────────────────────────────────────────────────

fn make_enigo() -> Result<Enigo, String> {
    Enigo::new(&Settings::default()).map_err(|e| e.to_string())
}

fn move_to(enigo: &mut Enigo, x: i32, y: i32) -> Result<(), String> {
    enigo
        .move_mouse(x, y, Coordinate::Abs)
        .map_err(|e| e.to_string())
}

// ── commands ──────────────────────────────────────────────────────────────────

/// Left-click at absolute screen coordinates.
#[tauri::command]
pub fn computer_use_click(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = make_enigo()?;
    move_to(&mut enigo, x, y)?;
    enigo
        .button(Button::Left, Click)
        .map_err(|e| e.to_string())
}

/// Double-click at absolute screen coordinates.
#[tauri::command]
pub fn computer_use_double_click(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = make_enigo()?;
    move_to(&mut enigo, x, y)?;
    enigo
        .button(Button::Left, Click)
        .map_err(|e| e.to_string())?;
    enigo
        .button(Button::Left, Click)
        .map_err(|e| e.to_string())
}

/// Right-click at absolute screen coordinates.
#[tauri::command]
pub fn computer_use_right_click(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = make_enigo()?;
    move_to(&mut enigo, x, y)?;
    enigo
        .button(Button::Right, Click)
        .map_err(|e| e.to_string())
}

/// Type a string via keyboard injection.
#[tauri::command]
pub fn computer_use_type(text: String) -> Result<(), String> {
    let mut enigo = make_enigo()?;
    enigo.text(&text).map_err(|e| e.to_string())
}

/// Move the cursor to absolute screen coordinates without clicking or scrolling.
#[tauri::command]
pub fn computer_use_move(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = make_enigo()?;
    move_to(&mut enigo, x, y)
}

/// Scroll at absolute screen coordinates.
/// `delta` > 0 scrolls down; `delta` < 0 scrolls up.
#[tauri::command]
pub fn computer_use_scroll(x: i32, y: i32, delta: i32) -> Result<(), String> {
    let mut enigo = make_enigo()?;
    move_to(&mut enigo, x, y)?;
    enigo
        .scroll(delta, enigo::Axis::Vertical)
        .map_err(|e| e.to_string())
}

// ── MCP raw helpers (no Tauri State — callable from mcp_server.rs) ────────────

/// Left-click without Tauri state wrapper.
pub fn computer_use_click_raw(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = make_enigo()?;
    move_to(&mut enigo, x, y)?;
    enigo
        .button(Button::Left, Click)
        .map_err(|e| e.to_string())
}

/// Type text without Tauri state wrapper.
pub fn computer_use_type_raw(text: &str) -> Result<(), String> {
    let mut enigo = make_enigo()?;
    enigo.text(text).map_err(|e| e.to_string())
}

/// Scroll with separate horizontal/vertical deltas without Tauri state wrapper.
pub fn computer_use_scroll_raw(x: i32, y: i32, dx: i32, dy: i32) -> Result<(), String> {
    let mut enigo = make_enigo()?;
    move_to(&mut enigo, x, y)?;
    if dx != 0 {
        enigo
            .scroll(dx, enigo::Axis::Horizontal)
            .map_err(|e| e.to_string())?;
    }
    if dy != 0 {
        enigo
            .scroll(dy, enigo::Axis::Vertical)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
