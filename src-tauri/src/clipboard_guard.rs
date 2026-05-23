/// Dim 61 — Clipboard data security (no auto-send to AI).
/// Dim 92 — Clipboard history awareness.
///
/// Provides safe clipboard access with:
///   1. PII scan before clipboard content is exposed to the AI pipeline.
///   2. Ring buffer of recent clipboard entries (Dim 92).
///   3. Explicit user-initiated access only — no passive clipboard polling.
///
/// The guard principle: clipboard content is NEVER automatically injected into
/// AI context. The frontend must call `read_clipboard_for_ai` explicitly, which
/// triggers a PII scan and user-visible notification of what was read.

use crate::security;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

const HISTORY_CAPACITY: usize = 20;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardEntry {
    pub text: String,
    pub timestamp_ms: u64,
    pub pii_categories: Vec<String>,
    pub redacted: bool,
}

pub struct ClipboardHistory {
    entries: Mutex<VecDeque<ClipboardEntry>>,
}

impl Default for ClipboardHistory {
    fn default() -> Self {
        Self {
            entries: Mutex::new(VecDeque::with_capacity(HISTORY_CAPACITY)),
        }
    }
}

impl ClipboardHistory {
    fn push(&self, entry: ClipboardEntry) {
        let mut q = self.entries.lock().unwrap();
        if q.len() >= HISTORY_CAPACITY {
            q.pop_front();
        }
        q.push_back(entry);
    }

    fn snapshot(&self) -> Vec<ClipboardEntry> {
        self.entries.lock().unwrap().iter().cloned().collect()
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}

/// Read clipboard text and scan for PII. Returns either the redacted version
/// (if PII was found) or the original. The user must explicitly call this —
/// DC never auto-reads clipboard. (Dim 61 + 92)
#[tauri::command]
pub fn read_clipboard_for_ai(
    history: tauri::State<'_, ClipboardHistory>,
) -> Result<Value, String> {
    let mut board = arboard::Clipboard::new().map_err(|e| format!("clipboard error: {e}"))?;
    let text = board.get_text().map_err(|e| format!("clipboard read error: {e}"))?;

    let pii = security::scan_for_pii(&text);
    let (final_text, was_redacted, pii_cats) = if pii.is_clean() {
        (text.clone(), false, vec![])
    } else {
        let cats: Vec<String> = pii.categories.iter().map(|s| s.to_string()).collect();
        (pii.redacted.clone(), true, cats.clone())
    };

    let entry = ClipboardEntry {
        text: final_text.chars().take(500).collect(), // cap stored history
        timestamp_ms: now_ms(),
        pii_categories: pii_cats.clone(),
        redacted: was_redacted,
    };
    history.push(entry);

    if was_redacted {
        log::info!("[clipboard] PII detected and redacted ({:?}) before AI exposure", pii_cats);
    }

    Ok(serde_json::json!({
        "text": final_text,
        "redacted": was_redacted,
        "piiCategories": pii_cats,
        "charCount": final_text.len(),
    }))
}

/// Return clipboard history (text is capped at 500 chars per entry). (Dim 92)
#[tauri::command]
pub fn get_clipboard_history(
    history: tauri::State<'_, ClipboardHistory>,
) -> Vec<ClipboardEntry> {
    history.snapshot()
}

/// Write text to clipboard (does not auto-inject into AI). (Dim 61)
#[tauri::command]
pub fn write_clipboard(text: String) -> Result<(), String> {
    let mut board = arboard::Clipboard::new().map_err(|e| format!("clipboard error: {e}"))?;
    board.set_text(text).map_err(|e| format!("clipboard write error: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clipboard_entry_pii_fields() {
        let entry = ClipboardEntry {
            text: "[REDACTED:email] test".to_string(),
            timestamp_ms: 0,
            pii_categories: vec!["email".to_string()],
            redacted: true,
        };
        assert!(entry.redacted);
        assert_eq!(entry.pii_categories[0], "email");
    }

    #[test]
    fn history_ring_buffer_capacity() {
        let h = ClipboardHistory::default();
        for i in 0..25usize {
            h.push(ClipboardEntry {
                text: i.to_string(),
                timestamp_ms: i as u64,
                pii_categories: vec![],
                redacted: false,
            });
        }
        let snap = h.snapshot();
        // Oldest 5 entries (0-4) should be evicted
        assert_eq!(snap.len(), HISTORY_CAPACITY);
        assert_eq!(snap[0].text, "5");
        assert_eq!(snap[HISTORY_CAPACITY - 1].text, "24");
    }
}
