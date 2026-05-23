use anyhow::{anyhow, Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const DEFAULT_RETENTION_DAYS: i64 = 14;
const MAX_SNAPSHOT_LIMIT: usize = 1_000;

#[derive(Debug, Clone, Deserialize)]
pub struct ObservabilityRecordInput {
    pub kind: String,
    pub name: String,
    pub timestamp: Option<String>,
    pub runtime_session_id: String,
    pub trace_id: String,
    pub span_id: Option<String>,
    pub parent_span_id: Option<String>,
    pub payload: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct ObservabilityRecordRow {
    pub id: i64,
    pub kind: String,
    pub name: String,
    pub timestamp: String,
    pub runtime_session_id: String,
    pub trace_id: String,
    pub span_id: Option<String>,
    pub parent_span_id: Option<String>,
    pub payload: Value,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ObservabilitySnapshot {
    pub status: String,
    pub record_count: i64,
    pub records: Vec<ObservabilityRecordRow>,
    pub crash_markers: Vec<Value>,
    pub retention_days: i64,
}

#[derive(Debug, Clone)]
pub struct ObservabilityStore {
    path: PathBuf,
}

impl ObservabilityStore {
    pub fn open_path(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("create observability directory {}", parent.display()))?;
        }
        let store = Self {
            path: path.to_path_buf(),
        };
        store.ensure_schema()?;
        Ok(store)
    }

    pub fn append(&self, record: ObservabilityRecordInput) -> Result<i64> {
        validate_kind(&record.kind)?;
        let conn = self.connection()?;
        let payload = sanitize_json(record.payload);
        let payload_json = serde_json::to_string(&payload)?;
        let timestamp = record.timestamp.unwrap_or_else(|| unix_timestamp().to_string());
        let created_at = unix_timestamp();
        conn.execute(
            "INSERT INTO observability_records
             (kind, name, timestamp, runtime_session_id, trace_id, span_id, parent_span_id, payload_json, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                record.kind,
                record.name,
                timestamp,
                record.runtime_session_id,
                record.trace_id,
                record.span_id,
                record.parent_span_id,
                payload_json,
                created_at,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn snapshot(&self, limit: usize, since: Option<String>) -> Result<ObservabilitySnapshot> {
        let conn = self.connection()?;
        let bounded_limit = limit.clamp(1, MAX_SNAPSHOT_LIMIT);
        let record_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM observability_records WHERE (?1 IS NULL OR timestamp >= ?1)",
            params![since],
            |row| row.get(0),
        )?;
        let mut stmt = conn.prepare(
            "SELECT id, kind, name, timestamp, runtime_session_id, trace_id, span_id, parent_span_id, payload_json, created_at
             FROM observability_records
             WHERE (?1 IS NULL OR timestamp >= ?1)
             ORDER BY id DESC
             LIMIT ?2",
        )?;
        let rows = stmt
            .query_map(params![since, bounded_limit as i64], |row| {
                let payload_json: String = row.get(8)?;
                let payload = serde_json::from_str(&payload_json).unwrap_or_else(|_| json!({}));
                Ok(ObservabilityRecordRow {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    name: row.get(2)?,
                    timestamp: row.get(3)?,
                    runtime_session_id: row.get(4)?,
                    trace_id: row.get(5)?,
                    span_id: row.get(6)?,
                    parent_span_id: row.get(7)?,
                    payload,
                    created_at: row.get(9)?,
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(ObservabilitySnapshot {
            status: "ready".to_string(),
            record_count,
            records: rows,
            crash_markers: read_crash_markers(&self.path.with_extension("crash.jsonl")),
            retention_days: DEFAULT_RETENTION_DAYS,
        })
    }

    pub fn clear(&self) -> Result<usize> {
        let conn = self.connection()?;
        let deleted = conn.execute("DELETE FROM observability_records", [])?;
        Ok(deleted)
    }

    pub fn prune(&self, retention_days: i64) -> Result<usize> {
        let conn = self.connection()?;
        if retention_days <= 0 {
            return Ok(conn.execute("DELETE FROM observability_records", [])?);
        }
        let cutoff = unix_timestamp() - retention_days.saturating_mul(86_400);
        Ok(conn.execute(
            "DELETE FROM observability_records WHERE created_at < ?1",
            params![cutoff],
        )?)
    }

    fn ensure_schema(&self) -> Result<()> {
        let conn = self.connection()?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             CREATE TABLE IF NOT EXISTS observability_records (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               kind TEXT NOT NULL CHECK(kind IN ('event', 'span', 'metric', 'error')),
               name TEXT NOT NULL,
               timestamp TEXT NOT NULL,
               runtime_session_id TEXT NOT NULL,
               trace_id TEXT NOT NULL,
               span_id TEXT,
               parent_span_id TEXT,
               payload_json TEXT NOT NULL,
               created_at INTEGER NOT NULL
             );
             CREATE INDEX IF NOT EXISTS idx_observability_records_created_at
               ON observability_records(created_at DESC);
             CREATE INDEX IF NOT EXISTS idx_observability_records_trace
               ON observability_records(trace_id, span_id);",
        )?;
        Ok(())
    }

    fn connection(&self) -> Result<Connection> {
        Connection::open(&self.path).with_context(|| {
            format!("open observability database {}", self.path.display())
        })
    }
}

#[tauri::command]
pub fn observability_append(app: AppHandle, record: ObservabilityRecordInput) -> std::result::Result<(), String> {
    let store = store_for_app(&app)?;
    store.append(record).map_err(|err| err.to_string())?;
    let _ = store.prune(DEFAULT_RETENTION_DAYS);
    Ok(())
}

#[tauri::command]
pub fn observability_snapshot(
    app: AppHandle,
    limit: Option<usize>,
    since: Option<String>,
) -> std::result::Result<ObservabilitySnapshot, String> {
    store_for_app(&app)?
        .snapshot(limit.unwrap_or(200), since)
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn observability_clear(app: AppHandle) -> std::result::Result<(), String> {
    store_for_app(&app)?
        .clear()
        .map(|_| ())
        .map_err(|err| err.to_string())
}

#[tauri::command]
pub fn observability_prune(
    app: AppHandle,
    retention_days: Option<i64>,
) -> std::result::Result<usize, String> {
    store_for_app(&app)?
        .prune(retention_days.unwrap_or(DEFAULT_RETENTION_DAYS))
        .map_err(|err| err.to_string())
}

pub fn observability_snapshot_internal(
    app: &AppHandle,
    limit: i64,
) -> std::result::Result<serde_json::Value, String> {
    let store = store_for_app(app)?;
    let snapshot = store
        .snapshot(limit.clamp(1, MAX_SNAPSHOT_LIMIT as i64) as usize, None)
        .map_err(|e| e.to_string())?;
    serde_json::to_value(snapshot).map_err(|e| e.to_string())
}

pub fn install_panic_hook(app: AppHandle) {
    let crash_path = app
        .path()
        .app_data_dir()
        .map(|dir| dir.join("observability.crash.jsonl"))
        .ok();
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |panic_info| {
        if let Some(path) = &crash_path {
            let message = panic_info.to_string();
            let _ = write_crash_marker_at_path(path, &message);
        }
        previous(panic_info);
    }));
}

pub fn write_crash_marker_at_path(path: &Path, message: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let marker = json!({
        "timestamp": unix_timestamp().to_string(),
        "message": redact_text(message),
    });
    use std::io::Write;
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)?;
    writeln!(file, "{}", serde_json::to_string(&marker)?)?;
    Ok(())
}

fn store_for_app(app: &AppHandle) -> std::result::Result<ObservabilityStore, String> {
    let dir = app.path().app_data_dir().map_err(|err| err.to_string())?;
    ObservabilityStore::open_path(&dir.join("observability.db"))
        .map_err(|err| err.to_string())
}

fn validate_kind(kind: &str) -> Result<()> {
    match kind {
        "event" | "span" | "metric" | "error" => Ok(()),
        _ => Err(anyhow!("invalid observability kind: {kind}")),
    }
}

fn sanitize_json(value: Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut output = Map::new();
            for (key, value) in map {
                if is_sensitive_key(&key) {
                    continue;
                }
                output.insert(key, sanitize_json(value));
            }
            Value::Object(output)
        }
        Value::Array(values) => Value::Array(values.into_iter().take(12).map(sanitize_json).collect()),
        Value::String(text) => Value::String(redact_text(&text).chars().take(180).collect()),
        other => other,
    }
}

fn is_sensitive_key(key: &str) -> bool {
    let lower = key.to_ascii_lowercase();
    [
        "apikey",
        "api_key",
        "authorization",
        "bearer",
        "token",
        "secret",
        "password",
        "passwd",
        "passphrase",
        "credential",
        "cookie",
        "screenshot",
        "image",
        "base64",
        "b64",
        "prompt",
        "transcript",
        "response",
        "content",
        "windowtitle",
        "window_title",
        "title",
    ]
    .iter()
    .any(|needle| lower.contains(needle))
}

fn redact_text(input: &str) -> String {
    let mut output = Vec::new();
    let mut skip_next = false;
    for token in input.split_whitespace() {
        if skip_next {
            output.push("[redacted]".to_string());
            skip_next = false;
            continue;
        }
        let lower = token.to_ascii_lowercase();
        if lower == "bearer" {
            output.push("[redacted]".to_string());
            skip_next = true;
        } else if lower.starts_with("sk-")
            || lower.starts_with("xai-")
            || lower.starts_with("phc_")
            || looks_like_email(token)
            || looks_like_base64(token)
        {
            output.push("[redacted]".to_string());
        } else {
            output.push(token.to_string());
        }
    }
    output.join(" ")
}

fn looks_like_email(token: &str) -> bool {
    token.contains('@') && token.rsplit_once('.').is_some()
}

fn looks_like_base64(token: &str) -> bool {
    token.len() >= 80
        && token
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '+' | '/' | '='))
}

fn read_crash_markers(path: &Path) -> Vec<Value> {
    std::fs::read_to_string(path)
        .ok()
        .map(|content| {
            content
                .lines()
                .rev()
                .take(20)
                .filter_map(|line| serde_json::from_str::<Value>(line).ok())
                .collect()
        })
        .unwrap_or_default()
}

fn unix_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

#[allow(dead_code)]
fn latest_record_count(path: &Path) -> Result<i64> {
    let conn = Connection::open(path)?;
    conn.query_row("SELECT COUNT(*) FROM observability_records", [], |row| row.get(0))
        .optional()?
        .ok_or_else(|| anyhow!("observability count unavailable"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn append_snapshot_prune_and_clear_diagnostics() {
        let path = temp_db_path("append_snapshot");
        let store = ObservabilityStore::open_path(&path).expect("store opens");

        store.append(ObservabilityRecordInput {
            kind: "event".to_string(),
            name: "voice.turn.completed".to_string(),
            timestamp: Some("2026-05-08T00:00:00.000Z".to_string()),
            runtime_session_id: "session-1".to_string(),
            trace_id: "0123456789abcdef0123456789abcdef".to_string(),
            span_id: Some("0123456789abcdef".to_string()),
            parent_span_id: None,
            payload: json!({ "provider": "openai", "prompt": "must never be present" }),
        }).expect("append event");
        store.append(ObservabilityRecordInput {
            kind: "span".to_string(),
            name: "model.stream".to_string(),
            timestamp: Some("2026-05-08T00:00:01.000Z".to_string()),
            runtime_session_id: "session-1".to_string(),
            trace_id: "0123456789abcdef0123456789abcdef".to_string(),
            span_id: Some("fedcba9876543210".to_string()),
            parent_span_id: Some("0123456789abcdef".to_string()),
            payload: json!({ "durationMs": 25, "status": "ok" }),
        }).expect("append span");

        let snapshot = store.snapshot(10, None).expect("snapshot");
        assert_eq!(snapshot.status, "ready");
        assert_eq!(snapshot.record_count, 2);
        assert_eq!(snapshot.records.len(), 2);
        assert!(!serde_json::to_string(&snapshot).unwrap().contains("must never be present"));

        assert_eq!(store.prune(0).expect("prune"), 2);
        assert_eq!(store.snapshot(10, None).unwrap().record_count, 0);

        store.append(ObservabilityRecordInput {
            kind: "error".to_string(),
            name: "error.captured".to_string(),
            timestamp: None,
            runtime_session_id: "session-1".to_string(),
            trace_id: "0123456789abcdef0123456789abcdef".to_string(),
            span_id: None,
            parent_span_id: None,
            payload: json!({ "message": "redacted" }),
        }).expect("append error");
        store.clear().expect("clear");
        assert_eq!(store.snapshot(10, None).unwrap().record_count, 0);

        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn rejects_malformed_record_kinds_and_redacts_crash_markers() {
        let path = temp_db_path("rejects_malformed");
        let store = ObservabilityStore::open_path(&path).expect("store opens");

        let err = store.append(ObservabilityRecordInput {
            kind: "secret".to_string(),
            name: "bad".to_string(),
            timestamp: None,
            runtime_session_id: "session-1".to_string(),
            trace_id: "0123456789abcdef0123456789abcdef".to_string(),
            span_id: None,
            parent_span_id: None,
            payload: json!({}),
        }).expect_err("invalid kind should fail");
        assert!(err.to_string().contains("invalid observability kind"));

        write_crash_marker_at_path(
            &path.with_extension("crash.jsonl"),
            "panic with sk-secret and Bearer token and user@example.com",
        ).expect("crash marker");
        let marker = std::fs::read_to_string(path.with_extension("crash.jsonl")).unwrap();
        assert!(!marker.contains("sk-secret"));
        assert!(!marker.contains("Bearer token"));
        assert!(!marker.contains("user@example.com"));
        assert!(marker.contains("[redacted]"));

        let _ = std::fs::remove_file(path.with_extension("crash.jsonl"));
        let _ = std::fs::remove_file(path);
    }

    fn temp_db_path(name: &str) -> std::path::PathBuf {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("dante-clicky-{name}-{now}.db"))
    }
}
