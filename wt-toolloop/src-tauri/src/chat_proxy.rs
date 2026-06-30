use futures_util::StreamExt;
use serde_json::Value;
use tauri::{AppHandle, Emitter};

#[tauri::command]
pub async fn stream_claude(
    app: AppHandle,
    api_key: String,
    body: Value,
    call_id: String,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let res = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", &api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let err = res.text().await.unwrap_or_default();
        app.emit(&format!("chat-error-{call_id}"), &err).ok();
        return Err(err);
    }

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
                        if data == "[DONE]" { continue; }
                        if let Ok(ev) = serde_json::from_str::<Value>(data) {
                            if ev["type"] == "content_block_delta" {
                                if let Some(text) = ev["delta"]["text"].as_str() {
                                    app.emit(&format!("chat-chunk-{call_id}"), text).ok();
                                }
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
    base_url: String,
    api_key: String,
    body: Value,
    call_id: String,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let res = client
        .post(format!("{base_url}/chat/completions"))
        .header("Authorization", format!("Bearer {api_key}"))
        .header("content-type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let err = res.text().await.unwrap_or_default();
        app.emit(&format!("chat-error-{call_id}"), &err).ok();
        return Err(err);
    }

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
                        if data == "[DONE]" { continue; }
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
pub async fn get_assemblyai_token(api_key: String) -> Result<String, String> {
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
    api_key: String,
    text: String,
    voice_id: String,
) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::new();
    let res = client
        .post(format!(
            "https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
        ))
        .header("xi-api-key", &api_key)
        .header("content-type", "application/json")
        .json(&serde_json::json!({
            "text": text,
            "model_id": "eleven_flash_v2_5",
            "voice_settings": { "stability": 0.5, "similarity_boost": 0.75 }
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("ElevenLabs {}", res.status()));
    }

    res.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| e.to_string())
}
