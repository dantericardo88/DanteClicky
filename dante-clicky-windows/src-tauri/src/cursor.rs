use std::{thread, time::Duration};

#[cfg(not(target_os = "windows"))]
use enigo::{Coordinate, Enigo, Mouse, Settings};
#[cfg(target_os = "windows")]
use windows::Win32::Foundation::POINT;
#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, SetCursorPos};

/// Smoothly animates the cursor from its current position to (x, y).
/// Windows uses Win32 for exact current-position easing; other desktop targets
/// use Enigo's cross-platform absolute move as a safe fallback.
#[tauri::command]
pub fn animate_cursor_to(x: i32, y: i32) {
    thread::spawn(move || {
        animate_cursor_to_blocking(x, y);
    });
}

/// Blocking version of cursor animation for MCP callers.
#[cfg(target_os = "windows")]
pub fn animate_cursor_to_blocking(x: i32, y: i32) {
    let mut start = POINT::default();
    unsafe {
        let _ = GetCursorPos(&mut start);
    }

    const STEPS: i32 = 20;

    for i in 1..=STEPS {
        let t = i as f64 / STEPS as f64;
        let ease = if t < 0.5 {
            4.0 * t * t * t
        } else {
            1.0 - (-2.0 * t + 2.0_f64).powi(3) / 2.0
        };

        let cx = start.x + ((x - start.x) as f64 * ease).round() as i32;
        let cy = start.y + ((y - start.y) as f64 * ease).round() as i32;

        unsafe {
            let _ = SetCursorPos(cx, cy);
        }
        thread::sleep(Duration::from_millis(16));
    }
}

#[cfg(not(target_os = "windows"))]
pub fn animate_cursor_to_blocking(x: i32, y: i32) {
    if let Ok(mut enigo) = Enigo::new(&Settings::default()) {
        let _ = enigo.move_mouse(x, y, Coordinate::Abs);
    }
    thread::sleep(Duration::from_millis(16));
}
