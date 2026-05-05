use rusqlite::{Connection, Result, params};
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::Manager;

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// ── SessionDb ─────────────────────────────────────────────────────────────────

pub struct SessionDb {
    conn: std::sync::Mutex<Connection>,
}

impl SessionDb {
    /// Open (or create) the production database in the Tauri app data directory.
    pub fn open(app: &tauri::AppHandle) -> Result<Self> {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| rusqlite::Error::InvalidPath(e.to_string().into()))?;

        std::fs::create_dir_all(&dir)
            .map_err(|e| rusqlite::Error::InvalidPath(e.to_string().into()))?;

        let db_path = dir.join("sessions.db");
        let conn = Connection::open(db_path)?;
        let db = Self {
            conn: std::sync::Mutex::new(conn),
        };
        db.init()?;
        Ok(db)
    }

    /// Open an in-memory database — used by unit tests.
    pub fn open_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let db = Self {
            conn: std::sync::Mutex::new(conn),
        };
        db.init()?;
        Ok(db)
    }

    fn init(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        // WAL mode for concurrent reads without blocking writes.
        conn.execute_batch("PRAGMA journal_mode=WAL;")?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;

        // Core tables.
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS sessions (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                ts       INTEGER NOT NULL,
                model    TEXT    NOT NULL,
                provider TEXT    NOT NULL
            );

            CREATE TABLE IF NOT EXISTS messages (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                role       TEXT    NOT NULL,
                content    TEXT    NOT NULL,
                ts         INTEGER NOT NULL,
                model      TEXT,
                tokens     INTEGER
            );
            ",
        )?;

        // FTS5 virtual table for full-text search over message content.
        conn.execute_batch(
            "
            CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
            USING fts5(content, content='messages', content_rowid='id');
            ",
        )?;

        // Triggers to keep FTS index in sync with the messages table.
        conn.execute_batch(
            "
            CREATE TRIGGER IF NOT EXISTS messages_ai
            AFTER INSERT ON messages BEGIN
                INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
            END;

            CREATE TRIGGER IF NOT EXISTS messages_ad
            AFTER DELETE ON messages BEGIN
                INSERT INTO messages_fts(messages_fts, rowid, content)
                    VALUES ('delete', old.id, old.content);
            END;

            CREATE TRIGGER IF NOT EXISTS messages_au
            AFTER UPDATE ON messages BEGIN
                INSERT INTO messages_fts(messages_fts, rowid, content)
                    VALUES ('delete', old.id, old.content);
                INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
            END;
            ",
        )?;

        Ok(())
    }

    // ── Public methods ────────────────────────────────────────────────────────

    /// Create a new chat session and return its id.
    pub fn new_session(&self, model: &str, provider: &str) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO sessions (ts, model, provider) VALUES (?1, ?2, ?3)",
            params![now_ts(), model, provider],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Persist a single message inside a session.
    pub fn save_message(
        &self,
        session_id: i64,
        role: &str,
        content: &str,
        model: Option<&str>,
        tokens: Option<i64>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO messages (session_id, role, content, ts, model, tokens)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![session_id, role, content, now_ts(), model, tokens],
        )?;
        Ok(())
    }

    /// Return the most recent `limit` messages for a session, oldest-first.
    pub fn get_history(&self, session_id: i64, limit: i64) -> Result<Vec<Value>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, session_id, role, content, ts, model, tokens
             FROM messages
             WHERE session_id = ?1
             ORDER BY ts DESC, id DESC
             LIMIT ?2",
        )?;

        let rows: Result<Vec<Value>> = stmt
            .query_map(params![session_id, limit], |row| {
                Ok(json!({
                    "id":         row.get::<_, i64>(0)?,
                    "session_id": row.get::<_, i64>(1)?,
                    "role":       row.get::<_, String>(2)?,
                    "content":    row.get::<_, String>(3)?,
                    "ts":         row.get::<_, i64>(4)?,
                    "model":      row.get::<_, Option<String>>(5)?,
                    "tokens":     row.get::<_, Option<i64>>(6)?,
                }))
            })?
            .collect();

        // Reverse so the caller receives oldest-first order.
        let mut msgs = rows?;
        msgs.reverse();
        Ok(msgs)
    }

    /// Full-text search across all message content. Returns up to `limit` results.
    pub fn search(&self, query: &str, limit: i64) -> Result<Vec<Value>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT m.id, m.session_id, m.role, m.content, m.ts, m.model, m.tokens
             FROM messages m
             JOIN messages_fts f ON f.rowid = m.id
             WHERE messages_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2",
        )?;

        let rows: Result<Vec<Value>> = stmt
            .query_map(params![query, limit], |row| {
                Ok(json!({
                    "id":         row.get::<_, i64>(0)?,
                    "session_id": row.get::<_, i64>(1)?,
                    "role":       row.get::<_, String>(2)?,
                    "content":    row.get::<_, String>(3)?,
                    "ts":         row.get::<_, i64>(4)?,
                    "model":      row.get::<_, Option<String>>(5)?,
                    "tokens":     row.get::<_, Option<i64>>(6)?,
                }))
            })?
            .collect();

        rows
    }
}

// ── Tauri commands ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn db_new_session(
    state: tauri::State<'_, SessionDb>,
    model: String,
    provider: String,
) -> Result<i64, String> {
    state.new_session(&model, &provider).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_save_message(
    state: tauri::State<'_, SessionDb>,
    session_id: i64,
    role: String,
    content: String,
    model: Option<String>,
    tokens: Option<i64>,
) -> Result<(), String> {
    state
        .save_message(session_id, &role, &content, model.as_deref(), tokens)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_get_history(
    state: tauri::State<'_, SessionDb>,
    session_id: i64,
    limit: Option<i64>,
) -> Result<Vec<Value>, String> {
    state
        .get_history(session_id, limit.unwrap_or(50))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_search_history(
    state: tauri::State<'_, SessionDb>,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<Value>, String> {
    state
        .search(&query, limit.unwrap_or(20))
        .map_err(|e| e.to_string())
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> SessionDb {
        SessionDb::open_memory().expect("in-memory DB should open")
    }

    #[test]
    fn test_create_session_and_get_history() {
        let db = setup();

        let sid = db.new_session("claude-3-5-sonnet", "anthropic").unwrap();
        assert!(sid > 0, "session id should be positive");

        db.save_message(sid, "user", "Hello, Dante!", None, None)
            .unwrap();
        db.save_message(sid, "assistant", "Hi! How can I help?", Some("claude-3-5-sonnet"), Some(12))
            .unwrap();

        let history = db.get_history(sid, 50).unwrap();
        assert_eq!(history.len(), 2, "should return both messages");

        assert_eq!(history[0]["role"], "user");
        assert_eq!(history[0]["content"], "Hello, Dante!");
        assert_eq!(history[1]["role"], "assistant");
        assert_eq!(history[1]["tokens"], 12);
    }

    #[test]
    fn test_get_history_limit() {
        let db = setup();

        let sid = db.new_session("gpt-4o", "openai").unwrap();
        db.save_message(sid, "user", "First message", None, None).unwrap();
        db.save_message(sid, "assistant", "Second message", None, None).unwrap();
        db.save_message(sid, "user", "Third message", None, None).unwrap();

        let history = db.get_history(sid, 1).unwrap();
        assert_eq!(history.len(), 1, "limit=1 should return exactly one message");
        assert_eq!(
            history[0]["content"], "Third message",
            "limit=1 should return the latest message"
        );
    }

    #[test]
    fn test_fts5_search_finds_by_keyword() {
        let db = setup();

        let sid = db.new_session("claude-3-5-sonnet", "anthropic").unwrap();
        db.save_message(sid, "user", "Tell me about quantum computing", None, None)
            .unwrap();
        db.save_message(sid, "assistant", "Quantum computing uses qubits", None, None)
            .unwrap();
        db.save_message(sid, "user", "What about neural networks?", None, None)
            .unwrap();

        let results = db.search("quantum", 20).unwrap();
        assert_eq!(results.len(), 2, "search should find both quantum messages");

        for r in &results {
            assert!(
                r["content"]
                    .as_str()
                    .unwrap_or("")
                    .to_lowercase()
                    .contains("quantum"),
                "every result should mention quantum"
            );
        }

        let no_results = db.search("blockchain", 20).unwrap();
        assert!(no_results.is_empty(), "search for absent term should return nothing");
    }

    #[test]
    fn test_multiple_sessions_are_isolated() {
        let db = setup();

        let sid1 = db.new_session("claude-3-5-sonnet", "anthropic").unwrap();
        let sid2 = db.new_session("gpt-4o", "openai").unwrap();

        db.save_message(sid1, "user", "Session one message", None, None).unwrap();
        db.save_message(sid2, "user", "Session two message", None, None).unwrap();

        let h1 = db.get_history(sid1, 50).unwrap();
        let h2 = db.get_history(sid2, 50).unwrap();

        assert_eq!(h1.len(), 1);
        assert_eq!(h2.len(), 1);
        assert_eq!(h1[0]["content"], "Session one message");
        assert_eq!(h2[0]["content"], "Session two message");
    }
}
