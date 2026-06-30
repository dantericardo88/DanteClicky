use base64::{engine::general_purpose::STANDARD, Engine};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use std::sync::{
    atomic::{AtomicBool, AtomicU32, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, Emitter, Runtime};

use crate::vad::{AutoGain, EnhancedVad, VadDecision};

// ── PCM accumulator ───────────────────────────────────────────────────────────

pub struct PcmAccumulator {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
    pub active: bool,
}

impl PcmAccumulator {
    pub fn new() -> Self {
        Self {
            samples: Vec::new(),
            sample_rate: 16000,
            active: false,
        }
    }

    pub fn clear(&mut self, sample_rate: u32) {
        self.samples.clear();
        self.sample_rate = sample_rate;
        self.active = true;
    }

    pub fn stop(&mut self) {
        self.active = false;
    }
}

// ── AudioState ────────────────────────────────────────────────────────────────

pub struct AudioState {
    pub stream: Option<cpal::Stream>,
    pub accumulator: Arc<Mutex<PcmAccumulator>>,
    /// Shared flag readable from audio callbacks without holding the AudioState lock.
    pub vad_enabled: Arc<AtomicBool>,
    // Pre-cached device info to reduce first-hotkey WASAPI init latency
    cached_device: Option<cpal::Device>,
    cached_config: Option<cpal::SupportedStreamConfig>,
}

impl AudioState {
    pub fn new() -> Self {
        Self {
            stream: None,
            accumulator: Arc::new(Mutex::new(PcmAccumulator::new())),
            vad_enabled: Arc::new(AtomicBool::new(false)),
            cached_device: None,
            cached_config: None,
        }
    }

    pub fn prewarm_input_device(&mut self) {
        if self.cached_device.is_some() && self.cached_config.is_some() {
            return;
        }
        let Some(device) = cpal::default_host().default_input_device() else {
            return;
        };
        let Ok(config) = device.default_input_config() else {
            return;
        };
        self.cached_device = Some(device);
        self.cached_config = Some(config);
    }

    /// Return the pre-warmed device and config, or try to acquire them fresh.
    pub fn acquire_device(&mut self) -> Result<(cpal::Device, cpal::SupportedStreamConfig), String> {
        // Re-use cached values from construction if still present
        if let (Some(dev), Some(cfg)) = (self.cached_device.take(), self.cached_config.take()) {
            return Ok((dev, cfg));
        }
        let dev = cpal::default_host()
            .default_input_device()
            .ok_or("No audio input device found")?;
        let cfg = dev
            .default_input_config()
            .map_err(|e| format!("No input config: {e}"))?;
        Ok((dev, cfg))
    }
}

// cpal::Stream is Send on Windows (WASAPI), so Mutex<AudioState> is safe to manage
unsafe impl Send for AudioState {}

// ── Public API ────────────────────────────────────────────────────────────────

/// Start recording using a pre-acquired device + config (fast path via AudioState cache).
pub fn start_with_device<R: Runtime>(
    app: AppHandle<R>,
    device: cpal::Device,
    default_config: cpal::SupportedStreamConfig,
    acc: Arc<Mutex<PcmAccumulator>>,
    vad_enabled: Arc<AtomicBool>,
) -> Result<cpal::Stream, String> {
    let sample_rate = default_config.sample_rate().0;
    let channels = default_config.channels();
    let format = default_config.sample_format();

    let config: StreamConfig = default_config.into();

    // Set actual device sample rate on the accumulator now that we know it
    acc.lock().unwrap().clear(sample_rate);

    // Shared VAD gate — maintains state across audio callback invocations
    let vad_gate = Arc::new(Mutex::new(EnhancedVad::new()));
    // AGC envelope follower — applied to cloud-streamed PCM only (frontend
    // accumulator stores untouched audio so local Whisper sees the original).
    let agc = Arc::new(Mutex::new(AutoGain::new()));

    let stream = match format {
        SampleFormat::F32 => {
            build_stream_f32(&device, &config, app, sample_rate, channels, Arc::clone(&acc), Arc::clone(&vad_gate), Arc::clone(&agc), Arc::clone(&vad_enabled))?
        }
        SampleFormat::I16 => {
            build_stream_i16(&device, &config, app, sample_rate, channels, Arc::clone(&acc), Arc::clone(&vad_gate), Arc::clone(&agc), Arc::clone(&vad_enabled))?
        }
        SampleFormat::U16 => {
            build_stream_u16(&device, &config, app, sample_rate, channels, Arc::clone(&acc), Arc::clone(&vad_gate), Arc::clone(&agc), Arc::clone(&vad_enabled))?
        }
        _ => return Err(format!("Unsupported sample format: {format:?}")),
    };

    stream
        .play()
        .map_err(|e| format!("Failed to start stream: {e}"))?;
    Ok(stream)
}

// ── set_vad_enabled command ───────────────────────────────────────────────────

#[tauri::command]
pub fn set_vad_enabled(state: tauri::State<'_, Mutex<AudioState>>, enabled: bool) {
    if let Ok(s) = state.lock() {
        s.vad_enabled.store(enabled, Ordering::Relaxed);
    }
}

// ── Audio level meter ─────────────────────────────────────────────────────────

static LEVEL_TICK: AtomicU32 = AtomicU32::new(0);

fn emit_audio_level<R: Runtime>(app: &AppHandle<R>, mono_f32: &[f32]) {
    let tick = LEVEL_TICK.fetch_add(1, Ordering::Relaxed);
    if tick % 4 == 0 {
        if mono_f32.is_empty() {
            return;
        }
        let rms = (mono_f32.iter().map(|s| s * s).sum::<f32>() / mono_f32.len() as f32).sqrt();
        let level = (rms / 0.1_f32).min(1.0); // normalize 0–1
        app.emit("audio-level", level).ok();
    }
}

/// Runs the VAD gate on a mono F32 frame.
/// Returns true if PCM should be forwarded to the STT stream.
/// When VAD detects end-of-speech, emits "vad-end-of-speech" so the
/// frontend can auto-stop recording without waiting for the hotkey release.
fn run_vad<R: Runtime>(
    app: &AppHandle<R>,
    mono_f32: &[f32],
    vad_gate: &Arc<Mutex<EnhancedVad>>,
    vad_enabled: &Arc<AtomicBool>,
) -> bool {
    if !vad_enabled.load(Ordering::Relaxed) {
        return true; // VAD disabled → pass everything through
    }
    let decision = vad_gate.lock().unwrap().process(mono_f32);
    if matches!(decision, VadDecision::EndOfSpeech) {
        app.emit("vad-end-of-speech", ()).ok();
    }
    matches!(decision, VadDecision::Speech | VadDecision::EndOfSpeech)
}

/// Apply gain normalization to mono F32 samples in place. Used only on the
/// PCM stream forwarded to AssemblyAI — the local accumulator keeps the raw
/// signal so candle Whisper sees what the mic actually captured.
fn apply_agc(agc: &Arc<Mutex<AutoGain>>, samples: &mut [f32]) {
    if let Ok(mut g) = agc.lock() {
        g.apply(samples);
    }
}

// ── PCM emit helper ───────────────────────────────────────────────────────────

fn emit_pcm<R: Runtime>(app: &AppHandle<R>, mono: &[i16], sample_rate: u32) {
    let bytes: Vec<u8> = mono.iter().flat_map(|s| s.to_le_bytes()).collect();
    let encoded = STANDARD.encode(&bytes);
    // Payload: [base64_pcm, sample_rate]
    app.emit("audio-chunk", (encoded, sample_rate)).ok();
}

fn push_f32_to_acc(acc: &Arc<Mutex<PcmAccumulator>>, f32_samples: &[f32]) {
    if let Ok(mut a) = acc.lock() {
        if a.active {
            a.samples.extend_from_slice(f32_samples);
        }
    }
}

// ── Stream builders ───────────────────────────────────────────────────────────

fn build_stream_f32<R: Runtime>(
    device: &cpal::Device,
    config: &StreamConfig,
    app: AppHandle<R>,
    sample_rate: u32,
    channels: u16,
    acc: Arc<Mutex<PcmAccumulator>>,
    vad_gate: Arc<Mutex<EnhancedVad>>,
    agc: Arc<Mutex<AutoGain>>,
    vad_enabled: Arc<AtomicBool>,
) -> Result<cpal::Stream, String> {
    let app_err = app.clone();
    device
        .build_input_stream(
            config,
            move |data: &[f32], _| {
                let mono_f32: Vec<f32> = if channels == 2 {
                    data.chunks_exact(2)
                        .map(|c| (c[0] + c[1]) * 0.5)
                        .collect()
                } else {
                    data.to_vec()
                };
                let should_emit = run_vad(&app, &mono_f32, &vad_gate, &vad_enabled);
                if should_emit {
                    let mut amplified = mono_f32.clone();
                    apply_agc(&agc, &mut amplified);
                    let mono_i16: Vec<i16> = amplified.iter().map(|&s| f32_to_i16(s)).collect();
                    emit_pcm(&app, &mono_i16, sample_rate);
                }
                push_f32_to_acc(&acc, &mono_f32);
                emit_audio_level(&app, &mono_f32);
            },
            move |e| {
                let msg = e.to_string();
                log::error!("[audio] F32 stream error: {msg}");
                app_err.emit("mic-stream-error", msg).ok();
            },
            None,
        )
        .map_err(|e| e.to_string())
}

fn build_stream_i16<R: Runtime>(
    device: &cpal::Device,
    config: &StreamConfig,
    app: AppHandle<R>,
    sample_rate: u32,
    channels: u16,
    acc: Arc<Mutex<PcmAccumulator>>,
    vad_gate: Arc<Mutex<EnhancedVad>>,
    agc: Arc<Mutex<AutoGain>>,
    vad_enabled: Arc<AtomicBool>,
) -> Result<cpal::Stream, String> {
    let app_err = app.clone();
    device
        .build_input_stream(
            config,
            move |data: &[i16], _| {
                let mono: Vec<i16> = if channels == 2 {
                    data.chunks_exact(2)
                        .map(|c| ((c[0] as i32 + c[1] as i32) / 2) as i16)
                        .collect()
                } else {
                    data.to_vec()
                };
                // Convert i16 → f32 [-1, 1]
                let mono_f32: Vec<f32> = mono
                    .iter()
                    .map(|&s| s as f32 / i16::MAX as f32)
                    .collect();
                let should_emit = run_vad(&app, &mono_f32, &vad_gate, &vad_enabled);
                if should_emit {
                    let mut amplified = mono_f32.clone();
                    apply_agc(&agc, &mut amplified);
                    let amplified_i16: Vec<i16> =
                        amplified.iter().map(|&s| f32_to_i16(s)).collect();
                    emit_pcm(&app, &amplified_i16, sample_rate);
                }
                push_f32_to_acc(&acc, &mono_f32);
                emit_audio_level(&app, &mono_f32);
            },
            move |e| {
                let msg = e.to_string();
                log::error!("[audio] I16 stream error: {msg}");
                app_err.emit("mic-stream-error", msg).ok();
            },
            None,
        )
        .map_err(|e| e.to_string())
}

fn build_stream_u16<R: Runtime>(
    device: &cpal::Device,
    config: &StreamConfig,
    app: AppHandle<R>,
    sample_rate: u32,
    channels: u16,
    acc: Arc<Mutex<PcmAccumulator>>,
    vad_gate: Arc<Mutex<EnhancedVad>>,
    agc: Arc<Mutex<AutoGain>>,
    vad_enabled: Arc<AtomicBool>,
) -> Result<cpal::Stream, String> {
    let app_err = app.clone();
    device
        .build_input_stream(
            config,
            move |data: &[u16], _| {
                let mono: Vec<i16> = if channels == 2 {
                    data.chunks_exact(2)
                        .map(|c| u16_to_i16((c[0] as u32 + c[1] as u32) / 2))
                        .collect()
                } else {
                    data.iter().map(|&s| u16_to_i16(s as u32)).collect()
                };
                // Convert i16 → f32 [-1, 1]
                let mono_f32: Vec<f32> = mono
                    .iter()
                    .map(|&s| s as f32 / i16::MAX as f32)
                    .collect();
                let should_emit = run_vad(&app, &mono_f32, &vad_gate, &vad_enabled);
                if should_emit {
                    let mut amplified = mono_f32.clone();
                    apply_agc(&agc, &mut amplified);
                    let amplified_i16: Vec<i16> =
                        amplified.iter().map(|&s| f32_to_i16(s)).collect();
                    emit_pcm(&app, &amplified_i16, sample_rate);
                }
                push_f32_to_acc(&acc, &mono_f32);
                emit_audio_level(&app, &mono_f32);
            },
            move |e| {
                let msg = e.to_string();
                log::error!("[audio] U16 stream error: {msg}");
                app_err.emit("mic-stream-error", msg).ok();
            },
            None,
        )
        .map_err(|e| e.to_string())
}

// ── Sample format helpers ─────────────────────────────────────────────────────

#[inline]
fn f32_to_i16(s: f32) -> i16 {
    (s.clamp(-1.0, 1.0) * i16::MAX as f32) as i16
}

#[inline]
fn u16_to_i16(s: u32) -> i16 {
    (s as i32 - 32768) as i16
}
