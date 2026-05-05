use rusqlite::{Connection, params};
use serde::{Serialize, Deserialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
pub struct TurnRow {
    pub id: i64,
    pub user_prompt: String,
    pub assistant_response: String,
    pub screenshot_path: Option<String>,
    pub created_at: String,
}

pub struct SessionDb {
    conn: Connection,
}

impl SessionDb {
    pub fn open(db_path: &Path) -> Result<Self, String> {
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        conn.execute_batch("
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS turns (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_prompt TEXT NOT NULL,
                assistant_response TEXT NOT NULL,
                screenshot_path TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts USING fts5(
                user_prompt, assistant_response,
                content=turns, content_rowid=id
            );
            CREATE TRIGGER IF NOT EXISTS turns_ai AFTER INSERT ON turns BEGIN
                INSERT INTO turns_fts(rowid, user_prompt, assistant_response)
                VALUES (new.id, new.user_prompt, new.assistant_response);
            END;
        ").map_err(|e| e.to_string())?;
        Ok(Self { conn })
    }

    pub fn save_turn(&self, user: &str, assistant: &str, screenshot_b64: Option<String>) -> Result<i64, String> {
        self.conn.execute(
            "INSERT INTO turns (user_prompt, assistant_response, screenshot_path) VALUES (?1, ?2, ?3)",
            params![user, assistant, screenshot_b64],
        ).map_err(|e| e.to_string())?;
        Ok(self.conn.last_insert_rowid())
    }

    pub fn search_history(&self, query: &str, limit: i32) -> Result<Vec<TurnRow>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT t.id, t.user_prompt, t.assistant_response, t.screenshot_path, t.created_at
             FROM turns_fts f
             JOIN turns t ON t.id = f.rowid
             WHERE turns_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![query, limit], |row| {
            Ok(TurnRow {
                id: row.get(0)?,
                user_prompt: row.get(1)?,
                assistant_response: row.get(2)?,
                screenshot_path: row.get(3)?,
                created_at: row.get(4)?,
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }

    pub fn get_recent_turns(&self, limit: i32) -> Result<Vec<TurnRow>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT id, user_prompt, assistant_response, screenshot_path, created_at
             FROM turns ORDER BY id DESC LIMIT ?1"
        ).map_err(|e| e.to_string())?;
        let rows = stmt.query_map(params![limit], |row| {
            Ok(TurnRow {
                id: row.get(0)?,
                user_prompt: row.get(1)?,
                assistant_response: row.get(2)?,
                screenshot_path: row.get(3)?,
                created_at: row.get(4)?,
            })
        }).map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
    }
}
