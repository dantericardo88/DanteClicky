// stt.rs -- Dual-backend STT manager
// Backend A: AssemblyAI (cloud, real-time, token from Worker)
// Backend B: candle-transformers Whisper (local, offline, pure Rust, no cmake) ← default

use std::sync::Mutex;

use crate::whisper_candle::WhisperCandle;

const WHISPER_LANGUAGE_CODES: &[(&str, &[&str])] = &[
    ("en", &["english"]),
    ("es", &["spanish", "castilian"]),
    ("de", &["german"]),
    ("fr", &["french"]),
    ("pt", &["portuguese"]),
    ("it", &["italian"]),
    ("zh", &["chinese", "mandarin", "zh-cn", "zh-tw"]),
    ("ja", &["japanese"]),
    ("ko", &["korean"]),
    ("hi", &["hindi"]),
    ("ar", &["arabic"]),
    ("nl", &["dutch"]),
    ("pl", &["polish"]),
    ("tr", &["turkish"]),
    ("uk", &["ukrainian"]),
    ("vi", &["vietnamese"]),
    ("id", &["indonesian"]),
    ("sv", &["swedish"]),
];

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum WhisperLanguageSelection {
    Auto,
    Language(String),
}

pub fn normalize_whisper_language_code(language_code: Option<&str>) -> WhisperLanguageSelection {
    let Some(raw_code) = language_code else {
        return WhisperLanguageSelection::Auto;
    };
    let normalized = raw_code.trim().to_lowercase().replace('_', "-");
    if normalized.is_empty() || normalized == "auto" {
        return WhisperLanguageSelection::Auto;
    }
    let base_code = normalized.split('-').next().unwrap_or(&normalized);
    for (code, aliases) in WHISPER_LANGUAGE_CODES {
        if normalized == *code || base_code == *code || aliases.iter().any(|alias| normalized == *alias) {
            return WhisperLanguageSelection::Language((*code).to_string());
        }
    }
    WhisperLanguageSelection::Auto
}

pub fn whisper_language_token_text(language_code: &str) -> Option<String> {
    match normalize_whisper_language_code(Some(language_code)) {
        WhisperLanguageSelection::Language(code) => Some(format!("<|{code}|>")),
        WhisperLanguageSelection::Auto => None,
    }
}

pub fn whisper_model_repository_for_language(language_code: Option<&str>) -> &'static str {
    match normalize_whisper_language_code(language_code) {
        WhisperLanguageSelection::Language(code) if code == "en" => "openai/whisper-tiny.en",
        _ => "openai/whisper-tiny",
    }
}

pub fn whisper_model_directory_name(language_code: Option<&str>) -> &'static str {
    match normalize_whisper_language_code(language_code) {
        WhisperLanguageSelection::Language(code) if code == "en" => "whisper-candle-tiny-en",
        _ => "whisper-candle-tiny-multilingual",
    }
}

// ── Types ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub enum SttMode {
    Cloud,  // AssemblyAI WebSocket (default when no local model)
    Local,  // candle-transformers Whisper (offline, pure Rust)
}

pub struct SttState {
    pub mode: SttMode,
    pub local_model_path: Option<String>,
    pub local_model_language: Option<String>,
    pub local_model_repository: Option<String>,
    candle: Option<WhisperCandle>,
}

// candle CPU tensors are Send; SttState is only accessed through Mutex
unsafe impl Send for SttState {}

impl SttState {
    pub fn new() -> Self {
        Self {
            mode: SttMode::Cloud,
            local_model_path: None,
            local_model_language: None,
            local_model_repository: None,
            candle: None,
        }
    }

    /// Load (or reload) a candle Whisper model from a directory containing
    /// model.safetensors, config.json, and tokenizer.json.
    pub fn load_model(&mut self, dir: &str, language_code: Option<&str>) -> Result<(), String> {
        let path = std::path::Path::new(dir);
        let model = WhisperCandle::load(path)?;
        self.candle = Some(model);
        self.local_model_path = Some(dir.to_owned());
        self.local_model_language = match normalize_whisper_language_code(language_code) {
            WhisperLanguageSelection::Language(code) => Some(code),
            WhisperLanguageSelection::Auto => Some("auto".to_string()),
        };
        self.local_model_repository = Some(whisper_model_repository_for_language(language_code).to_string());
        self.mode = SttMode::Local;
        Ok(())
    }

    /// Run Whisper inference on f32 mono PCM at `from_rate` Hz.
    pub fn transcribe(&mut self, samples: &[f32], from_rate: u32, language_code: Option<&str>) -> Result<String, String> {
        let model = self
            .candle
            .as_mut()
            .ok_or("No local Whisper model loaded. Download it in Settings → Voice.")?;
        model.transcribe(samples, from_rate, language_code)
    }

    /// Returns true if a candle model is loaded and ready.
    pub fn is_ctx_loaded(&self) -> bool {
        self.candle.is_some()
    }
}

// ── Tauri commands ────────────────────────────────────────────────────────────

#[tauri::command]
pub fn get_stt_mode(state: tauri::State<'_, Mutex<SttState>>) -> SttMode {
    state.lock().unwrap().mode.clone()
}

/// Set STT mode. Switching to Local is allowed even without a model loaded —
/// the transcription command surfaces the error at inference time.
#[tauri::command]
pub fn set_stt_mode(
    mode: SttMode,
    state: tauri::State<'_, Mutex<SttState>>,
) -> Result<(), String> {
    let mut s = state.lock().map_err(|e| e.to_string())?;
    s.mode = mode;
    Ok(())
}

/// Check if a local Whisper model is available and loaded.
#[tauri::command]
pub fn get_local_model_status(state: tauri::State<'_, Mutex<SttState>>) -> serde_json::Value {
    let s = state.lock().unwrap();
    serde_json::json!({
        "available": s.local_model_path.is_some(),
        "path": s.local_model_path,
        "model_language": s.local_model_language,
        "model_repository": s.local_model_repository,
        "mode": s.mode,
        "ctx_loaded": s.is_ctx_loaded(),
        "feature_enabled": true,  // always true — candle is always compiled in
        "backend": "candle",
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_language_codes_and_aliases() {
        assert_eq!(normalize_whisper_language_code(None), WhisperLanguageSelection::Auto);
        assert_eq!(
            normalize_whisper_language_code(Some("Spanish")),
            WhisperLanguageSelection::Language("es".to_string())
        );
        assert_eq!(
            normalize_whisper_language_code(Some("zh-CN")),
            WhisperLanguageSelection::Language("zh".to_string())
        );
        assert_eq!(
            normalize_whisper_language_code(Some("not-a-language")),
            WhisperLanguageSelection::Auto
        );
    }

    #[test]
    fn chooses_english_model_only_for_explicit_english() {
        assert_eq!(
            whisper_model_repository_for_language(Some("en")),
            "openai/whisper-tiny.en"
        );
        assert_eq!(
            whisper_model_repository_for_language(Some("es")),
            "openai/whisper-tiny"
        );
        assert_eq!(
            whisper_model_repository_for_language(None),
            "openai/whisper-tiny"
        );
    }

    #[test]
    fn builds_whisper_language_token_text_for_supported_languages() {
        assert_eq!(whisper_language_token_text("fr"), Some("<|fr|>".to_string()));
        assert_eq!(whisper_language_token_text("not-a-language"), None);
    }
}
