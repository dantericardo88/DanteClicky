//! Local Whisper STT via candle-transformers (pure Rust, no cmake).
//!
//! Model files (from openai/whisper-tiny.en on HuggingFace):
//!   model.safetensors  ~150 MB
//!   config.json        ~1 KB
//!   tokenizer.json     ~2 MB

use candle_core::{DType, Device, IndexOp, Tensor};
use candle_nn::VarBuilder;
use candle_transformers::models::whisper as whisper_model;
use std::collections::HashMap;
use tokenizers::Tokenizer;

const SAMPLE_RATE: usize = 16_000;
const CHUNK_SAMPLES: usize = SAMPLE_RATE * 30; // 30-second chunks

// ── Mel filterbank (Slaney normalization, matching openai/whisper audio.py) ───
//
// openai/whisper calls librosa.filters.mel(sr=16000, n_fft=400, n_mels=80)
// which uses htk=False (Slaney linear+log mel scale) and norm='slaney'
// (bandwidth normalization).  These constants are from librosa source.

fn hz_to_mel(hz: f64) -> f64 {
    // Slaney linear/log mel scale (NOT HTK).
    // Constants from librosa source (filters.py): logstep = ln(6.4)/27
    const F_SP: f64 = 200.0 / 3.0;
    const MIN_LOG_HZ: f64 = 1_000.0;
    const MIN_LOG_MEL: f64 = 15.0; // = MIN_LOG_HZ / F_SP
    const LOGSTEP: f64 = 0.068_751_777_42; // ln(6.4) / 27
    if hz < MIN_LOG_HZ {
        hz / F_SP
    } else {
        MIN_LOG_MEL + (hz / MIN_LOG_HZ).ln() / LOGSTEP
    }
}

fn mel_to_hz(mel: f64) -> f64 {
    const F_SP: f64 = 200.0 / 3.0;
    const MIN_LOG_HZ: f64 = 1_000.0;
    const MIN_LOG_MEL: f64 = 15.0;
    const LOGSTEP: f64 = 0.068_751_777_42;
    if mel < MIN_LOG_MEL {
        mel * F_SP
    } else {
        MIN_LOG_HZ * ((mel - MIN_LOG_MEL) * LOGSTEP).exp()
    }
}

/// Compute Slaney-normalized mel filterbank matching librosa.filters.mel defaults.
/// Output: flat Vec<f32> in row-major order, shape [n_mels, n_fft/2+1].
pub fn mel_filter_bank(n_mels: usize, n_fft: usize, sr: f64) -> Vec<f32> {
    let n_freqs = n_fft / 2 + 1;
    let fmax = sr / 2.0;

    // n_mels+2 equally-spaced points in Slaney mel scale → Hz
    let mel_min = hz_to_mel(0.0);
    let mel_max = hz_to_mel(fmax);
    let mel_pts: Vec<f64> = (0..=(n_mels + 1))
        .map(|i| mel_min + (mel_max - mel_min) * i as f64 / (n_mels + 1) as f64)
        .collect();
    let hz_pts: Vec<f64> = mel_pts.iter().map(|&m| mel_to_hz(m)).collect();

    // FFT bin index for each Hz point (non-integer)
    let bin_pts: Vec<f64> = hz_pts.iter().map(|&f| f / sr * n_fft as f64).collect();

    let mut filters = vec![0.0f32; n_mels * n_freqs];
    for m in 0..n_mels {
        let lo = bin_pts[m];
        let center = bin_pts[m + 1];
        let hi = bin_pts[m + 2];
        // Slaney bandwidth normalisation: divides each filter by its Hz width
        let bw = hz_pts[m + 2] - hz_pts[m];
        let enorm = if bw > 1e-10 { 2.0 / bw } else { 1.0 };
        for k in 0..n_freqs {
            let kf = k as f64;
            let raw = if kf >= lo && kf <= center {
                (kf - lo) / (center - lo)
            } else if kf > center && kf <= hi {
                (hi - kf) / (hi - center)
            } else {
                0.0
            };
            filters[m * n_freqs + k] = (raw * enorm) as f32;
        }
    }
    filters
}

// ── Resampler ─────────────────────────────────────────────────────────────────

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

fn normalize_requested_language_code(language_code: Option<&str>) -> Option<String> {
    let raw_code = language_code?.trim().to_lowercase().replace('_', "-");
    if raw_code.is_empty() {
        return None;
    }
    if raw_code == "auto" {
        return Some("auto".to_string());
    }
    Some(raw_code.split('-').next().unwrap_or(&raw_code).to_string())
}

// ── WhisperCandle ─────────────────────────────────────────────────────────────

pub struct WhisperCandle {
    model: whisper_model::model::Whisper,
    config: whisper_model::Config,
    tokenizer: Tokenizer,
    mel_filters: Vec<f32>,
    eot_token: u32,
    sot_token: u32,
    no_timestamps_token: u32,
    transcribe_token: u32,
    language_tokens: HashMap<String, u32>,
}

// candle CPU tensors are Send
unsafe impl Send for WhisperCandle {}

impl WhisperCandle {
    pub fn load(model_dir: &std::path::Path) -> Result<Self, String> {
        let device = Device::Cpu;

        let config: whisper_model::Config = {
            let s = std::fs::read_to_string(model_dir.join("config.json"))
                .map_err(|e| format!("config.json: {e}"))?;
            serde_json::from_str(&s).map_err(|e| format!("parse config: {e}"))?
        };

        let vb = unsafe {
            VarBuilder::from_mmaped_safetensors(
                &[model_dir.join("model.safetensors")],
                DType::F32,
                &device,
            )
            .map_err(|e| format!("load weights: {e}"))?
        };

        let model = whisper_model::model::Whisper::load(&vb, config.clone())
            .map_err(|e| format!("build model: {e}"))?;

        let tokenizer = Tokenizer::from_file(model_dir.join("tokenizer.json"))
            .map_err(|e| format!("tokenizer: {e}"))?;

        let vocab = tokenizer.get_vocab(true);
        let find = |tok: &str| -> Result<u32, String> {
            vocab.get(tok).copied().ok_or_else(|| format!("token not found: {tok}"))
        };
        let sot_token = find("<|startoftranscript|>")?;
        let eot_token = find("<|endoftext|>")?;
        let transcribe_token = find("<|transcribe|>")?;
        let no_timestamps_token = find("<|notimestamps|>")?;
        let language_tokens = vocab
            .iter()
            .filter_map(|(token, id)| {
                let code = token.strip_prefix("<|")?.strip_suffix("|>")?;
                if code.len() == 2 && code.chars().all(|c| c.is_ascii_lowercase()) {
                    Some((code.to_string(), *id))
                } else {
                    None
                }
            })
            .collect::<HashMap<String, u32>>();

        // Prefer the byte-exact reference filterbank downloaded from candle's repo
        // (melfilters.bytes = 80×201 f32 LE = 64320 bytes). Fall back to the local
        // Slaney computation when the file is absent (e.g. first-run before download).
        let n_fft = 400usize;
        let mel_filters = {
            let filter_path = model_dir.join("melfilters.bytes");
            let n_values = config.num_mel_bins * (n_fft / 2 + 1); // 80 * 201 = 16080
            if filter_path.exists() {
                let bytes = std::fs::read(&filter_path)
                    .map_err(|e| format!("read melfilters.bytes: {e}"))?;
                if bytes.len() >= n_values * 4 {
                    bytes[..n_values * 4]
                        .chunks_exact(4)
                        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                        .collect::<Vec<f32>>()
                } else {
                    mel_filter_bank(config.num_mel_bins, n_fft, SAMPLE_RATE as f64)
                }
            } else {
                mel_filter_bank(config.num_mel_bins, n_fft, SAMPLE_RATE as f64)
            }
        };

        Ok(Self {
            model,
            config,
            tokenizer,
            mel_filters,
            eot_token,
            sot_token,
            no_timestamps_token,
            transcribe_token,
            language_tokens,
        })
    }

    pub fn transcribe(&mut self, samples: &[f32], sample_rate: u32, language_code: Option<&str>) -> Result<String, String> {
        let samples = if sample_rate != SAMPLE_RATE as u32 {
            resample(samples, sample_rate, SAMPLE_RATE as u32)
        } else {
            samples.to_vec()
        };
        if samples.is_empty() {
            return Ok(String::new());
        }

        let mut all_text = String::new();
        for (i, chunk) in samples.chunks(CHUNK_SAMPLES).enumerate() {
            let mut padded = chunk.to_vec();
            padded.resize(CHUNK_SAMPLES, 0.0f32);
            match self.transcribe_chunk(&padded, language_code) {
                Ok(text) => {
                    let trimmed = text.trim().to_string();
                    if !trimmed.is_empty() {
                        if i > 0 {
                            all_text.push(' ');
                        }
                        all_text.push_str(&trimmed);
                    }
                }
                Err(e) => eprintln!("[whisper] chunk {i} error: {e}"),
            }
        }
        Ok(all_text.trim().to_string())
    }

    fn resolve_language_token(
        &mut self,
        audio_features: &Tensor,
        language_code: Option<&str>,
    ) -> Result<Option<u32>, String> {
        if let Some(requested_code) = normalize_requested_language_code(language_code) {
            if requested_code != "auto" {
                if let Some(token) = self.language_tokens.get(&requested_code) {
                    return Ok(Some(*token));
                }
                if requested_code == "en" {
                    return Ok(None);
                }
                return Err(format!(
                    "The loaded local Whisper model does not support {requested_code}. Download the multilingual Whisper model in Settings > Voice."
                ));
            }
        }

        if self.language_tokens.is_empty() {
            return Ok(None);
        }

        let device = Device::Cpu;
        let sot_t = Tensor::from_vec(vec![self.sot_token], (1usize, 1usize), &device)
            .map_err(|e| e.to_string())?;
        let language_logits = self
            .model
            .decoder
            .forward(&sot_t, audio_features, true)
            .map_err(|e| e.to_string())?;
        let logits = language_logits
            .i((0, 0usize, ..))
            .map_err(|e| e.to_string())?
            .to_vec1::<f32>()
            .map_err(|e| e.to_string())?;

        let mut best_language: Option<(&str, u32, f32)> = None;
        for (code, token) in &self.language_tokens {
            let score = logits.get(*token as usize).copied().unwrap_or(f32::NEG_INFINITY);
            if best_language.map(|(_, _, best_score)| score > best_score).unwrap_or(true) {
                best_language = Some((code.as_str(), *token, score));
            }
        }

        Ok(best_language.map(|(_, token, _)| token))
    }

    fn transcribe_chunk(&mut self, samples: &[f32], language_code: Option<&str>) -> Result<String, String> {
        let device = Device::Cpu;

        // ── 1. Build mel spectrogram ──────────────────────────────────────────
        let mel = whisper_model::audio::pcm_to_mel(&self.config, samples, &self.mel_filters);
        let mel_len = mel.len();
        let n_frames = mel_len / self.config.num_mel_bins;
        let mel_tensor = Tensor::from_vec(
            mel,
            (1usize, self.config.num_mel_bins, n_frames),
            &device,
        )
        .map_err(|e| e.to_string())?;

        // ── 2. Encode audio ───────────────────────────────────────────────────
        let audio_features = self
            .model
            .encoder
            .forward(&mel_tensor, true)
            .map_err(|e| e.to_string())?;

        // ── 3. Greedy decode (incremental — O(n) not O(n²)) ──────────────────
        //
        // Pass the full SOT prefix on the first call to populate the KV cache,
        // then pass ONLY the newly predicted token on each subsequent step.
        // This avoids re-processing the growing sequence on every iteration.

        let language_token = self.resolve_language_token(&audio_features, language_code)?;
        let mut prefix_ids: Vec<u32> = vec![self.sot_token];
        if let Some(token) = language_token {
            prefix_ids.push(token);
        }
        prefix_ids.push(self.transcribe_token);
        prefix_ids.push(self.no_timestamps_token);
        let prefix_len = prefix_ids.len();
        let prefix_t =
            Tensor::from_vec(prefix_ids, (1usize, prefix_len), &device).map_err(|e| e.to_string())?;

        // Flush=true: clear KV cache and process prefix; get logits for last position.
        let prefix_logits = self
            .model
            .decoder
            .forward(&prefix_t, &audio_features, true)
            .map_err(|e| e.to_string())?;

        // logits shape: [1, prefix_len, vocab_size]; we care about the last prefix position.
        let mut last_logits = prefix_logits
            .i((0, prefix_len - 1, ..))
            .map_err(|e| e.to_string())?;

        let mut text_tokens: Vec<u32> = Vec::new();
        let max_new_tokens = 224usize;

        for _ in 0..max_new_tokens {
            let next_token = last_logits
                .argmax(0)
                .map_err(|e| e.to_string())?
                .to_scalar::<u32>()
                .map_err(|e| e.to_string())?;

            if next_token == self.eot_token {
                break;
            }

            // Always advance the decoder (keeps KV cache position correct)
            let step_t = Tensor::from_vec(vec![next_token], (1usize, 1usize), &device)
                .map_err(|e| e.to_string())?;
            let step_logits = self
                .model
                .decoder
                .forward(&step_t, &audio_features, false) // flush=false: reuse KV cache
                .map_err(|e| e.to_string())?;
            last_logits = step_logits.i((0, 0usize, ..)).map_err(|e| e.to_string())?;

            // Collect only text tokens. Whisper special/control tokens start at eot.
            if next_token < self.eot_token {
                text_tokens.push(next_token);
            }
        }

        // ── 4. Detokenize ─────────────────────────────────────────────────────
        let text = self
            .tokenizer
            .decode(&text_tokens, true)
            .map_err(|e| e.to_string())?;

        Ok(text)
    }
}
