// stt.rs -- Dual-backend STT manager
// Backend A: AssemblyAI (cloud, real-time, token from Worker)
// Backend B: whisper-rs (local, offline, chunk-based) — requires `local-stt` feature

use std::sync::Mutex;

#[cfg(feature = "local-stt")]
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum SttMode {
    Cloud, // AssemblyAI WebSocket (default)
    Local, // whisper-rs local inference
}

pub struct SttState {
    pub mode: SttMode,
    pub local_model_path: Option<String>,
    #[cfg(feature = "local-stt")]
    ctx: Option<WhisperContext>,
}

// WhisperContext holds raw C pointers but is used single-threadedly within Tauri's Mutex.
unsafe impl Send for SttState {}

impl SttState {
    pub fn new() -> Self {
        Self {
            mode: SttMode::Cloud,
            local_model_path: None,
            #[cfg(feature = "local-stt")]
            ctx: None,
        }
    }

    /// Load (or reload) a ggml model from disk. Caches the context for reuse.
    pub fn load_model(&mut self, path: &str) -> Result<(), String> {
        #[cfg(feature = "local-stt")]
        {
            let ctx =
                WhisperContext::new_with_params(path, WhisperContextParameters::default())
                    .map_err(|e| format!("Failed to load whisper model: {e}"))?;
            self.ctx = Some(ctx);
            self.local_model_path = Some(path.to_owned());
            Ok(())
        }
        #[cfg(not(feature = "local-stt"))]
        {
            let _ = path;
            Err("Local STT not compiled into this build. Rebuild with --features local-stt.".into())
        }
    }

    /// Run Whisper inference on f32 mono PCM at `from_rate` Hz.
    pub fn transcribe(&self, samples: &[f32], from_rate: u32) -> Result<String, String> {
        #[cfg(feature = "local-stt")]
        {
            let ctx = self
                .ctx
                .as_ref()
                .ok_or("No model loaded. Download a Whisper model first.")?;

            let samples_16k = resample(samples, from_rate, 16000);

            let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
            params.set_language(Some("en"));
            params.set_print_special(false);
            params.set_print_progress(false);
            params.set_print_realtime(false);
            params.set_print_timestamps(false);
            params.set_n_threads(4);

            let mut state = ctx.create_state().map_err(|e| e.to_string())?;
            state.full(params, &samples_16k).map_err(|e| e.to_string())?;

            let n = state.full_n_segments().map_err(|e| e.to_string())?;
            let mut text = String::new();
            for i in 0..n {
                if let Ok(s) = state.full_get_segment_text(i) {
                    text.push_str(&s);
                }
            }
            Ok(text.trim().to_string())
        }
        #[cfg(not(feature = "local-stt"))]
        {
            let _ = (samples, from_rate);
            Err("Local STT not compiled into this build. Rebuild with --features local-stt.".into())
        }
    }

    /// Returns true if a context is loaded and ready for inference.
    pub fn is_ctx_loaded(&self) -> bool {
        #[cfg(feature = "local-stt")]
        {
            self.ctx.is_some()
        }
        #[cfg(not(feature = "local-stt"))]
        {
            false
        }
    }
}

// ── Linear resampler ──────────────────────────────────────────────────────────

#[cfg(feature = "local-stt")]
fn resample(input: &[f32], from_rate: u32, to_rate: u32) -> Vec<f32> {
    if from_rate == to_rate {
        return input.to_vec();
    }
    let ratio = to_rate as f64 / from_rate as f64;
    let out_len = (input.len() as f64 * ratio) as usize;
    (0..out_len)
        .map(|i| {
            let src = i as f64 / ratio;
            let idx = src as usize;
            let frac = (src - idx as f64) as f32;
            let a = input.get(idx).copied().unwrap_or(0.0);
            let b = input.get(idx + 1).copied().unwrap_or(0.0);
            a + (b - a) * frac
        })
        .collect()
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Get current STT mode
#[tauri::command]
pub fn get_stt_mode(state: tauri::State<'_, Mutex<SttState>>) -> SttMode {
    state.lock().unwrap().mode.clone()
}

/// Set STT mode. Local mode is allowed even without a model loaded --
/// the transcription command will surface the error at inference time.
#[tauri::command]
pub fn set_stt_mode(
    mode: SttMode,
    state: tauri::State<'_, Mutex<SttState>>,
) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.mode = mode;
    Ok(())
}

/// Check if a local Whisper model is available and loaded.
#[tauri::command]
pub fn get_local_model_status(state: tauri::State<'_, Mutex<SttState>>) -> serde_json::Value {
    let s = state.lock().unwrap();
    serde_json::json!({
        "available": s.local_model_path.is_some(),
        "path": s.local_model_path,
        "mode": s.mode,
        "ctx_loaded": s.is_ctx_loaded(),
        "feature_enabled": cfg!(feature = "local-stt"),
    })
}
