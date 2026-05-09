//! Frame source abstraction. Production = WGC capture (feature-gated).
//! Tests = MockFrameSource that synthesizes frames on demand.

use super::types::VideoFrame;

/// A source of decoded RGBA/BGRA frames. Async via blocking `next_frame()` so
/// the encoder thread drives the cadence — keeps logic testable without async runtimes.
pub trait FrameSource: Send {
    /// Block until the next frame is available, or return None if the source is closed.
    fn next_frame(&mut self) -> Option<VideoFrame>;
}

/// A deterministic frame source for tests. Each `next_frame` returns a synthetic
/// solid-color BGRA buffer with monotonically increasing pts_ms.
pub struct MockFrameSource {
    monitor_idx: u32,
    width: u32,
    height: u32,
    /// Frames remaining; None = unlimited.
    remaining: Option<usize>,
    pts_ms: i64,
    pts_step_ms: i64,
    color_seed: u8,
}

impl MockFrameSource {
    pub fn new(monitor_idx: u32, width: u32, height: u32, frame_count: Option<usize>) -> Self {
        Self {
            monitor_idx,
            width,
            height,
            remaining: frame_count,
            pts_ms: 0,
            pts_step_ms: 100, // 10 FPS
            color_seed: 0,
        }
    }

    pub fn with_pts_step(mut self, step_ms: i64) -> Self {
        self.pts_step_ms = step_ms;
        self
    }
}

impl FrameSource for MockFrameSource {
    fn next_frame(&mut self) -> Option<VideoFrame> {
        if let Some(r) = self.remaining {
            if r == 0 {
                return None;
            }
            self.remaining = Some(r - 1);
        }

        let pixels = (self.width * self.height) as usize;
        let mut pixels_rgba = vec![0u8; pixels * 4];
        // Fill with a slowly cycling solid color so motion estimators see real diffs.
        let v = self.color_seed;
        for chunk in pixels_rgba.chunks_exact_mut(4) {
            chunk[0] = v;
            chunk[1] = v.wrapping_add(64);
            chunk[2] = v.wrapping_add(128);
            chunk[3] = 0xFF;
        }
        self.color_seed = self.color_seed.wrapping_add(7);

        let pts = self.pts_ms;
        self.pts_ms += self.pts_step_ms;

        Some(VideoFrame {
            monitor_idx: self.monitor_idx,
            width: self.width,
            height: self.height,
            pts_ms: pts,
            pixels_rgba,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_source_emits_requested_count() {
        let mut s = MockFrameSource::new(0, 320, 240, Some(3));
        assert!(s.next_frame().is_some());
        assert!(s.next_frame().is_some());
        assert!(s.next_frame().is_some());
        assert!(s.next_frame().is_none());
    }

    #[test]
    fn mock_source_pts_advances_monotonically() {
        let mut s = MockFrameSource::new(0, 16, 16, Some(5)).with_pts_step(50);
        let mut last = -1i64;
        while let Some(f) = s.next_frame() {
            assert!(f.pts_ms > last, "pts must advance");
            last = f.pts_ms;
        }
    }

    #[test]
    fn mock_source_unlimited_when_no_count() {
        let mut s = MockFrameSource::new(0, 8, 8, None);
        for _ in 0..1000 {
            assert!(s.next_frame().is_some());
        }
    }
}
