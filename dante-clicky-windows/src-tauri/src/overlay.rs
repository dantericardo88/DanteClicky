use tauri::Manager;

#[cfg(target_os = "windows")]
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
};

/// Toggle whether the overlay is excluded from screen-capture APIs.
/// Windows supports WDA_EXCLUDEFROMCAPTURE. Other desktop targets expose an
/// explicit degraded response so the command compiles and the UI can explain it.
#[tauri::command]
pub fn set_overlay_stealth(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let overlay = app
            .get_webview_window("overlay")
            .ok_or_else(|| "overlay window not found".to_string())?;
        let hwnd = overlay.hwnd().map_err(|e| e.to_string())?;
        let affinity = if enabled { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE };
        unsafe {
            SetWindowDisplayAffinity(hwnd, affinity)
                .map_err(|e| format!("SetWindowDisplayAffinity failed: {e}"))
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, enabled);
        Err("overlay stealth is only supported on Windows".to_string())
    }
}
