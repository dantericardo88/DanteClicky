//! Shared types for the video pipeline.

use serde::{Deserialize, Serialize};

pub const DEFAULT_FPS_MIN: f32 = 0.5;
pub const DEFAULT_FPS_MAX: f32 = 10.0;
pub const DEFAULT_DISK_MINUTES: u32 = 15;
pub const DEFAULT_RAM_MINUTES: u32 = 5;
pub const DEFAULT_SEGMENT_SECONDS: u32 = 60;

/// A single decoded frame from the screen, plus capture metadata.
/// Pixels are tightly packed RGBA (4 bytes per pixel, R first). Used by
/// tests and the production capture loop.
///
/// History note: this field was originally named `bgra` and the source did
/// an R↔B swap on capture, then `encode_thumbnail` swapped again — a wasteful
/// no-op that hid bugs. As of the Phase A2 honest-9+ correction, capture
/// stores RGBA directly and there is no swap anywhere.
#[derive(Clone)]
pub struct VideoFrame {
    pub monitor_idx: u32,
    pub width: u32,
    pub height: u32,
    pub pts_ms: i64,
    pub pixels_rgba: Vec<u8>,
}

impl std::fmt::Debug for VideoFrame {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VideoFrame")
            .field("monitor_idx", &self.monitor_idx)
            .field("width", &self.width)
            .field("height", &self.height)
            .field("pts_ms", &self.pts_ms)
            .field("pixels_rgba_len", &self.pixels_rgba.len())
            .finish()
    }
}

/// One on-disk fMP4 chunk (or, for the in-RAM ringbuf, the encoded NALUs that
/// would have been written to that chunk). The ringbuf does not need disk I/O.
#[derive(Debug, Clone)]
pub struct EncodedSegment {
    pub monitor_idx: u32,
    /// Wall-clock start of this segment, ms since unix epoch.
    pub start_ms: i64,
    /// Wall-clock end (None = still being written).
    pub end_ms: Option<i64>,
    pub duration_ms: u64,
    pub width: u32,
    pub height: u32,
    pub frame_count: u32,
    pub bytes: Vec<u8>,
    pub privacy_flag: PrivacyFlag,
}

impl EncodedSegment {
    pub fn byte_size(&self) -> usize {
        self.bytes.len()
    }
}

/// Privacy state of a segment — controls what shows in the timeline and whether
/// the bytes are persisted at all.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrivacyFlag {
    Normal,
    Excluded,
    DrmBlackout,
    Paused,
    Incognito,
}

impl PrivacyFlag {
    pub fn as_str(self) -> &'static str {
        match self {
            PrivacyFlag::Normal => "normal",
            PrivacyFlag::Excluded => "excluded",
            PrivacyFlag::DrmBlackout => "drm_blackout",
            PrivacyFlag::Paused => "paused",
            PrivacyFlag::Incognito => "incognito",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "excluded" => PrivacyFlag::Excluded,
            "drm_blackout" => PrivacyFlag::DrmBlackout,
            "paused" => PrivacyFlag::Paused,
            "incognito" => PrivacyFlag::Incognito,
            _ => PrivacyFlag::Normal,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoStartOpts {
    /// Which monitor indices to record. Empty = all detected monitors.
    #[serde(default)]
    pub monitors: Vec<u32>,
    #[serde(default = "default_fps_min")]
    pub fps_min: f32,
    #[serde(default = "default_fps_max")]
    pub fps_max: f32,
    #[serde(default = "default_disk_minutes")]
    pub disk_minutes: u32,
    #[serde(default = "default_ram_minutes")]
    pub ram_minutes: u32,
    #[serde(default = "default_segment_seconds")]
    pub segment_seconds: u32,
}

impl Default for VideoStartOpts {
    fn default() -> Self {
        Self {
            monitors: vec![],
            fps_min: DEFAULT_FPS_MIN,
            fps_max: DEFAULT_FPS_MAX,
            disk_minutes: DEFAULT_DISK_MINUTES,
            ram_minutes: DEFAULT_RAM_MINUTES,
            segment_seconds: DEFAULT_SEGMENT_SECONDS,
        }
    }
}

impl VideoStartOpts {
    /// RAM capacity used to size the in-memory ringbuf — assumes ~3.5 Mbps avg
    /// (H.264 5–10 FPS, 1080p typical desktop content). Keeps a safety margin.
    pub fn ram_capacity_bytes(&self) -> usize {
        const AVG_BPS: usize = 3_500_000;
        let secs = self.ram_minutes as usize * 60;
        AVG_BPS / 8 * secs
    }
}

fn default_fps_min() -> f32 { DEFAULT_FPS_MIN }
fn default_fps_max() -> f32 { DEFAULT_FPS_MAX }
fn default_disk_minutes() -> u32 { DEFAULT_DISK_MINUTES }
fn default_ram_minutes() -> u32 { DEFAULT_RAM_MINUTES }
fn default_segment_seconds() -> u32 { DEFAULT_SEGMENT_SECONDS }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VideoStatus {
    pub running: bool,
    pub ram_bytes: u64,
    pub ram_segments: u64,
    pub disk_segments: u64,
    pub disk_bytes: u64,
    pub current_fps: f32,
    pub dropped_frames: u64,
    pub uptime_seconds: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_opts_have_sane_values() {
        let o = VideoStartOpts::default();
        assert_eq!(o.fps_min, 0.5);
        assert_eq!(o.fps_max, 10.0);
        assert_eq!(o.disk_minutes, 15);
        assert_eq!(o.ram_minutes, 5);
    }

    #[test]
    fn ram_capacity_grows_with_ram_minutes() {
        let mut o = VideoStartOpts::default();
        let small = o.ram_capacity_bytes();
        o.ram_minutes = 10;
        let large = o.ram_capacity_bytes();
        assert!(large > small);
        assert_eq!(large, small * 2);
    }

    #[test]
    fn privacy_flag_roundtrip() {
        for f in [
            PrivacyFlag::Normal,
            PrivacyFlag::Excluded,
            PrivacyFlag::DrmBlackout,
            PrivacyFlag::Paused,
            PrivacyFlag::Incognito,
        ] {
            assert_eq!(PrivacyFlag::from_str(f.as_str()), f);
        }
    }
}
