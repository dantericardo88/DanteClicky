use futures_util::StreamExt;
use serde_json::Value;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};

use crate::keystore::KeyStore;

struct PendingClaudeToolUse {
    id: String,
    name: String,
    input_json: String,
}

// Retry up to 3 times with exponential backoff for transient server errors.
// 400, 401, 403 are non-transient — do not retry.
fn is_retryable(status: u16) -> bool {
    matches!(status, 429 | 500 | 502 | 503 | 504)
}

async fn retry_delay(attempt: u32) {
    let ms = match attempt {
        0 => 800,
        1 => 2000,
        _ => 4000,
    };
    tokio::time::sleep(std::time::Duration::from_millis(ms)).await;
}

#[tauri::command]
pub async fn stream_claude(
    app: AppHandle,
    keystore: tauri::State<'_, KeyStore>,
    body: Value,
    call_id: String,
) -> Result<(), String> {
    let api_key = keystore
        .get("anthropic")
        .ok_or_else(|| "No API key configured for anthropic. Set it in Settings.".to_string())?;

    // Extract and remove the non-API "betas" field if present — send as header instead
    let mut body = body;
    let beta_header = body
        .as_object_mut()
        .and_then(|o| o.remove("betas"))
        .and_then(|v| {
            v.as_array().map(|arr| {
                arr.iter()
                    .filter_map(|s| s.as_str())
                    .collect::<Vec<_>>()
                    .join(",")
            })
        })
        .unwrap_or_default();

    let client = reqwest::Client::new();
    let res = {
        let mut last_err = String::new();
        let mut result = None;
        for attempt in 0u32..4 {
            if attempt > 0 {
                retry_delay(attempt - 1).await;
            }
            let mut req = client
                .post("https://api.anthropic.com/v1/messages")
                .header("x-api-key", &api_key)
                .header("anthropic-version", "2023-06-01")
                .header("content-type", "application/json");
            if !beta_header.is_empty() {
                req = req.header("anthropic-beta", &beta_header);
            }
            let r = match req.json(&body).send().await {
                Ok(r) => r,
                Err(e) => {
                    last_err = e.to_string();
                    continue;
                }
            };
            if r.status().is_success() {
                result = Some(r);
                break;
            }
            let status = r.status().as_u16();
            let err = r.text().await.unwrap_or_default();
            if !is_retryable(status) {
                app.emit(&format!("chat-error-{call_id}"), &err).ok();
                return Err(err);
            }
            last_err = err;
        }
        match result {
            Some(r) => r,
            None => {
                app.emit(&format!("chat-error-{call_id}"), &last_err).ok();
                return Err(last_err);
            }
        }
    };

    let mut stream = res.bytes_stream();
    let mut buf = String::new();
    // Tool-use accumulation: the JSON input arrives piecemeal in input_json_delta events
    let mut pending_tool_uses: HashMap<i64, PendingClaudeToolUse> = HashMap::new();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&bytes));

        loop {
            match buf.find('\n') {
                None => break,
                Some(pos) => {
                    let line = buf[..pos].trim().to_owned();
                    buf = buf[pos + 1..].to_owned();
                    if let Some(data) = line.strip_prefix("data: ") {
                        if data == "[DONE]" {
                            continue;
                        }
                        if let Ok(ev) = serde_json::from_str::<Value>(data) {
                            match ev["type"].as_str().unwrap_or("") {
                                "content_block_start" => {
                                    let index = ev["index"].as_i64().unwrap_or(-1);
                                    let cb = &ev["content_block"];
                                    if cb["type"] == "tool_use" {
                                        pending_tool_uses.insert(
                                            index,
                                            PendingClaudeToolUse {
                                                id: cb["id"].as_str().unwrap_or("").to_owned(),
                                                name: cb["name"].as_str().unwrap_or("").to_owned(),
                                                input_json: String::new(),
                                            },
                                        );
                                    }
                                }
                                "content_block_delta" => {
                                    let index = ev["index"].as_i64().unwrap_or(-1);
                                    let delta = &ev["delta"];
                                    if delta["type"] == "text_delta" {
                                        if let Some(text) = delta["text"].as_str() {
                                            app.emit(&format!("chat-chunk-{call_id}"), text).ok();
                                        }
                                    } else if delta["type"] == "input_json_delta" {
                                        if let Some(partial) = delta["partial_json"].as_str() {
                                            if let Some(tool_use) =
                                                pending_tool_uses.get_mut(&index)
                                            {
                                                tool_use.input_json.push_str(partial);
                                            }
                                        }
                                    }
                                }
                                "content_block_stop" => {
                                    let index = ev["index"].as_i64().unwrap_or(-1);
                                    // If we were accumulating a tool_use block, emit it now
                                    if let Some(tool_use) = pending_tool_uses.remove(&index) {
                                        if tool_use.id.is_empty() || tool_use.name.is_empty() {
                                            continue;
                                        }
                                        let input: Value =
                                            serde_json::from_str(&tool_use.input_json)
                                                .unwrap_or(Value::Object(Default::default()));
                                        let tool_use = serde_json::json!({
                                            "type": "tool_use",
                                            "id": tool_use.id,
                                            "name": tool_use.name,
                                            "input": input
                                        });
                                        app.emit(&format!("chat-tool-use-{call_id}"), &tool_use)
                                            .ok();
                                    }
                                }
                                "message_delta" => {
                                    if let Some(stop_reason) = ev["delta"]["stop_reason"].as_str() {
                                        app.emit(
                                            &format!("chat-stop-reason-{call_id}"),
                                            stop_reason,
                                        )
                                        .ok();
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
        }
    }

    app.emit(&format!("chat-done-{call_id}"), "").ok();
    Ok(())
}

#[tauri::command]
pub async fn stream_openai_compat(
    app: AppHandle,
    keystore: tauri::State<'_, KeyStore>,
    base_url: String,
    provider: String,
    body: Value,
    call_id: String,
) -> Result<(), String> {
    // Map provider name to keystore key: "openai" → "openai", "grok" → "xai"
    let store_key = if provider == "grok" {
        "xai"
    } else {
        provider.as_str()
    };
    let api_key = keystore
        .get(store_key)
        .ok_or_else(|| format!("No API key configured for {provider}. Set it in Settings."))?;

    let client = reqwest::Client::new();
    let res = {
        let mut last_err = String::new();
        let mut result = None;
        for attempt in 0u32..4 {
            if attempt > 0 {
                retry_delay(attempt - 1).await;
            }
            let r = match client
                .post(format!("{base_url}/chat/completions"))
                .header("Authorization", format!("Bearer {api_key}"))
                .header("content-type", "application/json")
                .json(&body)
                .send()
                .await
            {
                Ok(r) => r,
                Err(e) => {
                    last_err = e.to_string();
                    continue;
                }
            };
            if r.status().is_success() {
                result = Some(r);
                break;
            }
            let status = r.status().as_u16();
            let err = r.text().await.unwrap_or_default();
            if !is_retryable(status) {
                app.emit(&format!("chat-error-{call_id}"), &err).ok();
                return Err(err);
            }
            last_err = err;
        }
        match result {
            Some(r) => r,
            None => {
                app.emit(&format!("chat-error-{call_id}"), &last_err).ok();
                return Err(last_err);
            }
        }
    };

    let mut stream = res.bytes_stream();
    let mut buf = String::new();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| e.to_string())?;
        buf.push_str(&String::from_utf8_lossy(&bytes));

        loop {
            match buf.find('\n') {
                None => break,
                Some(pos) => {
                    let line = buf[..pos].trim().to_owned();
                    buf = buf[pos + 1..].to_owned();
                    if let Some(data) = line.strip_prefix("data: ") {
                        if data == "[DONE]" {
                            continue;
                        }
                        if let Ok(ev) = serde_json::from_str::<Value>(data) {
                            if let Some(text) = ev["choices"][0]["delta"]["content"].as_str() {
                                app.emit(&format!("chat-chunk-{call_id}"), text).ok();
                            }
                        }
                    }
                }
            }
        }
    }

    app.emit(&format!("chat-done-{call_id}"), "").ok();
    Ok(())
}

#[tauri::command]
pub async fn send_openai_response(
    keystore: tauri::State<'_, KeyStore>,
    body: Value,
) -> Result<Value, String> {
    let api_key = keystore
        .get("openai")
        .ok_or_else(|| "No API key configured for openai. Set it in Settings.".to_string())?;

    let client = reqwest::Client::new();
    let res = client
        .post("https://api.openai.com/v1/responses")
        .header("Authorization", format!("Bearer {api_key}"))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(res.text().await.unwrap_or_default());
    }

    res.json::<Value>().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_assemblyai_token(keystore: tauri::State<'_, KeyStore>) -> Result<String, String> {
    let api_key = keystore
        .get("assemblyai")
        .ok_or_else(|| "No API key configured for assemblyai. Set it in Settings.".to_string())?;

    let client = reqwest::Client::new();
    let res = client
        .get("https://streaming.assemblyai.com/v3/token?expires_in_seconds=480")
        .header("Authorization", &api_key)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("AssemblyAI token error: {}", res.status()));
    }

    let json: Value = res.json().await.map_err(|e| e.to_string())?;
    json["token"]
        .as_str()
        .map(|s| s.to_owned())
        .ok_or_else(|| "No token in AssemblyAI v3 response".to_string())
}

#[tauri::command]
pub async fn elevenlabs_tts(
    keystore: tauri::State<'_, KeyStore>,
    text: String,
    voice_id: String,
    model_id: Option<String>,
    output_format: Option<String>,
    latency_optimization: Option<u8>,
    language_code: Option<String>,
) -> Result<Vec<u8>, String> {
    let api_key = keystore
        .get("elevenlabs")
        .ok_or_else(|| "No API key configured for elevenlabs. Set it in Settings.".to_string())?;

    let resolved_model = model_id.unwrap_or_else(|| "eleven_flash_v2_5".to_string());
    let resolved_format = output_format.unwrap_or_else(|| "mp3_44100_192".to_string());
    let resolved_latency = latency_optimization.unwrap_or(3);
    let client = reqwest::Client::new();
    let mut body = serde_json::json!({
        "text": text,
        "model_id": resolved_model,
        "voice_settings": {
            "stability": 0.35,
            "similarity_boost": 0.85,
            "style": 0.15,
            "use_speaker_boost": true
        }
    });
    if let Some(lang) = language_code {
        body["language_id"] = serde_json::json!(lang);
    }
    let res = client
        .post(format!(
            "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format={resolved_format}&optimize_streaming_latency={resolved_latency}"
        ))
        .header("xi-api-key", &api_key)
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("ElevenLabs {}: {}", res.status(), res.text().await.unwrap_or_default()));
    }

    res.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn elevenlabs_list_voices(
    keystore: tauri::State<'_, KeyStore>,
) -> Result<Value, String> {
    let api_key = keystore
        .get("elevenlabs")
        .ok_or_else(|| "No API key configured for elevenlabs. Set it in Settings.".to_string())?;

    let client = reqwest::Client::new();
    let res = client
        .get("https://api.elevenlabs.io/v1/voices")
        .header("xi-api-key", &api_key)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("ElevenLabs voices: {}", res.status()));
    }

    res.json::<Value>().await.map_err(|e| e.to_string())
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioFileSample {
    pub base64: String,
    pub file_name: String,
}

fn mime_for_filename(name: &str) -> &'static str {
    if name.ends_with(".mp3") { "audio/mpeg" }
    else if name.ends_with(".m4a") { "audio/mp4" }
    else if name.ends_with(".ogg") { "audio/ogg" }
    else { "audio/wav" }
}

#[tauri::command]
pub async fn elevenlabs_add_voice(
    keystore: tauri::State<'_, KeyStore>,
    name: String,
    audio_files: Vec<AudioFileSample>,
    description: Option<String>,
) -> Result<String, String> {
    if audio_files.is_empty() {
        return Err("No audio files provided".to_string());
    }

    let api_key = keystore
        .get("elevenlabs")
        .ok_or_else(|| "No API key configured for elevenlabs. Set it in Settings.".to_string())?;

    let mut form = reqwest::multipart::Form::new().text("name", name);

    for sample in audio_files {
        let bytes = base64_decode(&sample.base64)
            .map_err(|e| format!("Invalid base64 audio: {e}"))?;
        let mime = mime_for_filename(&sample.file_name);
        let part = reqwest::multipart::Part::bytes(bytes)
            .file_name(sample.file_name)
            .mime_str(mime)
            .map_err(|e| e.to_string())?;
        form = form.part("files", part);
    }

    if let Some(desc) = description {
        form = form.text("description", desc);
    }

    let client = reqwest::Client::new();
    let res = client
        .post("https://api.elevenlabs.io/v1/voices/add")
        .header("xi-api-key", &api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("Voice clone failed: {}", res.text().await.unwrap_or_default()));
    }

    let json: Value = res.json().await.map_err(|e| e.to_string())?;
    json["voice_id"]
        .as_str()
        .map(|s| s.to_owned())
        .ok_or_else(|| "No voice_id in response".to_string())
}

fn base64_decode(s: &str) -> Result<Vec<u8>, base64::DecodeError> {
    use base64::{Engine, engine::general_purpose::STANDARD};
    STANDARD.decode(s)
}

#[tauri::command]
pub async fn extract_facts_oneshot(
    keystore: tauri::State<'_, KeyStore>,
    prompt: String,
    provider: String,
    model_id: String,
) -> Result<String, String> {
    let client = reqwest::Client::new();

    if provider == "anthropic" {
        let api_key = keystore.get("anthropic").ok_or("No Anthropic key")?;
        let body = serde_json::json!({
            "model": model_id,
            "max_tokens": 512,
            "messages": [{"role": "user", "content": prompt}]
        });
        let res = client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
        return Ok(json["content"][0]["text"].as_str().unwrap_or("").to_string());
    }

    let api_key = keystore.get("openai").ok_or("No OpenAI key")?;
    let body = serde_json::json!({
        "model": model_id,
        "max_tokens": 512,
        "messages": [{"role": "user", "content": prompt}]
    });
    let res = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(&api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let json: serde_json::Value = res.json().await.map_err(|e| e.to_string())?;
    Ok(json["choices"][0]["message"]["content"]
        .as_str()
        .unwrap_or("")
        .to_string())
}
