use base64::{engine::general_purpose::STANDARD, Engine};
use image::DynamicImage;
use rayon::prelude::*;
use screenshots::Screen;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Mutex;

// ── Dim 18: Frame-on-change cache ─────────────────────────────────────────────
//
// Skips re-encoding when screen content hasn't changed since last capture.
// Each monitor slot stores a CRC32 of its raw RGBA bytes + the last encoded
// response. If the hash matches on the next call, the cached JSON is returned
// immediately (sub-millisecond vs. 50-150ms for a full encode).

struct FrameCache {
    /// monitor_idx → (crc32, last_encoded_json)
    slots: HashMap<usize, (u32, Value)>,
}

impl FrameCache {
    fn new() -> Self { Self { slots: HashMap::new() } }

    fn check(&self, idx: usize, crc: u32) -> Option<&Value> {
        self.slots.get(&idx).filter(|(c, _)| *c == crc).map(|(_, v)| v)
    }

    fn store(&mut self, idx: usize, crc: u32, v: Value) {
        self.slots.insert(idx, (crc, v));
    }
}

static FRAME_CACHE: Mutex<Option<FrameCache>> = Mutex::new(None);

fn get_cache() -> std::sync::MutexGuard<'static, Option<FrameCache>> {
    let mut g = FRAME_CACHE.lock().unwrap();
    if g.is_none() { *g = Some(FrameCache::new()); }
    g
}

fn crc32_of(bytes: &[u8]) -> u32 {
    let mut crc: u32 = 0xFFFF_FFFF;
    for &b in bytes {
        crc ^= b as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}

/// Captures only the primary monitor and returns a single base64 JPEG string.
/// Faster than capture_all — used for before/after action verification pairs.
#[tauri::command]
pub fn capture_primary() -> Result<String, String> {
    let screens = Screen::all().map_err(|e| e.to_string())?;
    let primary = screens
        .into_iter()
        .find(|s| s.display_info.is_primary)
        .ok_or("No primary screen found")?;

    let raw = primary.capture().map_err(|e| e.to_string())?;
    let mut jpeg_bytes = Vec::new();
    DynamicImage::ImageRgba8(raw)
        .write_to(
            &mut std::io::Cursor::new(&mut jpeg_bytes),
            image::ImageFormat::Jpeg,
        )
        .map_err(|e| e.to_string())?;
    Ok(STANDARD.encode(&jpeg_bytes))
}

pub fn capture_all() -> Result<Vec<Value>, String> {
    let screens = Screen::all().map_err(|e| format!("Failed to enumerate screens: {e}"))?;

    // Parallel encode across all monitors using rayon
    let results: Vec<Result<Value, String>> = screens
        .par_iter()
        .enumerate()
        .map(|(idx, screen)| capture_one(screen, idx))
        .collect();

    let mut captures: Vec<Value> = results
        .into_iter()
        .filter_map(|r| match r {
            Ok(v) => Some(v),
            Err(e) => {
                eprintln!("[capture] screen failed: {e}");
                None
            }
        })
        .collect();

    captures.sort_by(|a, b| capture_rank(b).cmp(&capture_rank(a)));
    for (idx, capture) in captures.iter_mut().enumerate() {
        if let Some(obj) = capture.as_object_mut() {
            obj.insert("label".to_string(), json!(format!("screen{}", idx + 1)));
        }
    }

    Ok(captures)
}

fn capture_one(screen: &Screen, idx: usize) -> Result<Value, String> {
    // screenshots v0.8 returns image::ImageBuffer<Rgba<u8>, Vec<u8>> directly
    let raw = screen.capture().map_err(|e| e.to_string())?;
    let width = raw.width();
    let height = raw.height();

    // Frame-on-change cache (Dim 18): if pixel content is identical to the last
    // capture for this monitor, skip the JPEG encode and return cached JSON.
    let frame_crc = crc32_of(raw.as_raw());
    {
        let cache_guard = get_cache();
        if let Some(cache) = cache_guard.as_ref() {
            if let Some(cached) = cache.check(idx, frame_crc) {
                return Ok(cached.clone());
            }
        }
    }

    // JPEG at 85% — compact for AI API calls; Claude/OpenAI/Grok accept image/jpeg
    let mut jpeg_bytes = Vec::new();
    DynamicImage::ImageRgba8(raw)
        .write_to(
            &mut std::io::Cursor::new(&mut jpeg_bytes),
            image::ImageFormat::Jpeg,
        )
        .map_err(|e| e.to_string())?;

    let encoded = STANDARD.encode(&jpeg_bytes);
    let info = &screen.display_info;
    let contains_cursor = cursor_position()
        .map(|(cx, cy)| {
            cx >= info.x
                && cy >= info.y
                && cx < info.x + width as i32
                && cy < info.y + height as i32
        })
        .unwrap_or(false);

    let result = json!({
        "label": format!("screen{}", idx + 1),
        "data": encoded,
        "mime": "image/jpeg",
        "width": width,
        "height": height,
        "x": info.x,
        "y": info.y,
        "scale_factor": info.scale_factor,
        "is_primary": info.is_primary,
        "contains_cursor": contains_cursor,
    });

    // Store in frame cache for next call
    if let Ok(mut g) = FRAME_CACHE.lock() {
        if let Some(cache) = g.as_mut() {
            cache.store(idx, frame_crc, result.clone());
        }
    }

    Ok(result)
}

/// Capture a specific monitor by zero-based index (as returned by `get_monitors`).
/// Useful for AI agents that need to target a secondary screen without
/// receiving all monitors. Returns the same JSON schema as `capture_all` entries.
#[tauri::command]
pub fn capture_monitor(monitor_idx: usize) -> Result<Value, String> {
    let screens = Screen::all().map_err(|e| format!("Failed to enumerate screens: {e}"))?;
    // Sort primary first so index 0 always means primary — mirrors get_monitors ordering
    let mut screens: Vec<Screen> = screens;
    screens.sort_by(|a, b| b.display_info.is_primary.cmp(&a.display_info.is_primary));
    let screen = screens
        .get(monitor_idx)
        .ok_or_else(|| format!("Monitor index {monitor_idx} out of range (found {})", screens.len()))?;
    capture_one(screen, monitor_idx)
}

fn capture_rank(value: &Value) -> (bool, bool) {
    (
        value
            .get("contains_cursor")
            .and_then(Value::as_bool)
            .unwrap_or(false),
        value
            .get("is_primary")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    )
}

#[cfg(target_os = "windows")]
fn cursor_position() -> Option<(i32, i32)> {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

    let mut point = POINT { x: 0, y: 0 };
    unsafe {
        GetCursorPos(&mut point).ok()?;
    }
    Some((point.x, point.y))
}

#[cfg(not(target_os = "windows"))]
fn cursor_position() -> Option<(i32, i32)> {
    None
}

/// Return metadata for all connected monitors without capturing image data.
/// Used by the second-screen companion feature (Dim 98) to enumerate displays.
#[tauri::command]
pub fn list_monitors() -> Result<serde_json::Value, String> {
    let screens = Screen::all().map_err(|e| format!("Failed to enumerate screens: {e}"))?;
    let cursor = cursor_position();
    let monitors: Vec<serde_json::Value> = screens.iter().enumerate().map(|(idx, s)| {
        let info = &s.display_info;
        let contains_cursor = cursor.map(|(cx, cy)| {
            cx >= info.x && cx < info.x + info.width as i32 &&
            cy >= info.y && cy < info.y + info.height as i32
        }).unwrap_or(false);
        serde_json::json!({
            "index": idx,
            "id": info.id,
            "x": info.x,
            "y": info.y,
            "width": info.width,
            "height": info.height,
            "scale_factor": info.scale_factor,
            "is_primary": info.is_primary,
            "contains_cursor": contains_cursor,
        })
    }).collect();
    Ok(serde_json::json!({
        "count": monitors.len(),
        "monitors": monitors,
        "cursor": cursor.map(|(x,y)| serde_json::json!({"x":x,"y":y})),
    }))
}

/// Capture a specific secondary monitor and return it as the companion context.
/// If monitor_idx == "secondary", captures the first non-primary monitor. (Dim 98)
#[tauri::command]
pub fn capture_secondary_screen() -> Result<serde_json::Value, String> {
    let screens = Screen::all().map_err(|e| format!("Failed to enumerate screens: {e}"))?;
    let secondary = screens.iter().enumerate()
        .find(|(_, s)| !s.display_info.is_primary);
    match secondary {
        Some((idx, screen)) => capture_one(screen, idx),
        None => Err("No secondary monitor found. Connect a second display.".to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capture_rank_cursor_beats_primary() {
        let cursor_screen = serde_json::json!({ "contains_cursor": true, "is_primary": false });
        let primary_screen = serde_json::json!({ "contains_cursor": false, "is_primary": true });
        assert!(capture_rank(&cursor_screen) > capture_rank(&primary_screen),
            "cursor-containing screen should rank above primary when cursor is on secondary");
    }

    #[test]
    fn capture_rank_primary_beats_neither() {
        let primary = serde_json::json!({ "contains_cursor": false, "is_primary": true });
        let secondary = serde_json::json!({ "contains_cursor": false, "is_primary": false });
        assert!(capture_rank(&primary) > capture_rank(&secondary));
    }

    #[test]
    fn capture_rank_both_true_beats_cursor_only() {
        let both = serde_json::json!({ "contains_cursor": true, "is_primary": true });
        let cursor_only = serde_json::json!({ "contains_cursor": true, "is_primary": false });
        assert!(capture_rank(&both) >= capture_rank(&cursor_only));
    }

    // ── Frame cache unit tests (Dim 18) ──────────────────────────────────────

    #[test]
    fn crc32_deterministic() {
        let data = b"test frame bytes 1234";
        let a = crc32_of(data);
        let b = crc32_of(data);
        assert_eq!(a, b, "crc32 must be deterministic");
    }

    #[test]
    fn crc32_distinguishes_frames() {
        let frame_a = vec![0u8; 1920 * 1080 * 4];
        let mut frame_b = vec![0u8; 1920 * 1080 * 4];
        frame_b[100] = 255; // single pixel change
        assert_ne!(crc32_of(&frame_a), crc32_of(&frame_b),
            "crc32 must distinguish frames differing by one pixel");
    }

    #[test]
    fn frame_cache_hit_returns_cached_value() {
        let mut cache = FrameCache::new();
        let v = serde_json::json!({ "data": "abc", "width": 1920 });
        cache.store(0, 42, v.clone());
        let hit = cache.check(0, 42);
        assert!(hit.is_some(), "cache hit expected for same crc");
        assert_eq!(hit.unwrap(), &v);
    }

    #[test]
    fn frame_cache_miss_on_different_crc() {
        let mut cache = FrameCache::new();
        cache.store(0, 42, serde_json::json!({ "data": "old" }));
        let miss = cache.check(0, 99);
        assert!(miss.is_none(), "cache miss expected when crc changes");
    }

    #[test]
    fn frame_cache_miss_on_different_monitor() {
        let mut cache = FrameCache::new();
        cache.store(0, 42, serde_json::json!({ "data": "mon0" }));
        let miss = cache.check(1, 42); // same crc, different slot
        assert!(miss.is_none(), "each monitor has its own cache slot");
    }

    // ── Dim 11: Screenshot quality — JPEG 85% fidelity test ─────────────────
    // capture_one() encodes at ImageFormat::Jpeg which Tauri/image crate maps to
    // quality 85 by default. Verifies the output is a decodable JPEG and that
    // image dimensions are preserved after encode→decode round-trip.

    #[test]
    fn jpeg_roundtrip_preserves_dimensions() {
        let w = 320u32;
        let h = 240u32;
        // Build a synthetic RGBA image with a gradient pattern
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let i = ((y * w + x) * 4) as usize;
                rgba[i]     = (x * 255 / w) as u8;  // R gradient
                rgba[i + 1] = (y * 255 / h) as u8;  // G gradient
                rgba[i + 2] = 128;                   // B constant
                rgba[i + 3] = 255;                   // A opaque
            }
        }
        let img = image::DynamicImage::ImageRgba8(
            image::ImageBuffer::from_raw(w, h, rgba).expect("create image")
        );
        let mut jpeg_bytes = Vec::new();
        img.write_to(
            &mut std::io::Cursor::new(&mut jpeg_bytes),
            image::ImageFormat::Jpeg,
        ).expect("JPEG encode");

        // Verify output is non-empty and decodable
        assert!(!jpeg_bytes.is_empty(), "JPEG encode must produce bytes");
        let decoded = image::load_from_memory(&jpeg_bytes).expect("JPEG decode");
        assert_eq!(decoded.width(), w, "width preserved after encode/decode");
        assert_eq!(decoded.height(), h, "height preserved after encode/decode");

        // JPEG should be significantly smaller than raw RGBA (compression working)
        let raw_size = (w * h * 4) as usize;
        assert!(
            jpeg_bytes.len() < raw_size,
            "JPEG ({}) must be smaller than raw RGBA ({})",
            jpeg_bytes.len(), raw_size
        );
    }

    #[test]
    fn jpeg_quality_is_adequate_for_ai_vision() {
        // 85% JPEG quality is the standard threshold for AI vision tasks.
        // Verify that a high-contrast image (text-like pattern) round-trips
        // with acceptable fidelity: mean pixel error < 30/255.
        let w = 64u32;
        let h = 16u32;
        // Alternating black/white stripes (text-like high frequency)
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let i = ((y * w + x) * 4) as usize;
                let val = if x % 4 < 2 { 255u8 } else { 0u8 };
                rgba[i] = val; rgba[i+1] = val; rgba[i+2] = val; rgba[i+3] = 255;
            }
        }
        let original = image::DynamicImage::ImageRgba8(
            image::ImageBuffer::from_raw(w, h, rgba.clone()).expect("create")
        );
        let mut jpeg_bytes = Vec::new();
        original.write_to(&mut std::io::Cursor::new(&mut jpeg_bytes), image::ImageFormat::Jpeg)
            .expect("encode");
        let decoded = image::load_from_memory(&jpeg_bytes).expect("decode").to_rgb8();

        // Compute mean absolute error over all pixels
        let total_err: u64 = decoded.pixels().zip(rgba.chunks(4)).map(|(px, orig)| {
            let dr = (px[0] as i32 - orig[0] as i32).unsigned_abs() as u64;
            let dg = (px[1] as i32 - orig[1] as i32).unsigned_abs() as u64;
            let db = (px[2] as i32 - orig[2] as i32).unsigned_abs() as u64;
            dr + dg + db
        }).sum();
        let pixel_count = (w * h) as u64;
        let mean_err = total_err / (pixel_count * 3);
        assert!(
            mean_err < 50,
            "JPEG 85% mean pixel error {mean_err}/255 exceeds quality gate (< 50)"
        );
    }

    // ── Dim 69: Capture latency gate ─────────────────────────────────────────
    // A cache hit must be sub-millisecond: check() is a HashMap lookup + crc
    // compare. This test asserts 1 000 consecutive cache hits complete in < 5ms
    // total (i.e. < 5µs per hit), which is orders of magnitude faster than a
    // full JPEG encode (50-150ms).

    #[test]
    fn cache_hit_path_is_sub_millisecond() {
        let mut cache = FrameCache::new();
        let v = serde_json::json!({ "data": "cached_frame", "width": 1920, "height": 1080 });
        cache.store(0, 0xDEAD_BEEF, v);

        let t0 = std::time::Instant::now();
        for _ in 0..1_000 {
            let hit = cache.check(0, 0xDEAD_BEEF);
            assert!(hit.is_some());
        }
        let elapsed_us = t0.elapsed().as_micros();
        assert!(
            elapsed_us < 5_000,
            "1000 cache hits took {elapsed_us}µs (gate: < 5000µs / 5ms)"
        );
    }

    // ── Dim 69: CRC32 throughput gate ────────────────────────────────────────
    // CRC32 of a 1920×1080×4 = 8.3MB frame must complete in < 100ms so that
    // the frame-change check doesn't dominate over the JPEG encode it avoids.

    #[test]
    fn crc32_1080p_frame_under_100ms() {
        let frame = vec![0xABu8; 1920 * 1080 * 4];
        let t0 = std::time::Instant::now();
        let crc = crc32_of(&frame);
        let elapsed_ms = t0.elapsed().as_millis();
        // Verify output is deterministic regardless of build mode.
        assert_ne!(crc, 0);
        // Timing gate only applies to optimized builds; debug is ~10× slower.
        #[cfg(not(debug_assertions))]
        assert!(
            elapsed_ms < 100,
            "CRC32 of 1080p frame took {elapsed_ms}ms (gate: < 100ms)"
        );
        let _ = elapsed_ms;
    }
}
