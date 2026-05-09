use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum PendingHotkeyEvent {
    Pressed,
    Released,
}

impl PendingHotkeyEvent {
    fn event_name(&self) -> &'static str {
        match self {
            PendingHotkeyEvent::Pressed => "hotkey-pressed",
            PendingHotkeyEvent::Released => "hotkey-released",
        }
    }
}

static PENDING_HOTKEY_EVENTS: OnceLock<Mutex<Vec<PendingHotkeyEvent>>> = OnceLock::new();

fn pending_hotkey_events() -> &'static Mutex<Vec<PendingHotkeyEvent>> {
    PENDING_HOTKEY_EVENTS.get_or_init(|| Mutex::new(Vec::new()))
}

fn has_pending_hotkey_events() -> bool {
    pending_hotkey_events()
        .lock()
        .map(|events| !events.is_empty())
        .unwrap_or(false)
}

fn record_pending_hotkey_event(event: PendingHotkeyEvent) {
    if let Ok(mut events) = pending_hotkey_events().lock() {
        events.push(event);
    }
}

fn emit_or_queue_hotkey_event<R: Runtime>(app: &AppHandle<R>, event: PendingHotkeyEvent) {
    let panel_missing = app.get_webview_window("companion-panel").is_none();
    if panel_missing || has_pending_hotkey_events() {
        if let Err(e) = crate::ensure_companion_panel(app) {
            eprintln!("[hotkey] failed to create companion panel for pending hotkey: {e}");
        }
        record_pending_hotkey_event(event.clone());
    }

    app.emit(event.event_name(), ()).ok();
}

fn register_shortcut<R: Runtime>(app: &AppHandle<R>, shortcut: &str) -> Result<(), String> {
    app.global_shortcut()
        .on_shortcut(shortcut, |app, _shortcut, event| match event.state() {
            ShortcutState::Pressed => {
                emit_or_queue_hotkey_event(app, PendingHotkeyEvent::Pressed);
            }
            ShortcutState::Released => {
                emit_or_queue_hotkey_event(app, PendingHotkeyEvent::Released);
            }
        })
        .map_err(|e| e.to_string())
}

pub fn setup<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    // Ctrl+Alt+Space — push-to-talk hotkey (mirrors macOS Ctrl+Option)
    // Graceful degradation: if Ctrl+Alt+Space is already claimed by another app,
    // log a warning instead of panicking. The user can still use the tray menu.
    if let Err(e) = register_shortcut(app, "Ctrl+Alt+Space") {
        eprintln!("[hotkey] Ctrl+Alt+Space unavailable (another app may own it): {e}");
        eprintln!("[hotkey] Push-to-talk disabled. Reassign the hotkey in Settings to fix.");
    }

    Ok(())
}

#[tauri::command]
pub fn drain_pending_hotkey_events() -> Vec<PendingHotkeyEvent> {
    pending_hotkey_events()
        .lock()
        .map(|mut events| events.drain(..).collect())
        .unwrap_or_default()
}

#[tauri::command]
pub fn set_hotkey(app: AppHandle, shortcut: String) -> Result<(), String> {
    // Unregister all existing global shortcuts before registering the new one
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())?;

    // Register the new shortcut with the same hotkey-pressed / hotkey-released handler
    register_shortcut(&app, shortcut.as_str())
}
