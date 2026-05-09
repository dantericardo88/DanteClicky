// ocr.rs — Windows.Media.Ocr text extraction from JPEG screenshots
//
// Runs on a dedicated spawn_blocking thread to avoid blocking the Tauri async runtime.
// Uses COM MTA initialization so the WinRT IAsyncOperation::get() calls can complete
// without a message-pump loop (valid for free-threaded WinRT components).

use base64::{engine::general_purpose::STANDARD, Engine};
#[cfg(target_os = "windows")]
use windows::{
    Graphics::Imaging::BitmapDecoder,
    Media::Ocr::OcrEngine,
    Storage::Streams::{DataWriter, InMemoryRandomAccessStream},
    Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED},
};

// ── Public Tauri command ──────────────────────────────────────────────────────

/// Extract text from a JPEG screenshot (base64-encoded).
/// Returns empty string on any error so callers never fail.
#[tauri::command]
pub async fn ocr_screenshot(jpeg_b64: String) -> String {
    #[cfg(target_os = "windows")]
    {
    let bytes = match STANDARD.decode(&jpeg_b64) {
        Ok(b) => b,
        Err(_) => return String::new(),
    };
    tauri::async_runtime::spawn_blocking(move || ocr_blocking(&bytes).unwrap_or_default())
        .await
        .unwrap_or_default()
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = jpeg_b64;
        String::new()
    }
}

/// Same as `ocr_screenshot` but callable from other Rust modules.
pub async fn ocr_screenshot_internal(jpeg_b64: &str) -> Result<String, String> {
    #[cfg(target_os = "windows")]
    {
    let bytes = STANDARD
        .decode(jpeg_b64)
        .map_err(|e| format!("base64 decode: {e}"))?;
    tauri::async_runtime::spawn_blocking(move || ocr_blocking(&bytes).unwrap_or_default())
        .await
        .map_err(|e| e.to_string())
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = jpeg_b64;
        Ok(String::new())
    }
}

// ── Blocking implementation (runs on a dedicated OS thread) ──────────────────

#[cfg(target_os = "windows")]
fn ocr_blocking(jpeg_bytes: &[u8]) -> windows::core::Result<String> {
    // Initialize COM for this thread as MTA. WinRT free-threaded objects work
    // from MTA threads without a message pump; OcrEngine is free-threaded.
    let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    // S_OK (0) = initialized, S_FALSE (1) = already initialized — both are fine.
    // RPC_E_CHANGED_MODE (0x80010106) means STA already initialized on this thread;
    // still safe to proceed since WinRT free-threaded ops work from STA too.
    let com_initialized = hr.is_ok() || hr.0 == 0x80010106u32 as i32;

    let result = run_ocr(jpeg_bytes);

    if com_initialized && hr.is_ok() {
        unsafe { CoUninitialize() };
    }

    result
}

#[cfg(target_os = "windows")]
fn run_ocr(jpeg_bytes: &[u8]) -> windows::core::Result<String> {
    // 1. Write JPEG bytes into an in-memory random-access stream
    let stream = InMemoryRandomAccessStream::new()?;
    let writer = DataWriter::CreateDataWriter(&stream)?;
    writer.WriteBytes(jpeg_bytes)?;
    writer.StoreAsync()?.get()?;
    writer.FlushAsync()?.get()?;
    stream.Seek(0)?;

    // 2. Decode the JPEG into a SoftwareBitmap
    let decoder = BitmapDecoder::CreateAsync(&stream)?.get()?;
    let bitmap = decoder.GetSoftwareBitmapAsync()?.get()?;

    // 3. Create OCR engine using the user's profile language(s).
    //    Returns Result<OcrEngine> directly (synchronous in windows 0.61).
    let engine = OcrEngine::TryCreateFromUserProfileLanguages()?;

    // 4. Run recognition
    let ocr_result = engine.RecognizeAsync(&bitmap)?.get()?;
    Ok(ocr_result.Text()?.to_string())
}
