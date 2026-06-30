use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

pub fn setup<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    // Ctrl+Alt+Space — push-to-talk hotkey (mirrors macOS Ctrl+Option)
    // Graceful degradation: if Ctrl+Alt+Space is already claimed by another app,
    // log a warning instead of panicking. The user can still use the tray menu.
    if let Err(e) = app.global_shortcut().on_shortcut("Ctrl+Alt+Space", |app, _shortcut, event| {
        match event.state() {
            ShortcutState::Pressed => {
                app.emit("hotkey-pressed", ()).ok();
            }
            ShortcutState::Released => {
                app.emit("hotkey-released", ()).ok();
            }
        }
    }) {
        eprintln!("[hotkey] Ctrl+Alt+Space unavailable (another app may own it): {e}");
        eprintln!("[hotkey] Push-to-talk disabled. Reassign the hotkey in Settings to fix.");
    }

    Ok(())
}

#[tauri::command]
pub fn set_hotkey(app: AppHandle, shortcut: String) -> Result<(), String> {
    // Unregister all existing global shortcuts before registering the new one
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())?;

    // Register the new shortcut with the same hotkey-pressed / hotkey-released handler
    app.global_shortcut()
        .on_shortcut(shortcut.as_str(), |app, _shortcut, event| {
            match event.state() {
                ShortcutState::Pressed => {
                    app.emit("hotkey-pressed", ()).ok();
                }
                ShortcutState::Released => {
                    app.emit("hotkey-released", ()).ok();
                }
            }
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}
