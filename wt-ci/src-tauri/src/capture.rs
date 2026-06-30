use base64::{engine::general_purpose::STANDARD, Engine};
use image::DynamicImage;
use rayon::prelude::*;
use screenshots::Screen;
use serde_json::{json, Value};

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

    let captures: Vec<Value> = results
        .into_iter()
        .filter_map(|r| match r {
            Ok(v) => Some(v),
            Err(e) => {
                eprintln!("[capture] screen failed: {e}");
                None
            }
        })
        .collect();

    Ok(captures)
}

fn capture_one(screen: &Screen, idx: usize) -> Result<Value, String> {
    // screenshots v0.8 returns image::ImageBuffer<Rgba<u8>, Vec<u8>> directly
    let raw = screen.capture().map_err(|e| e.to_string())?;
    let width = raw.width();
    let height = raw.height();

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

    Ok(json!({
        "label": format!("screen{}", idx + 1),
        "data": encoded,
        "mime": "image/jpeg",
        "width": width,
        "height": height,
        "x": info.x,
        "y": info.y,
        "scale_factor": info.scale_factor,
        "is_primary": info.is_primary,
    }))
}
