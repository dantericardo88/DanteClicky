//! Segmenter — rotates 60-second fMP4 chunks per monitor under
//! `<root>/monitor_<idx>/<unix_ms>.mp4`. The actual H.264 muxing is a Phase 1b
//! task behind `video-hw-capture`; this struct owns the rotation policy + on-disk
//! accounting so Phase 2's manifest writer can be tested independently.

use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use super::types::{EncodedSegment, PrivacyFlag};

#[derive(Debug, Clone)]
pub struct SegmentRecord {
    pub monitor_idx: u32,
    pub path: PathBuf,
    pub start_ms: i64,
    pub end_ms: i64,
    pub duration_ms: u64,
    pub byte_size: u64,
    pub width: u32,
    pub height: u32,
    pub fps_avg: f32,
    pub privacy_flag: PrivacyFlag,
}

pub struct Segmenter {
    root_dir: PathBuf,
    monitors: Vec<u32>,
    segment_seconds: u32,
    /// History of segments already flushed to disk (one entry per file).
    history: Vec<SegmentRecord>,
    current_fps: f32,
    dropped_frames: u64,
    /// Override for tests so segmenter doesn't need to call SystemTime::now().
    now_fn: Option<Box<dyn Fn() -> i64 + Send + Sync>>,
}

impl Segmenter {
    pub fn new(root_dir: PathBuf, monitors: Vec<u32>, segment_seconds: u32) -> Self {
        Self {
            root_dir,
            monitors,
            segment_seconds: segment_seconds.max(1),
            history: Vec::new(),
            current_fps: 0.0,
            dropped_frames: 0,
            now_fn: None,
        }
    }

    pub fn with_clock<F: Fn() -> i64 + Send + Sync + 'static>(mut self, f: F) -> Self {
        self.now_fn = Some(Box::new(f));
        self
    }

    fn now_ms(&self) -> i64 {
        if let Some(f) = &self.now_fn {
            f()
        } else {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0)
        }
    }

    pub fn root_dir(&self) -> &Path {
        &self.root_dir
    }

    pub fn segment_seconds(&self) -> u32 {
        self.segment_seconds
    }

    pub fn monitors(&self) -> &[u32] {
        &self.monitors
    }

    pub fn current_fps(&self) -> f32 {
        self.current_fps
    }

    pub fn record_dropped(&mut self, n: u64) {
        self.dropped_frames = self.dropped_frames.saturating_add(n);
    }

    pub fn dropped_frames(&self) -> u64 {
        self.dropped_frames
    }

    pub fn update_fps(&mut self, fps: f32) {
        self.current_fps = fps;
    }

    pub fn total_disk_segments(&self) -> u64 {
        self.history.len() as u64
    }

    pub fn total_disk_bytes(&self) -> u64 {
        self.history.iter().map(|r| r.byte_size).sum()
    }

    pub fn history(&self) -> &[SegmentRecord] {
        &self.history
    }

    /// Compute the file path for a new segment starting at the given wall-clock ms.
    pub fn segment_path(&self, monitor_idx: u32, start_ms: i64) -> PathBuf {
        self.root_dir
            .join(format!("monitor_{}", monitor_idx))
            .join(format!("{}.mp4", start_ms))
    }

    /// Decide whether the current encoder should rotate to a new segment.
    /// True when wall-clock has crossed a `segment_seconds` boundary.
    pub fn should_rotate(&self, current_segment_start_ms: i64) -> bool {
        let now = self.now_ms();
        let elapsed_ms = now.saturating_sub(current_segment_start_ms);
        elapsed_ms >= (self.segment_seconds as i64) * 1000
    }

    /// Record a finished segment. Returns the chosen on-disk path.
    pub fn record_finished(&mut self, segment: &EncodedSegment) -> PathBuf {
        let path = self.segment_path(segment.monitor_idx, segment.start_ms);
        let end = segment
            .end_ms
            .unwrap_or(segment.start_ms + segment.duration_ms as i64);
        let rec = SegmentRecord {
            monitor_idx: segment.monitor_idx,
            path: path.clone(),
            start_ms: segment.start_ms,
            end_ms: end,
            duration_ms: segment.duration_ms,
            byte_size: segment.byte_size() as u64,
            width: segment.width,
            height: segment.height,
            fps_avg: if segment.duration_ms == 0 {
                0.0
            } else {
                (segment.frame_count as f32) * 1000.0 / (segment.duration_ms as f32)
            },
            privacy_flag: segment.privacy_flag,
        };
        self.history.push(rec);
        path
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicI64, Ordering};
    use std::sync::Arc;

    fn seg(monitor: u32, start_ms: i64, dur: u64, size: usize) -> EncodedSegment {
        EncodedSegment {
            monitor_idx: monitor,
            start_ms,
            end_ms: Some(start_ms + dur as i64),
            duration_ms: dur,
            width: 1920,
            height: 1080,
            frame_count: 600,
            bytes: vec![0u8; size],
            privacy_flag: PrivacyFlag::Normal,
        }
    }

    #[test]
    fn segment_path_is_per_monitor_and_unique_per_start_ms() {
        let s = Segmenter::new(PathBuf::from("/tmp/v"), vec![0, 1], 60);
        let p0 = s.segment_path(0, 1_700_000_000_000);
        let p1 = s.segment_path(1, 1_700_000_000_000);
        assert_ne!(p0, p1);
        assert!(p0.to_string_lossy().contains("monitor_0"));
        assert!(p1.to_string_lossy().contains("monitor_1"));
    }

    #[test]
    fn rotates_at_60s_using_fake_clock() {
        let now = Arc::new(AtomicI64::new(1_000_000));
        let n = now.clone();
        let s = Segmenter::new(PathBuf::from("/tmp/v"), vec![0], 60).with_clock(move || n.load(Ordering::SeqCst));

        let segment_start = 1_000_000;
        assert!(!s.should_rotate(segment_start), "0s elapsed");

        now.store(1_000_000 + 30_000, Ordering::SeqCst);
        assert!(!s.should_rotate(segment_start), "30s elapsed");

        now.store(1_000_000 + 59_999, Ordering::SeqCst);
        assert!(!s.should_rotate(segment_start), "59.999s elapsed");

        now.store(1_000_000 + 60_000, Ordering::SeqCst);
        assert!(s.should_rotate(segment_start), "60s elapsed");

        now.store(1_000_000 + 60_001, Ordering::SeqCst);
        assert!(s.should_rotate(segment_start), "60.001s elapsed");
    }

    #[test]
    fn record_finished_accumulates_history() {
        let mut s = Segmenter::new(PathBuf::from("/tmp/v"), vec![0], 60);
        assert_eq!(s.total_disk_segments(), 0);
        s.record_finished(&seg(0, 0, 60_000, 8_000_000));
        s.record_finished(&seg(0, 60_000, 60_000, 8_000_000));
        assert_eq!(s.total_disk_segments(), 2);
        assert_eq!(s.total_disk_bytes(), 16_000_000);
    }

    #[test]
    fn fps_avg_calculated_from_frame_count_and_duration() {
        let mut s = Segmenter::new(PathBuf::from("/tmp/v"), vec![0], 60);
        s.record_finished(&seg(0, 0, 60_000, 100));
        let h = s.history();
        assert!((h[0].fps_avg - 10.0).abs() < 0.01);
    }

    #[test]
    fn dropped_frames_accumulate() {
        let mut s = Segmenter::new(PathBuf::from("/tmp/v"), vec![0], 60);
        s.record_dropped(3);
        s.record_dropped(2);
        assert_eq!(s.dropped_frames(), 5);
    }
}
