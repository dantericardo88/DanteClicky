use futures_util::StreamExt;
use serde_json::Value;
use std::collections::HashMap;
use tauri::{AppHandle, Emitter};

use crate::keystore::KeyStore;
use crate::security;

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

fn provider_endpoint(provider: &str) -> Option<(&'static str, Option<&'static str>)> {
    match provider {
        "openai" => Some(("https://api.openai.com/v1", Some("openai"))),
        "grok" => Some(("https://api.x.ai/v1", Some("xai"))),
        "openrouter" => Some(("https://openrouter.ai/api/v1", Some("openrouter"))),
        "ollama" => Some(("http://localhost:11434/v1", None)),
        _ => None,
    }
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
    log::info!("[chat_proxy] stream_claude → looking up anthropic key");
    let api_key = keystore
        .get("anthropic")
        .ok_or_else(|| {
            log::error!("[chat_proxy] stream_claude → anthropic key NOT found in keystore");
            "No API key configured for anthropic. Set it in Settings.".to_string()
        })?;
    log::info!("[chat_proxy] stream_claude → anthropic key found (len={})", api_key.len());

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

    // Dim 51 — scan last user message for injection patterns before forwarding
    {
        let user_text = extract_last_user_text(body.get("messages").unwrap_or(&Value::Null));
        if !user_text.is_empty() {
            let (_safe, was_risky) = security::prepare_user_context_for_ai(&user_text, "stream_claude");
            if was_risky {
                app.emit(&format!("security-injection-risk-{call_id}"), "prompt-injection-detected").ok();
            }
        }
    }

    // Dim 58 — redact PII from all user messages before forwarding to AI
    if let Some(msgs) = body.get_mut("messages") {
        let n = security::redact_pii_in_messages(msgs);
        if n > 0 {
            log::info!("[security] redacted PII in {n} message(s) before Claude call");
        }
    }

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
    let (allowed_base_url, store_key) =
        provider_endpoint(&provider).ok_or_else(|| format!("Unsupported provider: {provider}"))?;
    log::info!("[chat_proxy] stream_openai_compat → provider={provider}, store_key={store_key:?}, base_url={base_url}");
    if base_url.trim_end_matches('/') != allowed_base_url {
        log::error!("[chat_proxy] stream_openai_compat → blocked untrusted endpoint: {base_url} (expected {allowed_base_url})");
        return Err(format!("Blocked untrusted model endpoint for {provider}"));
    }
    let api_key = match store_key {
        Some(key) => {
            log::info!("[chat_proxy] stream_openai_compat → looking up keystore key={key}");
            let found = keystore.get(key);
            if found.is_none() {
                log::error!("[chat_proxy] stream_openai_compat → key '{key}' NOT found for provider '{provider}'");
            } else {
                log::info!("[chat_proxy] stream_openai_compat → key '{key}' found (len={})", found.as_ref().unwrap().len());
            }
            Some(found.ok_or_else(|| format!("No API key configured for {provider}. Set it in Settings."))?)
        }
        None => None,
    };

    let mut body = body;

    // Dim 51 — scan last user message for injection patterns before forwarding
    {
        let user_text = extract_last_user_text(body.get("messages").unwrap_or(&Value::Null));
        if !user_text.is_empty() {
            let (_safe, was_risky) = security::prepare_user_context_for_ai(
                &user_text,
                &format!("stream_openai_compat/{provider}"),
            );
            if was_risky {
                app.emit(&format!("security-injection-risk-{call_id}"), "prompt-injection-detected").ok();
            }
        }
    }

    // Dim 58 — redact PII from all user messages before forwarding to AI
    if let Some(msgs) = body.get_mut("messages") {
        let n = security::redact_pii_in_messages(msgs);
        if n > 0 {
            log::info!("[security] redacted PII in {n} message(s) before {provider} call");
        }
    }

    let client = reqwest::Client::new();
    let res = {
        let mut last_err = String::new();
        let mut result = None;
        for attempt in 0u32..4 {
            if attempt > 0 {
                retry_delay(attempt - 1).await;
            }
            let mut request = client
                .post(format!("{allowed_base_url}/chat/completions"))
                .header("content-type", "application/json");
            if let Some(api_key) = api_key.as_ref() {
                request = request.header("Authorization", format!("Bearer {api_key}"));
            }
            if provider == "openrouter" {
                request = request
                    .header("HTTP-Referer", "https://github.com/dantericardo88/DanteClicky")
                    .header("X-Title", "DanteClicky");
            }
            let r = match request.json(&body).send().await {
                Ok(r) => r,
                Err(e) => {
                    last_err = e.to_string();
                    continue;
                }
            };
            let status = r.status().as_u16();
            if r.status().is_success() {
                log::info!("[chat_proxy] stream_openai_compat → HTTP {status} OK for provider={provider}");
                result = Some(r);
                break;
            }
            let err = r.text().await.unwrap_or_default();
            log::error!("[chat_proxy] stream_openai_compat → HTTP {status} error for provider={provider}: {err}");
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
    let mut chunk_count: u32 = 0;

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
                                chunk_count += 1;
                                app.emit(&format!("chat-chunk-{call_id}"), text).ok();
                            } else {
                                log::debug!("[chat_proxy] SSE event has no delta.content: {data}");
                            }
                        } else {
                            log::warn!("[chat_proxy] SSE parse error for provider={provider}: {data}");
                        }
                    }
                }
            }
        }
    }

    log::info!("[chat_proxy] stream_openai_compat done → provider={provider}, chunks_emitted={chunk_count}");
    if chunk_count == 0 {
        log::warn!("[chat_proxy] stream_openai_compat → 0 content chunks received from provider={provider}; Ollama model may not be loaded or model ID may be wrong");
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

/// Pull plain text from the last user message in a messages array.
/// Handles both string content and structured content-block arrays.
fn extract_last_user_text(messages: &Value) -> String {
    let arr = match messages.as_array() {
        Some(a) => a,
        None => return String::new(),
    };
    for msg in arr.iter().rev() {
        if msg["role"] != "user" {
            continue;
        }
        let content = &msg["content"];
        if let Some(s) = content.as_str() {
            return s.to_owned();
        }
        if let Some(parts) = content.as_array() {
            let text: String = parts
                .iter()
                .filter_map(|p| {
                    if p["type"] == "text" {
                        p["text"].as_str()
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join(" ");
            if !text.is_empty() {
                return text;
            }
        }
        break;
    }
    String::new()
}

/// Scan a text string for prompt injection patterns (Dim 51).
/// Returns `{ risky: bool, patterns: string[], escaped: string }`.
#[tauri::command]
pub fn scan_prompt_for_injection(text: String) -> Value {
    match security::scan_for_injection(&text) {
        security::InjectionRisk::Clean => serde_json::json!({ "risky": false, "patterns": [] }),
        security::InjectionRisk::Suspicious { patterns, escaped } => serde_json::json!({
            "risky": true,
            "patterns": patterns,
            "escaped": escaped
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::provider_endpoint;

    #[test]
    fn provider_endpoints_are_allowlisted() {
        assert_eq!(
            provider_endpoint("openrouter"),
            Some(("https://openrouter.ai/api/v1", Some("openrouter")))
        );
        assert_eq!(
            provider_endpoint("ollama"),
            Some(("http://localhost:11434/v1", None))
        );
        assert_eq!(provider_endpoint("https://evil.example"), None);
    }
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

// ── Context window token budget (Dim 70) ──────────────────────────────────────

/// Rough token estimate: ~4 chars per token (Anthropic rule of thumb).
fn estimate_tokens(text: &str) -> usize {
    (text.len() + 3) / 4
}

/// Estimate total token usage for a messages array.
fn estimate_messages_tokens(messages: &Value) -> usize {
    let arr = match messages.as_array() {
        Some(a) => a,
        None => return 0,
    };
    arr.iter().map(|msg| {
        let content = &msg["content"];
        let text = if let Some(s) = content.as_str() {
            s.to_owned()
        } else if let Some(parts) = content.as_array() {
            parts.iter()
                .filter_map(|p| if p["type"] == "text" { p["text"].as_str() } else { None })
                .collect::<Vec<_>>().join(" ")
        } else {
            String::new()
        };
        // Add 4 tokens overhead per message for role + formatting.
        estimate_tokens(&text) + 4
    }).sum()
}

/// Trim a messages array to fit within `max_tokens` by dropping the oldest
/// non-system messages (keeping the most recent exchange intact).
/// Returns the trimmed messages array and a bool indicating if trimming occurred.
fn trim_messages_to_budget(messages: &Value, max_tokens: usize) -> (Value, bool) {
    let arr = match messages.as_array() {
        Some(a) => a.clone(),
        None => return (messages.clone(), false),
    };
    if estimate_messages_tokens(messages) <= max_tokens {
        return (messages.clone(), false);
    }
    // Partition system messages (must keep) from conversation messages (can drop).
    let (system_msgs, mut conv_msgs): (Vec<_>, Vec<_>) = arr.into_iter()
        .partition(|m| m["role"].as_str() == Some("system"));
    // Drop oldest conversation messages until budget is met.
    while conv_msgs.len() > 2 {
        let total = {
            let mut all = system_msgs.clone();
            all.extend(conv_msgs.iter().cloned());
            estimate_messages_tokens(&Value::Array(all))
        };
        if total <= max_tokens { break; }
        conv_msgs.remove(0);
    }
    let mut result = system_msgs;
    result.extend(conv_msgs);
    (Value::Array(result), true)
}

/// Compress a messages array to fit within a token budget.
/// Returns a JSON object with the trimmed messages, estimated tokens, and
/// whether any messages were dropped. (Dim 70)
#[tauri::command]
pub fn compress_context(messages: Value, max_tokens: Option<usize>) -> Value {
    let budget = max_tokens.unwrap_or(80_000).clamp(1_000, 200_000);
    let original_tokens = estimate_messages_tokens(&messages);
    let (trimmed, was_compressed) = trim_messages_to_budget(&messages, budget);
    let final_tokens = estimate_messages_tokens(&trimmed);
    serde_json::json!({
        "messages": trimmed,
        "originalTokens": original_tokens,
        "finalTokens": final_tokens,
        "wasCompressed": was_compressed,
        "budget": budget,
    })
}

#[cfg(test)]
mod token_budget_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn estimate_tokens_rough() {
        assert_eq!(estimate_tokens("hello"), 2); // 5 chars → (5+3)/4 = 2
        assert_eq!(estimate_tokens(""), 0);
    }

    #[test]
    fn no_trim_when_under_budget() {
        let msgs = json!([
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "hello"}
        ]);
        let (trimmed, was_compressed) = trim_messages_to_budget(&msgs, 10_000);
        assert!(!was_compressed);
        assert_eq!(trimmed.as_array().unwrap().len(), 2);
    }

    #[test]
    fn trims_oldest_messages_first() {
        // Create 10 messages with ~500 tokens each to force trimming.
        let long_text = "word ".repeat(500); // ~625 tokens
        let mut arr = vec![];
        for i in 0..10 {
            arr.push(json!({ "role": if i % 2 == 0 { "user" } else { "assistant" }, "content": long_text }));
        }
        let msgs = Value::Array(arr);
        let original_tokens = estimate_messages_tokens(&msgs);
        let (trimmed, was_compressed) = trim_messages_to_budget(&msgs, original_tokens / 2);
        assert!(was_compressed);
        // Must have fewer messages
        assert!(trimmed.as_array().unwrap().len() < 10);
        // Must still have at least 2 (the most recent pair)
        assert!(trimmed.as_array().unwrap().len() >= 2);
    }

    // ── Dim 23: compress_context Tauri command ────────────────────────────────

    #[test]
    fn compress_context_returns_token_fields() {
        let msgs = json!([
            {"role": "user", "content": "hello"},
            {"role": "assistant", "content": "world"}
        ]);
        let result = compress_context(msgs, None);
        assert!(result.get("messages").is_some());
        assert!(result.get("originalTokens").is_some());
        assert!(result.get("finalTokens").is_some());
        assert!(result.get("wasCompressed").is_some());
        assert!(result.get("budget").is_some());
    }

    #[test]
    fn compress_context_reduces_over_budget_conversation() {
        let long_text = "word ".repeat(1000); // ~1250 tokens per message
        let msgs = json!([
            {"role": "user",      "content": long_text},
            {"role": "assistant", "content": long_text},
            {"role": "user",      "content": long_text},
            {"role": "assistant", "content": long_text},
            {"role": "user",      "content": long_text},
            {"role": "assistant", "content": long_text},
        ]);
        let result = compress_context(msgs, Some(2_000));
        let was_compressed = result["wasCompressed"].as_bool().unwrap_or(false);
        let original_tokens = result["originalTokens"].as_u64().unwrap_or(0);
        let final_tokens = result["finalTokens"].as_u64().unwrap_or(u64::MAX);
        assert!(was_compressed, "6-message overbudget conversation must be compressed");
        assert!(
            final_tokens < original_tokens,
            "compression must reduce token count: original={original_tokens}, final={final_tokens}"
        );
        // Keep at least 2 messages (last user+assistant pair), so final > 0.
        assert!(final_tokens > 0, "compression must retain at least the last exchange");
    }

    #[test]
    fn compress_context_preserves_system_messages() {
        let long_text = "word ".repeat(600); // ~750 tokens per message
        let msgs = json!([
            {"role": "system",    "content": "You are DanteClicky, a Windows AI assistant."},
            {"role": "user",      "content": long_text},
            {"role": "assistant", "content": long_text},
            {"role": "user",      "content": long_text},
            {"role": "assistant", "content": long_text},
        ]);
        let result = compress_context(msgs, Some(1_000));
        let messages = result["messages"].as_array().expect("messages array");
        // System message must survive compression
        let has_system = messages.iter().any(|m| m["role"].as_str() == Some("system"));
        assert!(has_system, "system message must be preserved after compression");
    }

    // ── Dim 42: Error handling — retryability gate ────────────────────────────

    #[test]
    fn retryable_status_codes() {
        assert!(is_retryable(429), "rate limit must be retryable");
        assert!(is_retryable(500), "server error must be retryable");
        assert!(is_retryable(502), "bad gateway must be retryable");
        assert!(is_retryable(503), "service unavailable must be retryable");
        assert!(is_retryable(504), "gateway timeout must be retryable");
    }

    #[test]
    fn non_retryable_status_codes() {
        assert!(!is_retryable(400), "bad request must not retry (client error)");
        assert!(!is_retryable(401), "unauthorized must not retry (auth error)");
        assert!(!is_retryable(403), "forbidden must not retry (auth error)");
        assert!(!is_retryable(404), "not found must not retry");
        assert!(!is_retryable(200), "success must not retry");
    }

    // ── Dim 24: Multi-model — 5 provider coverage ─────────────────────────────

    #[test]
    fn all_five_providers_have_endpoints() {
        // Anthropic uses a dedicated stream_claude path; these are the 4 OpenAI-compat providers.
        assert!(provider_endpoint("openai").is_some(), "openai provider required");
        assert!(provider_endpoint("grok").is_some(), "grok provider required");
        assert!(provider_endpoint("openrouter").is_some(), "openrouter provider required");
        assert!(provider_endpoint("ollama").is_some(), "ollama (local) provider required");
        // Unknown providers must be blocked (SSRF prevention)
        assert!(provider_endpoint("https://evil.example").is_none(), "unknown urls must be blocked");
    }

    #[test]
    fn ollama_has_no_key_requirement() {
        // Ollama is a local provider — key_name is None so no keystore lookup happens.
        let (_, key_name) = provider_endpoint("ollama").unwrap();
        assert!(key_name.is_none(), "ollama must not require an API key");
    }

    #[test]
    fn cloud_providers_require_keys() {
        let (_, openai_key) = provider_endpoint("openai").unwrap();
        assert!(openai_key.is_some(), "openai must require a key");
        let (_, grok_key) = provider_endpoint("grok").unwrap();
        assert!(grok_key.is_some(), "grok must require a key");
    }

    // ── Dim 71: Model switching — provider URL mapping ────────────────────────

    #[test]
    fn model_switching_provider_urls_are_correct() {
        let (openai_url, _) = provider_endpoint("openai").unwrap();
        assert_eq!(openai_url, "https://api.openai.com/v1");

        let (grok_url, _) = provider_endpoint("grok").unwrap();
        assert_eq!(grok_url, "https://api.x.ai/v1");

        let (openrouter_url, _) = provider_endpoint("openrouter").unwrap();
        assert_eq!(openrouter_url, "https://openrouter.ai/api/v1");

        let (ollama_url, _) = provider_endpoint("ollama").unwrap();
        assert_eq!(ollama_url, "http://localhost:11434/v1");
    }

    #[test]
    fn model_switching_uses_openai_compat_protocol() {
        // All four non-Anthropic providers must use the OpenAI-compatible API path.
        // Verifying URL shape: must end with /v1 (OpenAI-compat endpoint convention).
        for provider in ["openai", "grok", "openrouter", "ollama"] {
            let (url, _) = provider_endpoint(provider).unwrap();
            assert!(
                url.ends_with("/v1"),
                "provider {provider} URL must end with /v1 for OpenAI-compat: {url}"
            );
        }
    }
}
