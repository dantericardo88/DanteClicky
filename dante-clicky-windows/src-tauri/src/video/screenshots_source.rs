//! Production `FrameSource` impl backed by the existing `screenshots` crate
//! that the rest of DanteClicky uses for `capture_primary` / `capture_all`.
//!
//! Captures BGRA frames at a target cadence dictated by the adaptive FPS
//! controller. The wall-clock pacing is enforced inside `next_frame()` so the
//! capture loop can simply call `source.next_frame()` in a tight loop.
//!
//! Construction is by `monitor_idx`; the `Screen` handle is re-resolved on
//! each capture (matching `capture_primary()`'s pattern in `capture.rs`) so we
//! don't accumulate platform handles across long sessions and we recover from
//! monitor hot-plug events automatically.
//!
//! For unit tests, prefer `MockFrameSource` from `source.rs` — this source
//! requires a real display.
//!
//! Wave: Dim 16 / Phase 1.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use screenshots::Screen;

use super::source::FrameSource;
use super::types::VideoFrame;

/// A `FrameSource` that pulls one frame at a time from a real monitor via
/// the `screenshots` crate. Pacing is governed by `target_interval_ms`,
/// which the capture loop updates from `AdaptiveFps::target_frame_interval_ms()`.
pub struct ScreenshotsFrameSource {
    monitor_idx: u32,
    target_interval_ms: Arc<AtomicU64>,
    last_capture_at: Option<Instant>,
    pts_origin_ms: i64,
}

impl ScreenshotsFrameSource {
    /// Build a source for the given monitor index. The lookup is deferred to
    /// `next_frame()` — construction never fails so video_start can succeed
    /// even if a monitor is briefly unplugged.
    pub fn for_monitor(monitor_idx: u32) -> Self {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        Self {
            monitor_idx,
            target_interval_ms: Arc::new(AtomicU64::new(100)),
            last_capture_at: None,
            pts_origin_ms: now_ms,
        }
    }

    /// Return a handle to the interval the capture loop updates each tick.
    pub fn interval_handle(&self) -> Arc<AtomicU64> {
        Arc::clone(&self.target_interval_ms)
    }

    /// Update the target capture interval directly. Mostly used in tests.
    pub fn set_target_interval_ms(&self, ms: u64) {
        self.target_interval_ms.store(ms, Ordering::SeqCst);
    }

    fn capture_one(&self) -> Option<VideoFrame> {
        let screens = Screen::all().ok()?;
        let screen = screens.get(self.monitor_idx as usize)?;
        let captured = screen.capture().ok()?;
        let width = captured.width();
        let height = captured.height();
        // A2: store RGBA directly — no swap. The `screenshots` crate's
        // `ImageBuffer<Rgba<u8>, _>` is exactly what the rest of the pipeline
        // expects after the rename in types.rs.
        let pixels_rgba: Vec<u8> = captured.into_raw();
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        Some(VideoFrame {
            monitor_idx: self.monitor_idx,
            width,
            height,
            pts_ms: now_ms - self.pts_origin_ms,
            pixels_rgba,
        })
    }
}

impl FrameSource for ScreenshotsFrameSource {
    fn next_frame(&mut self) -> Option<VideoFrame> {
        let interval_ms = self.target_interval_ms.load(Ordering::SeqCst).max(1);
        let target_interval = Duration::from_millis(interval_ms);

        if let Some(last) = self.last_capture_at {
            let elapsed = last.elapsed();
            if elapsed < target_interval {
                std::thread::sleep(target_interval - elapsed);
            }
        }

        let frame = self.capture_one();
        self.last_capture_at = Some(Instant::now());
        frame
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn for_monitor_construction_is_infallible() {
        // Even on a headless CI box, construction must not panic.
        let src = ScreenshotsFrameSource::for_monitor(0);
        assert_eq!(src.monitor_idx, 0);
    }

    #[test]
    fn target_interval_default_is_100ms() {
        let src = ScreenshotsFrameSource::for_monitor(0);
        assert_eq!(src.target_interval_ms.load(Ordering::SeqCst), 100);
    }

    #[test]
    fn set_target_interval_ms_updates_handle() {
        let src = ScreenshotsFrameSource::for_monitor(0);
        let handle = src.interval_handle();
        src.set_target_interval_ms(2000);
        assert_eq!(handle.load(Ordering::SeqCst), 2000);
    }

    #[test]
    fn interval_handle_shares_state_with_source() {
        let src = ScreenshotsFrameSource::for_monitor(0);
        let handle = src.interval_handle();
        handle.store(500, Ordering::SeqCst);
        assert_eq!(src.target_interval_ms.load(Ordering::SeqCst), 500);
    }

    /// Smoke: hitting a real display is gated behind `#[ignore]` so CI runs
    /// pass without an X11/Wayland/Windows session.
    #[test]
    #[ignore]
    fn next_frame_returns_a_frame_on_real_display() {
        let mut src = ScreenshotsFrameSource::for_monitor(0);
        src.set_target_interval_ms(10);
        let f = src.next_frame().expect("should capture a frame");
        assert!(f.pixels_rgba.len() >= 4);
        assert_eq!(f.pixels_rgba.len(), (f.width as usize) * (f.height as usize) * 4);
    }
}
