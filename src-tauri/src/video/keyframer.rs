//! Bridge between the JS ambient capture loop (useAmbient.ts) and the
//! Rust video segmenter. When ambient saves a snapshot, we also write a
//! keyframe row that points at the live video segment for that monitor +
//! the nearest pts_ms to the capture wall-clock.
//!
//! Phase 3 — keyframe ↔ ambient OCR linkage.
//! Phase 4 — adds the SAD motion estimator + adaptive FPS controller (also here).

use super::types::{PrivacyFlag, VideoFrame};

/// Sum-of-absolute-differences motion score between two BGRA frames.
/// Downsamples to 16x16 (per-axis stride) to keep the cost O(256) regardless
/// of resolution. Returns the raw sum — caller compares against a threshold.
pub fn motion_sad(prev: &[u8], next: &[u8], width: u32, height: u32) -> u64 {
    let stride_x = (width / 16).max(1) as usize;
    let stride_y = (height / 16).max(1) as usize;
    let mut sad: u64 = 0;
    let row_bytes = (width as usize) * 4;

    let mut y = 0usize;
    while y < height as usize {
        let row_off = y * row_bytes;
        let mut x = 0usize;
        while x < width as usize {
            let off = row_off + x * 4;
            if off + 3 < prev.len() && off + 3 < next.len() {
                let p = (prev[off] as i32) + (prev[off + 1] as i32) + (prev[off + 2] as i32);
                let n = (next[off] as i32) + (next[off + 1] as i32) + (next[off + 2] as i32);
                sad = sad.saturating_add((p - n).unsigned_abs() as u64);
            }
            x += stride_x;
        }
        y += stride_y;
    }
    sad
}

/// Adaptive FPS controller. Tracks a sliding window of motion scores and
/// drops the encode rate when consecutive frames are below a threshold.
pub struct AdaptiveFps {
    fps_min: f32,
    fps_max: f32,
    pub current_fps: f32,
    /// Number of consecutive low-motion samples seen.
    quiet_streak: u32,
    /// Threshold below which a frame is considered "quiet". Tuned for 16x16
    /// downsample on 1080p — 256 samples × 3 channels × <2 raw delta avg.
    motion_threshold: u64,
    quiet_streak_to_drop: u32,
}

impl AdaptiveFps {
    pub fn new(fps_min: f32, fps_max: f32) -> Self {
        Self {
            fps_min,
            fps_max,
            current_fps: fps_max,
            quiet_streak: 0,
            motion_threshold: 1500,
            quiet_streak_to_drop: 3,
        }
    }

    pub fn observe(&mut self, motion_sad: u64) {
        if motion_sad < self.motion_threshold {
            self.quiet_streak = self.quiet_streak.saturating_add(1);
            if self.quiet_streak >= self.quiet_streak_to_drop {
                self.current_fps = self.fps_min;
            }
        } else {
            self.quiet_streak = 0;
            self.current_fps = self.fps_max;
        }
    }

    pub fn target_frame_interval_ms(&self) -> u64 {
        let fps = self.current_fps.max(0.01);
        (1000.0 / fps) as u64
    }
}

/// Check whether a frame is a hardware DRM/UAC blackout — solid black or
/// near-zero mean luminance from WGC's protected-content fallback.
pub fn is_drm_blackout(frame: &VideoFrame) -> bool {
    if frame.pixels_rgba.is_empty() {
        return false;
    }
    // Sample 256 pixels at stride
    let stride = (frame.pixels_rgba.len() / (256 * 4)).max(1);
    let mut sum: u64 = 0;
    let mut count: u64 = 0;
    let mut i = 0;
    while i + 3 < frame.pixels_rgba.len() {
        let lum = (frame.pixels_rgba[i] as u64)
            + (frame.pixels_rgba[i + 1] as u64)
            + (frame.pixels_rgba[i + 2] as u64);
        sum += lum;
        count += 1;
        i += 4 * stride;
    }
    if count == 0 {
        return false;
    }
    let mean = sum / count;
    mean < 6 // mean BGR sum per pixel < 6 → essentially black
}

/// Resolve an active-window title into the privacy flag the segmenter should
/// apply for the next encoded segment. Used by Phase 4 to honor the user's
/// `ambientExcludedApps` list and the global incognito toggle.
pub fn classify_privacy(
    active_window: &str,
    excluded_apps: &[String],
    incognito: bool,
    paused: bool,
) -> PrivacyFlag {
    if incognito {
        return PrivacyFlag::Incognito;
    }
    if paused {
        return PrivacyFlag::Paused;
    }
    let lower = active_window.to_ascii_lowercase();
    for app in excluded_apps {
        if app.is_empty() {
            continue;
        }
        if lower.contains(&app.to_ascii_lowercase()) {
            return PrivacyFlag::Excluded;
        }
    }
    PrivacyFlag::Normal
}

#[cfg(test)]
mod tests {
    use super::*;

    fn solid_bgra(w: u32, h: u32, b: u8, g: u8, r: u8) -> Vec<u8> {
        let pixels = (w * h) as usize;
        let mut buf = vec![0u8; pixels * 4];
        for chunk in buf.chunks_exact_mut(4) {
            chunk[0] = b;
            chunk[1] = g;
            chunk[2] = r;
            chunk[3] = 0xFF;
        }
        buf
    }

    #[test]
    fn motion_sad_zero_for_identical_frames() {
        let a = solid_bgra(64, 64, 100, 100, 100);
        let b = a.clone();
        assert_eq!(motion_sad(&a, &b, 64, 64), 0);
    }

    #[test]
    fn motion_sad_nonzero_for_different_frames() {
        let a = solid_bgra(64, 64, 0, 0, 0);
        let b = solid_bgra(64, 64, 255, 255, 255);
        let sad = motion_sad(&a, &b, 64, 64);
        assert!(sad > 0);
    }

    #[test]
    fn adaptive_fps_starts_at_max() {
        let f = AdaptiveFps::new(0.5, 10.0);
        assert!((f.current_fps - 10.0).abs() < 0.01);
    }

    #[test]
    fn adaptive_fps_drops_on_three_quiet_frames() {
        let mut f = AdaptiveFps::new(0.5, 10.0);
        f.observe(0);
        assert_eq!(f.current_fps, 10.0, "1 quiet frame is not enough to drop");
        f.observe(0);
        assert_eq!(f.current_fps, 10.0, "2 quiet frames is not enough to drop");
        f.observe(0);
        assert!((f.current_fps - 0.5).abs() < 0.01, "3 quiet frames drops to fps_min");
    }

    #[test]
    fn adaptive_fps_snaps_back_on_motion() {
        let mut f = AdaptiveFps::new(0.5, 10.0);
        f.observe(0);
        f.observe(0);
        f.observe(0);
        assert!((f.current_fps - 0.5).abs() < 0.01);
        f.observe(99_999);
        assert!((f.current_fps - 10.0).abs() < 0.01);
    }

    #[test]
    fn drm_blackout_detects_all_zero_frames() {
        let frame = VideoFrame {
            monitor_idx: 0,
            width: 16,
            height: 16,
            pts_ms: 0,
            pixels_rgba: vec![0u8; 16 * 16 * 4],
        };
        assert!(is_drm_blackout(&frame));
    }

    #[test]
    fn drm_blackout_false_for_non_black() {
        let frame = VideoFrame {
            monitor_idx: 0,
            width: 16,
            height: 16,
            pts_ms: 0,
            pixels_rgba: solid_bgra(16, 16, 100, 100, 100),
        };
        assert!(!is_drm_blackout(&frame));
    }

    #[test]
    fn classify_privacy_incognito_wins() {
        assert_eq!(
            classify_privacy("Chrome — bank.com", &["chrome".into()], true, false),
            PrivacyFlag::Incognito
        );
    }

    #[test]
    fn classify_privacy_excluded_app_match_case_insensitive() {
        assert_eq!(
            classify_privacy(
                "Discord — DM",
                &["discord".into()],
                false, false
            ),
            PrivacyFlag::Excluded
        );
    }

    #[test]
    fn classify_privacy_normal_when_no_match() {
        assert_eq!(
            classify_privacy("Notepad", &["chrome".into()], false, false),
            PrivacyFlag::Normal
        );
    }

    #[test]
    fn classify_privacy_paused_when_paused_flag_set() {
        assert_eq!(
            classify_privacy("Anything", &[], false, true),
            PrivacyFlag::Paused
        );
    }
}
