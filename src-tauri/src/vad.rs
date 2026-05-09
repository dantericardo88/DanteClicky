//! Voice activity detection and gain helpers for the cloud STT path.
//!
//! `EnhancedVad` upgrades the bare RMS gate that used to live in audio.rs:
//! adaptive noise floor (EMA over background frames), hysteresis (different
//! thresholds for speech-start vs speech-end), and a zero-crossing-rate check
//! to reject low-frequency rumble (HVAC, AC hum) that fools pure-RMS gates.
//!
//! `normalize_gain_in_place` is a one-shot envelope-based gain stage that
//! brings short PTT utterances to a consistent peak before they hit AssemblyAI.

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum VadDecision {
    Speech,
    Silence,
    EndOfSpeech,
}

#[derive(Debug, Clone, Copy)]
pub struct VadConfig {
    pub speech_start_rms: f32,
    pub speech_end_rms: f32,
    pub min_zcr: f32,
    pub max_zcr: f32,
    pub silence_frames_to_flush: usize,
    pub noise_floor_alpha: f32,
}

impl VadConfig {
    pub const DEFAULT: VadConfig = VadConfig {
        speech_start_rms: 0.018,
        speech_end_rms: 0.010,
        min_zcr: 0.01,
        max_zcr: 0.40,
        silence_frames_to_flush: 24,
        noise_floor_alpha: 0.05,
    };
}

pub struct EnhancedVad {
    config: VadConfig,
    silence_count: usize,
    speech_started: bool,
    noise_floor: f32,
}

impl EnhancedVad {
    pub fn new() -> Self {
        Self::with_config(VadConfig::DEFAULT)
    }

    pub fn with_config(config: VadConfig) -> Self {
        Self { config, silence_count: 0, speech_started: false, noise_floor: 0.005 }
    }

    pub fn process(&mut self, samples: &[f32]) -> VadDecision {
        if samples.is_empty() {
            return VadDecision::Silence;
        }
        let rms = compute_rms(samples);
        let zcr = compute_zcr(samples);

        let start_threshold = (self.config.speech_start_rms).max(self.noise_floor * 2.5);
        let end_threshold = (self.config.speech_end_rms).max(self.noise_floor * 1.6);

        let active_threshold =
            if self.speech_started { end_threshold } else { start_threshold };

        let zcr_ok = zcr >= self.config.min_zcr && zcr <= self.config.max_zcr;
        let is_speech = rms > active_threshold && zcr_ok;

        if is_speech {
            self.silence_count = 0;
            self.speech_started = true;
            VadDecision::Speech
        } else {
            // Update noise floor only on confirmed silence
            self.noise_floor =
                self.noise_floor * (1.0 - self.config.noise_floor_alpha)
                    + rms * self.config.noise_floor_alpha;
            self.silence_count += 1;
            if self.speech_started && self.silence_count >= self.config.silence_frames_to_flush {
                self.speech_started = false;
                self.silence_count = 0;
                VadDecision::EndOfSpeech
            } else {
                VadDecision::Silence
            }
        }
    }
}

fn compute_rms(samples: &[f32]) -> f32 {
    let sum_sq: f32 = samples.iter().map(|s| s * s).sum();
    (sum_sq / samples.len() as f32).sqrt()
}

fn compute_zcr(samples: &[f32]) -> f32 {
    if samples.len() < 2 {
        return 0.0;
    }
    let mut crossings = 0;
    for i in 1..samples.len() {
        let prev = samples[i - 1];
        let cur = samples[i];
        if (prev >= 0.0) != (cur >= 0.0) && (prev.abs() + cur.abs()) > 0.001 {
            crossings += 1;
        }
    }
    crossings as f32 / (samples.len() - 1) as f32
}

// ── Gain normalization ────────────────────────────────────────────────────────

/// Smoothed AGC: tracks a running peak with fast attack (~10ms) and slow
/// release (~250ms) so short PTT utterances reach AssemblyAI at a consistent
/// level even when the user is far from the mic. Caps gain to 12dB to avoid
/// pumping room noise during silences.
pub struct AutoGain {
    target_peak: f32,
    max_gain: f32,
    envelope: f32,
    attack_alpha: f32,
    release_alpha: f32,
}

impl AutoGain {
    pub fn new() -> Self {
        Self {
            target_peak: 0.55,
            max_gain: 4.0,    // ~+12 dB ceiling
            envelope: 0.001,
            attack_alpha: 0.4,
            release_alpha: 0.02,
        }
    }

    /// Apply gain in-place. Returns the gain coefficient applied this frame.
    pub fn apply(&mut self, samples: &mut [f32]) -> f32 {
        if samples.is_empty() {
            return 1.0;
        }
        let mut peak = 0.0_f32;
        for &s in samples.iter() {
            let abs = s.abs();
            if abs > peak {
                peak = abs;
            }
        }
        // Track envelope with attack/release dynamics
        let alpha = if peak > self.envelope { self.attack_alpha } else { self.release_alpha };
        self.envelope = self.envelope * (1.0 - alpha) + peak * alpha;

        // Skip gain when input is near-silence — avoids pumping background noise
        if self.envelope < 0.005 {
            return 1.0;
        }
        let raw_gain = self.target_peak / self.envelope;
        let gain = raw_gain.clamp(0.5, self.max_gain);

        for s in samples.iter_mut() {
            *s = (*s * gain).clamp(-1.0, 1.0);
        }
        gain
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(samples: usize, freq: f32, amplitude: f32, sample_rate: f32) -> Vec<f32> {
        (0..samples)
            .map(|i| {
                let t = i as f32 / sample_rate;
                (2.0 * std::f32::consts::PI * freq * t).sin() * amplitude
            })
            .collect()
    }

    #[test]
    fn silence_stays_silent_indefinitely_without_triggering_end_of_speech() {
        let mut vad = EnhancedVad::new();
        for _ in 0..200 {
            let frame = vec![0.0_f32; 512];
            assert_eq!(vad.process(&frame), VadDecision::Silence);
        }
    }

    #[test]
    fn voice_then_silence_emits_end_of_speech_after_hysteresis() {
        let mut vad = EnhancedVad::new();
        // Voice burst at speech-band frequency
        let voice = sine(512, 200.0, 0.2, 16000.0);
        for _ in 0..10 {
            let d = vad.process(&voice);
            assert!(matches!(d, VadDecision::Speech));
        }
        // Silence — count up to flush threshold
        let silence = vec![0.0_f32; 512];
        let mut emitted = false;
        for _ in 0..100 {
            if vad.process(&silence) == VadDecision::EndOfSpeech {
                emitted = true;
                break;
            }
        }
        assert!(emitted, "EndOfSpeech should fire after sustained silence");
    }

    #[test]
    fn rumble_with_high_amplitude_low_zcr_does_not_count_as_speech() {
        let mut vad = EnhancedVad::new();
        // 30 Hz rumble at moderate amplitude — very low zero-crossing rate
        let rumble = sine(512, 30.0, 0.06, 16000.0);
        let mut speech_count = 0;
        for _ in 0..20 {
            if vad.process(&rumble) == VadDecision::Speech {
                speech_count += 1;
            }
        }
        // Allow a tiny number of false positives on attack but not sustained
        assert!(speech_count < 5, "rumble triggered speech {speech_count} times");
    }

    #[test]
    fn hysteresis_keeps_voice_open_at_lower_amplitude_than_required_to_start() {
        let mut vad = EnhancedVad::new();
        let loud = sine(512, 200.0, 0.06, 16000.0);
        for _ in 0..5 {
            assert_eq!(vad.process(&loud), VadDecision::Speech);
        }
        // Drop amplitude below speech-start threshold (RMS ≈ 0.018) but above
        // speech-end threshold (RMS ≈ 0.010). Sine RMS = amp/√2.
        // amp 0.020 → RMS ≈ 0.0141 (between 0.010 and 0.018).
        let quiet = sine(512, 200.0, 0.020, 16000.0);
        let mut still_open = 0;
        for _ in 0..3 {
            if vad.process(&quiet) == VadDecision::Speech {
                still_open += 1;
            }
        }
        assert!(
            still_open >= 2,
            "hysteresis should keep speech open below start threshold; got {still_open}"
        );
    }

    #[test]
    fn auto_gain_lifts_quiet_audio_toward_target_peak() {
        let mut agc = AutoGain::new();
        // Feed many fresh quiet frames; AGC should settle on a > 1.0 gain.
        let mut last_gain = 1.0;
        for _ in 0..40 {
            let mut frame = sine(512, 200.0, 0.1, 16000.0);
            last_gain = agc.apply(&mut frame);
        }
        assert!(
            last_gain > 1.5,
            "expected steady-state gain > 1.5 for quiet input, got {last_gain}"
        );
    }

    #[test]
    fn auto_gain_does_not_amplify_pure_silence() {
        let mut agc = AutoGain::new();
        let mut silence = vec![0.0_f32; 512];
        let g = agc.apply(&mut silence);
        assert_eq!(g, 1.0);
        assert!(silence.iter().all(|&s| s == 0.0));
    }

    #[test]
    fn auto_gain_clamps_loud_input_to_unity_or_below() {
        let mut agc = AutoGain::new();
        let mut loud = sine(512, 200.0, 0.95, 16000.0);
        for _ in 0..5 {
            agc.apply(&mut loud);
        }
        let peak = loud.iter().map(|s| s.abs()).fold(0.0_f32, f32::max);
        assert!(peak <= 1.0, "post-AGC peak {peak} must not exceed 1.0");
    }
}
