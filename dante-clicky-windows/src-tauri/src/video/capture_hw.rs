//! Windows-only hardware video capture backend.
//!
//! This module is intentionally tiny until the Media Foundation encoder path is
//! wired into `VideoSession`; keeping it present makes the optional
//! `video-hw-capture` feature compile instead of pointing at a missing file.

#[cfg(target_os = "windows")]
pub fn backend_name() -> &'static str {
    "windows-graphics-capture"
}
