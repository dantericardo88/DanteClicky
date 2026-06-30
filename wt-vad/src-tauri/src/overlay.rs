use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
};

#[tauri::command]
pub fn set_overlay_stealth(window: tauri::Window, enabled: bool) -> Result<(), String> {
    let hwnd = HWND(window.hwnd().map_err(|e| e.to_string())? as isize);
    let affinity = if enabled { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
    unsafe {
        SetWindowDisplayAffinity(hwnd, affinity)
            .map_err(|e| format!("SetWindowDisplayAffinity failed: {e}"))
    }
}
