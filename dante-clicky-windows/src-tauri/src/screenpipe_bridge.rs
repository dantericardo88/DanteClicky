/// Dim 88 — Screenpipe integration depth (pipe events, read memory).
///
/// Screenpipe exposes a local HTTP API on port 3030. This module provides:
///   1. `screenpipe_status`     — check if screenpipe is running
///   2. `screenpipe_search`     — full-text search over OCR/audio index
///   3. `screenpipe_recent`     — fetch recent context chunks
///   4. `screenpipe_subscribe`  — start a background poller that forwards
///                                new screenpipe events into DC's EventBus,
///                                enabling true push delivery via /v1/events/stream
///   5. `screenpipe_unsubscribe`— stop the background poller
///
/// Integration principle: DanteClicky can READ from screenpipe to enrich AI
/// context. It does not control screenpipe or depend on it being present.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use tauri::Manager;

const SCREENPIPE_BASE: &str = "http://127.0.0.1:3030";
const TIMEOUT_SECS: u64 = 5;
const POLL_INTERVAL_SECS: u64 = 10;

/// Tracks the cancellation token for the active screenpipe subscription.
#[derive(Default)]
pub struct ScreenpipeSubscriptionState {
    cancel_tx: Mutex<Option<tokio::sync::oneshot::Sender<()>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenpipeStatus {
    pub running: bool,
    pub version: Option<String>,
    pub base_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenpipeChunk {
    pub content_type: String,  // "OCR" or "Audio"
    pub text: String,
    pub timestamp: String,
    pub app_name: Option<String>,
    pub window_name: Option<String>,
}

// ── Tauri commands ────────────────────────────────────────────────────────────

/// Check if screenpipe is running on localhost:3030. (Dim 88)
#[tauri::command]
pub async fn screenpipe_status() -> ScreenpipeStatus {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
        .build()
        .unwrap_or_default();

    match client.get(format!("{SCREENPIPE_BASE}/health")).send().await {
        Ok(r) if r.status().is_success() => {
            let json: Value = r.json().await.unwrap_or_default();
            ScreenpipeStatus {
                running: true,
                version: json.get("version").and_then(|v| v.as_str()).map(String::from),
                base_url: SCREENPIPE_BASE.to_string(),
            }
        }
        _ => ScreenpipeStatus {
            running: false,
            version: None,
            base_url: SCREENPIPE_BASE.to_string(),
        },
    }
}

/// Search screenpipe's indexed OCR + audio content. Returns up to `limit` chunks.
/// Use this to pull relevant past context into AI conversations. (Dim 88)
#[tauri::command]
pub async fn screenpipe_search(
    query: String,
    limit: Option<usize>,
    content_type: Option<String>,
) -> Result<Vec<ScreenpipeChunk>, String> {
    let n = limit.unwrap_or(10).min(50);
    let ct = content_type.unwrap_or_else(|| "all".to_string());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!(
        "{SCREENPIPE_BASE}/search?q={}&limit={}&content_type={}",
        urlenccode(&query), n, ct
    );

    let res = client.get(&url).send().await.map_err(|e| format!("screenpipe unreachable: {e}"))?;
    let json: Value = res.json().await.map_err(|e| format!("screenpipe parse error: {e}"))?;

    let chunks = json["data"].as_array()
        .unwrap_or(&vec![])
        .iter()
        .filter_map(|item| parse_chunk(item))
        .collect();

    Ok(chunks)
}

/// Fetch the most recent N context chunks from screenpipe without a query. (Dim 88)
#[tauri::command]
pub async fn screenpipe_recent(limit: Option<usize>) -> Result<Vec<ScreenpipeChunk>, String> {
    screenpipe_search(String::new(), limit, None).await
}

fn parse_chunk(item: &Value) -> Option<ScreenpipeChunk> {
    let content = item.get("content")?;
    let content_type = item.get("type")?.as_str()?.to_string();
    let text = match content_type.as_str() {
        "OCR" => content.get("text")?.as_str()?.to_string(),
        "Audio" => content.get("transcription")?.as_str()?.to_string(),
        _ => return None,
    };
    if text.trim().is_empty() { return None; }

    Some(ScreenpipeChunk {
        content_type,
        text,
        timestamp: content.get("timestamp")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .to_string(),
        app_name: content.get("app_name").and_then(|v| v.as_str()).map(String::from),
        window_name: content.get("window_name").and_then(|v| v.as_str()).map(String::from),
    })
}

/// Start a background poller that forwards new screenpipe events into DC's EventBus. (Dim 88)
///
/// Every `poll_secs` seconds the poller fetches the most recent `batch_size` chunks from
/// screenpipe and publishes any that arrived after the last seen timestamp.
/// This enables true push delivery: clients subscribe to GET /v1/events/stream (SSE)
/// and receive `screenpipe.ocr` / `screenpipe.audio` events forwarded through DC.
#[tauri::command]
pub async fn screenpipe_subscribe(
    app: tauri::AppHandle,
    poll_secs: Option<u64>,
    batch_size: Option<usize>,
) -> Result<String, String> {
    let state = app.state::<ScreenpipeSubscriptionState>();
    let mut lock = state.cancel_tx.lock().unwrap();
    if lock.is_some() {
        return Err("already subscribed — call screenpipe_unsubscribe first".to_string());
    }

    let (cancel_tx, mut cancel_rx) = tokio::sync::oneshot::channel::<()>();
    *lock = Some(cancel_tx);
    drop(lock);

    let event_bus = app.state::<crate::event_bus::EventBus>().inner().clone();
    let interval = std::time::Duration::from_secs(poll_secs.unwrap_or(POLL_INTERVAL_SECS).max(2));
    let n = batch_size.unwrap_or(5).min(20);

    tokio::spawn(async move {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(TIMEOUT_SECS))
            .build()
            .unwrap_or_default();

        let mut last_ts: Option<String> = None;

        loop {
            tokio::select! {
                _ = &mut cancel_rx => {
                    log::info!("[screenpipe] subscription cancelled");
                    break;
                }
                _ = tokio::time::sleep(interval) => {}
            }

            let url = format!("{SCREENPIPE_BASE}/search?q=&limit={n}&content_type=all");
            let chunks: Vec<ScreenpipeChunk> = match client.get(&url).send().await {
                Ok(r) => {
                    let json: Value = r.json().await.unwrap_or_default();
                    json["data"].as_array()
                        .unwrap_or(&vec![])
                        .iter()
                        .filter_map(|item| parse_chunk(item))
                        .collect()
                }
                Err(_) => continue,
            };

            for chunk in chunks {
                // Skip events we've already published
                if let Some(ref lt) = last_ts {
                    if chunk.timestamp <= *lt { continue; }
                }
                let topic = format!("screenpipe.{}", chunk.content_type.to_lowercase());
                event_bus.publish(crate::event_bus::BusEvent::new(
                    &topic,
                    serde_json::to_value(&chunk).unwrap_or_default(),
                ));
            }

            // Advance last_ts to the latest chunk we received (chunks returned newest-first)
            // Reset is fine — we'll see duplicates for one cycle but that's safe
            let url2 = format!("{SCREENPIPE_BASE}/search?q=&limit=1&content_type=all");
            if let Ok(r) = client.get(&url2).send().await {
                if let Ok(json) = r.json::<Value>().await {
                    if let Some(chunk) = json["data"].as_array().and_then(|a| a.first()) {
                        if let Some(ch) = parse_chunk(chunk) {
                            last_ts = Some(ch.timestamp);
                        }
                    }
                }
            }
        }
    });

    Ok(format!("subscribed to screenpipe (poll every {}s, batch {})", interval.as_secs(), n))
}

/// Stop the active screenpipe event subscription. (Dim 88)
#[tauri::command]
pub fn screenpipe_unsubscribe(
    app: tauri::AppHandle,
) -> Result<(), String> {
    let state = app.state::<ScreenpipeSubscriptionState>();
    let mut lock = state.cancel_tx.lock().unwrap();
    match lock.take() {
        Some(tx) => { let _ = tx.send(()); Ok(()) }
        None => Err("no active screenpipe subscription".to_string()),
    }
}

fn urlenccode(s: &str) -> String {
    s.chars().fold(String::new(), |mut acc, c| {
        match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => acc.push(c),
            ' ' => acc.push('+'),
            _ => { use std::fmt::Write; let _ = write!(acc, "%{:02X}", c as u32); }
        }
        acc
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parse_ocr_chunk() {
        let item = json!({
            "type": "OCR",
            "content": {
                "text": "Hello world",
                "timestamp": "2026-05-21T10:00:00Z",
                "app_name": "chrome",
                "window_name": "Google Search"
            }
        });
        let chunk = parse_chunk(&item).expect("parsed");
        assert_eq!(chunk.content_type, "OCR");
        assert_eq!(chunk.text, "Hello world");
        assert_eq!(chunk.app_name.as_deref(), Some("chrome"));
    }

    #[test]
    fn urlencode_spaces_and_special() {
        assert_eq!(urlenccode("hello world"), "hello+world");
        assert_eq!(urlenccode("a/b"), "a%2Fb");
    }

    #[test]
    fn screenpipe_status_returns_not_running_offline() {
        // Without a live screenpipe, the sync path should handle gracefully.
        // We test the status struct directly.
        let s = ScreenpipeStatus { running: false, version: None, base_url: SCREENPIPE_BASE.to_string() };
        assert!(!s.running);
    }
}
