mod audio;
mod capture;
mod chat_proxy;
mod cursor;
mod hotkey;
mod input;
mod mcp_server;
mod monitors;
mod session;
mod stt;
mod tray;
mod ws_server;

use std::sync::{Arc, Mutex};
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
fn get_monitors(app: tauri::AppHandle) -> Vec<serde_json::Value> {
    monitors::enumerate(&app)
        .into_iter()
        .map(|m| serde_json::to_value(m).unwrap_or_default())
        .collect()
}

#[tauri::command]
fn capture_screens() -> Result<Vec<serde_json::Value>, String> {
    capture::capture_all()
}

#[tauri::command]
fn start_audio(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<audio::AudioState>>,
) -> Result<(), String> {
    let acc = {
        let s = state.lock().unwrap();
        Arc::clone(&s.accumulator)
    };
    // audio::start() calls acc.clear(sample_rate) before opening the stream
    let stream = audio::start(app, acc)?;
    state.lock().unwrap().stream = Some(stream);
    Ok(())
}

#[tauri::command]
fn stop_audio(state: tauri::State<'_, Mutex<audio::AudioState>>) {
    let mut s = state.lock().unwrap();
    // Drop stream first so no more audio callbacks push samples
    s.stream = None;
    // Mark accumulator inactive (samples preserved for transcription)
    s.accumulator.lock().unwrap().stop();
}

/// Download the ggml-base.en Whisper model to app data dir, then load it.
/// If already downloaded, just loads it. Returns the local path.
#[tauri::command]
async fn download_whisper_model(
    stt_state: tauri::State<'_, Mutex<stt::SttState>>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let url = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin";
    let dest = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("ggml-base.en.bin");

    if dest.exists() {
        let path_str = dest.to_string_lossy().to_string();
        stt_state
            .lock()
            .map_err(|e| e.to_string())?
            .load_model(&path_str)?;
        return Ok(path_str);
    }

    let client = reqwest::Client::new();
    let bytes = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .bytes()
        .await
        .map_err(|e| e.to_string())?;

    std::fs::write(&dest, &bytes).map_err(|e| e.to_string())?;
    let path_str = dest.to_string_lossy().to_string();
    stt_state
        .lock()
        .map_err(|e| e.to_string())?
        .load_model(&path_str)?;
    Ok(path_str)
}

/// Run local Whisper inference on the audio recorded since the last start_audio call.
#[tauri::command]
fn transcribe_local(
    audio_state: tauri::State<'_, Mutex<audio::AudioState>>,
    stt_state: tauri::State<'_, Mutex<stt::SttState>>,
) -> Result<String, String> {
    let (samples, sample_rate) = {
        let a = audio_state.lock().map_err(|e| e.to_string())?;
        let acc = a.accumulator.lock().map_err(|e| e.to_string())?;
        (acc.samples.clone(), acc.sample_rate)
    };
    if samples.is_empty() {
        return Ok(String::new());
    }
    stt_state
        .lock()
        .map_err(|e| e.to_string())?
        .transcribe(&samples, sample_rate)
}

#[tauri::command]
fn show_overlay(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.show();
        let _ = w.set_ignore_cursor_events(false);
    }
}

#[tauri::command]
fn hide_overlay(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.hide();
        let _ = w.set_ignore_cursor_events(true);
    }
}

// ── App entry point ───────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .manage(Mutex::new(audio::AudioState::new()))
        .manage(Mutex::new(stt::SttState::new()))
        .invoke_handler(tauri::generate_handler![
            get_monitors,
            capture_screens,
            capture::capture_primary,
            start_audio,
            stop_audio,
            show_overlay,
            hide_overlay,
            cursor::animate_cursor_to,
            input::computer_use_click,
            input::computer_use_double_click,
            input::computer_use_right_click,
            input::computer_use_type,
            input::computer_use_scroll,
            input::computer_use_move,
            stt::get_stt_mode,
            stt::set_stt_mode,
            stt::get_local_model_status,
            download_whisper_model,
            transcribe_local,
            chat_proxy::stream_claude,
            chat_proxy::stream_openai_compat,
            chat_proxy::get_assemblyai_token,
            chat_proxy::elevenlabs_tts,
            hotkey::set_hotkey,
            session::db_new_session,
            session::db_save_message,
            session::db_get_history,
            session::db_search_history,
        ])
        .setup(|app| {
            let handle = app.handle().clone();

            // ── Session memory database ───────────────────────────────────────
            app.handle().manage(
                session::SessionDb::open(&handle)
                    .expect("failed to open session database"),
            );

            // ── Companion panel ───────────────────────────────────────────────
            let panel = WebviewWindowBuilder::new(
                &handle,
                "companion-panel",
                WebviewUrl::App("index.html".into()),
            )
            .title("DanteClicky")
            .inner_size(360.0, 580.0)
            .min_inner_size(320.0, 400.0)
            .decorations(false)
            .transparent(true)
            .resizable(false)
            .visible(false)
            .skip_taskbar(true)
            .build()?;

            if let Ok(Some(monitor)) = panel.primary_monitor() {
                let size = monitor.size();
                let scale = monitor.scale_factor();
                let lw = size.width as f64 / scale;
                let lh = size.height as f64 / scale;
                let x = lw - 360.0 - 12.0;
                let y = lh - 580.0 - 48.0 - 12.0;
                let _ = panel.set_position(tauri::LogicalPosition::new(x, y));
            }

            let panel_clone = panel.clone();
            panel.on_window_event(move |event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = panel_clone.hide();
                }
            });

            // ── Overlay window ────────────────────────────────────────────────
            let overlay = WebviewWindowBuilder::new(
                &handle,
                "overlay",
                WebviewUrl::App("index.html?window=overlay".into()),
            )
            .decorations(false)
            .transparent(true)
            .always_on_top(true)
            .visible(false)
            .skip_taskbar(true)
            .inner_size(1920.0, 1080.0)
            .build()?;

            if let Ok(Some(monitor)) = overlay.primary_monitor() {
                let size = monitor.size();
                let scale = monitor.scale_factor();
                let lw = size.width as f64 / scale;
                let lh = size.height as f64 / scale;
                let _ = overlay.set_size(tauri::LogicalSize::new(lw, lh));
                let _ = overlay.set_position(tauri::LogicalPosition::new(0.0, 0.0));
            }

            overlay.set_ignore_cursor_events(true)?;

            // Make the overlay invisible to all screen-capture APIs (Zoom, Teams, OBS, Game Bar).
            // WDA_EXCLUDEFROMCAPTURE requires Windows 10 20H1+; silently ignored if unavailable.
            #[cfg(target_os = "windows")]
            {
                use windows::Win32::UI::WindowsAndMessaging::{
                    SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE,
                };
                if let Ok(hwnd) = overlay.hwnd() {
                    unsafe {
                        let _ = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
                    }
                }
            }

            tray::setup(&handle)?;
            hotkey::setup(&handle)?;

            // ── DanteAgents WebSocket bridge (Phase 9) ────────────────────────
            let handle2 = handle.clone();
            tauri::async_runtime::spawn(async move {
                ws_server::start(handle2).await;
            });

            // ── MCP server (Phase P1-B) ───────────────────────────────────────
            let handle3 = handle.clone();
            tauri::async_runtime::spawn(async move {
                mcp_server::start(handle3).await;
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building DanteClicky");

    app.run(|_handle, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            api.prevent_exit();
        }
    });
}
