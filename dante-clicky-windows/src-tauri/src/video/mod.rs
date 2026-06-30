//! Dimension 16 — Video / temporal context.
//!
//! Continuous rolling video capture with timeline scrubbing and OCR-indexed seeking.
//! Goal: match Screenpipe's 24/7 video moat AND exceed it via DanteClicky's existing
//! triple-encryption (SQLCipher + ChaCha20-Poly1305 + DPAPI) and semantic-search edge.
//!
//! Architecture:
//!   - `FrameSource` trait abstracts the pixel source so tests run without a display.
//!   - `RingBuffer` keeps the last N seconds of encoded segments in RAM (hot tier).
//!   - `Segmenter` rotates 60-second fMP4 chunks to disk under
//!     `%LOCALAPPDATA%/DanteClicky/video/monitor_<idx>/` (cold tier).
//!   - `VideoState` is the Tauri-managed handle that owns the capture loop.
//!
//! Hardware capture (Windows Graphics Capture + Media Foundation encoder) is
//! target-gated behind `video-hw-capture` on Windows. The default build ships
//! the screenshots/mock source so cargo test runs in any environment.

pub mod capture_loop;
pub mod keyframer;
pub mod ringbuf;
pub mod screenshots_source;
pub mod segmenter;
pub mod source;
pub mod types;

#[cfg(all(feature = "video-hw-capture", target_os = "windows"))]
pub mod capture_hw;

use std::sync::{Arc, Mutex, RwLock};

pub use capture_loop::RuntimePrivacy;
pub use ringbuf::RingBuffer;
pub use segmenter::Segmenter;
pub use source::{FrameSource, MockFrameSource};
pub use types::{
    EncodedSegment, PrivacyFlag, VideoFrame, VideoStartOpts, VideoStatus, DEFAULT_DISK_MINUTES,
    DEFAULT_FPS_MAX, DEFAULT_FPS_MIN, DEFAULT_RAM_MINUTES,
};

/// Tauri-managed state for the video subsystem. A `None` inner means video is stopped.
#[derive(Default)]
pub struct VideoState(pub Mutex<Option<VideoSession>>);

/// Tauri-managed mutable runtime privacy snapshot read by the capture loop
/// each tick. JS-side toggles flow through `video_set_privacy` and update
/// this without restarting the thread.
#[derive(Default)]
pub struct VideoPrivacyState(pub Arc<RwLock<RuntimePrivacy>>);

/// One running video capture session — owns the ring buffer, segmenter, and a stop flag.
pub struct VideoSession {
    pub opts: VideoStartOpts,
    pub ringbuf: Arc<Mutex<RingBuffer>>,
    pub segmenter: Arc<Mutex<Segmenter>>,
    pub stop_flag: Arc<std::sync::atomic::AtomicBool>,
    pub started_at: std::time::SystemTime,
    /// Capture-loop join handles, one per monitor. Cleared on stop.
    pub capture_handles: Vec<std::thread::JoinHandle<()>>,
    /// Force-keyframe slots, one per monitor. The Tauri command
    /// `video_capture_now(label)` writes the label into all slots so every
    /// monitor emits a labeled keyframe on its next tick (Phase B2).
    pub force_keyframe_slots: Vec<Arc<Mutex<Option<String>>>>,
}

impl VideoSession {
    pub fn new(opts: VideoStartOpts, root_dir: std::path::PathBuf) -> Self {
        let ram_capacity_bytes = opts.ram_capacity_bytes();
        let segmenter = Segmenter::new(root_dir, opts.monitors.clone(), opts.segment_seconds);
        Self {
            ringbuf: Arc::new(Mutex::new(RingBuffer::new(ram_capacity_bytes))),
            segmenter: Arc::new(Mutex::new(segmenter)),
            stop_flag: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            started_at: std::time::SystemTime::now(),
            capture_handles: Vec::new(),
            force_keyframe_slots: Vec::new(),
            opts,
        }
    }

    pub fn status(&self) -> VideoStatus {
        let rb = self.ringbuf.lock().unwrap();
        let seg = self.segmenter.lock().unwrap();
        VideoStatus {
            running: !self.stop_flag.load(std::sync::atomic::Ordering::SeqCst),
            ram_bytes: rb.bytes_used(),
            ram_segments: rb.len() as u64,
            disk_segments: seg.total_disk_segments(),
            disk_bytes: seg.total_disk_bytes(),
            current_fps: seg.current_fps(),
            dropped_frames: seg.dropped_frames(),
            uptime_seconds: self
                .started_at
                .elapsed()
                .map(|d| d.as_secs())
                .unwrap_or(0),
        }
    }
}
