use base64::{engine::general_purpose::STANDARD, Engine};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{SampleFormat, StreamConfig};
use std::sync::{
    atomic::{AtomicU32, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, Emitter, Runtime};

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
}

impl AudioState {
    pub fn new() -> Self {
        Self {
            stream: None,
            accumulator: Arc::new(Mutex::new(PcmAccumulator::new())),
        }
    }
}

// cpal::Stream is Send on Windows (WASAPI), so Mutex<AudioState> is safe to manage
unsafe impl Send for AudioState {}

// ── Public API ────────────────────────────────────────────────────────────────

pub fn start<R: Runtime>(
    app: AppHandle<R>,
    acc: Arc<Mutex<PcmAccumulator>>,
) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();
    let device = host
        .default_input_device()
        .ok_or("No audio input device found")?;

    let default_config = device
        .default_input_config()
        .map_err(|e| format!("No input config: {e}"))?;

    let sample_rate = default_config.sample_rate().0;
    let channels = default_config.channels();
    let format = default_config.sample_format();

    let config: StreamConfig = default_config.into();

    // Set actual device sample rate on the accumulator now that we know it
    acc.lock().unwrap().clear(sample_rate);

    let stream = match format {
        SampleFormat::F32 => {
            build_stream_f32(&device, &config, app, sample_rate, channels, Arc::clone(&acc))?
        }
        SampleFormat::I16 => {
            build_stream_i16(&device, &config, app, sample_rate, channels, Arc::clone(&acc))?
        }
        SampleFormat::U16 => {
            build_stream_u16(&device, &config, app, sample_rate, channels, Arc::clone(&acc))?
        }
        _ => return Err(format!("Unsupported sample format: {format:?}")),
    };

    stream
        .play()
        .map_err(|e| format!("Failed to start stream: {e}"))?;
    Ok(stream)
}

// ── Voice Activity Detection ──────────────────────────────────────────────────

const SILENCE_THRESHOLD: f32 = 0.008; // RMS threshold — tune as needed

fn is_silence(samples: &[f32]) -> bool {
    if samples.is_empty() {
        return true;
    }
    let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
    rms < SILENCE_THRESHOLD
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
) -> Result<cpal::Stream, String> {
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
                // Only emit to STT when audio is not silence
                if !is_silence(&mono_f32) {
                    let mono_i16: Vec<i16> = mono_f32.iter().map(|&s| f32_to_i16(s)).collect();
                    emit_pcm(&app, &mono_i16, sample_rate);
                }
                // Always accumulate for local Whisper (captures speech + silence)
                push_f32_to_acc(&acc, &mono_f32);
                // Emit audio level for UI meter
                emit_audio_level(&app, &mono_f32);
            },
            |e| eprintln!("[audio] F32 stream error: {e}"),
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
) -> Result<cpal::Stream, String> {
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
                // Only emit to STT when audio is not silence
                if !is_silence(&mono_f32) {
                    emit_pcm(&app, &mono, sample_rate);
                }
                // Always accumulate for local Whisper (captures speech + silence)
                push_f32_to_acc(&acc, &mono_f32);
                // Emit audio level for UI meter
                emit_audio_level(&app, &mono_f32);
            },
            |e| eprintln!("[audio] I16 stream error: {e}"),
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
) -> Result<cpal::Stream, String> {
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
                // Only emit to STT when audio is not silence
                if !is_silence(&mono_f32) {
                    emit_pcm(&app, &mono, sample_rate);
                }
                // Always accumulate for local Whisper (captures speech + silence)
                push_f32_to_acc(&acc, &mono_f32);
                // Emit audio level for UI meter
                emit_audio_level(&app, &mono_f32);
            },
            |e| eprintln!("[audio] U16 stream error: {e}"),
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
