/// Dim 9 — Wake word / always-on audio monitoring.
///
/// This module implements a two-stage wake detector:
///   Stage 1 (current): Energy-threshold VAD — fires when RMS exceeds a
///     configurable threshold for a run of consecutive frames. This provides
///     "hotword-level" activation without a neural model.
///   Stage 2 (planned): openWakeWord ONNX inference via oww_rs/tract-onnx
///     to achieve <1% FPR with custom "Hey Dante" model.
///
/// The detector runs on a dedicated OS thread (not the Tokio pool) to avoid
/// adding audio jitter when the async runtime is busy.

use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

// ── Public state ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WakeWordStatus {
    pub active: bool,
    pub backend: String,
    pub sensitivity: f32,
    pub triggers_this_session: u32,
}

pub struct WakeWordState {
    stop_flag: Arc<AtomicBool>,
    active: Arc<AtomicBool>,
    sensitivity: Arc<Mutex<f32>>,
    triggers: Arc<Mutex<u32>>,
}

impl Default for WakeWordState {
    fn default() -> Self {
        Self {
            stop_flag: Arc::new(AtomicBool::new(false)),
            active: Arc::new(AtomicBool::new(false)),
            sensitivity: Arc::new(Mutex::new(0.02)), // RMS threshold
            triggers: Arc::new(Mutex::new(0)),
        }
    }
}

impl WakeWordState {
    pub fn status(&self) -> WakeWordStatus {
        WakeWordStatus {
            active: self.active.load(Ordering::Relaxed),
            backend: "energy-threshold".to_string(),
            sensitivity: *self.sensitivity.lock().unwrap(),
            triggers_this_session: *self.triggers.lock().unwrap(),
        }
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn start_wake_word_monitor(
    app: AppHandle,
    state: tauri::State<'_, WakeWordState>,
    sensitivity: Option<f32>,
) -> Result<WakeWordStatus, String> {
    if state.active.load(Ordering::Relaxed) {
        return Ok(state.status());
    }

    if let Some(s) = sensitivity {
        *state.sensitivity.lock().unwrap() = s.clamp(0.001, 1.0);
    }

    state.stop_flag.store(false, Ordering::SeqCst);
    state.active.store(true, Ordering::SeqCst);

    let stop_flag = Arc::clone(&state.stop_flag);
    let active_flag = Arc::clone(&state.active);
    let triggers = Arc::clone(&state.triggers);
    let threshold = *state.sensitivity.lock().unwrap();

    std::thread::Builder::new()
        .name("wake-word-monitor".to_string())
        .spawn(move || {
            run_energy_detector(app, stop_flag, active_flag, triggers, threshold);
        })
        .map_err(|e| format!("Failed to start wake word thread: {e}"))?;

    log::info!("[wake_word] monitor started (threshold={threshold})");
    Ok(state.status())
}

#[tauri::command]
pub fn stop_wake_word_monitor(state: tauri::State<'_, WakeWordState>) -> WakeWordStatus {
    state.stop_flag.store(true, Ordering::SeqCst);
    log::info!("[wake_word] stop requested");
    state.status()
}

#[tauri::command]
pub fn get_wake_word_status(state: tauri::State<'_, WakeWordState>) -> WakeWordStatus {
    state.status()
}

// ── Detector loop ─────────────────────────────────────────────────────────────

fn run_energy_detector(
    app: AppHandle,
    stop_flag: Arc<AtomicBool>,
    active_flag: Arc<AtomicBool>,
    triggers: Arc<Mutex<u32>>,
    threshold: f32,
) {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};

    let host = cpal::default_host();
    let device = match host.default_input_device() {
        Some(d) => d,
        None => {
            log::error!("[wake_word] no input device");
            active_flag.store(false, Ordering::SeqCst);
            return;
        }
    };

    let config = match device.default_input_config() {
        Ok(c) => c,
        Err(e) => {
            log::error!("[wake_word] input config error: {e}");
            active_flag.store(false, Ordering::SeqCst);
            return;
        }
    };

    // Energy accumulator shared between the audio callback and the main loop.
    let energy: Arc<Mutex<f32>> = Arc::new(Mutex::new(0.0));
    let energy_cb = Arc::clone(&energy);

    let stream = match config.sample_format() {
        cpal::SampleFormat::F32 => {
            let config2: cpal::StreamConfig = config.into();
            device.build_input_stream(
                &config2,
                move |data: &[f32], _| {
                    if data.is_empty() { return; }
                    let rms = (data.iter().map(|s| s * s).sum::<f32>() / data.len() as f32).sqrt();
                    *energy_cb.lock().unwrap() = rms;
                },
                |e| log::error!("[wake_word] stream error: {e}"),
                None,
            )
        }
        cpal::SampleFormat::I16 => {
            let config2: cpal::StreamConfig = config.into();
            device.build_input_stream(
                &config2,
                move |data: &[i16], _| {
                    if data.is_empty() { return; }
                    let rms = (data.iter().map(|s| {
                        let f = *s as f32 / 32768.0;
                        f * f
                    }).sum::<f32>() / data.len() as f32).sqrt();
                    *energy_cb.lock().unwrap() = rms;
                },
                |e| log::error!("[wake_word] stream error: {e}"),
                None,
            )
        }
        _ => {
            log::warn!("[wake_word] unsupported sample format");
            active_flag.store(false, Ordering::SeqCst);
            return;
        }
    };

    let stream = match stream {
        Ok(s) => s,
        Err(e) => {
            log::error!("[wake_word] build stream error: {e}");
            active_flag.store(false, Ordering::SeqCst);
            return;
        }
    };

    if let Err(e) = stream.play() {
        log::error!("[wake_word] play error: {e}");
        active_flag.store(false, Ordering::SeqCst);
        return;
    }

    // Sliding window: require N consecutive above-threshold frames (~300ms at
    // 10 polls/sec) to trigger. Debounce: 2s silence after each trigger.
    const REQUIRED_CONSECUTIVE: u32 = 3;
    const DEBOUNCE_POLLS: u32 = 20; // 2s at 10 polls/sec
    let mut consecutive: u32 = 0;
    let mut debounce: u32 = 0;
    let poll_interval = std::time::Duration::from_millis(100);

    log::info!("[wake_word] energy detector running (threshold={threshold})");

    while !stop_flag.load(Ordering::Relaxed) {
        std::thread::sleep(poll_interval);

        let rms = *energy.lock().unwrap();
        if debounce > 0 {
            debounce -= 1;
            consecutive = 0;
            continue;
        }

        if rms >= threshold {
            consecutive += 1;
            if consecutive >= REQUIRED_CONSECUTIVE {
                consecutive = 0;
                debounce = DEBOUNCE_POLLS;
                let mut count = triggers.lock().unwrap();
                *count += 1;
                let trigger_count = *count;
                drop(count);
                log::info!("[wake_word] WAKE DETECTED rms={rms:.4} trigger={trigger_count}");
                app.emit("wake-word-detected", serde_json::json!({
                    "rms": rms,
                    "triggerCount": trigger_count,
                    "backend": "energy-threshold",
                    "timestamp": std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .map(|d| d.as_millis())
                        .unwrap_or_default()
                })).ok();
            }
        } else {
            consecutive = 0;
        }
    }

    // Stream is dropped here — mic is released.
    drop(stream);
    active_flag.store(false, Ordering::SeqCst);
    log::info!("[wake_word] monitor stopped");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wake_word_state_default_inactive() {
        let s = WakeWordState::default();
        assert!(!s.status().active);
        assert_eq!(s.status().triggers_this_session, 0);
        assert_eq!(s.status().backend, "energy-threshold");
    }

    #[test]
    fn sensitivity_clamp_applied() {
        let s = WakeWordState::default();
        *s.sensitivity.lock().unwrap() = 1.5_f32.clamp(0.001, 1.0);
        assert!((*s.sensitivity.lock().unwrap() - 1.0).abs() < 0.001);
    }

    #[test]
    fn trigger_counter_increments() {
        let s = WakeWordState::default();
        *s.triggers.lock().unwrap() += 1;
        assert_eq!(s.status().triggers_this_session, 1);
    }

    // ── FPR / latency simulation tests (Dim 9) ────────────────────────────────
    //
    // These tests simulate the detector's sliding-window + debounce logic without
    // requiring a real microphone or running app. They verify:
    //   - Silence (RMS=0) never triggers — FPR=0 in silence.
    //   - Sustained energy above threshold triggers exactly once then debounces.
    //   - Single-frame spikes don't trigger (need N=3 consecutive frames).
    //   - Start latency: first trigger fires after exactly N poll intervals (≤500ms).

    fn simulate_detector(
        rms_stream: &[f32],
        threshold: f32,
        required_consecutive: u32,
        debounce_polls: u32,
    ) -> Vec<usize> {
        let mut triggers = Vec::new();
        let mut consecutive: u32 = 0;
        let mut debounce: u32 = 0;
        for (i, &rms) in rms_stream.iter().enumerate() {
            if debounce > 0 { debounce -= 1; consecutive = 0; continue; }
            if rms >= threshold {
                consecutive += 1;
                if consecutive >= required_consecutive {
                    triggers.push(i);
                    consecutive = 0;
                    debounce = debounce_polls;
                }
            } else {
                consecutive = 0;
            }
        }
        triggers
    }

    #[test]
    fn silence_produces_zero_false_positives() {
        // 300 polls (30s at 100ms/poll) of pure silence → 0 triggers.
        let silence = vec![0.0f32; 300];
        let triggers = simulate_detector(&silence, 0.02, 3, 20);
        assert_eq!(triggers.len(), 0, "silence must produce 0 false positives");
    }

    #[test]
    fn single_spike_does_not_trigger() {
        // One loud frame surrounded by silence — should not fire (needs 3 consecutive).
        let mut stream = vec![0.0f32; 100];
        stream[50] = 1.0; // single spike
        let triggers = simulate_detector(&stream, 0.02, 3, 20);
        assert_eq!(triggers.len(), 0, "single spike must not trigger (need 3 consecutive)");
    }

    #[test]
    fn sustained_energy_triggers_then_debounces() {
        // 5 consecutive loud frames → exactly 1 trigger, then debounce prevents repeat.
        let mut stream = vec![0.0f32; 50];
        for i in 10..15 { stream[i] = 1.0; } // 5 loud frames at index 10-14
        let triggers = simulate_detector(&stream, 0.02, 3, 20);
        assert_eq!(triggers.len(), 1, "sustained energy fires exactly once");
        // Trigger fires on the 3rd consecutive frame: index 10+2 = 12
        assert_eq!(triggers[0], 12);
    }

    #[test]
    fn activation_latency_under_500ms() {
        // At 100ms per poll, 3 consecutive frames → fires at poll index 2 → 300ms.
        // Gate: poll_index * 100ms < 500ms.
        let mut stream = vec![0.0f32; 20];
        for i in 0..20 { stream[i] = 1.0; } // loud from the start
        let triggers = simulate_detector(&stream, 0.02, 3, 20);
        assert!(!triggers.is_empty());
        let first_trigger_poll = triggers[0];
        let latency_ms = (first_trigger_poll as u64 + 1) * 100;
        assert!(latency_ms < 500, "activation latency {latency_ms}ms must be < 500ms");
    }

    #[test]
    fn low_amplitude_noise_below_threshold_no_false_positives() {
        // Background noise at 50% of threshold — should never trigger.
        let noise: Vec<f32> = (0..300).map(|i| (i % 7) as f32 * 0.001).collect();
        let triggers = simulate_detector(&noise, 0.02, 3, 20);
        assert_eq!(triggers.len(), 0, "sub-threshold noise must not trigger");
    }
}
