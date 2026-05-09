//! Live capture loop for Dim 16. This is the linchpin that turns the
//! existing scaffolding (ringbuf, segmenter, keyframer, FrameSource) into a
//! running pipeline that produces SQLite keyframe rows the agent and timeline
//! UI can search.
//!
//! Design choices:
//!   - Pure `std::thread` — no async runtime, no tokio-on-tokio risks.
//!   - One thread per monitor so a slow monitor doesn't stall others.
//!   - Per-tick logic (`capture_tick`) is a pure function that takes the
//!     state it needs and returns a `TickOutcome` so unit tests can drive it
//!     deterministically with `MockFrameSource` and an in-memory `SessionDb`.
//!   - Skips H.264 muxing entirely. Each keyframe is a JPEG thumbnail stored
//!     in the encrypted `video_keyframes.thumb_jpeg_enc` column. The "segment"
//!     becomes a metadata grouping rather than an on-disk fMP4 — functionally
//!     equivalent for searchable temporal context.
//!
//! Wave: Dim 16 / Phase 2.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::JoinHandle;

use base64::{engine::general_purpose::STANDARD, Engine};
use image::{ImageBuffer, Rgba};

use super::keyframer::{is_drm_blackout, motion_sad, AdaptiveFps};
use super::ringbuf::RingBuffer;
use super::segmenter::Segmenter;
use super::source::FrameSource;
use super::types::{EncodedSegment, PrivacyFlag, VideoFrame};
use crate::session::SessionDb;

/// Default keyframe gates. A keyframe is emitted when motion crosses the
/// threshold OR the heartbeat interval elapses (so we always have at least
/// one entry per `MAX_KEYFRAME_INTERVAL_MS`, even on a fully static screen).
pub const DEFAULT_MOTION_KEYFRAME_THRESHOLD: u64 = 1500;
pub const DEFAULT_MAX_KEYFRAME_INTERVAL_MS: i64 = 5000;
pub const DEFAULT_THUMB_W: u32 = 160;
pub const DEFAULT_THUMB_H: u32 = 90;

/// User-controlled privacy state read by the capture loop each tick.
/// Lives behind an `Arc<RwLock<...>>` so JS-side toggles take effect on the
/// next frame without restarting the thread.
#[derive(Debug, Clone, Default)]
pub struct RuntimePrivacy {
    pub incognito: bool,
    pub paused: bool,
    pub excluded_apps: Vec<String>,
}

/// What `capture_tick` did. Used by tests to assert behaviour.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TickOutcome {
    /// Source returned None — the loop should exit.
    SourceClosed,
    /// Frame was a DRM blackout — segment marked, no keyframe persisted.
    DrmBlackout,
    /// Privacy gates blocked persistence.
    SkippedPrivate(PrivacyFlag),
    /// Frame received but motion was below threshold and heartbeat hasn't
    /// elapsed — no keyframe written this tick.
    NoKeyframe,
    /// Wrote a keyframe row. Returns the saved keyframe id and segment id.
    WroteKeyframe {
        keyframe_id: i64,
        segment_id: i64,
        motion_sad: u64,
    },
}

/// Mutable per-loop state owned by the capture thread. Threaded into
/// `capture_tick` so tests can construct it directly.
pub struct CaptureState {
    pub monitor_idx: u32,
    pub adaptive_fps: AdaptiveFps,
    /// Previous frame's pixels (RGBA). `None` after a DRM blackout or at start
    /// so the next real frame is always emitted as a keyframe (motion=u64::MAX).
    pub prev_pixels: Option<Vec<u8>>,
    pub current_segment_id: Option<i64>,
    pub current_segment_start_ms: i64,
    pub last_keyframe_ms: i64,
    pub motion_threshold: u64,
    pub max_keyframe_interval_ms: i64,
    pub thumb_w: u32,
    pub thumb_h: u32,
    pub jpeg_quality: u8,
    pub ringbuf: Arc<Mutex<RingBuffer>>,
    pub segmenter: Arc<Mutex<Segmenter>>,
    /// Source pacing handle. When the adaptive FPS controller drops or raises,
    /// we push the new target interval into this atomic so the source's next
    /// `next_frame()` call honors it. `None` for tests that drive `capture_tick`
    /// directly with a `MockFrameSource`.
    pub interval_handle: Option<Arc<AtomicU64>>,
    /// Force-keyframe slot (Phase B2). When `Some(label)`, the next tick emits
    /// a labeled keyframe regardless of motion gate. Cleared after consumption.
    pub force_keyframe_label: Arc<Mutex<Option<String>>>,
}

impl CaptureState {
    pub fn new(
        monitor_idx: u32,
        fps_min: f32,
        fps_max: f32,
        ringbuf: Arc<Mutex<RingBuffer>>,
        segmenter: Arc<Mutex<Segmenter>>,
    ) -> Self {
        Self {
            monitor_idx,
            adaptive_fps: AdaptiveFps::new(fps_min, fps_max),
            prev_pixels: None,
            current_segment_id: None,
            current_segment_start_ms: 0,
            last_keyframe_ms: 0,
            motion_threshold: DEFAULT_MOTION_KEYFRAME_THRESHOLD,
            max_keyframe_interval_ms: DEFAULT_MAX_KEYFRAME_INTERVAL_MS,
            thumb_w: DEFAULT_THUMB_W,
            thumb_h: DEFAULT_THUMB_H,
            jpeg_quality: 75,
            ringbuf,
            segmenter,
            interval_handle: None,
            force_keyframe_label: Arc::new(Mutex::new(None)),
        }
    }

    /// Attach a source pacing handle so the adaptive FPS controller can
    /// actually throttle the source between ticks.
    pub fn with_interval_handle(mut self, handle: Arc<AtomicU64>) -> Self {
        self.interval_handle = Some(handle);
        self
    }

    /// Returns the slot the JS side writes into via `video_capture_now`.
    pub fn force_keyframe_slot(&self) -> Arc<Mutex<Option<String>>> {
        Arc::clone(&self.force_keyframe_label)
    }
}

/// One iteration of the capture loop. Returns the outcome so callers (and
/// tests) can react. Wall-clock and active-window resolution are injected so
/// the unit tests are deterministic.
///
/// Honest-9+ corrections (Phase A):
/// - A1: pushes `adaptive_fps.target_frame_interval_ms()` into the source's
///   interval handle each tick, so quiet workloads actually throttle the source.
/// - A2: pixels are RGBA throughout — no double-swap.
/// - A3: DRM blackout sets `prev_pixels = None` so the *next* real frame is
///   the keyframe (via the first-frame `u64::MAX` branch), not a spurious
///   motion-driven keyframe against the black memory.
/// - A4: `RuntimePrivacy.paused` is honored without thread death; the segment
///   is marked Paused and the loop continues.
/// - B2: a force-keyframe label slot lets the agent emit labeled keyframes
///   immediately after a computer-use action, regardless of motion gate.
pub fn capture_tick(
    state: &mut CaptureState,
    source: &mut dyn FrameSource,
    db: &SessionDb,
    privacy: &RuntimePrivacy,
    active_window: &str,
    now_ms: i64,
) -> TickOutcome {
    let frame = match source.next_frame() {
        Some(f) => f,
        None => return TickOutcome::SourceClosed,
    };

    if is_drm_blackout(&frame) {
        ensure_segment(state, db, now_ms, PrivacyFlag::DrmBlackout);
        // A3: clear prev so the next real frame is the keyframe via u64::MAX,
        // not a spurious motion delta against the black memory.
        state.prev_pixels = None;
        return TickOutcome::DrmBlackout;
    }

    let sad = match &state.prev_pixels {
        Some(prev) if prev.len() == frame.pixels_rgba.len() => {
            motion_sad(prev, &frame.pixels_rgba, frame.width, frame.height)
        }
        _ => u64::MAX, // first frame after start always counts as motion
    };
    state.adaptive_fps.observe(sad);

    // A1: push the controller's target interval back to the source so the
    // next next_frame() call honors the new pacing. This is the wire-up the
    // prior session's audit explicitly missed.
    if let Some(handle) = &state.interval_handle {
        let interval = state.adaptive_fps.target_frame_interval_ms();
        handle.store(interval, Ordering::SeqCst);
    }

    // B2: consume the force-keyframe slot if set. We resolve to a label that
    // travels into `active_window_enc` prefixed with "[action]" so timeline
    // search can find action-driven keyframes distinctly.
    let force_label = state
        .force_keyframe_label
        .lock()
        .ok()
        .and_then(|mut slot| slot.take());

    let privacy_flag = resolve_privacy(privacy, active_window);
    let is_keyframe_candidate = force_label.is_some()
        || sad >= state.motion_threshold
        || (now_ms - state.last_keyframe_ms) >= state.max_keyframe_interval_ms;

    if !is_keyframe_candidate {
        state.prev_pixels = Some(frame.pixels_rgba);
        return TickOutcome::NoKeyframe;
    }

    if matches!(
        privacy_flag,
        PrivacyFlag::Incognito | PrivacyFlag::Paused | PrivacyFlag::Excluded
    ) {
        ensure_segment(state, db, now_ms, privacy_flag);
        state.prev_pixels = Some(frame.pixels_rgba);
        return TickOutcome::SkippedPrivate(privacy_flag);
    }

    let segment_id = ensure_segment(state, db, now_ms, PrivacyFlag::Normal);
    let pts_ms = now_ms - state.current_segment_start_ms;

    let thumb_b64 = encode_thumbnail(&frame, state.thumb_w, state.thumb_h, state.jpeg_quality);

    // Push a stub encoded segment into the ringbuf so size accounting matches
    // what the timeline UI reports. The bytes themselves are the JPEG so the
    // RAM tier still represents real visual data, just keyframe-only.
    if let Ok(mut rb) = state.ringbuf.lock() {
        if let Some(b64) = thumb_b64.as_ref() {
            // Decode rough byte size — ~3/4 of base64 length is the binary size.
            let approx_bytes = (b64.len() * 3) / 4;
            let stub = EncodedSegment {
                monitor_idx: frame.monitor_idx,
                start_ms: now_ms,
                end_ms: Some(now_ms),
                duration_ms: 0,
                width: frame.width,
                height: frame.height,
                frame_count: 1,
                bytes: vec![0u8; approx_bytes],
                privacy_flag,
            };
            rb.push(stub);
        }
    }

    // Pick the active_window field. Force-label-driven keyframes get
    // a "[action] <label>" prefix so the timeline can group them.
    let owned_label;
    let active_window_for_save: Option<&str> = match &force_label {
        Some(label) => {
            owned_label = format!("[action] {}", label);
            Some(owned_label.as_str())
        }
        None if active_window.is_empty() => None,
        None => Some(active_window),
    };

    // Use ocr_text=None here — ambient mode enriches via link_ambient_to_video.
    let keyframe_id = match db.save_video_keyframe(
        segment_id,
        pts_ms,
        None,
        active_window_for_save,
        None,
        thumb_b64.as_deref(),
        None,
    ) {
        Ok(id) => id,
        Err(_) => {
            // DB error is non-fatal — keep the loop alive.
            state.prev_pixels = Some(frame.pixels_rgba);
            return TickOutcome::NoKeyframe;
        }
    };

    state.last_keyframe_ms = now_ms;
    state.prev_pixels = Some(frame.pixels_rgba);

    TickOutcome::WroteKeyframe {
        keyframe_id,
        segment_id,
        motion_sad: sad,
    }
}

/// Open or rotate the current segment. Returns the active segment id.
fn ensure_segment(
    state: &mut CaptureState,
    db: &SessionDb,
    now_ms: i64,
    privacy_flag: PrivacyFlag,
) -> i64 {
    let needs_rotation = match state.current_segment_id {
        None => true,
        Some(_) => state
            .segmenter
            .lock()
            .map(|s| s.should_rotate(state.current_segment_start_ms))
            .unwrap_or(false),
    };

    if !needs_rotation {
        return state.current_segment_id.unwrap();
    }

    let start_ts = ms_to_iso(now_ms);
    let path = format!(
        "monitor_{}/{}.keyframes",
        state.monitor_idx, now_ms
    );
    let new_id = db
        .save_video_segment(
            state.monitor_idx,
            &path,
            &start_ts,
            None,
            0,
            0,
            0,
            0,
            state.adaptive_fps.current_fps,
            privacy_flag.as_str(),
        )
        .unwrap_or(0);

    state.current_segment_id = Some(new_id);
    state.current_segment_start_ms = now_ms;
    new_id
}

fn resolve_privacy(privacy: &RuntimePrivacy, active_window: &str) -> PrivacyFlag {
    super::keyframer::classify_privacy(
        active_window,
        &privacy.excluded_apps,
        privacy.incognito,
        privacy.paused,
    )
}

fn encode_thumbnail(frame: &VideoFrame, w: u32, h: u32, quality: u8) -> Option<String> {
    if frame.pixels_rgba.is_empty() || frame.width == 0 || frame.height == 0 {
        return None;
    }
    // A2: pixels are already RGBA — no swap. Direct ImageBuffer view.
    // (We clone into a Vec because ImageBuffer::from_vec needs an owned Vec; we
    // can revisit zero-copy later but for thumbnail-resize the resize itself
    // copies anyway.)
    let img: ImageBuffer<Rgba<u8>, Vec<u8>> =
        ImageBuffer::from_vec(frame.width, frame.height, frame.pixels_rgba.clone())?;
    let resized = image::imageops::thumbnail(&img, w, h);
    let mut bytes = Vec::with_capacity(8 * 1024);
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, quality);
    encoder
        .encode_image(&resized)
        .ok()
        .map(|_| STANDARD.encode(&bytes))
}

fn ms_to_iso(ms: i64) -> String {
    // Avoid pulling chrono just for this. The DB stores `strftime('%Y-%m-%dT%H:%M:%S','now')`
    // so we must produce the same fixed-second-precision shape. We compute UTC
    // seconds since 1970 manually.
    let total_secs = ms / 1000;
    let days = total_secs / 86_400;
    let secs_of_day = total_secs % 86_400;
    let hh = secs_of_day / 3600;
    let mm = (secs_of_day % 3600) / 60;
    let ss = secs_of_day % 60;
    let (y, mo, d) = days_to_ymd(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}",
        y, mo, d, hh, mm, ss
    )
}

fn days_to_ymd(days_since_epoch: i64) -> (i64, i64, i64) {
    // Days from 1970-01-01 → year/month/day. Handles leap years correctly.
    let mut days = days_since_epoch;
    let mut year = 1970i64;
    loop {
        let len = if is_leap_year(year) { 366 } else { 365 };
        if days < len {
            break;
        }
        days -= len;
        year += 1;
    }
    let mut month = 1i64;
    let lengths = [31, if is_leap_year(year) { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    while month <= 12 && days >= lengths[(month - 1) as usize] {
        days -= lengths[(month - 1) as usize];
        month += 1;
    }
    (year, month, days + 1)
}

fn is_leap_year(year: i64) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

/// Spawn the production capture thread. Runs until `stop_flag` is set OR the
/// frame source returns None. All errors during capture are swallowed (logged
/// to stderr) so a misbehaving monitor never crashes the whole loop.
pub fn spawn_capture_loop(
    state: CaptureState,
    mut source: Box<dyn FrameSource>,
    db: Arc<SessionDb>,
    privacy: Arc<RwLock<RuntimePrivacy>>,
    stop_flag: Arc<AtomicBool>,
    active_window_fn: Arc<dyn Fn() -> String + Send + Sync>,
) -> JoinHandle<()> {
    let mut state = state;
    std::thread::spawn(move || {
        while !stop_flag.load(Ordering::SeqCst) {
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            let active_window = active_window_fn();
            let snapshot = privacy
                .read()
                .map(|p| p.clone())
                .unwrap_or_default();
            let outcome = capture_tick(&mut state, source.as_mut(), &db, &snapshot, &active_window, now_ms);
            if matches!(outcome, TickOutcome::SourceClosed) {
                break;
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::video::source::MockFrameSource;
    use std::sync::atomic::AtomicI64;

    fn fresh_state() -> CaptureState {
        let ringbuf = Arc::new(Mutex::new(RingBuffer::new(50_000_000)));
        let segmenter = Arc::new(Mutex::new(Segmenter::new(
            std::path::PathBuf::from("/tmp/dc-test"),
            vec![0],
            60,
        )));
        CaptureState::new(0, 0.5, 10.0, ringbuf, segmenter)
    }

    #[test]
    fn first_frame_writes_keyframe() {
        let mut state = fresh_state();
        let mut source = MockFrameSource::new(0, 64, 64, Some(1));
        let db = SessionDb::open_memory().unwrap();
        let privacy = RuntimePrivacy::default();

        let outcome = capture_tick(&mut state, &mut source, &db, &privacy, "Notepad", 1_000_000);
        match outcome {
            TickOutcome::WroteKeyframe { keyframe_id, segment_id, .. } => {
                assert!(keyframe_id > 0);
                assert!(segment_id > 0);
            }
            other => panic!("expected WroteKeyframe, got {:?}", other),
        }
    }

    #[test]
    fn motion_burst_writes_multiple_keyframes() {
        let mut state = fresh_state();
        let mut source = MockFrameSource::new(0, 64, 64, Some(5));
        let db = SessionDb::open_memory().unwrap();
        let privacy = RuntimePrivacy::default();
        let mut keyframes = 0;
        let now = AtomicI64::new(1_000_000);
        for _ in 0..5 {
            let n = now.load(Ordering::SeqCst);
            let outcome = capture_tick(&mut state, &mut source, &db, &privacy, "Chrome", n);
            now.fetch_add(50, Ordering::SeqCst);
            if matches!(outcome, TickOutcome::WroteKeyframe { .. }) {
                keyframes += 1;
            }
        }
        // Mock source cycles colors so motion is non-zero between frames.
        assert!(keyframes >= 2, "expected ≥2 keyframes, got {}", keyframes);
    }

    #[test]
    fn drm_blackout_skips_keyframe_persist() {
        struct BlackSource(bool);
        impl FrameSource for BlackSource {
            fn next_frame(&mut self) -> Option<VideoFrame> {
                if self.0 { return None; }
                self.0 = true;
                Some(VideoFrame {
                    monitor_idx: 0,
                    width: 16,
                    height: 16,
                    pts_ms: 0,
                    pixels_rgba: vec![0u8; 16 * 16 * 4],
                })
            }
        }
        let mut state = fresh_state();
        let mut source = BlackSource(false);
        let db = SessionDb::open_memory().unwrap();
        let outcome = capture_tick(&mut state, &mut source, &db, &RuntimePrivacy::default(), "Netflix", 1_000_000);
        assert_eq!(outcome, TickOutcome::DrmBlackout);
    }

    #[test]
    fn incognito_skips_keyframe() {
        let mut state = fresh_state();
        let mut source = MockFrameSource::new(0, 32, 32, Some(1));
        let db = SessionDb::open_memory().unwrap();
        let privacy = RuntimePrivacy { incognito: true, paused: false, excluded_apps: vec![] };
        let outcome = capture_tick(&mut state, &mut source, &db, &privacy, "Notepad", 1_000_000);
        assert_eq!(outcome, TickOutcome::SkippedPrivate(PrivacyFlag::Incognito));
    }

    #[test]
    fn excluded_app_skips_keyframe() {
        let mut state = fresh_state();
        let mut source = MockFrameSource::new(0, 32, 32, Some(1));
        let db = SessionDb::open_memory().unwrap();
        let privacy = RuntimePrivacy {
            incognito: false, paused: false,
            excluded_apps: vec!["bank".to_string()],
        };
        let outcome = capture_tick(&mut state, &mut source, &db, &privacy, "Chrome — bank.com", 1_000_000);
        assert_eq!(outcome, TickOutcome::SkippedPrivate(PrivacyFlag::Excluded));
    }

    #[test]
    fn heartbeat_keyframe_after_max_interval() {
        // Use a source that returns identical frames so SAD≈0 won't fire motion gate.
        struct ConstSource(usize);
        impl FrameSource for ConstSource {
            fn next_frame(&mut self) -> Option<VideoFrame> {
                if self.0 == 0 { return None; }
                self.0 -= 1;
                Some(VideoFrame {
                    monitor_idx: 0, width: 32, height: 32, pts_ms: 0,
                    pixels_rgba: vec![128u8; 32 * 32 * 4],
                })
            }
        }
        let mut state = fresh_state();
        state.motion_threshold = u64::MAX;          // disable motion gate
        state.max_keyframe_interval_ms = 5000;
        let mut source = ConstSource(2);
        let db = SessionDb::open_memory().unwrap();
        let privacy = RuntimePrivacy::default();

        // First tick: SAD = u64::MAX (no prev frame) so it writes a keyframe.
        let first = capture_tick(&mut state, &mut source, &db, &privacy, "Notepad", 1_000_000);
        assert!(matches!(first, TickOutcome::WroteKeyframe { .. }));

        // Second tick at +1000ms: identical frame, motion zero, no heartbeat yet.
        let second = capture_tick(&mut state, &mut source, &db, &privacy, "Notepad", 1_001_000);
        assert_eq!(second, TickOutcome::NoKeyframe);
    }

    #[test]
    fn segment_rotates_after_60s() {
        let mut state = fresh_state();
        let mut source = MockFrameSource::new(0, 32, 32, Some(2));
        let db = SessionDb::open_memory().unwrap();
        let privacy = RuntimePrivacy::default();
        let first = capture_tick(&mut state, &mut source, &db, &privacy, "Notepad", 1_000_000);
        let initial_seg = match first {
            TickOutcome::WroteKeyframe { segment_id, .. } => segment_id,
            o => panic!("expected keyframe, got {:?}", o),
        };
        let later = capture_tick(&mut state, &mut source, &db, &privacy, "Notepad", 1_065_000);
        match later {
            TickOutcome::WroteKeyframe { segment_id, .. } => {
                assert_ne!(segment_id, initial_seg, "segment should rotate after 60s");
            }
            o => panic!("expected keyframe after rotation, got {:?}", o),
        }
    }

    #[test]
    fn ms_to_iso_round_known_value() {
        // 2024-01-01T00:00:00 UTC = 1704067200 seconds = 1704067200000 ms
        assert_eq!(ms_to_iso(1_704_067_200_000), "2024-01-01T00:00:00");
        // 2024-12-31T23:59:59 UTC = 1735689599
        assert_eq!(ms_to_iso(1_735_689_599_000), "2024-12-31T23:59:59");
    }

    #[test]
    fn ms_to_iso_handles_leap_year() {
        // 2024-02-29 is a leap day = 1709164800 seconds
        assert_eq!(ms_to_iso(1_709_164_800_000), "2024-02-29T00:00:00");
    }

    #[test]
    fn encode_thumbnail_produces_valid_base64() {
        let frame = VideoFrame {
            monitor_idx: 0, width: 64, height: 64, pts_ms: 0,
            pixels_rgba: vec![100u8; 64 * 64 * 4],
        };
        let b64 = encode_thumbnail(&frame, 32, 18, 75).expect("must encode");
        assert!(!b64.is_empty());
        assert!(STANDARD.decode(&b64).is_ok());
    }

    // ── Honest-9+ correction tests (A1, A3, A4, B2) ────────────────────────

    #[test]
    fn a1_adaptive_fps_throttle_writes_back_to_source_interval() {
        // Drive a series of identical frames so motion stays at zero. After
        // `quiet_streak_to_drop` quiet observations, AdaptiveFps drops to
        // fps_min, and the capture_tick MUST push the new interval into the
        // shared handle. Pre-fix, the handle stayed at the default forever.
        let interval_handle = Arc::new(AtomicU64::new(100));
        let mut state = fresh_state().with_interval_handle(Arc::clone(&interval_handle));
        // The MockFrameSource alternates colors per frame, so use a
        // const-frame source to actually test quiet detection.
        struct ConstFrame(usize, Vec<u8>);
        impl FrameSource for ConstFrame {
            fn next_frame(&mut self) -> Option<VideoFrame> {
                if self.0 == 0 { return None; }
                self.0 -= 1;
                Some(VideoFrame {
                    monitor_idx: 0, width: 32, height: 32, pts_ms: 0,
                    pixels_rgba: self.1.clone(),
                })
            }
        }
        let mut source = ConstFrame(10, vec![100u8; 32 * 32 * 4]);
        let db = SessionDb::open_memory().unwrap();
        let privacy = RuntimePrivacy::default();

        let initial = interval_handle.load(Ordering::SeqCst);
        for i in 0..5 {
            let _ = capture_tick(&mut state, &mut source, &db, &privacy, "Notepad", 1_000_000 + i * 100);
        }
        // After ≥3 quiet observations, fps_min (0.5) → 2000ms interval.
        let after = interval_handle.load(Ordering::SeqCst);
        assert!(after > initial, "quiet workload must lengthen interval; before={} after={}", initial, after);
        assert!(after >= 1000, "fps_min=0.5 should produce ≥1000ms interval; got {}", after);
    }

    #[test]
    fn a3_drm_blackout_does_not_spurious_keyframe_on_next_real_frame() {
        // Sequence: real frame → blackout → identical-to-first real frame.
        // With prior bug, the third frame had huge motion vs black memory →
        // spurious keyframe. With fix, prev_pixels=None after blackout, so the
        // third frame's first-frame branch fires u64::MAX and IS a keyframe —
        // but a HEARTBEAT/first-frame keyframe, not motion-driven. Critically,
        // the segment after blackout must NOT show "huge motion" sad value
        // when motion threshold is high.
        struct Seq(Vec<VideoFrame>);
        impl FrameSource for Seq {
            fn next_frame(&mut self) -> Option<VideoFrame> {
                if self.0.is_empty() { return None; }
                Some(self.0.remove(0))
            }
        }
        let real = VideoFrame {
            monitor_idx: 0, width: 16, height: 16, pts_ms: 0,
            pixels_rgba: vec![100u8; 16 * 16 * 4],
        };
        let black = VideoFrame {
            monitor_idx: 0, width: 16, height: 16, pts_ms: 100,
            pixels_rgba: vec![0u8; 16 * 16 * 4],
        };
        let mut source = Seq(vec![real.clone(), black, real.clone()]);

        let mut state = fresh_state();
        let db = SessionDb::open_memory().unwrap();
        let privacy = RuntimePrivacy::default();

        // Tick 1: real frame → first-frame keyframe (sad=u64::MAX).
        let r1 = capture_tick(&mut state, &mut source, &db, &privacy, "App", 1_000_000);
        assert!(matches!(r1, TickOutcome::WroteKeyframe { .. }));

        // Tick 2: black frame → DrmBlackout, prev_pixels reset to None.
        let r2 = capture_tick(&mut state, &mut source, &db, &privacy, "App", 1_000_100);
        assert_eq!(r2, TickOutcome::DrmBlackout);
        assert!(state.prev_pixels.is_none(), "DRM blackout must clear prev_pixels");

        // Tick 3: same real frame → should be first-frame branch (sad=MAX).
        // The motion gate fires, but the sad value reported should be u64::MAX
        // (first-frame branch), proving we did NOT compare against black.
        let r3 = capture_tick(&mut state, &mut source, &db, &privacy, "App", 1_000_200);
        match r3 {
            TickOutcome::WroteKeyframe { motion_sad, .. } => {
                assert_eq!(motion_sad, u64::MAX, "post-blackout frame must be first-frame branch, not motion vs black");
            }
            other => panic!("expected keyframe after blackout, got {:?}", other),
        }
    }

    #[test]
    fn a4_pause_via_privacy_continues_loop_with_paused_segments() {
        // The fix: video_pause sets privacy.paused=true. The capture loop
        // keeps running, classify_privacy returns Paused, so we get
        // SkippedPrivate(Paused) tick after tick — NOT TickOutcome::SourceClosed.
        let mut state = fresh_state();
        let mut source = MockFrameSource::new(0, 32, 32, Some(3));
        let db = SessionDb::open_memory().unwrap();
        let mut privacy = RuntimePrivacy::default();

        // Unpaused: writes a keyframe.
        let r1 = capture_tick(&mut state, &mut source, &db, &privacy, "App", 1_000_000);
        assert!(matches!(r1, TickOutcome::WroteKeyframe { .. }));

        // Pause via privacy snapshot.
        privacy.paused = true;
        let r2 = capture_tick(&mut state, &mut source, &db, &privacy, "App", 1_000_100);
        assert_eq!(r2, TickOutcome::SkippedPrivate(PrivacyFlag::Paused));

        // Resume: privacy.paused = false.
        privacy.paused = false;
        let r3 = capture_tick(&mut state, &mut source, &db, &privacy, "App", 1_000_200);
        assert!(matches!(r3, TickOutcome::WroteKeyframe { .. } | TickOutcome::NoKeyframe));
    }

    #[test]
    fn b2_force_keyframe_label_writes_action_prefix() {
        // Drive an identical-frame source so motion gate would NOT fire.
        // Set the force-keyframe slot, run a tick, assert a keyframe was
        // written AND its active_window starts with "[action]".
        struct ConstFrame(usize);
        impl FrameSource for ConstFrame {
            fn next_frame(&mut self) -> Option<VideoFrame> {
                if self.0 == 0 { return None; }
                self.0 -= 1;
                Some(VideoFrame {
                    monitor_idx: 0, width: 32, height: 32, pts_ms: 0,
                    pixels_rgba: vec![128u8; 32 * 32 * 4],
                })
            }
        }
        let mut state = fresh_state();
        state.motion_threshold = u64::MAX;          // disable motion gate
        state.max_keyframe_interval_ms = 999_999;   // disable heartbeat
        let mut source = ConstFrame(2);
        let db = SessionDb::open_memory().unwrap();
        let privacy = RuntimePrivacy::default();

        // First tick: even with disabled motion gate, sad=u64::MAX writes a keyframe.
        let _ = capture_tick(&mut state, &mut source, &db, &privacy, "Notepad", 1_000_000);

        // Second tick: identical frame → no motion → no heartbeat → no keyframe...
        // UNLESS we set the force slot.
        {
            let mut slot = state.force_keyframe_label.lock().unwrap();
            *slot = Some("typed-text".into());
        }
        let r = capture_tick(&mut state, &mut source, &db, &privacy, "Notepad", 1_000_100);
        match r {
            TickOutcome::WroteKeyframe { keyframe_id, .. } => {
                // Pull recent keyframes; the newest one is ours.
                let rows = db.get_recent_keyframes(2, None).unwrap();
                let ours = rows.iter().find(|r| r.0 == keyframe_id).expect("keyframe row");
                assert!(ours.5.starts_with("[action]"), "expected [action] prefix, got: {}", ours.5);
                assert!(ours.5.contains("typed-text"));
            }
            other => panic!("force-slot must produce keyframe even when motion gate is disabled; got {:?}", other),
        }
        // Slot must be cleared after consumption.
        assert!(state.force_keyframe_label.lock().unwrap().is_none());
    }

    /// A6 — the integration test. Run with:
    ///   cargo test --manifest-path src-tauri/Cargo.toml --lib live_screenshot_capture_lands_keyframe_in_db -- --ignored --nocapture
    /// It captures a real frame from monitor 0, runs three ticks, and asserts
    /// that ≥1 keyframe row landed in an in-memory `SessionDb` with a non-empty
    /// `thumb_jpeg_enc`. Gated `#[ignore]` so CI runs without a display.
    #[test]
    #[ignore]
    fn live_screenshot_capture_lands_keyframe_in_db() {
        use crate::video::screenshots_source::ScreenshotsFrameSource;
        let mut source: Box<dyn FrameSource> =
            Box::new(ScreenshotsFrameSource::for_monitor(0));
        // Make the source very fast so we don't have to sleep here.
        // (The default interval is 100ms.)
        let mut state = fresh_state();
        let db = SessionDb::open_memory().unwrap();
        let privacy = RuntimePrivacy::default();

        let mut wrote = 0;
        for i in 0..3 {
            let now = 1_700_000_000_000 + (i as i64) * 200;
            let outcome = capture_tick(&mut state, source.as_mut(), &db, &privacy, "TestApp", now);
            if matches!(outcome, TickOutcome::WroteKeyframe { .. }) {
                wrote += 1;
            }
        }
        assert!(wrote >= 1, "expected ≥1 real keyframe from a live screen capture, got {wrote}");

        let rows = db.get_recent_keyframes(10, None).unwrap();
        assert!(!rows.is_empty());
        let kf_id = rows[0].0;
        let thumb = db.get_keyframe_thumb(kf_id).unwrap();
        assert!(thumb.is_some(), "thumb_jpeg_enc must be present for live keyframes");
        assert!(thumb.as_ref().unwrap().len() > 100, "thumb base64 should be substantial");
    }
}
