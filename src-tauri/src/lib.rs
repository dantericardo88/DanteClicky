mod accessibility;
mod audio;
mod capture;
mod chat_proxy;
mod computer_use;
mod cursor;
mod embedding;
mod hardware;
mod hotkey;
mod input;
mod keystore;
mod mcp_server;
mod monitors;
mod moondream;
mod observability;
mod ocr;
mod overlay;
mod platform;
pub mod security;
mod clipboard_guard;
mod context_awareness;
mod event_bus;
mod profiler;
mod screenpipe_bridge;
mod task_integrations;
mod session;
mod shell_hooks;
mod workflow_recorder;
mod stt;
mod tray;
mod tts_local;
mod vad;
mod video;
mod wake_word;
mod whisper_candle;
mod ws_server;

use std::collections::HashMap;
use std::io::Write;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{
    AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder,
    WindowEvent,
};
use tauri_plugin_updater::UpdaterExt;

// ── Tauri commands ────────────────────────────────────────────────────────────

const LATEST_MANIFEST_URL: &str =
    "https://github.com/dantericardo88/DanteClicky/releases/latest/download/latest.json";

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

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub reached_manifest: bool,
    pub available: bool,
    pub current_version: String,
    pub version: Option<String>,
    pub target: Option<String>,
    pub date: Option<String>,
    pub body: Option<String>,
    pub download_url: Option<String>,
    pub manifest_url: Option<String>,
    pub signature_present: bool,
}

#[derive(serde::Deserialize)]
struct LatestUpdaterManifest {
    platforms: HashMap<String, LatestUpdaterPlatform>,
}

#[derive(serde::Deserialize)]
struct LatestUpdaterPlatform {
    signature: Option<String>,
    url: Option<String>,
}

fn current_updater_platform_key() -> String {
    let os = if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        std::env::consts::OS
    };

    format!("{os}-{}", std::env::consts::ARCH)
}

async fn latest_manifest_platform_probe() -> Option<(String, Option<String>, bool)> {
    let platform_key = current_updater_platform_key();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .ok()?;
    let manifest = client
        .get(LATEST_MANIFEST_URL)
        .send()
        .await
        .ok()?
        .error_for_status()
        .ok()?
        .json::<LatestUpdaterManifest>()
        .await
        .ok()?;
    let platform = manifest.platforms.get(&platform_key)?;
    let signature_present = platform
        .signature
        .as_deref()
        .map(|signature| !signature.trim().is_empty())
        .unwrap_or(false);

    Some((platform_key, platform.url.clone(), signature_present))
}

#[tauri::command]
async fn check_for_update(app: tauri::AppHandle) -> Result<UpdateCheckResult, String> {
    let current_version = app.package_info().version.to_string();
    let updater = app
        .updater()
        .map_err(|e| format!("updater init failed: {e}"))?;
    match updater.check().await {
        Ok(Some(update)) => {
            let manifest_probe = latest_manifest_platform_probe().await;
            let manifest_signature_present = manifest_probe
                .as_ref()
                .map(|(_, _, signature_present)| *signature_present)
                .unwrap_or(false);

            Ok(UpdateCheckResult {
                reached_manifest: true,
                available: true,
                current_version: update.current_version,
                version: Some(update.version),
                target: Some(update.target),
                date: update.date.map(|d| d.to_string()),
                body: update.body,
                download_url: Some(update.download_url.to_string()),
                manifest_url: Some(LATEST_MANIFEST_URL.to_string()),
                signature_present: !update.signature.trim().is_empty()
                    || manifest_signature_present,
            })
        }
        Ok(None) => {
            let manifest_probe = latest_manifest_platform_probe().await;
            let (target, download_url, signature_present) =
                manifest_probe.unwrap_or_else(|| (current_updater_platform_key(), None, false));

            Ok(UpdateCheckResult {
                reached_manifest: true,
                available: false,
                current_version,
                version: None,
                target: Some(target),
                date: None,
                body: None,
                download_url,
                manifest_url: Some(LATEST_MANIFEST_URL.to_string()),
                signature_present,
            })
        }
        Err(e) => Err(format!("updater check failed: {e}")),
    }
}

// ── Dim 16: Video / temporal context — control surface ───────────────────────

#[tauri::command]
fn video_start(
    opts: video::VideoStartOpts,
    app: tauri::AppHandle,
    state: tauri::State<'_, video::VideoState>,
    db: tauri::State<'_, Arc<session::SessionDb>>,
    privacy_state: tauri::State<'_, video::VideoPrivacyState>,
) -> Result<video::VideoStatus, String> {
    let mut slot = state.0.lock().map_err(|e| e.to_string())?;
    if slot.is_some() {
        return Err("video already running".to_string());
    }
    let root = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("video");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let mut session = video::VideoSession::new(opts.clone(), root);

    // Resolve target monitors. Empty list = primary monitor only (idx 0).
    let monitors: Vec<u32> = if opts.monitors.is_empty() {
        vec![0]
    } else {
        opts.monitors.clone()
    };

    let db_arc = Arc::clone(&*db);
    let privacy_arc = Arc::clone(&privacy_state.0);
    let stop_flag = Arc::clone(&session.stop_flag);

    for monitor_idx in monitors {
        // A1 fix: build the source FIRST so we can grab its pacing handle
        // BEFORE wrapping it in `Box<dyn FrameSource>`. The CaptureState then
        // pushes adaptive_fps.target_frame_interval_ms() into this handle on
        // every tick, actually throttling the source.
        let concrete_source =
            video::screenshots_source::ScreenshotsFrameSource::for_monitor(monitor_idx);
        let interval_handle = concrete_source.interval_handle();
        let cap_state = video::capture_loop::CaptureState::new(
            monitor_idx,
            opts.fps_min,
            opts.fps_max,
            Arc::clone(&session.ringbuf),
            Arc::clone(&session.segmenter),
        )
        .with_interval_handle(interval_handle);
        // Capture the force-keyframe slot BEFORE moving cap_state into the
        // thread so we can publish it to a shared registry below.
        let force_slot = cap_state.force_keyframe_slot();
        session.force_keyframe_slots.push(force_slot);
        let source: Box<dyn video::FrameSource> = Box::new(concrete_source);
        let active_window_fn: Arc<dyn Fn() -> String + Send + Sync> =
            Arc::new(get_active_window_title);
        let handle = video::capture_loop::spawn_capture_loop(
            cap_state,
            source,
            Arc::clone(&db_arc),
            Arc::clone(&privacy_arc),
            Arc::clone(&stop_flag),
            active_window_fn,
        );
        session.capture_handles.push(handle);
    }

    let status = session.status();
    *slot = Some(session);
    Ok(status)
}

#[tauri::command]
fn video_stop(state: tauri::State<'_, video::VideoState>) -> Result<(), String> {
    // Take the session out under lock, then drop the lock BEFORE join so the
    // capture threads can finish their final tick without blocking on it.
    let session = {
        let mut slot = state.0.lock().map_err(|e| e.to_string())?;
        if let Some(s) = slot.as_ref() {
            s.stop_flag.store(true, std::sync::atomic::Ordering::SeqCst);
        }
        slot.take()
    };
    if let Some(session) = session {
        for h in session.capture_handles {
            // Best-effort join. If a thread is wedged, ignore — process exit
            // will clean it up. Most ticks complete in <100ms anyway.
            let _ = h.join();
        }
    }
    Ok(())
}

#[tauri::command]
fn video_status(state: tauri::State<'_, video::VideoState>) -> Result<video::VideoStatus, String> {
    let slot = state.0.lock().map_err(|e| e.to_string())?;
    Ok(match slot.as_ref() {
        Some(s) => s.status(),
        None => video::VideoStatus {
            running: false,
            ram_bytes: 0,
            ram_segments: 0,
            disk_segments: 0,
            disk_bytes: 0,
            current_fps: 0.0,
            dropped_frames: 0,
            uptime_seconds: 0,
        },
    })
}

/// Pause capture WITHOUT killing the worker thread. Sets the runtime
/// privacy snapshot's `paused` flag so the existing privacy classifier
/// turns every subsequent tick into a no-op (segment marked Paused, no
/// keyframe persisted). Resume is instant — no thread re-spawn.
///
/// (A4 fix: prior implementation set `stop_flag=true` which exited the
/// loop, requiring full `video_start` to resume.)
#[tauri::command]
fn video_pause(privacy_state: tauri::State<'_, video::VideoPrivacyState>) -> Result<(), String> {
    let mut p = privacy_state.0.write().map_err(|e| e.to_string())?;
    p.paused = true;
    Ok(())
}

#[tauri::command]
fn video_resume(privacy_state: tauri::State<'_, video::VideoPrivacyState>) -> Result<(), String> {
    let mut p = privacy_state.0.write().map_err(|e| e.to_string())?;
    p.paused = false;
    Ok(())
}

/// Phase 3 — link an ambient_snapshots row (already saved by the JS ambient
/// loop) to the live video segment + nearest keyframe. Called by useAmbient.ts
/// right after `save_ambient_snapshot` completes.
///
/// Inputs:
///   ambient_snapshot_id - row id returned from save_ambient_snapshot
///   captured_at_ts      - ISO8601 wall-clock of the screenshot
///   monitor_idx         - which monitor the screenshot came from
///   ocr_text            - decrypted OCR (we re-encrypt into video_keyframes)
///   active_window       - decrypted active window
///   thumb_jpeg_b64      - optional 160x90 thumbnail produced by the encoder
///
/// If no live segment exists for this monitor + timestamp, a fresh segment row
/// is auto-inserted so the keyframe always has a valid FK.
#[tauri::command]
fn link_ambient_to_video(
    ambient_snapshot_id: i64,
    captured_at_ts: String,
    monitor_idx: u32,
    ocr_text: Option<String>,
    active_window: Option<String>,
    thumb_jpeg_b64: Option<String>,
    db: tauri::State<'_, Arc<session::SessionDb>>,
) -> Result<i64, String> {
    // Try to find an existing segment that brackets this timestamp.
    let segments = db
        .get_video_segments_in_window(&captured_at_ts, &captured_at_ts, Some(monitor_idx), 1)
        .map_err(|e| e.to_string())?;

    let segment_id = if let Some((id, _, _, _, _, _, _, _)) = segments.first().cloned() {
        id
    } else {
        // No live segment — synthesize a placeholder so this keyframe is recoverable.
        // Phase 4+ will replace this with the actual encoder-driven segment open.
        db.save_video_segment(
            monitor_idx,
            &format!("placeholder/monitor_{}/{}.mp4", monitor_idx, captured_at_ts),
            &captured_at_ts,
            None,
            0,
            0,
            0,
            0,
            0.0,
            "normal",
        )
        .map_err(|e| e.to_string())?
    };

    db.save_video_keyframe(
        segment_id,
        0,
        ocr_text.as_deref(),
        active_window.as_deref(),
        Some(ambient_snapshot_id),
        thumb_jpeg_b64.as_deref(),
        None,
    )
    .map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub struct VideoSeekResult {
    pub keyframe_id: i64,
    pub segment_id: i64,
    pub pts_ms: i64,
    pub ocr_text: String,
    pub active_window: String,
    pub ambient_snapshot_id: Option<i64>,
}

#[tauri::command]
fn video_seek(
    target_ts: String,
    monitor_idx: Option<u32>,
    db: tauri::State<'_, Arc<session::SessionDb>>,
) -> Result<Option<VideoSeekResult>, String> {
    let hit = db
        .find_video_keyframe_near(&target_ts, monitor_idx)
        .map_err(|e| e.to_string())?;
    Ok(
        hit.map(|(id, seg, pts, ocr, win, ambient)| VideoSeekResult {
            keyframe_id: id,
            segment_id: seg,
            pts_ms: pts,
            ocr_text: ocr,
            active_window: win,
            ambient_snapshot_id: ambient,
        }),
    )
}

#[derive(serde::Serialize)]
pub struct VideoSearchHit {
    pub keyframe_id: i64,
    pub segment_id: i64,
    pub pts_ms: i64,
    pub ocr_snippet: String,
}

#[tauri::command]
fn video_search(
    query: String,
    limit: Option<usize>,
    db: tauri::State<'_, Arc<session::SessionDb>>,
) -> Result<Vec<VideoSearchHit>, String> {
    let hits = db
        .search_video_keyframes(&query, limit.unwrap_or(20))
        .map_err(|e| e.to_string())?;
    Ok(hits
        .into_iter()
        .map(|(id, seg, pts, snippet)| VideoSearchHit {
            keyframe_id: id,
            segment_id: seg,
            pts_ms: pts,
            ocr_snippet: snippet,
        })
        .collect())
}

#[derive(serde::Serialize)]
pub struct TimelineBucket {
    pub segment_id: i64,
    pub monitor_idx: u32,
    pub start_ts: String,
    pub end_ts: Option<String>,
    pub duration_ms: i64,
    pub byte_size: i64,
    pub privacy_flag: String,
}

#[tauri::command]
fn video_timeline(
    range_minutes: u32,
    monitor_idx: Option<u32>,
    db: tauri::State<'_, Arc<session::SessionDb>>,
) -> Result<Vec<TimelineBucket>, String> {
    // Compute the wall-clock window in SQL — use SQLite's now to stay consistent
    // with the format used in start_ts (DEFAULT strftime('%Y-%m-%dT%H:%M:%S','now')).
    // This way we don't pull in chrono and timezone bugs.
    let window_minutes = range_minutes.max(1) as i64;
    // We'll pass relative ranges: now - N minutes .. now
    let rows = db
        .get_recent_video_segments(window_minutes, monitor_idx)
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(
            |(id, monitor_idx, start_ts, end_ts, duration_ms, byte_size, privacy_flag)| {
                TimelineBucket {
                    segment_id: id,
                    monitor_idx,
                    start_ts,
                    end_ts,
                    duration_ms,
                    byte_size,
                    privacy_flag,
                }
            },
        )
        .collect())
}

// ── Dim 16 Phase 4+: thumbnail extract, recent-keyframes, privacy, prune ─────

#[derive(serde::Serialize)]
pub struct ExtractFrameResult {
    pub keyframe_id: i64,
    pub jpeg_base64: Option<String>,
}

/// Return the encrypted JPEG thumbnail for a given keyframe id (decrypted to
/// base64). `jpeg_base64` is `None` when the keyframe row exists but has no
/// stored thumb (privacy-flagged or DRM-blackout segments).
#[tauri::command]
fn video_extract_frame(
    keyframe_id: i64,
    db: tauri::State<'_, Arc<session::SessionDb>>,
) -> Result<ExtractFrameResult, String> {
    let jpeg_base64 = db
        .get_keyframe_thumb(keyframe_id)
        .map_err(|e| e.to_string())?;
    Ok(ExtractFrameResult {
        keyframe_id,
        jpeg_base64,
    })
}

#[derive(serde::Serialize)]
pub struct RecentKeyframe {
    pub keyframe_id: i64,
    pub segment_id: i64,
    pub monitor_idx: u32,
    pub start_ts: String,
    pub pts_ms: i64,
    pub active_window: String,
    pub privacy_flag: String,
    pub has_thumb: bool,
}

/// Return the most recent N keyframes across all monitors. Filters can
/// constrain to a single monitor. Used by the timeline mini-strip and the
/// temporal-context API in [src/lib/temporalContext.ts](../../src/lib/temporalContext.ts).
#[tauri::command]
fn video_recent_keyframes(
    limit: Option<usize>,
    monitor_idx: Option<u32>,
    db: tauri::State<'_, Arc<session::SessionDb>>,
) -> Result<Vec<RecentKeyframe>, String> {
    let rows = db
        .get_recent_keyframes(limit.unwrap_or(20).min(200), monitor_idx)
        .map_err(|e| e.to_string())?;
    Ok(rows
        .into_iter()
        .map(
            |(
                keyframe_id,
                segment_id,
                monitor_idx,
                start_ts,
                pts_ms,
                active_window,
                privacy_flag,
                has_thumb,
            )| {
                RecentKeyframe {
                    keyframe_id,
                    segment_id,
                    monitor_idx,
                    start_ts,
                    pts_ms,
                    active_window,
                    privacy_flag,
                    has_thumb,
                }
            },
        )
        .collect())
}

/// Update the runtime privacy snapshot read by the capture loop on every tick.
/// Effective on the next frame — no thread restart required.
#[tauri::command]
fn video_set_privacy(
    incognito: bool,
    paused: bool,
    excluded_apps: Vec<String>,
    state: tauri::State<'_, video::VideoPrivacyState>,
) -> Result<(), String> {
    let mut p = state.0.write().map_err(|e| e.to_string())?;
    p.incognito = incognito;
    p.paused = paused;
    p.excluded_apps = excluded_apps;
    Ok(())
}

/// Delete video manifest rows + on-disk segment files older than `days` days.
/// `days <= 0` wipes everything. Returns the count of segments deleted.
#[tauri::command]
fn video_prune_old(
    days: i64,
    db: tauri::State<'_, Arc<session::SessionDb>>,
) -> Result<usize, String> {
    db.prune_video_segments(days).map_err(|e| e.to_string())
}

/// Phase B2 — request the next tick to emit a labeled keyframe regardless of
/// motion gate. Called by `agentLoop.ts` immediately after a successful
/// computer-use action so the timeline captures the *cause* of state changes,
/// not just the visual result. Writes the label into every monitor's
/// force-keyframe slot. Returns the number of slots written (= live monitors).
#[tauri::command]
fn video_capture_now(
    label: String,
    state: tauri::State<'_, video::VideoState>,
) -> Result<usize, String> {
    let slot = state.0.lock().map_err(|e| e.to_string())?;
    let session = match slot.as_ref() {
        Some(s) => s,
        None => return Ok(0), // not running — silent no-op
    };
    let mut written = 0;
    for force_slot in &session.force_keyframe_slots {
        if let Ok(mut s) = force_slot.lock() {
            *s = Some(label.clone());
            written += 1;
        }
    }
    Ok(written)
}

#[tauri::command]
fn start_audio(
    app: tauri::AppHandle,
    state: tauri::State<'_, Mutex<audio::AudioState>>,
) -> Result<(), String> {
    log::info!("[audio] start_audio called — mic recording starting");
    let mut s = state.lock().unwrap();
    if s.stream.is_some() {
        log::warn!("[audio] start_audio — already recording, ignoring duplicate call");
        return Ok(());
    }
    let acc = Arc::clone(&s.accumulator);
    let vad_enabled = Arc::clone(&s.vad_enabled);
    // Acquire pre-warmed device (fast path) or fresh device (first-run fallback)
    let (device, config) = s.acquire_device()?;
    let stream = audio::start_with_device(app, device, config, acc, vad_enabled)?;
    s.stream = Some(stream);
    log::info!("[audio] mic stream started OK");
    Ok(())
}

#[tauri::command]
fn stop_audio(state: tauri::State<'_, Mutex<audio::AudioState>>) {
    log::info!("[audio] stop_audio called — stopping mic");
    let mut s = state.lock().unwrap();
    // Drop stream first so no more audio callbacks push samples
    s.stream = None;
    // Mark accumulator inactive (samples preserved for transcription)
    s.accumulator.lock().unwrap().stop();
    log::info!("[audio] mic stopped");
}

/// Download whisper-tiny.en (candle safetensors format) and load it.
/// Downloads model.safetensors (~150MB), config.json, and tokenizer.json.
/// Emits "whisper-download-progress" events: { file, bytes_done, bytes_total }
/// If all files already exist, just loads the model. Returns the model directory.
#[tauri::command]
async fn download_whisper_model(
    language_code: Option<String>,
    stt_state: tauri::State<'_, Mutex<stt::SttState>>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    use futures_util::StreamExt;

    let requested_language = language_code.as_deref();
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(stt::whisper_model_directory_name(requested_language));

    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let repository = stt::whisper_model_repository_for_language(requested_language);
    let base_url = format!("https://huggingface.co/{repository}/resolve/main");
    // model.safetensors first so progress bar covers the heavy file
    let files = ["model.safetensors", "config.json", "tokenizer.json"];

    let client = reqwest::Client::new();

    // Candle reference mel filterbank — 80×201 f32 little-endian, 64320 bytes.
    // Downloading this once guarantees exact byte-for-byte parity with the candle
    // whisper implementation; the local computed filterbank is used as fallback.
    let melfilters_dest = dir.join("melfilters.bytes");
    // melfilters.bytes is always exactly 64320 bytes; re-download if missing or truncated.
    let melfilters_ok = melfilters_dest.exists()
        && std::fs::metadata(&melfilters_dest).map(|m| m.len()).unwrap_or(0) == 64320;
    if !melfilters_ok {
        let _ = std::fs::remove_file(&melfilters_dest);
        let mf_url = "https://raw.githubusercontent.com/huggingface/candle/main/candle-examples/examples/whisper/melfilters.bytes";
        let res = client
            .get(mf_url)
            .send()
            .await
            .map_err(|e| format!("download melfilters.bytes: {e}"))?;
        let data = res
            .bytes()
            .await
            .map_err(|e| format!("read melfilters.bytes: {e}"))?;
        std::fs::write(&melfilters_dest, &data)
            .map_err(|e| format!("write melfilters.bytes: {e}"))?;
    }
    for file in &files {
        let dest = dir.join(file);
        // Guard against stale partial files from previous crashes.
        // A truncated model.safetensors triggers a Windows SEH access violation
        // (not a catchable Rust error) when candle mmaps it — so size matters.
        let min_size: u64 = match *file {
            "model.safetensors" => 50_000_000, // whisper-tiny.en ~75 MB, multilingual ~150 MB
            "tokenizer.json"    => 1_000,
            _                   => 100,
        };
        if dest.exists() {
            let size = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
            if size >= min_size {
                continue; // file looks complete
            }
            // Truncated/corrupted — delete and re-download
            let _ = std::fs::remove_file(&dest);
        }

        let res = client
            .get(format!("{base_url}/{file}"))
            .send()
            .await
            .map_err(|e| format!("download {file}: {e}"))?;

        let total = res.content_length().unwrap_or(0);
        let mut stream = res.bytes_stream();
        let mut done: u64 = 0;

        // Write directly to disk as chunks arrive — avoids buffering the entire
        // model (~150 MB) in RAM before the first byte touches disk.
        let tmp_dest = dest.with_extension("tmp");
        {
            use std::io::Write;
            let file_handle = std::fs::File::create(&tmp_dest)
                .map_err(|e| format!("create {file}: {e}"))?;
            let mut writer = std::io::BufWriter::new(file_handle);

            while let Some(chunk) = stream.next().await {
                let chunk = chunk.map_err(|e| format!("stream {file}: {e}"))?;
                done += chunk.len() as u64;
                writer.write_all(&chunk).map_err(|e| format!("write {file}: {e}"))?;
                app.emit(
                    "whisper-download-progress",
                    serde_json::json!({ "file": file, "bytes_done": done, "bytes_total": total }),
                )
                .ok();
            }
            writer.flush().map_err(|e| format!("flush {file}: {e}"))?;
        }
        std::fs::rename(&tmp_dest, &dest).map_err(|e| format!("rename {file}: {e}"))?;
    }

    let dir_str = dir.to_string_lossy().to_string();
    // load_model mmaps and builds the candle graph — CPU-bound blocking work.
    // block_in_place keeps the Tokio runtime responsive during model load.
    tokio::task::block_in_place(|| {
        stt_state
            .lock()
            .map_err(|e| e.to_string())?
            .load_model(&dir_str, requested_language)
    })?;
    Ok(dir_str)
}

/// Run local Whisper inference on the audio recorded since the last start_audio call.
/// Uses block_in_place so the multi-second CPU inference does not stall the async runtime.
#[tauri::command]
async fn transcribe_local(
    language_code: Option<String>,
    audio_state: tauri::State<'_, Mutex<audio::AudioState>>,
    stt_state: tauri::State<'_, Mutex<stt::SttState>>,
) -> Result<String, String> {
    let (samples, sample_rate) = {
        let a = audio_state.lock().map_err(|e| e.to_string())?;
        let acc = a.accumulator.lock().map_err(|e| e.to_string())?;
        (acc.samples.clone(), acc.sample_rate)
    };
    log::info!("[stt] transcribe_local called — samples={}, rate={}, lang={:?}", samples.len(), sample_rate, language_code);
    if samples.is_empty() {
        log::warn!("[stt] transcribe_local → no audio samples, returning empty");
        return Ok(String::new());
    }
    // block_in_place: yield the async worker thread for blocking CPU work
    let result = tokio::task::block_in_place(|| {
        stt_state.lock().map_err(|e| e.to_string())?.transcribe(
            &samples,
            sample_rate,
            language_code.as_deref(),
        )
    });
    match &result {
        Ok(text) => log::info!("[stt] transcribe_local → OK, transcript_len={}", text.len()),
        Err(e) => log::error!("[stt] transcribe_local → FAILED: {e}"),
    }
    result
}

#[tauri::command]
fn save_turn(
    user: String,
    assistant: String,
    screenshot_b64: Option<String>,
    state: tauri::State<'_, Arc<session::SessionDb>>,
) -> Result<i64, String> {
    state
        .save_turn(&user, &assistant, screenshot_b64)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn search_history(
    query: String,
    limit: i32,
    state: tauri::State<'_, Arc<session::SessionDb>>,
) -> Result<Vec<session::TurnRow>, String> {
    state
        .search_history(&query, limit as i64)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_recent_turns(
    limit: i32,
    state: tauri::State<'_, Arc<session::SessionDb>>,
) -> Result<Vec<session::TurnRow>, String> {
    state
        .get_recent_turns(limit as i64)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn rate_turn(
    turn_id: i64,
    rating: i32,
    reason: Option<String>,
    state: tauri::State<'_, Arc<session::SessionDb>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    state
        .rate_turn_with_reason(turn_id, rating, reason)
        .map_err(|e| e.to_string())?;
    app.emit("preference-updated", ()).ok();
    Ok(())
}

#[tauri::command]
fn get_top_rated_turns(
    limit: i32,
    state: tauri::State<'_, Arc<session::SessionDb>>,
) -> Result<Vec<session::TurnRow>, String> {
    state
        .get_top_rated_turns(limit as i64)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn show_overlay(app: tauri::AppHandle) {
    match ensure_overlay_window(&app) {
        Ok(w) => {
            let _ = w.show();
            let _ = w.set_ignore_cursor_events(false);
        }
        Err(e) => eprintln!("[overlay] failed to create overlay window: {e}"),
    }
}

#[tauri::command]
fn hide_overlay(app: tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.hide();
        let _ = w.set_ignore_cursor_events(true);
    }
}

fn ensure_overlay_window(app: &tauri::AppHandle) -> Result<WebviewWindow, String> {
    if let Some(window) = app.get_webview_window("overlay") {
        return Ok(window);
    }

    let overlay_builder = WebviewWindowBuilder::new(
        app,
        "overlay",
        WebviewUrl::App("index.html?window=overlay".into()),
    )
    .decorations(false);
    #[cfg(not(target_os = "macos"))]
    let overlay_builder = overlay_builder.transparent(true);

    let overlay = overlay_builder
        .always_on_top(true)
        .visible(false)
        .skip_taskbar(true)
        .inner_size(1920.0, 1080.0)
        .build()
        .map_err(|e| e.to_string())?;

    if let Ok(Some(monitor)) = overlay.primary_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let logical_width = size.width as f64 / scale;
        let logical_height = size.height as f64 / scale;
        let _ = overlay.set_size(tauri::LogicalSize::new(logical_width, logical_height));
        let _ = overlay.set_position(tauri::LogicalPosition::new(0.0, 0.0));
    }

    overlay
        .set_ignore_cursor_events(true)
        .map_err(|e| e.to_string())?;

    apply_overlay_stealth(&overlay);
    Ok(overlay)
}

fn apply_overlay_stealth(overlay: &WebviewWindow) {
    #[cfg(target_os = "windows")]
    if let Ok(hwnd) = overlay.hwnd() {
        #[allow(non_snake_case)]
        extern "system" {
            fn SetWindowDisplayAffinity(hWnd: *mut std::ffi::c_void, dwAffinity: u32) -> i32;
        }
        unsafe {
            SetWindowDisplayAffinity(hwnd.0, 0x0000_0011); // WDA_EXCLUDEFROMCAPTURE
        }
    }
}

pub(crate) fn ensure_companion_panel<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<WebviewWindow<R>, String> {
    if let Some(window) = app.get_webview_window("companion-panel") {
        return Ok(window);
    }

    let panel_builder =
        WebviewWindowBuilder::new(app, "companion-panel", WebviewUrl::App("index.html".into()))
            .title("DanteClicky")
            .inner_size(360.0, 580.0)
            .min_inner_size(320.0, 400.0)
            .decorations(false);
    #[cfg(not(target_os = "macos"))]
    let panel_builder = panel_builder.transparent(true);

    let panel = panel_builder
        .resizable(false)
        .visible(false)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;

    position_companion_panel(&panel, "right");

    let panel_clone = panel.clone();
    panel.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = panel_clone.hide();
        }
    });

    write_startup_probe_marker(app, "first_panel_created");
    Ok(panel)
}

fn position_companion_panel<R: Runtime>(panel: &WebviewWindow<R>, position: &str) {
    if let Ok(Some(monitor)) = panel.primary_monitor() {
        let size = monitor.size();
        let scale = monitor.scale_factor();
        let lw = size.width as f64 / scale;
        let lh = size.height as f64 / scale;
        let x = if position == "left" {
            12.0
        } else {
            lw - 360.0 - 12.0
        };
        let y = lh - 580.0 - 48.0 - 12.0;
        let _ = panel.set_position(tauri::LogicalPosition::new(x, y));
    }
}

fn ensure_onboarding_window<R: Runtime>(app: &AppHandle<R>) -> Result<WebviewWindow<R>, String> {
    if let Some(window) = app.get_webview_window("onboarding") {
        return Ok(window);
    }

    let onboarding_builder = WebviewWindowBuilder::new(
        app,
        "onboarding",
        WebviewUrl::App("index.html?window=onboarding".into()),
    )
    .title("Welcome to DanteClicky")
    .inner_size(880.0, 640.0)
    .min_inner_size(860.0, 600.0)
    .decorations(false);
    #[cfg(not(target_os = "macos"))]
    let onboarding_builder = onboarding_builder.transparent(true);

    let onboarding = onboarding_builder
        .resizable(false)
        .visible(false)
        .skip_taskbar(false)
        .center()
        .build()
        .map_err(|e| e.to_string())?;

    let onb_clone = onboarding.clone();
    onboarding.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = onb_clone.hide();
        }
    });

    Ok(onboarding)
}

fn is_first_run<R: Runtime>(app: &AppHandle<R>) -> bool {
    match app.path().app_data_dir() {
        Ok(dir) => !dir.join(".onboarding_done").exists(),
        Err(_) => false,
    }
}

fn mark_onboarding_done<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(".onboarding_done"), b"1").map_err(|e| e.to_string())
}

pub(crate) fn toggle_primary_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(onboarding) = app.get_webview_window("onboarding") {
        if onboarding.is_visible().unwrap_or(false) {
            let _ = onboarding.hide();
            return;
        }
    }

    if is_first_run(app) {
        match ensure_onboarding_window(app) {
            Ok(window) => {
                let _ = window.show();
                let _ = window.set_focus();
            }
            Err(e) => eprintln!("[onboarding] failed to create window: {e}"),
        }
        return;
    }

    match ensure_companion_panel(app) {
        Ok(window) => {
            if window.is_visible().unwrap_or(false) {
                let _ = window.hide();
            } else {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
        Err(e) => eprintln!("[companion] failed to create panel: {e}"),
    }
}

/// Returns true if this is the first run (marker file does not exist).
#[tauri::command]
fn check_first_run(app: tauri::AppHandle) -> bool {
    is_first_run(&app)
}

/// Writes marker file, hides onboarding window, shows companion panel.
#[tauri::command]
fn complete_onboarding(app: tauri::AppHandle) -> Result<(), String> {
    mark_onboarding_done(&app)?;
    if let Some(w) = app.get_webview_window("onboarding") {
        let _ = w.hide();
    }
    let w = ensure_companion_panel(&app)?;
    let _ = w.show();
    let _ = w.set_focus();
    Ok(())
}

/// Shows the companion panel — called as fallback if complete_onboarding fails.
#[tauri::command]
fn show_companion_panel(app: tauri::AppHandle) -> Result<(), String> {
    let w = ensure_companion_panel(&app)?;
    let _ = w.show();
    let _ = w.set_focus();
    Ok(())
}

#[tauri::command]
fn set_companion_opacity(app: tauri::AppHandle, opacity: f64) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    if let Some(w) = app.get_webview_window("companion-panel") {
        if let Ok(hwnd) = w.hwnd() {
            extern "system" {
                fn SetLayeredWindowAttributes(
                    hwnd: *mut std::ffi::c_void,
                    cr_key: u32,
                    b_alpha: u8,
                    dw_flags: u32,
                ) -> i32;
                fn GetWindowLongPtrW(hwnd: *mut std::ffi::c_void, n_index: i32) -> isize;
                fn SetWindowLongPtrW(
                    hwnd: *mut std::ffi::c_void,
                    n_index: i32,
                    dw_new_long: isize,
                ) -> isize;
            }
            const GWL_EXSTYLE: i32 = -20;
            const WS_EX_LAYERED: isize = 0x0008_0000;
            const LWA_ALPHA: u32 = 0x0000_0002;
            unsafe {
                let ex_style = GetWindowLongPtrW(hwnd.0, GWL_EXSTYLE);
                SetWindowLongPtrW(hwnd.0, GWL_EXSTYLE, ex_style | WS_EX_LAYERED);
                let alpha = (opacity.clamp(0.3, 1.0) * 255.0) as u8;
                SetLayeredWindowAttributes(hwnd.0, 0, alpha, LWA_ALPHA);
            }
        }
    }
    Ok(())
}

#[tauri::command]
fn set_companion_panel_position(app: tauri::AppHandle, position: String) -> Result<(), String> {
    let panel = ensure_companion_panel(&app)?;
    position_companion_panel(&panel, &position);
    Ok(())
}

// ── Memory Digest commands (Dim 35) ──────────────────────────────────────────

#[tauri::command]
fn get_turns_to_consolidate(
    since_turn_id: i64,
    limit: usize,
    state: tauri::State<'_, Arc<session::SessionDb>>,
) -> Result<Vec<session::TurnRow>, String> {
    state
        .get_turns_to_consolidate(since_turn_id, limit)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_last_consolidated_turn_id(
    state: tauri::State<'_, Arc<session::SessionDb>>,
) -> Result<i64, String> {
    state
        .get_last_consolidated_turn_id()
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn update_consolidation_state(
    last_turn_id: i64,
    state: tauri::State<'_, Arc<session::SessionDb>>,
) -> Result<(), String> {
    state
        .update_consolidation_state(last_turn_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn save_digest_facts(
    facts: Vec<session::DigestFact>,
    state: tauri::State<'_, Arc<session::SessionDb>>,
) -> Result<(), String> {
    state.save_digest_facts(&facts).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_digest_facts(
    limit: i64,
    state: tauri::State<'_, Arc<session::SessionDb>>,
) -> Result<Vec<session::DigestFact>, String> {
    state.get_digest_facts(limit).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_digest_fact(
    id: i64,
    state: tauri::State<'_, Arc<session::SessionDb>>,
) -> Result<(), String> {
    state.delete_digest_fact(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn clear_digest(state: tauri::State<'_, Arc<session::SessionDb>>) -> Result<(), String> {
    state.clear_digest().map_err(|e| e.to_string())
}

#[tauri::command]
fn get_last_consolidation_time(
    state: tauri::State<'_, Arc<session::SessionDb>>,
) -> Result<Option<String>, String> {
    state
        .get_last_consolidation_time()
        .map_err(|e| e.to_string())
}

/// Return the title of the current foreground window (Win32).
/// Falls back to empty string on any error.
#[tauri::command]
fn get_active_window_title() -> String {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW};
        unsafe {
            let hwnd: HWND = GetForegroundWindow();
            if hwnd.0.is_null() {
                return String::new();
            }
            let mut buf = [0u16; 512];
            let len = GetWindowTextW(hwnd, &mut buf);
            if len <= 0 {
                return String::new();
            }
            String::from_utf16_lossy(&buf[..len as usize])
        }
    }
    #[cfg(not(target_os = "windows"))]
    String::new()
}

// ── App entry point ───────────────────────────────────────────────────────────

fn write_startup_probe<R: Runtime>(app: &AppHandle<R>, elapsed: Duration) {
    write_startup_probe_json(
        app,
        serde_json::json!({
            "marker": "native_ready",
            "ready_elapsed_ms": elapsed.as_millis(),
        }),
    );
}

fn write_startup_probe_marker<R: Runtime>(app: &AppHandle<R>, marker: &str) {
    write_startup_probe_json(
        app,
        serde_json::json!({
            "marker": marker,
        }),
    );
}

fn write_startup_probe_json<R: Runtime>(app: &AppHandle<R>, mut payload: serde_json::Value) {
    if std::env::var_os("DANTE_STARTUP_PROBE").is_none() {
        return;
    }

    let probe_path = if let Some(path) = std::env::var_os("DANTE_STARTUP_PROBE_PATH") {
        std::path::PathBuf::from(path)
    } else {
        let Ok(dir) = app.path().app_local_data_dir() else {
            return;
        };
        dir.join("startup-probe.jsonl")
    };

    let Some(probe_dir) = probe_path.parent() else {
        return;
    };
    if std::fs::create_dir_all(probe_dir).is_err() {
        return;
    }

    let unix_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    if let Some(object) = payload.as_object_mut() {
        object.insert("pid".into(), serde_json::json!(std::process::id()));
        object.insert("unix_ms".into(), serde_json::json!(unix_ms));
    }
    let line = payload.to_string();

    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(probe_path)
    {
        let _ = writeln!(file, "{line}");
    }
}

/// Returns true when the process was started with `--headless` or `DANTE_HEADLESS=1`.
/// In headless mode, no windows are created — only the tray icon, hotkeys,
/// MCP server, and WS bridge start. Useful for CI smoke tests and agent pipelines.
fn is_headless_mode() -> bool {
    if std::env::var_os("DANTE_HEADLESS").is_some() {
        return true;
    }
    std::env::args().any(|a| a == "--headless" || a == "--no-gui")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let startup_started = Instant::now();
    let headless = is_headless_mode();
    if headless {
        log::info!("[startup] headless mode — windows suppressed");
    }
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_log::Builder::new()
                .max_file_size(1_000_000)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepSome(5))
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("dante-clicky.log".to_string()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                ])
                .build(),
        )
        .manage(Mutex::new(audio::AudioState::new()))
        .manage(Mutex::new(stt::SttState::new()))
        .manage(Mutex::new(moondream::MoondreamState::new()))
        .manage(keystore::KeyStore::new())
        .manage(video::VideoState::default())
        .manage(wake_word::WakeWordState::default())
        .manage(event_bus::EventBus::default())
        .manage(clipboard_guard::ClipboardHistory::default())
        .manage(workflow_recorder::WorkflowState::default())
        .manage(screenpipe_bridge::ScreenpipeSubscriptionState::default())
        .manage(profiler::HeapMonitorState::default())
        .manage(profiler::MemoryGuardState::default())
        .manage(profiler::GpuMonitorState::default())
        .invoke_handler(tauri::generate_handler![
            save_turn,
            search_history,
            get_recent_turns,
            get_monitors,
            capture_screens,
            check_for_update,
            capture::capture_primary,
            capture::capture_monitor,
            capture::list_monitors,
            capture::capture_secondary_screen,
            start_audio,
            stop_audio,
            show_overlay,
            hide_overlay,
            cursor::animate_cursor_to,
            input::computer_use_click,
            input::computer_use_double_click,
            input::computer_use_triple_click,
            input::computer_use_right_click,
            input::computer_use_middle_click,
            input::computer_use_type,
            input::computer_use_scroll,
            input::computer_use_move,
            input::computer_use_drag,
            input::computer_use_keypress,
            stt::get_stt_mode,
            stt::set_stt_mode,
            stt::get_local_model_status,
            download_whisper_model,
            transcribe_local,
            chat_proxy::stream_claude,
            chat_proxy::stream_openai_compat,
            chat_proxy::send_openai_response,
            chat_proxy::get_assemblyai_token,
            chat_proxy::elevenlabs_tts,
            chat_proxy::elevenlabs_list_voices,
            chat_proxy::elevenlabs_add_voice,
            hotkey::set_hotkey,
            hotkey::drain_pending_hotkey_events,
            hardware::get_hardware_profile,
            ws_server::get_ws_connection_count,
            tts_local::download_kokoro_model,
            tts_local::kokoro_tts,
            tts_local::get_kokoro_status,
            moondream::download_moondream_model,
            moondream::get_moondream_status,
            moondream::load_moondream_model,
            moondream::moondream_caption,
            moondream::moondream_vqa,
            moondream::moondream_point_query,
            moondream::moondream_verify_action,
            ocr::ocr_screenshot,
            accessibility::get_ui_tree,
            keystore::set_api_key,
            keystore::clear_api_key,
            keystore::get_api_key_status,
            keystore::get_api_key_statuses,
            keystore::session_clear_keys,
            session::db_new_session,
            session::db_save_message,
            session::db_get_history,
            session::db_search_history,
            session::save_embedding,
            session::search_semantic,
            session::get_unembedded_turns,
            session::count_unembedded_turns,
            session::save_conversation_summary,
            session::get_latest_conversation_summary,
            session::get_session_meta,
            session::upsert_session_meta,
            embedding::generate_embedding,
            session::db_clear_turns,
            session::db_turn_count,
            audio::set_vad_enabled,
            overlay::set_overlay_stealth,
            platform::get_platform_capabilities,
            check_first_run,
            complete_onboarding,
            show_companion_panel,
            set_companion_opacity,
            set_companion_panel_position,
            rate_turn,
            get_top_rated_turns,
            session::record_preference_signal,
            session::get_preference_profile,
            session::record_preference_event,
            session::get_preference_events,
            session::update_preference_trait,
            session::delete_preference_trait,
            session::upsert_preference_fact,
            session::get_active_preference_facts,
            session::set_preference_fact_status,
            session::clear_preference_learning,
            session::rebuild_preference_profile,
            session::purge_all_memory,
            session::export_memory_json,
            session::import_memory_json,
            session::prune_old_turns,
            session::delete_turn,
            session::db_key_status,
            session::rekey_database,
            session::enforce_retention_policy,
            session::get_oldest_turn_date,
            get_turns_to_consolidate,
            get_last_consolidated_turn_id,
            update_consolidation_state,
            save_digest_facts,
            get_digest_facts,
            delete_digest_fact,
            clear_digest,
            get_last_consolidation_time,
            chat_proxy::extract_facts_oneshot,
            chat_proxy::scan_prompt_for_injection,
            chat_proxy::compress_context,
            profiler::heap_stats,
            profiler::gpu_stats,
            profiler::start_heap_monitor,
            profiler::stop_heap_monitor,
            profiler::start_memory_guard,
            profiler::stop_memory_guard,
            profiler::start_gpu_monitor,
            profiler::stop_gpu_monitor,
            profiler::is_on_battery,
            profiler::battery_status,
            security::sanitize_screen_text,
            security::scan_and_redact_pii,
            security::validate_url_security,
            event_bus::bus_publish,
            event_bus::bus_recent,
            shell_hooks::install_shell_hooks,
            shell_hooks::get_shell_hook_paths,
            clipboard_guard::read_clipboard_for_ai,
            clipboard_guard::get_clipboard_history,
            clipboard_guard::write_clipboard,
            context_awareness::get_window_context,
            context_awareness::get_calendar_context,
            context_awareness::get_calendar_appointments,
            context_awareness::get_recent_files,
            context_awareness::send_os_notification,
            task_integrations::get_github_issues,
            task_integrations::get_github_issues_summary,
            task_integrations::get_linear_issues,
            task_integrations::get_notion_tasks,
            screenpipe_bridge::screenpipe_status,
            screenpipe_bridge::screenpipe_search,
            screenpipe_bridge::screenpipe_recent,
            screenpipe_bridge::screenpipe_subscribe,
            screenpipe_bridge::screenpipe_unsubscribe,
            workflow_recorder::start_recording,
            workflow_recorder::record_step,
            workflow_recorder::stop_recording,
            workflow_recorder::list_workflows,
            workflow_recorder::load_workflow,
            workflow_recorder::replay_workflow,
            wake_word::start_wake_word_monitor,
            wake_word::stop_wake_word_monitor,
            wake_word::get_wake_word_status,
            // Ambient / always-on mode
            get_active_window_title,
            session::save_ambient_snapshot,
            session::get_ambient_context,
            session::get_recent_ambient_snapshots,
            session::prune_ambient_snapshots,
            session::count_ambient_today,
            observability::observability_append,
            observability::observability_snapshot,
            observability::observability_clear,
            observability::observability_prune,
            tray::set_tray_tooltip,
            // Dim 16 — video / temporal context
            video_start,
            video_stop,
            video_status,
            video_pause,
            video_resume,
            link_ambient_to_video,
            video_seek,
            video_search,
            video_timeline,
            video_extract_frame,
            video_recent_keyframes,
            video_set_privacy,
            video_prune_old,
            video_capture_now,
            session::prune_video,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            observability::install_panic_hook(handle.clone());
            log::info!("observability diagnostics initialized");

            // ── Video subsystem privacy snapshot (live-readable by capture loop)
            app.handle().manage(video::VideoPrivacyState::default());

            tray::setup(&handle)?;
            if let Ok(dir) = handle.path().app_local_data_dir() {
                if let Some(store) = handle.try_state::<keystore::KeyStore>() {
                    store.configure_storage(dir.join("secrets"));
                }
            }
            write_startup_probe_marker(&handle, "tray_ready");
            hotkey::setup(&handle)?;
            write_startup_probe_marker(&handle, "hotkey_registered");

            // ── Dev-mode only: auto-open companion panel so DevTools is reachable
            // without needing a tray click. Skipped in headless mode.
            #[cfg(debug_assertions)]
            if !headless {
                match crate::ensure_companion_panel(&handle) {
                    Ok(panel) => {
                        log::info!("[dev] companion panel auto-opened on startup");
                        let _ = panel.show();
                        let _ = panel.set_focus();
                    }
                    Err(e) => log::error!("[dev] failed to auto-open companion panel: {e}"),
                }
            }

            let ready_elapsed = startup_started.elapsed();
            log::info!("startup.ready elapsed_ms={}", ready_elapsed.as_millis());
            write_startup_probe_marker(&handle, "native_ready");
            write_startup_probe(&handle, ready_elapsed);

            // ── Session memory database ───────────────────────────────────────
            // Always managed — either the real file DB or an in-memory fallback.
            // This guarantees State<Arc<SessionDb>> is never called before manage().
            let db = match session::SessionDb::open(&handle) {
                Ok(db) => {
                    log::info!("session database initialized");
                    db
                }
                Err(e) => {
                    log::error!("session database unavailable, using in-memory fallback: {e}");
                    session::SessionDb::open_memory()
                        .expect("in-memory SessionDb must always succeed")
                }
            };
            handle.manage(Arc::new(db));

            let audio_prewarm_handle = handle.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                if let Ok(mut audio_state) = audio_prewarm_handle
                    .state::<Mutex<audio::AudioState>>()
                    .lock()
                {
                    audio_state.prewarm_input_device();
                }
            });

            // ── DanteAgents WebSocket bridge (Phase 9) ────────────────────────
            let handle2 = handle.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                ws_server::start(handle2).await;
            });

            // ── MCP server (Phase P1-B) ───────────────────────────────────────
            let handle3 = handle.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                mcp_server::start(handle3).await;
            });

            // ── Whisper auto-load: if the model was downloaded in a previous
            // session, load it immediately so transcribe_local works on first use.
            if let Ok(app_data_dir) = handle.path().app_data_dir() {
                for lang_code in &[Some("en"), None::<&str>] {
                    let dir_name = stt::whisper_model_directory_name(*lang_code);
                    let model_dir = app_data_dir.join(dir_name);
                    let required = ["model.safetensors", "config.json", "tokenizer.json"];
                    if required.iter().all(|f| model_dir.join(f).exists()) {
                        let dir_str = model_dir.to_string_lossy().to_string();
                        if let Ok(mut s) = handle.state::<Mutex<stt::SttState>>().lock() {
                            if !s.is_ctx_loaded() {
                                match s.load_model(&dir_str, *lang_code) {
                                    Ok(()) => log::info!("[startup] auto-loaded whisper model from {}", dir_str),
                                    Err(e) => log::warn!("[startup] whisper auto-load failed: {}", e),
                                }
                            }
                        }
                        break;
                    }
                }
            }

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
