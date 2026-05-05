// tts_local.rs — Local TTS via Kokoro ONNX
// Full inference requires: kokoro-82M ONNX model + phoneme tables
// This module provides the download command and a stub inference command.
// Enable with --features local-tts

#[derive(serde::Serialize)]
pub struct KokoroStatus {
    pub available: bool,
    pub model_path: Option<String>,
    pub feature_enabled: bool,
}

/// Download the Kokoro-82M ONNX model to the app data directory
#[tauri::command]
pub async fn download_kokoro_model(
    app: tauri::AppHandle,
) -> Result<String, String> {
    use tauri::Manager;

    let data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Cannot get app data dir: {e}"))?;
    std::fs::create_dir_all(&data_dir).map_err(|e| e.to_string())?;

    let model_path = data_dir.join("kokoro-v0_19.onnx");
    if model_path.exists() {
        return Ok(model_path.to_string_lossy().to_string());
    }

    // Kokoro v0.19 ONNX from HuggingFace (~330MB)
    let url = "https://huggingface.co/hexgrad/Kokoro-82M/resolve/main/kokoro-v0_19.onnx";

    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let bytes = response.bytes().await.map_err(|e| e.to_string())?;
    std::fs::write(&model_path, &bytes).map_err(|e| e.to_string())?;

    Ok(model_path.to_string_lossy().to_string())
}

/// Check if Kokoro model is available
#[tauri::command]
pub fn get_kokoro_status(app: tauri::AppHandle) -> KokoroStatus {
    use tauri::Manager;

    let model_path = app.path().app_data_dir().ok()
        .map(|d| d.join("kokoro-v0_19.onnx"));

    let available = model_path.as_ref()
        .map(|p| p.exists())
        .unwrap_or(false);

    KokoroStatus {
        available,
        model_path: model_path.filter(|_| available).map(|p| p.to_string_lossy().to_string()),
        feature_enabled: cfg!(feature = "local-tts"),
    }
}

/// Run Kokoro TTS inference — returns WAV audio bytes
/// Returns error if model not downloaded or feature not compiled
#[tauri::command]
pub async fn kokoro_tts(
    text: String,
    app: tauri::AppHandle,
) -> Result<Vec<u8>, String> {
    use tauri::Manager;

    let model_path = app.path().app_data_dir()
        .map_err(|e| e.to_string())?
        .join("kokoro-v0_19.onnx");

    if !model_path.exists() {
        return Err("Kokoro model not downloaded. Use download_kokoro_model first.".into());
    }

    #[cfg(feature = "local-tts")]
    {
        // Full Kokoro inference would go here with ort crate
        // For now, return an informative error — the model download infra is real
        let _ = text;
        Err("Kokoro inference not yet wired (model downloaded OK). Rebuild with phoneme tables.".into())
    }

    #[cfg(not(feature = "local-tts"))]
    {
        let _ = text;
        Err("Local TTS not compiled. Rebuild with --features local-tts.".into())
    }
}
