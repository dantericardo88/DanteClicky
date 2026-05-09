// Computer-use input control.
// Exposes Tauri commands for mouse and keyboard injection via the `enigo` crate.

use enigo::{Button, Coordinate, Direction, Enigo, Key, Keyboard, Mouse, Settings};

const MAX_ABSOLUTE_COORDINATE: i32 = 100_000;
const MAX_TEXT_INPUT_CHARS: usize = 5_000;
const MAX_SCROLL_DELTA: i32 = 30;

fn make_enigo() -> Result<Enigo, String> {
    Enigo::new(&Settings::default()).map_err(|e| e.to_string())
}

fn move_to(enigo: &mut Enigo, x: i32, y: i32) -> Result<(), String> {
    validate_coordinates(x, y)?;
    enigo
        .move_mouse(x, y, Coordinate::Abs)
        .map_err(|e| e.to_string())
}

fn validate_coordinates(x: i32, y: i32) -> Result<(), String> {
    if x.abs() > MAX_ABSOLUTE_COORDINATE || y.abs() > MAX_ABSOLUTE_COORDINATE {
        return Err(format!("Refusing out-of-bounds coordinates ({x}, {y})"));
    }
    Ok(())
}

fn validate_text(text: &str) -> Result<(), String> {
    if text.chars().count() > MAX_TEXT_INPUT_CHARS {
        return Err(format!(
            "Refusing to type more than {MAX_TEXT_INPUT_CHARS} characters"
        ));
    }
    Ok(())
}

fn clamp_scroll_delta(delta: i32) -> i32 {
    delta.clamp(-MAX_SCROLL_DELTA, MAX_SCROLL_DELTA)
}

#[tauri::command]
pub fn computer_use_click(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = make_enigo()?;
    move_to(&mut enigo, x, y)?;
    enigo
        .button(Button::Left, Direction::Click)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn computer_use_double_click(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = make_enigo()?;
    move_to(&mut enigo, x, y)?;
    click_button_repeated(&mut enigo, Button::Left, 2)
}

#[tauri::command]
pub fn computer_use_triple_click(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = make_enigo()?;
    move_to(&mut enigo, x, y)?;
    click_button_repeated(&mut enigo, Button::Left, 3)
}

#[tauri::command]
pub fn computer_use_right_click(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = make_enigo()?;
    move_to(&mut enigo, x, y)?;
    enigo
        .button(Button::Right, Direction::Click)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn computer_use_middle_click(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = make_enigo()?;
    move_to(&mut enigo, x, y)?;
    enigo
        .button(Button::Middle, Direction::Click)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn computer_use_type(text: String) -> Result<(), String> {
    validate_text(&text)?;
    let mut enigo = make_enigo()?;
    enigo.text(&text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn computer_use_move(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = make_enigo()?;
    move_to(&mut enigo, x, y)
}

#[tauri::command]
pub fn computer_use_scroll(x: i32, y: i32, delta: i32) -> Result<(), String> {
    let mut enigo = make_enigo()?;
    move_to(&mut enigo, x, y)?;
    enigo
        .scroll(clamp_scroll_delta(delta), enigo::Axis::Vertical)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn computer_use_drag(x1: i32, y1: i32, x2: i32, y2: i32) -> Result<(), String> {
    let mut enigo = make_enigo()?;
    move_to(&mut enigo, x1, y1)?;
    enigo
        .button(Button::Left, Direction::Press)
        .map_err(|e| e.to_string())?;
    move_to(&mut enigo, x2, y2)?;
    enigo
        .button(Button::Left, Direction::Release)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn computer_use_keypress(keys: Vec<String>) -> Result<(), String> {
    if keys.is_empty() || keys.len() > 4 {
        return Err("Keypress requires one to four allowed keys".to_string());
    }

    let parsed: Vec<Key> = keys
        .iter()
        .map(|key| parse_allowed_key(key))
        .collect::<Result<Vec<_>, _>>()?;
    let mut enigo = make_enigo()?;

    if parsed.len() == 1 {
        return enigo
            .key(parsed[0], Direction::Click)
            .map_err(|e| e.to_string());
    }

    let last = parsed[parsed.len() - 1];
    for key in &parsed[..parsed.len() - 1] {
        enigo
            .key(*key, Direction::Press)
            .map_err(|e| e.to_string())?;
    }
    let click_result = enigo.key(last, Direction::Click).map_err(|e| e.to_string());
    for key in parsed[..parsed.len() - 1].iter().rev() {
        enigo
            .key(*key, Direction::Release)
            .map_err(|e| e.to_string())?;
    }
    click_result
}

pub fn computer_use_click_raw(x: i32, y: i32) -> Result<(), String> {
    let mut enigo = make_enigo()?;
    move_to(&mut enigo, x, y)?;
    enigo
        .button(Button::Left, Direction::Click)
        .map_err(|e| e.to_string())
}

pub fn computer_use_type_raw(text: &str) -> Result<(), String> {
    validate_text(text)?;
    let mut enigo = make_enigo()?;
    enigo.text(text).map_err(|e| e.to_string())
}

pub fn computer_use_scroll_raw(x: i32, y: i32, dx: i32, dy: i32) -> Result<(), String> {
    let mut enigo = make_enigo()?;
    move_to(&mut enigo, x, y)?;
    if dx != 0 {
        enigo
            .scroll(clamp_scroll_delta(dx), enigo::Axis::Horizontal)
            .map_err(|e| e.to_string())?;
    }
    if dy != 0 {
        enigo
            .scroll(clamp_scroll_delta(dy), enigo::Axis::Vertical)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn parse_allowed_key(key: &str) -> Result<Key, String> {
    let normalized = key.trim().to_lowercase();
    let parsed = match normalized.as_str() {
        "ctrl" | "control" => Key::Control,
        "alt" | "option" => Key::Alt,
        "shift" => Key::Shift,
        "meta" | "cmd" | "command" | "win" | "windows" | "super" => Key::Meta,
        "enter" | "return" => Key::Return,
        "tab" => Key::Tab,
        "esc" | "escape" => Key::Escape,
        "backspace" => Key::Backspace,
        "delete" | "del" => Key::Delete,
        "space" => Key::Space,
        "up" | "arrowup" | "up_arrow" => Key::UpArrow,
        "down" | "arrowdown" | "down_arrow" => Key::DownArrow,
        "left" | "arrowleft" | "left_arrow" => Key::LeftArrow,
        "right" | "arrowright" | "right_arrow" => Key::RightArrow,
        "home" => Key::Home,
        "end" => Key::End,
        "pageup" | "page_up" => Key::PageUp,
        "pagedown" | "page_down" => Key::PageDown,
        "f1" => Key::F1,
        "f2" => Key::F2,
        "f3" => Key::F3,
        "f4" => Key::F4,
        "f5" => Key::F5,
        "f6" => Key::F6,
        "f7" => Key::F7,
        "f8" => Key::F8,
        "f9" => Key::F9,
        "f10" => Key::F10,
        "f11" => Key::F11,
        "f12" => Key::F12,
        value if value.len() == 1 => {
            let ch = value.chars().next().unwrap();
            if ch.is_ascii_alphanumeric() {
                Key::Unicode(ch)
            } else {
                return Err(format!("Unsupported key: {key}"));
            }
        }
        _ => return Err(format!("Unsupported key: {key}")),
    };
    Ok(parsed)
}

fn click_button_repeated(enigo: &mut Enigo, button: Button, count: usize) -> Result<(), String> {
    for _ in 0..count {
        enigo
            .button(button, Direction::Click)
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_out_of_bounds_coordinates() {
        assert!(validate_coordinates(100_001, 0).is_err());
        assert!(validate_coordinates(100, -100).is_ok());
    }

    #[test]
    fn clamps_scroll_delta() {
        assert_eq!(clamp_scroll_delta(99), 30);
        assert_eq!(clamp_scroll_delta(-99), -30);
    }

    #[test]
    fn allows_only_known_keys() {
        assert!(parse_allowed_key("ctrl").is_ok());
        assert!(parse_allowed_key("enter").is_ok());
        assert!(parse_allowed_key("a").is_ok());
        assert!(parse_allowed_key("launch-missiles").is_err());
    }
}
