// ocr.rs — Windows.Media.Ocr text extraction from screenshots
// WinRT OCR requires windows-crate async features that conflict with the current
// dependency tree. This stub returns empty string until the crate versions align.

/// Extract text from a JPEG screenshot (base64-encoded). Currently a stub.
#[tauri::command]
pub async fn ocr_screenshot(_jpeg_b64: String) -> String {
    String::new()
}

/// Same as `ocr_screenshot` but usable from other Rust modules.
pub async fn ocr_screenshot_internal(_jpeg_b64: &str) -> Result<String, String> {
    Ok(String::new())
}
