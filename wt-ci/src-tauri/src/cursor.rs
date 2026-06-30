use std::{thread, time::Duration};

use windows::Win32::Foundation::POINT;
use windows::Win32::UI::WindowsAndMessaging::{GetCursorPos, SetCursorPos};

/// Smoothly animates the Windows cursor from its current position to (x, y)
/// in absolute screen pixels. Uses ease-in-out cubic over 500 ms at ~60 fps.
/// Runs on a detached thread — never blocks the Tauri event loop.
#[tauri::command]
pub fn animate_cursor_to(x: i32, y: i32) {
    thread::spawn(move || {
        let mut start = POINT::default();
        // SAFETY: GetCursorPos / SetCursorPos are thread-safe Win32 calls.
        unsafe {
            let _ = GetCursorPos(&mut start);
        }

        const STEPS: i32 = 30;
        const FRAME_MS: u64 = 500 / STEPS as u64; // ≈16 ms per frame

        for i in 1..=STEPS {
            let t = i as f64 / STEPS as f64;
            // Ease-in-out cubic
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
            thread::sleep(Duration::from_millis(FRAME_MS));
        }
    });
}

/// Blocking version of cursor animation for MCP callers.
/// Runs ease-in-out cubic over ~320 ms at ~60 fps on the calling thread.
pub fn animate_cursor_to_blocking(x: i32, y: i32) {
    let mut start = POINT::default();
    // SAFETY: GetCursorPos / SetCursorPos are thread-safe Win32 calls.
    unsafe {
        let _ = GetCursorPos(&mut start);
    }

    const STEPS: i32 = 20;

    for i in 1..=STEPS {
        let t = i as f64 / STEPS as f64;
        // Ease-in-out cubic
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
