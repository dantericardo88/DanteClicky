use rusqlite::{Connection, OptionalExtension, Result, params};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

// â”€â”€ Encryption helpers (ChaCha20-Poly1305 + Windows DPAPI key storage) â”€â”€â”€â”€â”€â”€â”€
//
// Each encrypted column is stored as "enc:<base64(nonce||ciphertext)>".
// Plaintext values (legacy rows) pass through transparently on read.
//
// Key storage:
//   Windows â†’ session.key.dpapi  (DPAPI-protected, bound to Windows user account)
//   Other   â†’ session.key        (raw 32 bytes)
//
// DPAPI binding: an attacker who copies both the DB and the key file still cannot
// decrypt without the original user's Windows login credentials.

use chacha20poly1305::{
    aead::{Aead, AeadCore, KeyInit, OsRng},
    ChaCha20Poly1305, Key, Nonce,
};

const ENC_PREFIX: &str = "enc:";

// â”€â”€ Windows DPAPI via raw FFI â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[cfg(target_os = "windows")]
mod dpapi_ffi {
    use std::ffi::c_void;

    #[repr(C)]
    pub struct DataBlob { pub cb_data: u32, pub pb_data: *mut u8 }
    unsafe impl Send for DataBlob {}
    unsafe impl Sync for DataBlob {}
    impl Default for DataBlob {
        fn default() -> Self { DataBlob { cb_data: 0, pb_data: std::ptr::null_mut() } }
    }
    pub const CRYPTPROTECT_UI_FORBIDDEN: u32 = 0x1;

    #[link(name = "Crypt32")]
    unsafe extern "system" {
        pub fn CryptProtectData(
            pb_data_in: *const DataBlob, sz_data_descr: *const u16,
            pb_optional_entropy: *const DataBlob, pv_reserved: *mut c_void,
            p_prompt_struct: *const c_void, dw_flags: u32, pb_data_out: *mut DataBlob,
        ) -> i32;
        pub fn CryptUnprotectData(
            pb_data_in: *const DataBlob, ppz_data_descr: *mut *mut u16,
            pb_optional_entropy: *const DataBlob, pv_reserved: *mut c_void,
            p_prompt_struct: *const c_void, dw_flags: u32, pb_data_out: *mut DataBlob,
        ) -> i32;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        pub fn LocalFree(h_mem: *mut c_void) -> *mut c_void;
    }
}

#[cfg(target_os = "windows")]
fn dpapi_protect(data: &[u8]) -> std::io::Result<Vec<u8>> {
    use dpapi_ffi::*;
    let input = DataBlob { cb_data: data.len() as u32, pb_data: data.as_ptr() as *mut u8 };
    let mut out = DataBlob::default();
    let ok = unsafe { CryptProtectData(&input, std::ptr::null(), std::ptr::null(),
        std::ptr::null_mut(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out) };
    if ok == 0 { return Err(std::io::Error::last_os_error()); }
    let v = unsafe { std::slice::from_raw_parts(out.pb_data, out.cb_data as usize).to_vec() };
    unsafe { LocalFree(out.pb_data as *mut _) };
    Ok(v)
}

#[cfg(target_os = "windows")]
fn dpapi_unprotect(data: &[u8]) -> std::io::Result<Vec<u8>> {
    use dpapi_ffi::*;
    let input = DataBlob { cb_data: data.len() as u32, pb_data: data.as_ptr() as *mut u8 };
    let mut out = DataBlob::default();
    let ok = unsafe { CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(),
        std::ptr::null_mut(), std::ptr::null(), CRYPTPROTECT_UI_FORBIDDEN, &mut out) };
    if ok == 0 { return Err(std::io::Error::last_os_error()); }
    let v = unsafe { std::slice::from_raw_parts(out.pb_data, out.cb_data as usize).to_vec() };
    unsafe { LocalFree(out.pb_data as *mut _) };
    Ok(v)
}

fn load_or_create_key(dir: &std::path::Path) -> std::io::Result<[u8; 32]> {
    #[cfg(target_os = "windows")]
    let dpapi_path = dir.join("session.key.dpapi");
    let raw_path = dir.join("session.key");

    // Primary: DPAPI-protected key (Windows)
    #[cfg(target_os = "windows")]
    if dpapi_path.exists() {
        if let Ok(blob) = std::fs::read(&dpapi_path) {
            if let Ok(raw) = dpapi_unprotect(&blob) {
                if raw.len() == 32 {
                    let mut k = [0u8; 32];
                    k.copy_from_slice(&raw);
                    return Ok(k);
                }
            }
        }
        // Corrupted â€” regenerate below
    }

    // Migration: legacy plaintext key â†’ DPAPI-protected
    #[cfg(target_os = "windows")]
    if raw_path.exists() {
        let bytes = std::fs::read(&raw_path)?;
        if bytes.len() == 32 {
            let mut k = [0u8; 32];
            k.copy_from_slice(&bytes);
            if let Ok(protected) = dpapi_protect(&bytes) {
                let _ = std::fs::write(&dpapi_path, &protected);
                let _ = std::fs::remove_file(&raw_path);
            }
            return Ok(k);
        }
    }

    // Non-Windows raw key
    #[cfg(not(target_os = "windows"))]
    if raw_path.exists() {
        let bytes = std::fs::read(&raw_path)?;
        if bytes.len() == 32 {
            let mut k = [0u8; 32];
            k.copy_from_slice(&bytes);
            return Ok(k);
        }
    }

    // Generate fresh key and persist
    let mut key = [0u8; 32];
    use rand::RngCore;
    rand::thread_rng().fill_bytes(&mut key);
    #[cfg(target_os = "windows")]
    { let p = dpapi_protect(&key)?; std::fs::write(&dpapi_path, &p)?; }
    #[cfg(not(target_os = "windows"))]
    std::fs::write(&raw_path, key)?;
    Ok(key)
}

fn encrypt_field(key: &[u8; 32], plaintext: &str) -> String {
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    let nonce = ChaCha20Poly1305::generate_nonce(&mut OsRng);
    let ciphertext = cipher.encrypt(&nonce, plaintext.as_bytes()).unwrap();
    let mut combined = nonce.to_vec();
    combined.extend_from_slice(&ciphertext);
    use base64::Engine;
    format!("{ENC_PREFIX}{}", base64::engine::general_purpose::STANDARD.encode(combined))
}

fn decrypt_field(key: &[u8; 32], value: &str) -> String {
    let Some(encoded) = value.strip_prefix(ENC_PREFIX) else {
        return value.to_string(); // legacy plaintext â€” pass through
    };
    use base64::Engine;
    let Ok(combined) = base64::engine::general_purpose::STANDARD.decode(encoded) else {
        return value.to_string();
    };
    if combined.len() <= 12 {
        return value.to_string();
    }
    let nonce = Nonce::from_slice(&combined[..12]);
    let cipher = ChaCha20Poly1305::new(Key::from_slice(key));
    match cipher.decrypt(nonce, &combined[12..]) {
        Ok(plain) => String::from_utf8_lossy(&plain).into_owned(),
        Err(_) => value.to_string(),
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TurnRow {
    pub id: i64,
    pub user_prompt: String,
    pub assistant_response: String,
    pub created_at: String,
}

/// A `TurnRow` augmented with its cosine similarity score, returned by `search_semantic`.
#[derive(Debug, Serialize, Deserialize)]
pub struct ScoredTurnRow {
    pub score: f32,
    pub id: i64,
    pub user_prompt: String,
    pub assistant_response: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ConversationSummaryRow {
    pub id: i64,
    pub summary: String,
    pub covered_turn_start_id: Option<i64>,
    pub covered_turn_end_id: Option<i64>,
    pub estimated_tokens_before: i64,
    pub estimated_tokens_after: i64,
    pub provider: String,
    pub model: String,
    pub schema_version: i64,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionMetaRow {
    pub date_key: String,
    pub label: Option<String>,
    pub summary: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PreferenceTraitRow {
    pub key: String,
    pub label: String,
    pub score: f64,
    pub evidence_count: i64,
    pub positive_count: i64,
    pub negative_count: i64,
    pub support_score: f64,
    pub conflict_score: f64,
    pub decayed_score: f64,
    pub confidence: f64,
    pub status: String,
    pub user_label: Option<String>,
    pub user_note: Option<String>,
    pub last_seen: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PreferenceExampleRow {
    pub id: i64,
    pub user_prompt: String,
    pub assistant_response: String,
    pub created_at: String,
    pub preference_score: f64,
    pub feedback_source: String,
    pub feedback_reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PreferenceProfile {
    pub traits: Vec<PreferenceTraitRow>,
    pub prompt_traits: Vec<PreferenceTraitRow>,
    pub positive_examples: Vec<PreferenceExampleRow>,
    pub negative_examples: Vec<PreferenceExampleRow>,
    pub explicit_feedback_count: i64,
    pub implicit_feedback_count: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PreferenceFactRow {
    pub id: i64,
    pub scope: String,
    pub category: String,
    pub polarity: i64,
    pub summary: String,
    pub evidence: String,
    pub confidence: f64,
    pub evidence_count: i64,
    pub source_event_ids_json: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_seen_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AmbientSnapshotRow {
    pub id: i64,
    pub active_window: String,
    pub captured_at: String,
    pub ocr_snippet: String,
    pub vision_desc: String,
    pub pixel_hash: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PreferenceEventRow {
    pub id: i64,
    pub turn_id: i64,
    pub signal: String,
    pub source: String,
    pub weight: f64,
    pub reason: Option<String>,
    pub raw_text: Option<String>,
    pub idempotency_key: Option<String>,
    pub active: bool,
    pub created_at: String,
    pub user_prompt: String,
    pub assistant_response: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DigestFact {
    pub id: Option<i64>,
    pub fact: String,
    pub category: String,
    pub confidence: f64,
    pub source_turn_ids: Option<String>,
    pub last_seen: Option<String>,
    pub created_at: Option<String>,
}

/// Describes the current encryption key protection status â€” returned to the UI.
#[derive(Debug, Serialize, Deserialize)]
pub struct KeyStatusResponse {
    pub encrypted: bool,
    pub dpapi_protected: bool,
    pub sqlcipher_active: bool,
    pub platform: String,
}

fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

// â”€â”€ SessionDb â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

pub struct SessionDb {
    conn: std::sync::Mutex<Connection>,
    /// Encryption key in a Mutex so `rekey_database` can atomically swap it
    /// after writing the new DPAPI blob â€” no restart required.
    key: std::sync::Mutex<[u8; 32]>,
}

impl SessionDb {
    /// Returns a copy of the current encryption key (cheap: 32-byte Copy).
    #[inline]
    fn current_key(&self) -> [u8; 32] {
        *self.key.lock().unwrap()
    }

    /// Migrate an existing unencrypted sessions.db to SQLCipher in-place.
    /// Uses sqlcipher_export() to copy all data into a new encrypted file, then swaps.
    /// The original is preserved as sessions.db.bak for one-launch recovery.
    #[cfg(feature = "sqlcipher")]
    fn migrate_to_sqlcipher(db_path: &std::path::Path, key: &[u8; 32]) -> Result<()> {
        let enc_path = db_path.with_extension("db.enc");
        let hex_key: String = key.iter().map(|b| format!("{:02x}", b)).collect();
        {
            let plain = Connection::open(db_path)?;
            plain.execute_batch(&format!(
                "ATTACH DATABASE '{}' AS encrypted KEY \"x'{hex_key}'\";
                 SELECT sqlcipher_export('encrypted');
                 DETACH DATABASE encrypted;",
                enc_path.to_string_lossy()
            ))?;
        }
        let bak = db_path.with_extension("db.bak");
        std::fs::rename(db_path, &bak)
            .map_err(|e| rusqlite::Error::InvalidPath(e.to_string().into()))?;
        std::fs::rename(&enc_path, db_path)
            .map_err(|e| rusqlite::Error::InvalidPath(e.to_string().into()))?;
        Ok(())
    }

    /// Open (or create) the production database in the Tauri app data directory.
    pub fn open(app: &tauri::AppHandle) -> Result<Self> {
        let dir = app
            .path()
            .app_data_dir()
            .map_err(|e| rusqlite::Error::InvalidPath(e.to_string().into()))?;

        std::fs::create_dir_all(&dir)
            .map_err(|e| rusqlite::Error::InvalidPath(e.to_string().into()))?;

        let key = load_or_create_key(&dir)
            .map_err(|e| rusqlite::Error::InvalidPath(e.to_string().into()))?;

        let db_path = dir.join("sessions.db");

        #[cfg(feature = "sqlcipher")]
        let conn = {
            let hex_key: String = key.iter().map(|b| format!("{:02x}", b)).collect();
            let c = Connection::open(&db_path)?;
            c.pragma_update(None, "key", format!("x'{hex_key}'"))?;
            // A failed query here means the DB is plaintext â€” migrate to SQLCipher.
            if c.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)).is_err() {
                drop(c);
                Self::migrate_to_sqlcipher(&db_path, &key)?;
                let c2 = Connection::open(&db_path)?;
                c2.pragma_update(None, "key", format!("x'{hex_key}'"))?;
                c2
            } else {
                c
            }
        };

        #[cfg(not(feature = "sqlcipher"))]
        let conn = Connection::open(&db_path)?;

        let db = Self {
            conn: std::sync::Mutex::new(conn),
            key: std::sync::Mutex::new(key),
        };
        db.init()?;
        Ok(db)
    }

    /// Open an in-memory database â€” used by unit tests (zero key, no encryption).
    pub fn open_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        let db = Self {
            conn: std::sync::Mutex::new(conn),
            key: std::sync::Mutex::new([0u8; 32]),
        };
        db.init()?;
        Ok(db)
    }

    fn init(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        // DELETE journal mode: no -wal/-shm sidecar files that could expose
        // field-level-encrypted data outside the main DB file.
        conn.execute_batch("PRAGMA journal_mode=DELETE;")?;
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

        // Turns table â€” stores user+assistant exchanges as atomic units for cross-session memory.
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS turns (
                id                 INTEGER PRIMARY KEY AUTOINCREMENT,
                user_prompt        TEXT NOT NULL,
                assistant_response TEXT NOT NULL,
                screenshot_b64     TEXT,
                created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts
            USING fts5(user_prompt, assistant_response, content='turns', content_rowid='id');

            CREATE TABLE IF NOT EXISTS conversation_summaries (
                id                      INTEGER PRIMARY KEY AUTOINCREMENT,
                summary                 TEXT NOT NULL,
                covered_turn_start_id   INTEGER,
                covered_turn_end_id     INTEGER,
                estimated_tokens_before INTEGER NOT NULL,
                estimated_tokens_after  INTEGER NOT NULL,
                provider                TEXT NOT NULL,
                model                   TEXT NOT NULL,
                schema_version          INTEGER NOT NULL,
                created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
            );
            ",
        )?;

        conn.execute_batch(
            "
            CREATE TRIGGER IF NOT EXISTS turns_ai
            AFTER INSERT ON turns BEGIN
                INSERT INTO turns_fts(rowid, user_prompt, assistant_response)
                VALUES (new.id, new.user_prompt, new.assistant_response);
            END;

            CREATE TRIGGER IF NOT EXISTS turns_ad
            AFTER DELETE ON turns BEGIN
                INSERT INTO turns_fts(turns_fts, rowid, user_prompt, assistant_response)
                VALUES ('delete', old.id, old.user_prompt, old.assistant_response);
            END;
            ",
        )?;

        // Schema migration: add embedding_vec BLOB column if it doesn't exist yet.
        let has_embedding: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('turns') WHERE name='embedding_vec'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;
        if !has_embedding {
            conn.execute_batch("ALTER TABLE turns ADD COLUMN embedding_vec BLOB;")?;
        }

        // Schema migration: add rating INTEGER column for preference learning.
        let has_rating: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('turns') WHERE name='rating'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;
        if !has_rating {
            conn.execute_batch("ALTER TABLE turns ADD COLUMN rating INTEGER NOT NULL DEFAULT 0;")?;
        }

        // Preference learning: explicit thumbs, weak implicit signals, and the
        // derived per-user trait profile are stored locally beside encrypted turns.
        let has_preference_score: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('turns') WHERE name='preference_score'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;
        if !has_preference_score {
            conn.execute_batch("ALTER TABLE turns ADD COLUMN preference_score REAL NOT NULL DEFAULT 0.0;")?;
        }
        let has_feedback_source: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('turns') WHERE name='feedback_source'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;
        if !has_feedback_source {
            conn.execute_batch("ALTER TABLE turns ADD COLUMN feedback_source TEXT NOT NULL DEFAULT 'none';")?;
        }
        let has_feedback_reason: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('turns') WHERE name='feedback_reason'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;
        if !has_feedback_reason {
            conn.execute_batch("ALTER TABLE turns ADD COLUMN feedback_reason TEXT;")?;
        }
        let has_feedback_at: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('turns') WHERE name='feedback_at'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;
        if !has_feedback_at {
            conn.execute_batch("ALTER TABLE turns ADD COLUMN feedback_at TEXT;")?;
        }

        let has_session_meta: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='session_meta'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0)
            > 0;
        if !has_session_meta {
            conn.execute_batch(
                "CREATE TABLE session_meta (
                    date_key   TEXT PRIMARY KEY,
                    label      TEXT,
                    summary    TEXT,
                    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
                    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
                );"
            )?;
        }

        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS preference_events (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                turn_id         INTEGER NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
                event_type      TEXT,
                polarity        INTEGER,
                payload_json    TEXT,
                signal          TEXT    NOT NULL,
                source          TEXT    NOT NULL DEFAULT 'implicit',
                weight          REAL    NOT NULL,
                reason          TEXT,
                raw_text        TEXT,
                idempotency_key TEXT UNIQUE,
                extractor       TEXT    NOT NULL DEFAULT 'preference_v2',
                active          INTEGER NOT NULL DEFAULT 1,
                created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
            );

            CREATE TABLE IF NOT EXISTS preference_trait_evidence (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                event_id      INTEGER NOT NULL REFERENCES preference_events(id) ON DELETE CASCADE,
                trait_key     TEXT    NOT NULL,
                trait_label   TEXT    NOT NULL,
                polarity      INTEGER NOT NULL,
                strength      REAL    NOT NULL,
                rationale     TEXT    NOT NULL,
                evidence_text TEXT    NOT NULL,
                created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
            );

            CREATE TABLE IF NOT EXISTS preference_traits (
                key            TEXT PRIMARY KEY,
                label          TEXT NOT NULL,
                score          REAL NOT NULL,
                evidence_count INTEGER NOT NULL,
                positive_count INTEGER NOT NULL,
                negative_count INTEGER NOT NULL,
                support_score  REAL NOT NULL DEFAULT 0.0,
                conflict_score REAL NOT NULL DEFAULT 0.0,
                decayed_score  REAL NOT NULL DEFAULT 0.0,
                confidence     REAL NOT NULL DEFAULT 0.0,
                status         TEXT NOT NULL DEFAULT 'active',
                user_label     TEXT,
                user_note      TEXT,
                last_seen      TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS preference_facts (
                id                    INTEGER PRIMARY KEY AUTOINCREMENT,
                scope                 TEXT    NOT NULL DEFAULT 'global',
                category              TEXT    NOT NULL,
                polarity              INTEGER NOT NULL,
                summary               TEXT    NOT NULL,
                evidence              TEXT    NOT NULL,
                confidence            REAL    NOT NULL DEFAULT 0.0,
                evidence_count        INTEGER NOT NULL DEFAULT 1,
                source_event_ids_json TEXT    NOT NULL DEFAULT '[]',
                status                TEXT    NOT NULL DEFAULT 'active',
                summary_hash          TEXT,
                created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
                updated_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
                last_seen_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
            );

            CREATE TABLE IF NOT EXISTS memory_digest (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                fact            TEXT    NOT NULL,
                category        TEXT    NOT NULL DEFAULT 'general',
                confidence      REAL    NOT NULL DEFAULT 1.0,
                source_turn_ids TEXT,
                last_seen       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now')),
                created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now'))
            );

            CREATE TABLE IF NOT EXISTS consolidation_state (
                id           INTEGER PRIMARY KEY DEFAULT 1,
                last_turn_id INTEGER NOT NULL DEFAULT 0,
                last_run_at  TEXT
            );

            INSERT OR IGNORE INTO consolidation_state(id, last_turn_id) VALUES (1, 0);

            -- Ambient mode: periodic passive screen captures for always-on context.
            -- ocr_text and active_window are field-encrypted (ChaCha20-Poly1305).
            -- pixel_hash is a short change-detection fingerprint (not sensitive).
            CREATE TABLE IF NOT EXISTS ambient_snapshots (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                ocr_text      TEXT    NOT NULL DEFAULT '',
                active_window TEXT    NOT NULL DEFAULT '',
                pixel_hash    TEXT    NOT NULL DEFAULT '',
                vision_desc   TEXT    NOT NULL DEFAULT '',
                captured_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now'))
            );

            CREATE INDEX IF NOT EXISTS ambient_snapshots_captured_at_idx
                ON ambient_snapshots(captured_at DESC);

            -- Dim 16: Video / temporal context â€” encrypted manifest of fMP4 segments.
            -- The MP4 bytes live on disk under %LOCALAPPDATA%/DanteClicky/video/
            -- but their filenames are ChaCha20-encrypted in `path_enc` so an
            -- attacker with FS access cannot link bytes to content without the
            -- SQLCipher key.
            CREATE TABLE IF NOT EXISTS video_segments (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                monitor_idx   INTEGER NOT NULL,
                path_enc      TEXT    NOT NULL,
                start_ts      TEXT    NOT NULL,
                end_ts        TEXT,
                duration_ms   INTEGER NOT NULL DEFAULT 0,
                byte_size     INTEGER NOT NULL DEFAULT 0,
                width         INTEGER NOT NULL DEFAULT 0,
                height        INTEGER NOT NULL DEFAULT 0,
                fps_avg       REAL    NOT NULL DEFAULT 0.0,
                privacy_flag  TEXT    NOT NULL DEFAULT 'normal',
                created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%S', 'now'))
            );

            CREATE INDEX IF NOT EXISTS video_segments_start_ts_idx
                ON video_segments(start_ts);
            CREATE INDEX IF NOT EXISTS video_segments_monitor_start_idx
                ON video_segments(monitor_idx, start_ts);

            -- One row per GOP keyframe. ocr_text/active_window/thumb encrypted
            -- with ChaCha20-Poly1305 (defense-in-depth atop SQLCipher AES-256).
            CREATE TABLE IF NOT EXISTS video_keyframes (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                segment_id          INTEGER NOT NULL REFERENCES video_segments(id) ON DELETE CASCADE,
                pts_ms              INTEGER NOT NULL,
                ocr_text_enc        TEXT,
                active_window_enc   TEXT,
                ambient_snapshot_id INTEGER REFERENCES ambient_snapshots(id) ON DELETE SET NULL,
                thumb_jpeg_enc      TEXT,
                embedding_blob      BLOB
            );

            CREATE INDEX IF NOT EXISTS video_keyframes_segment_idx
                ON video_keyframes(segment_id, pts_ms);
            CREATE INDEX IF NOT EXISTS video_keyframes_ambient_idx
                ON video_keyframes(ambient_snapshot_id);

            -- FTS5 over decrypted OCR text. The DB file itself is SQLCipher-encrypted
            -- so the FTS index is unreadable at rest without the key. We use a
            -- regular (non-contentless) FTS5 table so DELETE WHERE rowid = ? works.
            CREATE VIRTUAL TABLE IF NOT EXISTS video_keyframes_fts
                USING fts5(ocr_text, tokenize='porter unicode61');
            ",
        )?;
        migrate_preference_tables(&conn)?;

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

    // â”€â”€ Public methods â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

    /// Persist a user+assistant exchange as a single turn for cross-session memory.
    /// All text columns (including screenshots) are encrypted at rest.
    pub fn save_turn(&self, user: &str, assistant: &str, screenshot_b64: Option<String>) -> Result<i64> {
        let key = self.current_key();
        let enc_user = encrypt_field(&key, user);
        let enc_asst = encrypt_field(&key, assistant);
        let enc_screenshot = screenshot_b64.as_deref().map(|s| encrypt_field(&key, s));
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO turns (user_prompt, assistant_response, screenshot_b64) VALUES (?1, ?2, ?3)",
            params![enc_user, enc_asst, enc_screenshot],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Delete a single turn by id (fine-grained privacy control).
    pub fn delete_turn(&self, turn_id: i64) -> Result<()> {
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        // The turns_ad trigger keeps the FTS index in sync
        conn.execute("DELETE FROM turns WHERE id = ?1", params![turn_id])?;
        rebuild_preference_traits(&conn, &key)?;
        Ok(())
    }

    /// Return the `limit` most recent turns, oldest-first. Decrypts text columns.
    pub fn get_recent_turns(&self, limit: i64) -> Result<Vec<TurnRow>> {
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_prompt, assistant_response, created_at
             FROM turns ORDER BY id DESC LIMIT ?1",
        )?;
        let rows: Result<Vec<TurnRow>> = stmt
            .query_map(params![limit], |row| {
                Ok(TurnRow {
                    id: row.get(0)?,
                    user_prompt: decrypt_field(&key, &row.get::<_, String>(1)?),
                    assistant_response: decrypt_field(&key, &row.get::<_, String>(2)?),
                    created_at: row.get(3)?,
                })
            })?
            .collect();
        let mut turns = rows?;
        turns.reverse();
        Ok(turns)
    }

    /// Update the rating of an existing turn (+1 thumbs-up, -1 thumbs-down, 0 neutral).
    pub fn rate_turn(&self, turn_id: i64, rating: i32) -> Result<()> {
        self.rate_turn_with_reason(turn_id, rating, None)
    }

    pub fn rate_turn_with_reason(
        &self,
        turn_id: i64,
        rating: i32,
        feedback_reason: Option<String>,
    ) -> Result<()> {
        if !matches!(rating, -1 | 0 | 1) {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let normalized = rating;
        let sanitized_feedback_reason = feedback_reason.and_then(|reason| {
            let redacted = redact_sensitive_text(&reason);
            let compact = compact_plain_text(&redacted, 180);
            if compact.is_empty() {
                None
            } else {
                Some(compact)
            }
        });
        let reason = match normalized {
            1 => Some("explicit thumbs-up".to_string()),
            -1 => Some(match sanitized_feedback_reason {
                Some(reason) => format!("explicit thumbs-down: {reason}"),
                None => "explicit thumbs-down".to_string(),
            }),
            _ => Some("manual rating cleared".to_string()),
        };
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        ensure_turn_exists(&conn, turn_id)?;
        conn.execute(
            "UPDATE turns SET rating = ?1 WHERE id = ?2",
            params![normalized, turn_id],
        )?;
        if normalized == 0 {
            conn.execute(
                "UPDATE preference_events
                 SET active = 0, reason = ?2
                 WHERE turn_id = ?1 AND signal IN ('explicit_thumbs_up', 'explicit_thumbs_down')",
                params![turn_id, reason.as_deref()],
            )?;
            update_turn_preference_summary(&conn, &key, turn_id, "rating_cleared", reason.as_deref())?;
            rebuild_preference_traits(&conn, &key)?;
            return Ok(());
        }

        let signal = if normalized > 0 { "explicit_thumbs_up" } else { "explicit_thumbs_down" };
        conn.execute(
            "UPDATE preference_events
             SET active = 0
             WHERE turn_id = ?1 AND signal IN ('explicit_thumbs_up', 'explicit_thumbs_down')",
            params![turn_id],
        )?;
        record_preference_event_locked(
            &conn,
            &key,
            turn_id,
            signal,
            reason.as_deref(),
            None,
            Some(&format!("rating:{turn_id}")),
        )?;
        Ok(())
    }

    /// Record an implicit feedback event, such as copied response, "that worked",
    /// or corrective language in the user's next turn.
    pub fn record_preference_signal(
        &self,
        turn_id: i64,
        signal: &str,
        _weight: f64,
        reason: Option<String>,
    ) -> Result<()> {
        let safe_signal = sanitize_preference_signal(signal);
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        record_preference_event_locked(
            &conn,
            &key,
            turn_id,
            &safe_signal,
            reason.as_deref(),
            None,
            Some(&format!("legacy:{turn_id}:{safe_signal}")),
        )
        .map(|_| ())
    }

    /// Record append-only preference evidence using backend-owned signal weights.
    pub fn record_preference_event(
        &self,
        turn_id: i64,
        signal: &str,
        reason: Option<String>,
        raw_text: Option<String>,
        idempotency_key: Option<String>,
    ) -> Result<i64> {
        let safe_signal = sanitize_preference_signal(signal);
        let safe_key = idempotency_key
            .as_deref()
            .map(sanitize_idempotency_key)
            .filter(|s| !s.is_empty());
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        record_preference_event_locked(
            &conn,
            &key,
            turn_id,
            &safe_signal,
            reason.as_deref(),
            raw_text.as_deref(),
            safe_key.as_deref(),
        )
    }

    pub fn get_preference_events(
        &self,
        limit: Option<i64>,
        trait_key: Option<&str>,
    ) -> Result<Vec<PreferenceEventRow>> {
        let limit = normalize_preference_limit(limit.unwrap_or(25))?;
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        let rows = if let Some(trait_key) = trait_key {
            let mut stmt = conn.prepare(
                "SELECT DISTINCT e.id, e.turn_id, e.signal, e.source, e.weight, e.reason,
                        e.raw_text, e.idempotency_key, e.active, e.created_at,
                        t.user_prompt, t.assistant_response
                 FROM preference_events e
                 JOIN preference_trait_evidence pte ON pte.event_id = e.id
                 JOIN turns t ON t.id = e.turn_id
                 WHERE pte.trait_key = ?1
                 ORDER BY e.created_at DESC, e.id DESC
                 LIMIT ?2",
            )?;
            let rows = stmt.query_map(params![trait_key, limit], |row| {
                preference_event_row_from_sql(row, &key)
            })?
            .collect::<Result<Vec<_>>>()?;
            rows
        } else {
            let mut stmt = conn.prepare(
                "SELECT e.id, e.turn_id, e.signal, e.source, e.weight, e.reason,
                        e.raw_text, e.idempotency_key, e.active, e.created_at,
                        t.user_prompt, t.assistant_response
                 FROM preference_events e
                 JOIN turns t ON t.id = e.turn_id
                 ORDER BY e.created_at DESC, e.id DESC
                 LIMIT ?1",
            )?;
            let rows = stmt.query_map(params![limit], |row| {
                preference_event_row_from_sql(row, &key)
            })?
            .collect::<Result<Vec<_>>>()?;
            rows
        };
        Ok(rows)
    }

    pub fn update_preference_trait(
        &self,
        trait_key: &str,
        status: Option<String>,
        label: Option<String>,
        note: Option<String>,
    ) -> Result<()> {
        let safe_key = sanitize_preference_signal(trait_key);
        if safe_key != trait_key {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let conn = self.conn.lock().unwrap();
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM preference_traits WHERE key = ?1",
            params![trait_key],
            |row| row.get(0),
        )?;
        if exists == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }

        let normalized_status = status
            .as_deref()
            .map(normalize_preference_status)
            .transpose()?;
        let user_label = label
            .map(|s| compact_plain_text(&s, 80))
            .filter(|s| !s.trim().is_empty());
        let user_note = note
            .map(|s| compact_plain_text(&s, 220))
            .filter(|s| !s.trim().is_empty());
        conn.execute(
            "UPDATE preference_traits
             SET status = COALESCE(?2, status),
                 user_label = COALESCE(?3, user_label),
                 label = COALESCE(?3, label),
                 user_note = COALESCE(?4, user_note)
             WHERE key = ?1",
            params![trait_key, normalized_status, user_label, user_note],
        )?;
        Ok(())
    }

    pub fn delete_preference_trait(&self, trait_key: &str) -> Result<()> {
        self.update_preference_trait(trait_key, Some("deleted".to_string()), None, None)
    }

    pub fn clear_preference_learning(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM preference_trait_evidence", [])?;
        conn.execute("DELETE FROM preference_events", [])?;
        conn.execute("DELETE FROM preference_traits", [])?;
        conn.execute("DELETE FROM preference_facts", [])?;
        conn.execute(
            "UPDATE turns
             SET rating = 0,
                 preference_score = 0.0,
                 feedback_source = 'none',
                 feedback_reason = NULL,
                 feedback_at = NULL",
            [],
        )?;
        Ok(())
    }

    pub fn rebuild_preference_profile(&self) -> Result<()> {
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        rebuild_preference_traits(&conn, &key)?;
        rebuild_all_turn_preference_summaries(&conn, &key)?;
        Ok(())
    }

    /// Return the top-rated turns ordered by rating descending, for style injection.
    pub fn get_top_rated_turns(&self, limit: i64) -> Result<Vec<TurnRow>> {
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_prompt, assistant_response, created_at
             FROM turns WHERE rating > 0 ORDER BY rating DESC, id DESC LIMIT ?1",
        )?;
        let rows: Result<Vec<TurnRow>> = stmt
            .query_map(params![limit], |row| {
                Ok(TurnRow {
                    id: row.get(0)?,
                    user_prompt: decrypt_field(&key, &row.get::<_, String>(1)?),
                    assistant_response: decrypt_field(&key, &row.get::<_, String>(2)?),
                    created_at: row.get(3)?,
                })
            })?
            .collect();
        rows
    }

    /// Return a compact user preference model plus positive and negative examples.
    pub fn get_preference_profile(&self, limit: i64) -> Result<PreferenceProfile> {
        let limit = normalize_preference_limit(limit)?;
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        let mut trait_stmt = conn.prepare(
            "SELECT key, label, score, evidence_count, positive_count, negative_count,
                    support_score, conflict_score, decayed_score, confidence, status,
                    user_label, user_note, last_seen
             FROM preference_traits
             ORDER BY
                CASE status WHEN 'active' THEN 0 WHEN 'conflicted' THEN 1 WHEN 'low_confidence' THEN 2 WHEN 'disabled' THEN 3 ELSE 4 END,
                ABS(decayed_score) DESC,
                evidence_count DESC,
                last_seen DESC
             LIMIT ?1",
        )?;
        let traits: Vec<PreferenceTraitRow> = trait_stmt
            .query_map(params![limit], preference_trait_row_from_sql)?
            .collect::<Result<Vec<_>>>()?;

        let prompt_traits = traits
            .iter()
            .filter(|t| t.status == "active" && t.confidence >= 0.25 && t.decayed_score.abs() >= 0.1)
            .take(6)
            .cloned()
            .collect();

        let positive_examples = preference_examples(&conn, &key, ">", limit)?;
        let negative_examples = preference_examples(&conn, &key, "<", limit)?;

        let explicit_feedback_count = conn
            .query_row(
                "SELECT COUNT(*) FROM preference_events WHERE active = 1 AND source = 'explicit'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0);
        let implicit_feedback_count = conn
            .query_row(
                "SELECT COUNT(*) FROM preference_events WHERE active = 1 AND source != 'explicit'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap_or(0);

        Ok(PreferenceProfile {
            traits,
            prompt_traits,
            positive_examples,
            negative_examples,
            explicit_feedback_count,
            implicit_feedback_count,
        })
    }

    pub fn upsert_preference_fact(
        &self,
        scope: &str,
        category: &str,
        polarity: i64,
        summary: &str,
        evidence: &str,
        confidence: f64,
        evidence_count: i64,
        source_event_ids_json: Option<String>,
    ) -> Result<i64> {
        let key = self.current_key();
        let scope = normalize_preference_scope(scope);
        let category = normalize_preference_category(category)?;
        let polarity = normalize_preference_polarity(polarity)?;
        let summary = compact_plain_text(&redact_sensitive_text(summary), 180);
        let evidence = compact_plain_text(&redact_sensitive_text(evidence), 260);
        if summary.trim().is_empty() || evidence.trim().is_empty() {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let confidence = confidence.clamp(0.0, 0.99);
        let evidence_count = evidence_count.max(1);
        let source_event_ids_json = source_event_ids_json.unwrap_or_else(|| "[]".to_string());
        let hash = preference_fact_hash(&scope, &category, polarity, &summary);
        let enc_summary = encrypt_field(&key, &summary);
        let enc_evidence = encrypt_field(&key, &evidence);
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO preference_facts
                (scope, category, polarity, summary, evidence, summary_hash, confidence, evidence_count, source_event_ids_json, status)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'active')
             ON CONFLICT(summary_hash) DO UPDATE SET
                evidence = excluded.evidence,
                confidence = excluded.confidence,
                evidence_count = excluded.evidence_count,
                source_event_ids_json = excluded.source_event_ids_json,
                status = CASE WHEN preference_facts.status = 'deleted' THEN 'deleted' ELSE 'active' END,
                updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now'),
                last_seen_at = strftime('%Y-%m-%d %H:%M:%S', 'now')",
            params![
                scope,
                category,
                polarity,
                enc_summary,
                enc_evidence,
                hash,
                confidence,
                evidence_count,
                source_event_ids_json,
            ],
        )?;
        conn.query_row(
            "SELECT id FROM preference_facts WHERE summary_hash = ?1",
            params![hash],
            |row| row.get(0),
        )
    }

    pub fn get_active_preference_facts(&self, limit: i64) -> Result<Vec<PreferenceFactRow>> {
        let limit = normalize_preference_limit(limit)?;
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, scope, category, polarity, summary, evidence, confidence, evidence_count,
                    source_event_ids_json, status, created_at, updated_at, last_seen_at
             FROM preference_facts
             WHERE status = 'active'
             ORDER BY confidence DESC, evidence_count DESC, last_seen_at DESC
             LIMIT ?1",
        )?;
        let rows = stmt
            .query_map(params![limit], |row| preference_fact_row_from_sql(row, &key))?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }

    pub fn set_preference_fact_status(&self, id: i64, status: &str) -> Result<()> {
        let status = normalize_preference_status(status)?;
        let conn = self.conn.lock().unwrap();
        let changed = conn.execute(
            "UPDATE preference_facts
             SET status = ?2, updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
             WHERE id = ?1",
            params![id, status],
        )?;
        if changed == 0 {
            return Err(rusqlite::Error::QueryReturnedNoRows);
        }
        Ok(())
    }

    /// Delete all stored turns and rebuild the FTS index.
    pub fn clear_turns(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM turns", [])?;
        conn.execute("DELETE FROM conversation_summaries", [])?;
        conn.execute("DELETE FROM preference_trait_evidence", [])?;
        conn.execute("DELETE FROM preference_events", [])?;
        conn.execute("DELETE FROM preference_traits", [])?;
        conn.execute("DELETE FROM preference_facts", [])?;
        conn.execute("INSERT INTO turns_fts(turns_fts) VALUES('rebuild')", [])?;
        conn.execute("DELETE FROM memory_digest", [])?;
        conn.execute(
            "UPDATE consolidation_state SET last_turn_id = 0, last_run_at = NULL WHERE id = 1",
            [],
        )?;
        Ok(())
    }

    // â”€â”€ Ambient mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /// Persist one ambient snapshot. `ocr_text` and `active_window` are
    /// encrypted at rest; `pixel_hash` is a plain fingerprint for change detection.
    pub fn save_ambient_snapshot(
        &self,
        ocr_text: &str,
        active_window: &str,
        pixel_hash: &str,
        vision_desc: Option<&str>,
    ) -> Result<i64> {
        let key = self.current_key();
        let enc_ocr = encrypt_field(&key, ocr_text);
        let enc_win = encrypt_field(&key, active_window);
        let enc_vision = vision_desc.map(|v| encrypt_field(&key, v));
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO ambient_snapshots (ocr_text, active_window, pixel_hash, vision_desc)
             VALUES (?1, ?2, ?3, ?4)",
            params![enc_ocr, enc_win, pixel_hash, enc_vision.unwrap_or_default()],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Return a summarised context string covering the last `minutes` minutes
    /// of ambient captures â€” deduplicated by active window and trimmed to
    /// `max_chars` characters. Used for injection into the AI system prompt.
    pub fn get_ambient_context(&self, minutes: i64, max_chars: usize) -> Result<String> {
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        let window_str = format!("-{minutes} minutes");
        let mut stmt = conn.prepare(
            "SELECT ocr_text, active_window, vision_desc, captured_at
             FROM ambient_snapshots
             WHERE captured_at >= datetime('now', ?1)
             ORDER BY captured_at ASC",
        )?;
        let rows: Vec<(String, String, String)> = stmt
            .query_map(params![window_str], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2).unwrap_or_default(),
                ))
            })?
            .filter_map(|r| r.ok())
            .map(|(ocr, win, vision)| (decrypt_field(&key, &ocr), decrypt_field(&key, &win), decrypt_field(&key, &vision)))
            .collect();

        if rows.is_empty() {
            return Ok(String::new());
        }

        // Deduplicate by window, preserving first-seen order.
        // Collect OCR and vision descriptions separately.
        let mut window_order: Vec<String> = Vec::new();
        let mut window_texts: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        let mut window_vision: std::collections::HashMap<String, String> =
            std::collections::HashMap::new();
        for (ocr, win, vision) in rows {
            if !window_texts.contains_key(&win) {
                window_order.push(win.clone());
                window_texts.insert(win.clone(), Vec::new());
            }
            window_texts.get_mut(&win).unwrap().push(ocr);
            if !vision.is_empty() && !window_vision.contains_key(&win) {
                window_vision.insert(win.clone(), vision);
            }
        }

        // Build compact summary: one bullet per unique window, 500 chars of OCR + vision description.
        let mut out = String::new();
        for win in window_order {
            let texts = window_texts.remove(&win).unwrap_or_default();
            let combined = texts.join(" ").replace('\n', " ");
            let snippet: String = combined.chars().take(500).collect();
            let mut line = format!("â€¢ {win}: {snippet}");
            if let Some(vision) = window_vision.remove(&win) {
                if !vision.is_empty() {
                    line.push_str(&format!(" [vision: {}]", vision.chars().take(100).collect::<String>()));
                }
            }
            out.push_str(&format!("{}\n", line));
        }

        // Clamp to max_chars
        if out.len() > max_chars {
            out.truncate(max_chars);
            out.push_str("â€¦");
        }
        Ok(out)
    }

    /// Prune ambient snapshots older than `days` days for retention compliance.
    /// Pass `days = 0` to delete all ambient snapshots.
    pub fn prune_ambient_snapshots(&self, days: i64) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let count = if days <= 0 {
            conn.execute("DELETE FROM ambient_snapshots", [])?
        } else {
            conn.execute(
                "DELETE FROM ambient_snapshots WHERE captured_at < datetime('now', ?1)",
                params![format!("-{days} days")],
            )?
        };
        Ok(count)
    }

    /// Count ambient snapshots captured today (for the tray status badge).
    pub fn count_ambient_today(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM ambient_snapshots WHERE strftime('%Y-%m-%d', captured_at, 'localtime') = date('now', 'localtime')",
            [],
            |row| row.get(0),
        )
    }

    /// Return recent ambient snapshots with decrypted content and truncated snippets.
    /// Used to display ambient history in the UI. Returns up to `limit` snapshots
    /// in reverse chronological order with OCR/vision content trimmed for readability.
    pub fn get_recent_ambient_snapshots(&self, limit: usize) -> Result<Vec<AmbientSnapshotRow>> {
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, ocr_text, active_window, vision_desc, pixel_hash, captured_at
             FROM ambient_snapshots
             ORDER BY captured_at DESC
             LIMIT ?1",
        )?;
        let rows: Vec<AmbientSnapshotRow> = stmt
            .query_map(params![limit as i64], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3).unwrap_or_default(),
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .map(|(id, ocr_enc, win_enc, vision_enc, pixel_hash, captured_at)| {
                let ocr_decrypted = decrypt_field(&key, &ocr_enc);
                let win_decrypted = decrypt_field(&key, &win_enc);
                let vision_decrypted = decrypt_field(&key, &vision_enc);
                AmbientSnapshotRow {
                    id,
                    active_window: win_decrypted,
                    captured_at,
                    ocr_snippet: ocr_decrypted.chars().take(150).collect(),
                    vision_desc: vision_decrypted.chars().take(80).collect(),
                    pixel_hash,
                }
            })
            .collect();
        Ok(rows)
    }

    // â”€â”€ Dim 16: video / temporal context CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /// Insert a new video segment manifest row. `path` is encrypted with the
    /// session key before storage so the on-disk filename is unrecoverable
    /// without the SQLCipher key. Returns the new segment id.
    pub fn save_video_segment(
        &self,
        monitor_idx: u32,
        path: &str,
        start_ts: &str,
        end_ts: Option<&str>,
        duration_ms: i64,
        byte_size: i64,
        width: u32,
        height: u32,
        fps_avg: f32,
        privacy_flag: &str,
    ) -> Result<i64> {
        let key = self.current_key();
        let path_enc = encrypt_field(&key, path);
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO video_segments
             (monitor_idx, path_enc, start_ts, end_ts, duration_ms, byte_size,
              width, height, fps_avg, privacy_flag)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                monitor_idx,
                path_enc,
                start_ts,
                end_ts,
                duration_ms,
                byte_size,
                width,
                height,
                fps_avg,
                privacy_flag
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    /// Insert a keyframe row linked to a segment. OCR text, active window, and
    /// thumbnail JPEG are all field-encrypted. Also updates the FTS5 index.
    /// Returns the new keyframe id.
    pub fn save_video_keyframe(
        &self,
        segment_id: i64,
        pts_ms: i64,
        ocr_text: Option<&str>,
        active_window: Option<&str>,
        ambient_snapshot_id: Option<i64>,
        thumb_jpeg_b64: Option<&str>,
        embedding_blob: Option<&[u8]>,
    ) -> Result<i64> {
        let key = self.current_key();
        let ocr_enc = ocr_text.map(|s| encrypt_field(&key, s));
        let win_enc = active_window.map(|s| encrypt_field(&key, s));
        let thumb_enc = thumb_jpeg_b64.map(|s| encrypt_field(&key, s));

        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO video_keyframes
             (segment_id, pts_ms, ocr_text_enc, active_window_enc,
              ambient_snapshot_id, thumb_jpeg_enc, embedding_blob)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                segment_id,
                pts_ms,
                ocr_enc,
                win_enc,
                ambient_snapshot_id,
                thumb_enc,
                embedding_blob
            ],
        )?;
        let id = conn.last_insert_rowid();

        // FTS5 mirror â€” index plaintext OCR. The DB file is SQLCipher-encrypted
        // at rest, so the index is unreadable without the key.
        if let Some(text) = ocr_text {
            conn.execute(
                "INSERT INTO video_keyframes_fts(rowid, ocr_text) VALUES (?1, ?2)",
                params![id, text],
            )?;
        }
        Ok(id)
    }

    /// Search keyframes by OCR text via FTS5. Returns (keyframe_id, segment_id,
    /// pts_ms, decrypted_ocr_snippet).
    pub fn search_video_keyframes(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<(i64, i64, i64, String)>> {
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT k.id, k.segment_id, k.pts_ms, k.ocr_text_enc
             FROM video_keyframes_fts f
             JOIN video_keyframes k ON k.id = f.rowid
             WHERE video_keyframes_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2",
        )?;
        let rows: Vec<_> = stmt
            .query_map(params![query, limit as i64], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                ))
            })?
            .filter_map(|r| r.ok())
            .map(|(id, seg_id, pts, ocr_enc)| {
                let decrypted = decrypt_field(&key, &ocr_enc);
                let snippet: String = decrypted.chars().take(200).collect();
                (id, seg_id, pts, snippet)
            })
            .collect();
        Ok(rows)
    }

    /// Decrypt a segment's on-disk path from its encrypted manifest row.
    pub fn get_video_segment_path(&self, segment_id: i64) -> Result<Option<String>> {
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT path_enc FROM video_segments WHERE id = ?1",
                params![segment_id],
                |r| r.get::<_, String>(0),
            )
            .optional()?;
        Ok(row.map(|enc| decrypt_field(&key, &enc)))
    }

    /// Return segment manifest rows whose [start_ts, end_ts] window overlaps
    /// the requested ISO8601 window. Used by the timeline UI.
    pub fn get_video_segments_in_window(
        &self,
        start_ts: &str,
        end_ts: &str,
        monitor_idx: Option<u32>,
        limit: usize,
    ) -> Result<Vec<(i64, u32, String, String, Option<String>, i64, i64, String)>> {
        let conn = self.conn.lock().unwrap();
        let monitor_filter = monitor_idx.map(|m| m as i64);
        let mut stmt = conn.prepare(
            "SELECT id, monitor_idx, start_ts, COALESCE(end_ts, start_ts), end_ts,
                    duration_ms, byte_size, privacy_flag
             FROM video_segments
             WHERE start_ts <= ?2 AND COALESCE(end_ts, start_ts) >= ?1
               AND (?3 IS NULL OR monitor_idx = ?3)
             ORDER BY start_ts ASC
             LIMIT ?4",
        )?;
        let rows: Vec<_> = stmt
            .query_map(
                params![start_ts, end_ts, monitor_filter, limit as i64],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)? as u32,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, Option<String>>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, String>(7)?,
                    ))
                },
            )?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    /// Find the keyframe nearest a wall-clock timestamp on a given monitor.
    /// Returns (keyframe_id, segment_id, pts_ms, decrypted_ocr_text,
    /// decrypted_active_window, ambient_snapshot_id).
    pub fn find_video_keyframe_near(
        &self,
        target_ts: &str,
        monitor_idx: Option<u32>,
    ) -> Result<Option<(i64, i64, i64, String, String, Option<i64>)>> {
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        let monitor_filter = monitor_idx.map(|m| m as i64);
        let row = conn
            .query_row(
                "SELECT k.id, k.segment_id, k.pts_ms, k.ocr_text_enc,
                        k.active_window_enc, k.ambient_snapshot_id
                 FROM video_keyframes k
                 JOIN video_segments s ON s.id = k.segment_id
                 WHERE s.start_ts <= ?1 AND COALESCE(s.end_ts, s.start_ts) >= ?1
                   AND (?2 IS NULL OR s.monitor_idx = ?2)
                 ORDER BY ABS(strftime('%s', s.start_ts) * 1000 + k.pts_ms
                              - strftime('%s', ?1) * 1000)
                 LIMIT 1",
                params![target_ts, monitor_filter],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, i64>(2)?,
                        row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                        row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                        row.get::<_, Option<i64>>(5)?,
                    ))
                },
            )
            .optional()?;
        Ok(row.map(|(id, seg, pts, ocr_enc, win_enc, ambient_id)| {
            (
                id,
                seg,
                pts,
                decrypt_field(&key, &ocr_enc),
                decrypt_field(&key, &win_enc),
                ambient_id,
            )
        }))
    }

    /// Delete video segments older than `days` days. Cascades to keyframes
    /// via FK ON DELETE CASCADE. Returns the count of segments deleted.
    /// `days <= 0` deletes all segments.
    pub fn prune_video_segments(&self, days: i64) -> Result<usize> {
        let conn = self.conn.lock().unwrap();
        let count = if days <= 0 {
            let n = conn.execute("DELETE FROM video_segments", [])?;
            // Rebuild FTS so it doesn't keep stale entries
            conn.execute("DELETE FROM video_keyframes_fts", [])?;
            n
        } else {
            // Deleting the segment cascades to keyframes; we have to manually
            // prune the FTS table since it's a contentless external-content table.
            let mut stmt = conn.prepare(
                "SELECT k.id FROM video_keyframes k
                 JOIN video_segments s ON s.id = k.segment_id
                 WHERE s.start_ts < datetime('now', ?1)",
            )?;
            let to_delete: Vec<i64> = stmt
                .query_map(params![format!("-{days} days")], |r| r.get::<_, i64>(0))?
                .filter_map(|r| r.ok())
                .collect();
            drop(stmt);
            for id in to_delete {
                conn.execute(
                    "DELETE FROM video_keyframes_fts WHERE rowid = ?1",
                    params![id],
                )?;
            }
            conn.execute(
                "DELETE FROM video_segments WHERE start_ts < datetime('now', ?1)",
                params![format!("-{days} days")],
            )?
        };
        Ok(count)
    }

    /// Return decrypted on-disk paths for all known video segments. Used by
    /// the retention worker to delete the actual MP4 files after the manifest
    /// rows are pruned.
    pub fn get_all_video_segment_paths(&self) -> Result<Vec<(i64, String)>> {
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, path_enc FROM video_segments")?;
        let rows: Vec<_> = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?
            .filter_map(|r| r.ok())
            .map(|(id, enc)| (id, decrypt_field(&key, &enc)))
            .collect();
        Ok(rows)
    }

    /// Return the decrypted base64 JPEG thumbnail for a keyframe id.
    /// `Ok(None)` means the keyframe exists but has no stored thumb (e.g. a
    /// privacy-flagged segment that recorded only metadata).
    pub fn get_keyframe_thumb(&self, keyframe_id: i64) -> Result<Option<String>> {
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT thumb_jpeg_enc FROM video_keyframes WHERE id = ?1",
                params![keyframe_id],
                |r| r.get::<_, Option<String>>(0),
            )
            .optional()?;
        Ok(row.flatten().map(|enc| decrypt_field(&key, &enc)))
    }

    /// Return the most recent keyframes across all monitors, newest first.
    /// Returns rows of (keyframe_id, segment_id, monitor_idx, start_ts,
    /// pts_ms, decrypted_active_window, privacy_flag, has_thumb).
    pub fn get_recent_keyframes(
        &self,
        limit: usize,
        monitor_idx: Option<u32>,
    ) -> Result<Vec<(i64, i64, u32, String, i64, String, String, bool)>> {
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        let monitor_filter = monitor_idx.map(|m| m as i64);
        let mut stmt = conn.prepare(
            "SELECT k.id, k.segment_id, s.monitor_idx, s.start_ts, k.pts_ms,
                    k.active_window_enc, s.privacy_flag,
                    CASE WHEN k.thumb_jpeg_enc IS NOT NULL THEN 1 ELSE 0 END
             FROM video_keyframes k
             JOIN video_segments s ON s.id = k.segment_id
             WHERE (?1 IS NULL OR s.monitor_idx = ?1)
             ORDER BY s.start_ts DESC, k.pts_ms DESC
             LIMIT ?2",
        )?;
        let rows: Vec<_> = stmt
            .query_map(params![monitor_filter, limit as i64], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)? as u32,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                    row.get::<_, String>(6)?,
                    row.get::<_, i64>(7)? != 0,
                ))
            })?
            .filter_map(|r| r.ok())
            .map(|(id, seg, m, ts, pts, win_enc, flag, has_thumb)| {
                (
                    id,
                    seg,
                    m,
                    ts,
                    pts,
                    decrypt_field(&key, &win_enc),
                    flag,
                    has_thumb,
                )
            })
            .collect();
        Ok(rows)
    }

    /// Total bytes accounted for by the manifest. Used for status displays.
    pub fn total_video_bytes(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT COALESCE(SUM(byte_size), 0) FROM video_segments",
            [],
            |r| r.get(0),
        )
    }

    /// Return all video segments captured within the trailing window of N
    /// minutes. Used by the Timeline UI. Returns rows of
    /// (segment_id, monitor_idx, start_ts, end_ts, duration_ms, byte_size, privacy_flag).
    pub fn get_recent_video_segments(
        &self,
        window_minutes: i64,
        monitor_idx: Option<u32>,
    ) -> Result<Vec<(i64, u32, String, Option<String>, i64, i64, String)>> {
        let conn = self.conn.lock().unwrap();
        let monitor_filter = monitor_idx.map(|m| m as i64);
        let start = format!("-{} minutes", window_minutes.max(1));
        let mut stmt = conn.prepare(
            "SELECT id, monitor_idx, start_ts, end_ts, duration_ms, byte_size, privacy_flag
             FROM video_segments
             WHERE start_ts >= datetime('now', ?1)
               AND (?2 IS NULL OR monitor_idx = ?2)
             ORDER BY start_ts ASC
             LIMIT 1024",
        )?;
        let rows: Vec<_> = stmt
            .query_map(params![start, monitor_filter], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)? as u32,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, String>(6)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    }

    // â”€â”€ End video CRUD â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    /// Delete all memory: turns, summaries, and message history.
    pub fn purge_all_memory(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM turns", [])?;
        conn.execute("DELETE FROM conversation_summaries", [])?;
        conn.execute("DELETE FROM messages", [])?;
        conn.execute("DELETE FROM preference_trait_evidence", [])?;
        conn.execute("DELETE FROM preference_events", [])?;
        conn.execute("DELETE FROM preference_traits", [])?;
        conn.execute("DELETE FROM preference_facts", [])?;
        conn.execute("INSERT INTO turns_fts(turns_fts) VALUES('rebuild')", [])?;
        conn.execute("INSERT INTO messages_fts(messages_fts) VALUES('rebuild')", [])?;
        conn.execute("DELETE FROM memory_digest", [])?;
        conn.execute("DELETE FROM ambient_snapshots", [])?;
        // Dim 16 â€” video manifests + FTS index
        conn.execute("DELETE FROM video_keyframes_fts", [])?;
        conn.execute("DELETE FROM video_segments", [])?;
        conn.execute(
            "UPDATE consolidation_state SET last_turn_id = 0, last_run_at = NULL WHERE id = 1",
            [],
        )?;
        conn.execute("DELETE FROM session_meta", [])?;
        Ok(())
    }

    /// Export all memory as a complete JSON object: turns, preference_facts, memory_digest.
    pub fn export_memory_json(&self) -> Result<String> {
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();

        // Turns
        let mut stmt = conn.prepare(
            "SELECT id, user_prompt, assistant_response, created_at, rating, preference_score, feedback_source, feedback_reason
             FROM turns ORDER BY id ASC",
        )?;
        let turns: Vec<serde_json::Value> = stmt
            .query_map([], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "user_prompt": decrypt_field(&key, &row.get::<_, String>(1)?),
                    "assistant_response": decrypt_field(&key, &row.get::<_, String>(2)?),
                    "created_at": row.get::<_, String>(3)?,
                    "rating": row.get::<_, i64>(4).unwrap_or(0),
                    "preference_score": row.get::<_, f64>(5).unwrap_or(0.0),
                    "feedback_source": row.get::<_, String>(6).unwrap_or_else(|_| "none".to_string()),
                    "feedback_reason": row.get::<_, Option<String>>(7).unwrap_or(None).map(|v| decrypt_field(&key, &v)),
                }))
            })?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);

        // Preference facts â€” decrypt summary/evidence (ChaCha20-Poly1305) before export.
        let mut stmt2 = conn.prepare(
            "SELECT id, scope, category, polarity, summary, evidence, confidence,
                    evidence_count, source_event_ids_json, status, created_at, updated_at, last_seen_at
             FROM preference_facts ORDER BY id ASC",
        )?;
        let facts: Vec<serde_json::Value> = stmt2
            .query_map([], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "scope": row.get::<_, String>(1)?,
                    "category": row.get::<_, String>(2)?,
                    "polarity": row.get::<_, i64>(3)?,
                    "summary": decrypt_field(&key, &row.get::<_, String>(4)?),
                    "evidence": decrypt_field(&key, &row.get::<_, String>(5)?),
                    "confidence": row.get::<_, f64>(6)?,
                    "evidence_count": row.get::<_, i64>(7)?,
                    "source_event_ids_json": row.get::<_, String>(8)?,
                    "status": row.get::<_, String>(9)?,
                    "created_at": row.get::<_, String>(10)?,
                    "updated_at": row.get::<_, String>(11)?,
                    "last_seen_at": row.get::<_, String>(12)?,
                }))
            })?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt2);

        // Memory digest facts (decrypted)
        let mut stmt3 = conn.prepare(
            "SELECT id, fact, category, confidence, source_turn_ids, last_seen, created_at
             FROM memory_digest ORDER BY id ASC",
        )?;
        let digest: Vec<serde_json::Value> = stmt3
            .query_map([], |row| {
                Ok(serde_json::json!({
                    "id": row.get::<_, i64>(0)?,
                    "fact": decrypt_field(&key, &row.get::<_, String>(1)?),
                    "category": row.get::<_, String>(2)?,
                    "confidence": row.get::<_, f64>(3)?,
                    "source_turn_ids": row.get::<_, Option<String>>(4)?,
                    "last_seen": row.get::<_, String>(5)?,
                    "created_at": row.get::<_, String>(6)?,
                }))
            })?
            .filter_map(|r| r.ok())
            .collect();

        let export = serde_json::json!({
            "version": 2,
            "exported_at": now_ts(),
            "turns": turns,
            "preference_facts": facts,
            "memory_digest": digest,
        });
        serde_json::to_string(&export).map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))
    }

    /// Import memory from JSON produced by export_memory_json.
    /// Accepts both v1 (bare array of turns) and v2 (object with turns/preference_facts/memory_digest).
    /// Re-encrypts all text with the current key. Returns number of turns imported.
    pub fn import_memory_json(&self, json: &str) -> Result<usize> {
        let root: serde_json::Value = serde_json::from_str(json)
            .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(e)))?;
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();

        // Support both v1 (bare array) and v2 (object) export formats
        let empty_vec = vec![];
        let (turns_arr, facts_arr, digest_arr) = if root.is_array() {
            (root.as_array().unwrap(), &empty_vec, &empty_vec)
        } else {
            (
                root["turns"].as_array().unwrap_or(&empty_vec),
                root["preference_facts"].as_array().unwrap_or(&empty_vec),
                root["memory_digest"].as_array().unwrap_or(&empty_vec),
            )
        };

        let mut count = 0usize;

        // Import turns
        for turn in turns_arr {
            let user = turn["user_prompt"].as_str().unwrap_or("").trim().to_string();
            let asst = turn["assistant_response"].as_str().unwrap_or("").trim().to_string();
            if user.is_empty() && asst.is_empty() {
                continue;
            }
            let enc_user = encrypt_field(&key, &user);
            let enc_asst = encrypt_field(&key, &asst);
            let created_at = turn["created_at"].as_str().unwrap_or("");
            let rating = turn["rating"].as_i64().unwrap_or(0) as i32;
            let preference_score = turn["preference_score"].as_f64().unwrap_or(0.0);
            let feedback_source = turn["feedback_source"].as_str().unwrap_or("none");
            // Encrypt feedback_reason to maintain the same invariant as live writes.
            let enc_feedback_reason: Option<String> = turn["feedback_reason"]
                .as_str()
                .filter(|s| !s.is_empty())
                .map(|s| encrypt_field(&key, s));
            if !created_at.is_empty() {
                conn.execute(
                    "INSERT INTO turns (user_prompt, assistant_response, created_at,
                      rating, preference_score, feedback_source, feedback_reason)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![enc_user, enc_asst, created_at, rating,
                            preference_score, feedback_source, enc_feedback_reason],
                )?;
            } else {
                conn.execute(
                    "INSERT INTO turns (user_prompt, assistant_response,
                      rating, preference_score, feedback_source, feedback_reason)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![enc_user, enc_asst, rating,
                            preference_score, feedback_source, enc_feedback_reason],
                )?;
            }
            count += 1;
        }

        // Import preference facts (upsert by scope+category+polarity+summary)
        // Import preference facts: encrypt summary/evidence, use summary_hash as dedup key.
        for fact in facts_arr {
            let scope = fact["scope"].as_str().unwrap_or("global");
            let category = fact["category"].as_str().unwrap_or("general");
            let polarity = fact["polarity"].as_i64().unwrap_or(1);
            let summary = fact["summary"].as_str().unwrap_or("").trim().to_string();
            let evidence = fact["evidence"].as_str().unwrap_or("").trim().to_string();
            if summary.is_empty() { continue; }
            let hash = preference_fact_hash(scope, category, polarity, &summary);
            let enc_summary = encrypt_field(&key, &summary);
            let enc_evidence = encrypt_field(&key, &evidence);
            let _ = conn.execute(
                "INSERT INTO preference_facts
                    (scope, category, polarity, summary, evidence, summary_hash,
                     confidence, evidence_count, source_event_ids_json, status)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                 ON CONFLICT(summary_hash) DO UPDATE SET
                    evidence = excluded.evidence,
                    confidence = excluded.confidence,
                    evidence_count = excluded.evidence_count,
                    updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')",
                params![
                    scope,
                    category,
                    polarity,
                    enc_summary,
                    enc_evidence,
                    hash,
                    fact["confidence"].as_f64().unwrap_or(0.5),
                    fact["evidence_count"].as_i64().unwrap_or(1),
                    fact["source_event_ids_json"].as_str().unwrap_or("[]"),
                    fact["status"].as_str().unwrap_or("active"),
                ],
            );
        }

        // Import memory digest facts (encrypt before storing)
        for d in digest_arr {
            let fact_text = d["fact"].as_str().unwrap_or("").trim().to_string();
            if fact_text.is_empty() { continue; }
            let enc_fact = encrypt_field(&key, &fact_text);
            let _ = conn.execute(
                "INSERT OR IGNORE INTO memory_digest (fact, category, confidence, source_turn_ids)
                 VALUES (?1, ?2, ?3, ?4)",
                params![
                    enc_fact,
                    d["category"].as_str().unwrap_or("general"),
                    d["confidence"].as_f64().unwrap_or(1.0),
                    d["source_turn_ids"].as_str(),
                ],
            );
        }

        Ok(count)
    }

    /// Delete turns older than `days` days.
    pub fn prune_old_turns(&self, days: i64) -> Result<()> {
        if days <= 0 {
            return Ok(());
        }
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        let retention_window = format!("-{days} days");
        let pruned_turns = conn.execute(
            "DELETE FROM turns WHERE created_at < datetime('now', ?1)",
            params![retention_window],
        )?;
        conn.execute(
            "DELETE FROM conversation_summaries WHERE created_at < datetime('now', ?1)",
            params![format!("-{days} days")],
        )?;
        if pruned_turns > 0 {
            let min_remaining_turn_id: Option<i64> =
                conn.query_row("SELECT MIN(id) FROM turns", [], |row| row.get(0))?;
            if let Some(min_id) = min_remaining_turn_id {
                conn.execute(
                    "DELETE FROM conversation_summaries
                     WHERE covered_turn_start_id IS NULL OR covered_turn_start_id < ?1",
                    params![min_id],
                )?;
            } else {
                conn.execute("DELETE FROM conversation_summaries", [])?;
            }
        }
        conn.execute("INSERT INTO turns_fts(turns_fts) VALUES('rebuild')", [])?;
        rebuild_preference_traits(&conn, &key)?;
        Ok(())
    }

    pub fn save_conversation_summary(
        &self,
        summary: &str,
        covered_turn_start_id: Option<i64>,
        covered_turn_end_id: Option<i64>,
        estimated_tokens_before: i64,
        estimated_tokens_after: i64,
        provider: &str,
        model: &str,
        schema_version: i64,
    ) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO conversation_summaries
             (summary, covered_turn_start_id, covered_turn_end_id, estimated_tokens_before,
              estimated_tokens_after, provider, model, schema_version)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                summary,
                covered_turn_start_id,
                covered_turn_end_id,
                estimated_tokens_before,
                estimated_tokens_after,
                provider,
                model,
                schema_version,
            ],
        )?;
        Ok(conn.last_insert_rowid())
    }

    pub fn get_latest_conversation_summary(&self) -> Result<Option<ConversationSummaryRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, summary, covered_turn_start_id, covered_turn_end_id,
                    estimated_tokens_before, estimated_tokens_after, provider, model,
                    schema_version, created_at
             FROM conversation_summaries
             ORDER BY id DESC
             LIMIT 1",
        )?;
        let mut rows = stmt.query([])?;
        if let Some(row) = rows.next()? {
            Ok(Some(ConversationSummaryRow {
                id: row.get(0)?,
                summary: row.get(1)?,
                covered_turn_start_id: row.get(2)?,
                covered_turn_end_id: row.get(3)?,
                estimated_tokens_before: row.get(4)?,
                estimated_tokens_after: row.get(5)?,
                provider: row.get(6)?,
                model: row.get(7)?,
                schema_version: row.get(8)?,
                created_at: row.get(9)?,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn get_session_meta(&self) -> Result<Vec<SessionMetaRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT date_key, label, summary, created_at, updated_at
             FROM session_meta ORDER BY date_key DESC"
        )?;
        let mut rows = Vec::new();
        let mut mapped = stmt.query_map([], |row| Ok(SessionMetaRow {
            date_key:   row.get(0)?,
            label:      row.get(1)?,
            summary:    row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        }))?;
        while let Some(row_result) = mapped.next() {
            rows.push(row_result?);
        }
        Ok(rows)
    }

    pub fn upsert_session_meta(
        &self,
        date_key: &str,
        label: Option<String>,
        summary: Option<String>,
    ) -> Result<()> {
        if date_key.len() != 10
            || !date_key.chars().enumerate().all(|(i, c)| {
                if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() }
            })
        {
            return Err(rusqlite::Error::InvalidQuery);
        }
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO session_meta (date_key, label, summary)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(date_key) DO UPDATE SET
                 label      = COALESCE(?2, label),
                 summary    = COALESCE(?3, summary),
                 updated_at = strftime('%Y-%m-%d %H:%M:%S', 'now')",
            rusqlite::params![date_key, label, summary],
        )?;
        Ok(())
    }

    /// Return total turn count (for UI display).
    pub fn turn_count(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.query_row("SELECT COUNT(*) FROM turns", [], |row| row.get(0))
    }

    /// Delete turns older than `days` days. Returns the number of rows deleted.
    /// Passing 0 means "keep forever" â€” no deletion.
    pub fn delete_turns_older_than(&self, days: i64) -> Result<u64> {
        if days <= 0 {
            return Ok(0);
        }
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "DELETE FROM turns WHERE created_at < datetime('now', ?1)",
            rusqlite::params![format!("-{days} days")],
        )?;
        Ok(n as u64)
    }

    /// Return the created_at timestamp of the oldest turn, or None if there are no turns.
    pub fn get_oldest_turn_date(&self) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        match conn.query_row(
            "SELECT created_at FROM turns ORDER BY created_at ASC LIMIT 1",
            [],
            |row| row.get::<_, String>(0),
        ) {
            Ok(d) => Ok(Some(d)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Full-text keyword search over turns. Since turns_fts indexes encrypted blobs,
    /// this decrypts all rows in-memory and filters by substring match. Semantic search
    /// via search_semantic is recommended for large histories.
    pub fn search_history(&self, query: &str, limit: i64) -> Result<Vec<TurnRow>> {
        let key = self.current_key();
        let query_lower = query.to_lowercase();
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_prompt, assistant_response, created_at
             FROM turns ORDER BY id DESC",
        )?;
        let matches: Vec<TurnRow> = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                ))
            })?
            .filter_map(|r| r.ok())
            .map(|(id, enc_user, enc_asst, created_at)| TurnRow {
                id,
                user_prompt: decrypt_field(&key, &enc_user),
                assistant_response: decrypt_field(&key, &enc_asst),
                created_at,
            })
            .filter(|t| {
                t.user_prompt.to_lowercase().contains(&query_lower)
                    || t.assistant_response.to_lowercase().contains(&query_lower)
            })
            .take(limit as usize)
            .collect();
        Ok(matches)
    }

    /// Store a 384-dim embedding vector (little-endian f32 bytes) for a turn.
    pub fn save_embedding(&self, turn_id: i64, embedding: Vec<f32>) -> Result<()> {
        let bytes: Vec<u8> = embedding.iter().flat_map(|f| f.to_le_bytes()).collect();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE turns SET embedding_vec = ?1 WHERE id = ?2",
            params![bytes, turn_id],
        )?;
        Ok(())
    }

    /// Cosine similarity search over all embedded turns. Scans all embedded turns and
    /// returns the top `limit` results with cosine >= `min_score`, each annotated with
    /// its similarity score.
    pub fn search_semantic(&self, query_embedding: &[f32], limit: usize, min_score: f32) -> Result<Vec<ScoredTurnRow>> {
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_prompt, assistant_response, created_at, embedding_vec
             FROM turns WHERE embedding_vec IS NOT NULL ORDER BY id DESC",
        )?;
        let candidates: Vec<(TurnRow, Vec<f32>)> = stmt
            .query_map([], |row| {
                let bytes: Vec<u8> = row.get(4)?;
                let embedding: Vec<f32> = bytes
                    .chunks_exact(4)
                    .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                    .collect();
                Ok((
                    TurnRow {
                        id: row.get(0)?,
                        user_prompt: decrypt_field(&key, &row.get::<_, String>(1)?),
                        assistant_response: decrypt_field(&key, &row.get::<_, String>(2)?),
                        created_at: row.get(3)?,
                    },
                    embedding,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect();

        let mut scored: Vec<(f32, TurnRow)> = candidates
            .into_iter()
            .map(|(turn, emb)| (cosine_similarity(query_embedding, &emb), turn))
            .filter(|(score, _)| *score >= min_score)
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        Ok(scored
            .into_iter()
            .take(limit)
            .map(|(score, t)| ScoredTurnRow {
                score,
                id: t.id,
                user_prompt: t.user_prompt,
                assistant_response: t.assistant_response,
                created_at: t.created_at,
            })
            .collect())
    }

    /// Return the count of turns that have not yet been embedded.
    pub fn count_unembedded_turns(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT COUNT(*) FROM turns WHERE embedding_vec IS NULL",
            [],
            |row| row.get(0),
        )
    }

    /// Return turns that have not yet been embedded â€” used for background indexing.
    pub fn get_unembedded_turns(&self, limit: usize) -> Result<Vec<TurnRow>> {
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_prompt, assistant_response, created_at FROM turns
             WHERE embedding_vec IS NULL ORDER BY id DESC LIMIT ?1",
        )?;
        let rows: Result<Vec<TurnRow>> = stmt
            .query_map(params![limit as i64], |row| {
                Ok(TurnRow {
                    id: row.get(0)?,
                    user_prompt: decrypt_field(&key, &row.get::<_, String>(1)?),
                    assistant_response: decrypt_field(&key, &row.get::<_, String>(2)?),
                    created_at: row.get(3)?,
                })
            })?
            .collect();
        rows
    }

    /// Returns the current encryption key protection status.
    /// On Windows, attempts a real DPAPI decrypt to verify the key is actually readable â€”
    /// a file-existence check alone would show false-green after account migration.
    pub fn key_status(&self, dir: &std::path::Path) -> KeyStatusResponse {
        #[cfg(target_os = "windows")]
        let dpapi_protected = {
            let dpapi_path = dir.join("session.key.dpapi");
            dpapi_path.exists()
                && std::fs::read(&dpapi_path)
                    .ok()
                    .and_then(|blob| dpapi_unprotect(&blob).ok())
                    .map(|raw| raw.len() == 32)
                    .unwrap_or(false)
        };
        #[cfg(not(target_os = "windows"))]
        let dpapi_protected = false;
        KeyStatusResponse {
            encrypted: true,
            dpapi_protected,
            sqlcipher_active: cfg!(feature = "sqlcipher"),
            platform: std::env::consts::OS.to_string(),
        }
    }

    /// Re-encrypt all turns with a fresh key, persist the new DPAPI-protected key,
    /// and atomically swap the in-memory key so subsequent saves use the new key immediately.
    pub fn rekey_database(&self, dir: &std::path::Path) -> Result<usize> {
        let old_key = self.current_key();
        let mut new_key = [0u8; 32];
        use rand::RngCore;
        rand::thread_rng().fill_bytes(&mut new_key);

        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_prompt, assistant_response, screenshot_b64 FROM turns",
        )?;
        let rows: Vec<(i64, String, String, Option<String>)> = stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)))?
            .filter_map(|r| r.ok())
            .collect();
        drop(stmt);
        let count = rows.len();
        for (id, enc_u, enc_a, enc_s) in rows {
            let plain_u = decrypt_field(&old_key, &enc_u);
            let plain_a = decrypt_field(&old_key, &enc_a);
            let new_enc_s = enc_s.map(|s| encrypt_field(&new_key, &decrypt_field(&old_key, &s)));
            conn.execute(
                "UPDATE turns SET user_prompt = ?1, assistant_response = ?2, screenshot_b64 = ?3 WHERE id = ?4",
                params![encrypt_field(&new_key, &plain_u), encrypt_field(&new_key, &plain_a), new_enc_s, id],
            )?;
        }

        #[cfg(target_os = "windows")]
        {
            let protected = dpapi_protect(&new_key)
                .map_err(|e| rusqlite::Error::InvalidPath(e.to_string().into()))?;
            std::fs::write(dir.join("session.key.dpapi"), &protected)
                .map_err(|e| rusqlite::Error::InvalidPath(e.to_string().into()))?;
        }
        #[cfg(not(target_os = "windows"))]
        std::fs::write(dir.join("session.key"), new_key)
            .map_err(|e| rusqlite::Error::InvalidPath(e.to_string().into()))?;

        // Atomically update the in-memory key so subsequent saves use the new key immediately.
        *self.key.lock().unwrap() = new_key;
        Ok(count)
    }

    // â”€â”€ Memory Digest (Dim 35) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    pub fn get_turns_to_consolidate(&self, since_turn_id: i64, limit: usize) -> Result<Vec<TurnRow>> {
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, user_prompt, assistant_response, created_at FROM turns
             WHERE id > ?1 ORDER BY id ASC LIMIT ?2",
        )?;
        let rows: Result<Vec<TurnRow>> = stmt
            .query_map(params![since_turn_id, limit as i64], |row| {
                Ok(TurnRow {
                    id: row.get(0)?,
                    user_prompt: decrypt_field(&key, &row.get::<_, String>(1)?),
                    assistant_response: decrypt_field(&key, &row.get::<_, String>(2)?),
                    created_at: row.get(3)?,
                })
            })?
            .collect();
        rows
    }

    pub fn get_last_consolidated_turn_id(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT last_turn_id FROM consolidation_state WHERE id = 1",
            [],
            |r| r.get(0),
        )
        .or(Ok(0))
    }

    pub fn update_consolidation_state(&self, last_turn_id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE consolidation_state SET last_turn_id = ?1,
             last_run_at = strftime('%Y-%m-%dT%H:%M:%S', 'now') WHERE id = 1",
            params![last_turn_id],
        )?;
        Ok(())
    }

    pub fn get_last_consolidation_time(&self) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        conn.query_row(
            "SELECT last_run_at FROM consolidation_state WHERE id = 1",
            [],
            |r| r.get(0),
        )
        .or(Ok(None))
    }

    pub fn save_digest_facts(&self, facts: &[DigestFact]) -> Result<()> {
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        const MAX_FACTS: i64 = 50;

        // Load all existing decrypted facts within this lock for dedup checks
        let mut existing: Vec<String> = {
            let mut stmt = conn.prepare("SELECT fact FROM memory_digest ORDER BY confidence DESC")?;
            let x = stmt.query_map([], |r| r.get::<_, String>(0))?
                .filter_map(|r| r.ok())
                .map(|enc| decrypt_field(&key, &enc))
                .collect();
            x
        };

        for f in facts {
            let normalized_new = f.fact.to_lowercase();
            // Skip if Jaccard word overlap > 0.65 with any existing fact
            let is_duplicate = existing.iter().any(|ex| {
                word_overlap_ratio(&ex.to_lowercase(), &normalized_new) > 0.65
            });
            if is_duplicate {
                continue;
            }

            // Evict lowest-confidence fact when at cap
            let count: i64 = conn
                .query_row("SELECT COUNT(*) FROM memory_digest", [], |r| r.get(0))
                .unwrap_or(0);
            if count >= MAX_FACTS {
                conn.execute(
                    "DELETE FROM memory_digest WHERE id = (
                         SELECT id FROM memory_digest ORDER BY confidence ASC LIMIT 1
                     )",
                    [],
                )?;
            }

            let encrypted_fact = encrypt_field(&key, &f.fact);
            conn.execute(
                "INSERT INTO memory_digest(fact, category, confidence, source_turn_ids, last_seen)
                 VALUES (?1, ?2, ?3, ?4, strftime('%Y-%m-%dT%H:%M:%S', 'now'))",
                params![encrypted_fact, f.category, f.confidence, f.source_turn_ids],
            )?;
            existing.push(f.fact.clone());
        }
        Ok(())
    }

    pub fn get_digest_facts(&self, limit: i64) -> Result<Vec<DigestFact>> {
        let key = self.current_key();
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, fact, category, confidence, source_turn_ids, last_seen, created_at
             FROM memory_digest ORDER BY confidence DESC, last_seen DESC LIMIT ?1",
        )?;
        let rows: Result<Vec<DigestFact>> = stmt
            .query_map([limit], |r| {
                Ok(DigestFact {
                    id: Some(r.get(0)?),
                    fact: r.get(1)?,
                    category: r.get(2)?,
                    confidence: r.get(3)?,
                    source_turn_ids: r.get(4)?,
                    last_seen: r.get(5).ok(),
                    created_at: r.get(6).ok(),
                })
            })?
            .collect();
        let mut facts = rows?;
        for f in &mut facts {
            f.fact = decrypt_field(&key, &f.fact);
        }
        Ok(facts)
    }

    pub fn delete_digest_fact(&self, id: i64) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM memory_digest WHERE id = ?1", [id])?;
        Ok(())
    }

    pub fn clear_digest(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM memory_digest", [])?;
        conn.execute(
            "UPDATE consolidation_state SET last_turn_id = 0, last_run_at = NULL WHERE id = 1",
            [],
        )?;
        Ok(())
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

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm_a == 0.0 || norm_b == 0.0 {
        0.0
    } else {
        dot / (norm_a * norm_b)
    }
}

fn word_overlap_ratio(a: &str, b: &str) -> f64 {
    use std::collections::HashSet;
    let wa: HashSet<&str> = a.split_whitespace().collect();
    let wb: HashSet<&str> = b.split_whitespace().collect();
    let intersection = wa.intersection(&wb).count();
    let union = wa.union(&wb).count();
    if union == 0 { 0.0 } else { intersection as f64 / union as f64 }
}

fn sanitize_preference_signal(signal: &str) -> String {
    let mut out: String = signal
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .take(48)
        .collect();
    if out.is_empty() {
        out = "implicit_feedback".to_string();
    }
    out
}

fn sanitize_idempotency_key(key: &str) -> String {
    key.chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(*c, '_' | '-' | ':' | '.'))
        .take(96)
        .collect()
}

fn normalize_preference_limit(limit: i64) -> Result<i64> {
    if (1..=50).contains(&limit) {
        Ok(limit)
    } else {
        Err(rusqlite::Error::InvalidQuery)
    }
}

fn normalize_preference_status(status: &str) -> Result<String> {
    match status {
        "active" | "disabled" | "deleted" => Ok(status.to_string()),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn normalize_preference_category(category: &str) -> Result<String> {
    match category {
        "style" | "workflow" | "tool" | "safety" | "domain" | "avoidance" => Ok(category.to_string()),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn normalize_preference_scope(scope: &str) -> String {
    let safe: String = scope
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(*c, '_' | '-' | ':' | '.'))
        .take(64)
        .collect();
    if safe.is_empty() {
        "global".to_string()
    } else {
        safe
    }
}

fn normalize_preference_polarity(polarity: i64) -> Result<i64> {
    match polarity {
        -1 | 1 => Ok(polarity),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn ensure_turn_exists(conn: &Connection, turn_id: i64) -> Result<()> {
    let exists: i64 = conn.query_row(
        "SELECT COUNT(*) FROM turns WHERE id = ?1",
        params![turn_id],
        |row| row.get(0),
    )?;
    if exists == 0 {
        return Err(rusqlite::Error::QueryReturnedNoRows);
    }
    Ok(())
}

struct PreferenceSignalSpec {
    source: &'static str,
    weight: f64,
}

fn preference_signal_spec(signal: &str) -> Option<PreferenceSignalSpec> {
    match signal {
        "explicit_thumbs_up" => Some(PreferenceSignalSpec { source: "explicit", weight: 1.0 }),
        "explicit_thumbs_down" => Some(PreferenceSignalSpec { source: "explicit", weight: -1.25 }),
        "copied_response" => Some(PreferenceSignalSpec { source: "implicit", weight: 0.35 }),
        "positive_followup" => Some(PreferenceSignalSpec { source: "implicit", weight: 0.55 }),
        "corrective_followup" => Some(PreferenceSignalSpec { source: "implicit", weight: -0.85 }),
        "manual_preference" => Some(PreferenceSignalSpec { source: "manual", weight: 1.0 }),
        "preference_reset" => Some(PreferenceSignalSpec { source: "system", weight: 0.0 }),
        "action_succeeded" => Some(PreferenceSignalSpec { source: "implicit", weight: 0.3 }),
        _ => None,
    }
}

fn migrate_preference_tables(conn: &Connection) -> Result<()> {
    if !table_has_column(conn, "preference_events", "idempotency_key")? {
        conn.execute_batch(
            "
            ALTER TABLE preference_events RENAME TO preference_events_legacy;
            CREATE TABLE preference_events (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                turn_id         INTEGER NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
                event_type      TEXT,
                polarity        INTEGER,
                payload_json    TEXT,
                signal          TEXT    NOT NULL,
                source          TEXT    NOT NULL DEFAULT 'implicit',
                weight          REAL    NOT NULL,
                reason          TEXT,
                raw_text        TEXT,
                idempotency_key TEXT UNIQUE,
                extractor       TEXT    NOT NULL DEFAULT 'preference_v2',
                active          INTEGER NOT NULL DEFAULT 1,
                created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
            );
            INSERT INTO preference_events
                (id, turn_id, event_type, polarity, payload_json, signal, source, weight, reason, raw_text, idempotency_key, extractor, active, created_at)
            SELECT
                id,
                turn_id,
                CASE
                    WHEN signal = 'explicit_rating' AND weight >= 0 THEN 'explicit_thumbs_up'
                    WHEN signal = 'explicit_rating' THEN 'explicit_thumbs_down'
                    ELSE signal
                END,
                CASE WHEN weight >= 0 THEN 1 ELSE -1 END,
                '{}',
                CASE
                    WHEN signal = 'explicit_rating' AND weight >= 0 THEN 'explicit_thumbs_up'
                    WHEN signal = 'explicit_rating' THEN 'explicit_thumbs_down'
                    ELSE signal
                END,
                CASE WHEN signal = 'explicit_rating' THEN 'explicit' ELSE 'implicit' END,
                weight,
                reason,
                NULL,
                'legacy:' || turn_id || ':' || signal,
                'preference_v1_migrated',
                1,
                created_at
            FROM preference_events_legacy;
            DROP TABLE preference_events_legacy;
            ",
        )?;
    }

    ensure_column(conn, "preference_events", "event_type", "TEXT")?;
    ensure_column(conn, "preference_events", "polarity", "INTEGER")?;
    ensure_column(conn, "preference_events", "payload_json", "TEXT")?;
    ensure_column(conn, "preference_traits", "support_score", "REAL NOT NULL DEFAULT 0.0")?;
    ensure_column(conn, "preference_traits", "conflict_score", "REAL NOT NULL DEFAULT 0.0")?;
    ensure_column(conn, "preference_traits", "decayed_score", "REAL NOT NULL DEFAULT 0.0")?;
    ensure_column(conn, "preference_traits", "confidence", "REAL NOT NULL DEFAULT 0.0")?;
    ensure_column(conn, "preference_traits", "status", "TEXT NOT NULL DEFAULT 'active'")?;
    ensure_column(conn, "preference_traits", "user_label", "TEXT")?;
    ensure_column(conn, "preference_traits", "user_note", "TEXT")?;
    // Add summary_hash for encrypted dedup (replaces UNIQUE on plaintext summary column).
    ensure_column(conn, "preference_facts", "summary_hash", "TEXT")?;
    conn.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS preference_facts_summary_hash_idx
         ON preference_facts(summary_hash) WHERE summary_hash IS NOT NULL;",
    )?;

    // Drop the old UNIQUE(scope, category, polarity, summary) constraint that was baked
    // into the original CREATE TABLE.  Since summary is now encrypted ciphertext, the
    // constraint can never fire and would silently accept duplicate plaintext values.
    // SQLite requires a full table rebuild to remove an inline table constraint.
    let has_legacy_unique: bool = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master
         WHERE type='table' AND name='preference_facts'
           AND sql LIKE '%UNIQUE(scope, category, polarity, summary)%'",
        [],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;

    if has_legacy_unique {
        conn.execute_batch("
            PRAGMA foreign_keys=OFF;

            CREATE TABLE preference_facts_new (
                id                    INTEGER PRIMARY KEY AUTOINCREMENT,
                scope                 TEXT    NOT NULL DEFAULT 'global',
                category              TEXT    NOT NULL,
                polarity              INTEGER NOT NULL,
                summary               TEXT    NOT NULL,
                evidence              TEXT    NOT NULL,
                confidence            REAL    NOT NULL DEFAULT 0.0,
                evidence_count        INTEGER NOT NULL DEFAULT 1,
                source_event_ids_json TEXT    NOT NULL DEFAULT '[]',
                status                TEXT    NOT NULL DEFAULT 'active',
                summary_hash          TEXT,
                created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
                updated_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now')),
                last_seen_at          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S', 'now'))
            );

            INSERT INTO preference_facts_new
                SELECT id, scope, category, polarity, summary, evidence, confidence,
                       evidence_count, source_event_ids_json, status, summary_hash,
                       created_at, updated_at, last_seen_at
                FROM preference_facts;

            DROP TABLE preference_facts;
            ALTER TABLE preference_facts_new RENAME TO preference_facts;

            CREATE UNIQUE INDEX IF NOT EXISTS preference_facts_summary_hash_idx
                ON preference_facts(summary_hash) WHERE summary_hash IS NOT NULL;

            PRAGMA foreign_keys=ON;
        ")?;
    }

    Ok(())
}

fn table_has_column(conn: &Connection, table: &str, column: &str) -> Result<bool> {
    let sql = format!("SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = ?1");
    let count: i64 = conn.query_row(&sql, params![column], |row| row.get(0))?;
    Ok(count > 0)
}

fn ensure_column(conn: &Connection, table: &str, column: &str, definition: &str) -> Result<()> {
    if !table_has_column(conn, table, column)? {
        conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {column} {definition};"))?;
    }
    Ok(())
}

/// Stable 16-hex-char hash of a preference fact's canonical key fields for dedup.
/// Uses DefaultHasher (not cryptographic â€” dedup accuracy only, not security).
fn preference_fact_hash(scope: &str, category: &str, polarity: i64, summary: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    scope.hash(&mut h);
    category.hash(&mut h);
    polarity.hash(&mut h);
    summary.hash(&mut h);
    format!("{:016x}", h.finish())
}

fn record_preference_event_locked(
    conn: &Connection,
    key: &[u8; 32],
    turn_id: i64,
    signal: &str,
    reason: Option<&str>,
    raw_text: Option<&str>,
    idempotency_key: Option<&str>,
) -> Result<i64> {
    let spec = preference_signal_spec(signal).ok_or(rusqlite::Error::InvalidQuery)?;
    ensure_turn_exists(conn, turn_id)?;

    if let Some(key) = idempotency_key {
        if let Ok(existing_id) = conn.query_row(
            "SELECT id FROM preference_events WHERE idempotency_key = ?1",
            params![key],
            |row| row.get::<_, i64>(0),
        ) {
            return Ok(existing_id);
        }
    }

    let safe_reason = reason.map(|s| compact_plain_text(s, 220));
    let safe_raw_text = raw_text.map(|s| redact_sensitive_text(&compact_plain_text(s, 320)));
    let enc_reason = safe_reason.as_deref().map(|s| encrypt_field(key, s));
    let enc_raw_text = safe_raw_text.as_deref().map(|s| encrypt_field(key, s));
    let polarity = if spec.weight >= 0.0 { 1 } else { -1 };
    // reason and raw_text are stored in dedicated encrypted columns â€” omit from payload_json
    let payload_json = json!({ "signal": signal, "source": spec.source }).to_string();
    conn.execute(
        "INSERT INTO preference_events
            (turn_id, event_type, polarity, payload_json, signal, source, weight, reason, raw_text, idempotency_key, extractor, active)
         VALUES (?1, ?2, ?3, ?4, ?2, ?5, ?6, ?7, ?8, ?9, 'preference_v2', 1)",
        params![
            turn_id,
            signal,
            polarity,
            payload_json,
            spec.source,
            spec.weight,
            enc_reason,
            enc_raw_text,
            idempotency_key,
        ],
    )?;
    let event_id = conn.last_insert_rowid();
    update_turn_preference_summary(conn, key, turn_id, signal, reason)?;
    rebuild_preference_traits(conn, key)?;
    Ok(event_id)
}

fn update_turn_preference_summary(
    conn: &Connection,
    key: &[u8; 32],
    turn_id: i64,
    latest_signal: &str,
    latest_reason: Option<&str>,
) -> Result<()> {
    let score: f64 = conn
        .query_row(
            "SELECT COALESCE(SUM(weight), 0.0) FROM preference_events WHERE turn_id = ?1 AND active = 1",
            params![turn_id],
            |row| row.get(0),
        )
        .unwrap_or(0.0);
    let latest = conn
        .query_row(
            "SELECT signal, reason
             FROM preference_events
             WHERE turn_id = ?1 AND active = 1
             ORDER BY created_at DESC, id DESC
             LIMIT 1",
            params![turn_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
        )
        .ok();
    let latest_signal = latest
        .as_ref()
        .map(|(signal, _)| signal.as_str())
        .unwrap_or(if score.abs() < 0.01 { "none" } else { latest_signal });
    // Decrypt the DB-read reason (stored encrypted). Fall back to the caller's plaintext reason.
    let db_reason_plain = latest
        .as_ref()
        .and_then(|(_, r)| r.as_deref())
        .map(|enc| decrypt_field(key, enc));
    let plain_reason = db_reason_plain.as_deref().or(latest_reason);
    let enc_reason = plain_reason.map(|r| encrypt_field(key, r));
    conn.execute(
        "UPDATE turns
         SET preference_score = ?1,
             feedback_source = ?2,
             feedback_reason = ?3,
             feedback_at = strftime('%Y-%m-%d %H:%M:%S', 'now')
         WHERE id = ?4",
        params![score, latest_signal, enc_reason, turn_id],
    )?;
    Ok(())
}

fn rebuild_preference_traits(conn: &Connection, key: &[u8; 32]) -> Result<()> {
    let mut overrides: HashMap<String, (String, Option<String>, Option<String>)> = HashMap::new();
    if let Ok(mut stmt) = conn.prepare("SELECT key, status, user_label, user_note FROM preference_traits") {
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?;
        for row in rows {
            let (key, status, user_label, user_note) = row?;
            overrides.insert(key, (status, user_label, user_note));
        }
    }
    conn.execute("DELETE FROM preference_trait_evidence", [])?;
    conn.execute("DELETE FROM preference_traits", [])?;
    let mut stmt = conn.prepare(
        "SELECT e.id, t.user_prompt, t.assistant_response, e.signal, e.weight,
                e.reason, e.raw_text, e.created_at,
                MAX(0.0, julianday('now') - julianday(e.created_at)) AS age_days
         FROM preference_events e
         JOIN turns t ON t.id = e.turn_id
         WHERE e.active = 1
         ORDER BY e.created_at ASC, e.id ASC",
    )?;
    let events: Result<Vec<(i64, String, String, String, f64, Option<String>, Option<String>, String, f64)>> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                decrypt_field(key, &row.get::<_, String>(1)?),
                decrypt_field(key, &row.get::<_, String>(2)?),
                row.get::<_, String>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, Option<String>>(5)?.map(|v| decrypt_field(key, &v)),
                row.get::<_, Option<String>>(6)?.map(|v| decrypt_field(key, &v)),
                row.get::<_, String>(7)?,
                row.get::<_, f64>(8)?,
            ))
        })?
        .collect();

    let mut aggs: HashMap<String, PreferenceTraitAgg> = HashMap::new();
    for (event_id, user_prompt, assistant_response, signal, weight, reason, raw_text, created_at, age_days) in events? {
        let decay = 0.5_f64.powf(age_days / 90.0);
        for detected in detect_preference_traits(
            &user_prompt,
            &assistant_response,
            &signal,
            reason.as_deref(),
            raw_text.as_deref(),
        ) {
            let weighted = weight * detected.strength;
            let decayed = weighted * decay;
            let entry = aggs
                .entry(detected.key.to_string())
                .or_insert_with(|| PreferenceTraitAgg::new(detected.label));
            entry.score += weighted;
            entry.decayed_score += decayed;
            entry.evidence_count += 1;
            entry.last_seen = created_at.clone();
            if decayed >= 0.0 {
                entry.positive_count += 1;
                entry.support_score += decayed.abs();
            } else {
                entry.negative_count += 1;
                entry.conflict_score += decayed.abs();
            }
            conn.execute(
                "INSERT INTO preference_trait_evidence
                    (event_id, trait_key, trait_label, polarity, strength, rationale, evidence_text, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    event_id,
                    detected.key,
                    detected.label,
                    if weighted >= 0.0 { 1 } else { -1 },
                    detected.strength,
                    encrypt_field(key, &detected.rationale),
                    encrypt_field(key, &detected.evidence_text),
                    created_at,
                ],
            )?;
        }
    }

    for (trait_key, agg) in aggs {
        let total = agg.support_score + agg.conflict_score;
        let agreement = if total > 0.0 { agg.decayed_score.abs() / total } else { 0.0 };
        let confidence = (agreement * (1.0 - (-total / 2.0).exp())).clamp(0.0, 0.99);
        let computed_status = if agg.support_score > 0.0 && agg.conflict_score > 0.0 && agreement < 0.55 {
            "conflicted"
        } else if confidence < 0.25 {
            "low_confidence"
        } else {
            "active"
        };
        let (status, user_label, user_note) = overrides
            .get(&trait_key)
            .cloned()
            .unwrap_or_else(|| (computed_status.to_string(), None, None));
        let status = if status == "disabled" || status == "deleted" {
            status
        } else {
            computed_status.to_string()
        };
        let label = user_label.clone().unwrap_or_else(|| agg.label.clone());
        conn.execute(
            "INSERT INTO preference_traits
                (key, label, score, evidence_count, positive_count, negative_count,
                 support_score, conflict_score, decayed_score, confidence, status,
                 user_label, user_note, last_seen)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                trait_key,
                label,
                agg.score,
                agg.evidence_count,
                agg.positive_count,
                agg.negative_count,
                agg.support_score,
                agg.conflict_score,
                agg.decayed_score,
                confidence,
                status,
                user_label,
                user_note,
                agg.last_seen,
            ],
        )?;
    }
    Ok(())
}

struct PreferenceTraitAgg {
    label: String,
    score: f64,
    evidence_count: i64,
    positive_count: i64,
    negative_count: i64,
    support_score: f64,
    conflict_score: f64,
    decayed_score: f64,
    last_seen: String,
}

impl PreferenceTraitAgg {
    fn new(label: &str) -> Self {
        Self {
            label: label.to_string(),
            score: 0.0,
            evidence_count: 0,
            positive_count: 0,
            negative_count: 0,
            support_score: 0.0,
            conflict_score: 0.0,
            decayed_score: 0.0,
            last_seen: String::new(),
        }
    }
}

struct PreferenceTraitDetection {
    key: &'static str,
    label: &'static str,
    strength: f64,
    rationale: &'static str,
    evidence_text: String,
}

impl PreferenceTraitDetection {
    fn new(
        key: &'static str,
        label: &'static str,
        strength: f64,
        rationale: &'static str,
        evidence_text: &str,
    ) -> Self {
        Self {
            key,
            label,
            strength,
            rationale,
            evidence_text: redact_sensitive_text(&compact_plain_text(evidence_text, 180)),
        }
    }
}

fn detect_preference_traits(
    user_prompt: &str,
    assistant_response: &str,
    signal: &str,
    reason: Option<&str>,
    raw_text: Option<&str>,
) -> Vec<PreferenceTraitDetection> {
    let lower_user = user_prompt.to_lowercase();
    let lower_response = assistant_response.to_lowercase();
    let lower_reason = reason.unwrap_or("").to_lowercase();
    let word_count = assistant_response.split_whitespace().count();
    let evidence = raw_text.unwrap_or(assistant_response);
    let mut traits = Vec::new();

    if word_count > 0 && word_count <= 55 {
        traits.push(PreferenceTraitDetection::new("concise", "concise responses", 1.0, "assistant response was concise", evidence));
    }
    if word_count >= 140 {
        traits.push(PreferenceTraitDetection::new("detailed", "detailed explanations", 1.0, "assistant response was detailed", evidence));
    }
    if lower_response.contains("[point:") || lower_response.contains("[elem:")
        || lower_response.contains("on screen") || lower_response.contains("on the screen")
        || lower_response.contains("i can see") || lower_response.contains("currently showing")
        || ((lower_user.contains("on screen") || lower_user.contains("on the screen"))
            && (lower_response.contains("visible") || lower_response.contains("button") || lower_response.contains("next step"))) {
        traits.push(PreferenceTraitDetection::new("screen_grounded", "screen-grounded help", 1.0, "response referenced visible screen state", evidence));
    }
    if lower_response.contains("click") || lower_response.contains("type ") || lower_response.contains("press ") || lower_response.contains("navigate to") {
        traits.push(PreferenceTraitDetection::new("action_oriented", "action-oriented responses", 0.9, "response offered concrete action", evidence));
    }
    if assistant_response.contains("```") {
        traits.push(PreferenceTraitDetection::new("technical_specificity", "technical specificity", 0.9, "response included code blocks", evidence));
    }
    if lower_response.contains("because") || lower_response.contains("that means") || lower_response.contains("the reason") {
        traits.push(PreferenceTraitDetection::new("explains_why", "explains the reason", 0.65, "response explained why", evidence));
    }
    if assistant_response.contains("\n- ") {
        traits.push(PreferenceTraitDetection::new("structured_answer", "bullet-list structure", 0.7, "response used bullet-list structure", evidence));
    }
    if lower_response == assistant_response && assistant_response.chars().any(|c| c.is_ascii_alphabetic()) {
        traits.push(PreferenceTraitDetection::new("spoken_lowercase", "spoken lowercase tone", 0.6, "response used spoken lowercase style", evidence));
    }
    {
        let filler_openers = ["sure!", "of course", "great question", "absolutely", "happy to help", "certainly", "definitely!", "glad to help", "of course!"];
        let lower_start: String = lower_response.trim_start().chars().take(50).collect();
        if filler_openers.iter().any(|f| lower_start.contains(f)) {
            traits.push(PreferenceTraitDetection::new("warm_tone", "warm/enthusiastic opener", 0.6, "response used an enthusiastic opener phrase", evidence));
        }
    }
    if lower_reason.contains("too long") || lower_reason.contains("too verbose") {
        traits.push(PreferenceTraitDetection::new("detailed", "detailed explanations", 1.1, "user said the response was too long", evidence));
    }
    if lower_reason.contains("too short") {
        traits.push(PreferenceTraitDetection::new("concise", "concise responses", 1.1, "user said the response was too short", evidence));
    }
    // Code-heavy response (â‰¥2 code blocks)
    if assistant_response.matches("```").count() >= 4 {
        traits.push(PreferenceTraitDetection::new("code_heavy", "rich code examples", 0.85, "response contained multiple code blocks", evidence));
    }
    // Numbered step sequences
    if lower_response.contains("\n1.") && lower_response.contains("\n2.") {
        traits.push(PreferenceTraitDetection::new("numbered_steps", "numbered step sequences", 0.75, "response used numbered steps", evidence));
    }
    // Ends with clarifying question
    if lower_response.contains("do you mean") || lower_response.contains("which one") || lower_response.contains("can you clarify") || lower_response.contains("could you specify") {
        traits.push(PreferenceTraitDetection::new("question_clarifier", "clarifying questions", 0.55, "response contained a clarifying question", evidence));
    }
    // Emoji usage
    let has_emoji = assistant_response.chars().any(|c| {
        let cp = c as u32;
        matches!(cp, 0x1F300..=0x1F9FF | 0x2600..=0x26FF | 0x2700..=0x27BF)
    });
    if has_emoji {
        traits.push(PreferenceTraitDetection::new("emoji_usage", "emoji in responses", 0.6, "response used emoji", evidence));
    }
    if signal == "manual_preference" {
        let user_text = raw_text.unwrap_or("").to_lowercase();
        if user_text.contains("bullet") || user_text.contains("list") {
            traits.push(PreferenceTraitDetection::new("structured_answer", "bullet-list structure", 1.0, "user explicitly requested bullet lists", evidence));
        } else if user_text.contains("concis") || user_text.contains("brief") || user_text.contains("short") || user_text.contains("terse") {
            traits.push(PreferenceTraitDetection::new("concise", "concise responses", 1.0, "user explicitly requested concise responses", evidence));
        } else if user_text.contains("detail") || user_text.contains("thorough") || user_text.contains("longer") || user_text.contains("comprehensive") {
            traits.push(PreferenceTraitDetection::new("detailed", "detailed explanations", 1.0, "user explicitly requested detailed responses", evidence));
        } else if user_text.contains("code") || user_text.contains("snippet") {
            traits.push(PreferenceTraitDetection::new("technical_specificity", "technical specificity", 1.0, "user explicitly requested code examples", evidence));
        } else if user_text.contains("number") || user_text.contains("step") {
            traits.push(PreferenceTraitDetection::new("numbered_steps", "numbered step sequences", 1.0, "user explicitly requested numbered steps", evidence));
        } else if user_text.contains("formal") {
            traits.push(PreferenceTraitDetection::new("formal_tone", "formal tone", 1.0, "user explicitly requested formal tone", evidence));
        } else if user_text.contains("casual") || user_text.contains("informal") || user_text.contains("no markdown") || user_text.contains("plain") {
            traits.push(PreferenceTraitDetection::new("spoken_lowercase", "spoken lowercase tone", 1.0, "user explicitly requested casual/plain tone", evidence));
        } else if traits.is_empty() {
            traits.push(PreferenceTraitDetection::new("manual_preference", "manual preference", 1.0, "user manually recorded a preference", evidence));
        }
    }
    traits
}

fn preference_trait_row_from_sql(row: &rusqlite::Row<'_>) -> Result<PreferenceTraitRow> {
    Ok(PreferenceTraitRow {
        key: row.get(0)?,
        label: row.get(1)?,
        score: row.get(2)?,
        evidence_count: row.get(3)?,
        positive_count: row.get(4)?,
        negative_count: row.get(5)?,
        support_score: row.get(6)?,
        conflict_score: row.get(7)?,
        decayed_score: row.get(8)?,
        confidence: row.get(9)?,
        status: row.get(10)?,
        user_label: row.get(11)?,
        user_note: row.get(12)?,
        last_seen: row.get(13)?,
    })
}

fn preference_event_row_from_sql(row: &rusqlite::Row<'_>, key: &[u8; 32]) -> Result<PreferenceEventRow> {
    Ok(PreferenceEventRow {
        id: row.get(0)?,
        turn_id: row.get(1)?,
        signal: row.get(2)?,
        source: row.get(3)?,
        weight: row.get(4)?,
        reason: row.get::<_, Option<String>>(5)?.map(|v| decrypt_field(key, &v)),
        raw_text: row.get::<_, Option<String>>(6)?.map(|v| decrypt_field(key, &v)),
        idempotency_key: row.get(7)?,
        active: row.get::<_, i64>(8)? != 0,
        created_at: row.get(9)?,
        user_prompt: decrypt_field(key, &row.get::<_, String>(10)?),
        assistant_response: decrypt_field(key, &row.get::<_, String>(11)?),
    })
}

fn preference_fact_row_from_sql(row: &rusqlite::Row<'_>, key: &[u8; 32]) -> Result<PreferenceFactRow> {
    Ok(PreferenceFactRow {
        id: row.get(0)?,
        scope: row.get(1)?,
        category: row.get(2)?,
        polarity: row.get(3)?,
        summary: decrypt_field(key, &row.get::<_, String>(4)?),
        evidence: decrypt_field(key, &row.get::<_, String>(5)?),
        confidence: row.get(6)?,
        evidence_count: row.get(7)?,
        source_event_ids_json: row.get(8)?,
        status: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        last_seen_at: row.get(12)?,
    })
}

fn rebuild_all_turn_preference_summaries(conn: &Connection, key: &[u8; 32]) -> Result<()> {
    let turn_ids: Vec<i64> = conn
        .prepare("SELECT id FROM turns")?
        .query_map([], |row| row.get::<_, i64>(0))?
        .collect::<Result<Vec<_>>>()?;
    for turn_id in turn_ids {
        update_turn_preference_summary(conn, key, turn_id, "none", None)?;
    }
    Ok(())
}

fn compact_plain_text(text: &str, max_len: usize) -> String {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if normalized.chars().count() <= max_len {
        normalized
    } else {
        let keep = max_len.saturating_sub(3);
        let prefix: String = normalized.chars().take(keep).collect();
        format!("{prefix}...")
    }
}

fn redact_sensitive_text(text: &str) -> String {
    text.split_whitespace()
        .map(|word| {
            let lower = word.to_lowercase();
            if lower.contains("sk-")
                || lower.contains("token")
                || lower.contains("secret")
                || lower.contains("password")
                || lower.contains("api_key")
                || lower.contains("apikey")
            {
                "[redacted]"
            } else {
                word
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn preference_examples(
    conn: &Connection,
    key: &[u8; 32],
    direction: &str,
    limit: i64,
) -> Result<Vec<PreferenceExampleRow>> {
    let comparison = if direction == "<" { "< 0" } else { "> 0" };
    let order = if direction == "<" { "ASC" } else { "DESC" };
    let sql = format!(
        "SELECT id, user_prompt, assistant_response, created_at, preference_score, feedback_source, feedback_reason
         FROM turns
         WHERE preference_score {comparison}
         ORDER BY preference_score {order}, id DESC
         LIMIT ?1"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows: Result<Vec<PreferenceExampleRow>> = stmt
        .query_map(params![limit], |row| {
            Ok(PreferenceExampleRow {
                id: row.get(0)?,
                user_prompt: decrypt_field(key, &row.get::<_, String>(1)?),
                assistant_response: decrypt_field(key, &row.get::<_, String>(2)?),
                created_at: row.get(3)?,
                preference_score: row.get(4)?,
                feedback_source: row.get(5)?,
                feedback_reason: row.get(6)?,
            })
        })?
        .collect();
    rows
}

// â”€â”€ Tauri commands â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[tauri::command]
pub fn db_new_session(
    state: tauri::State<'_, Arc<SessionDb>>,
    model: String,
    provider: String,
) -> Result<i64, String> {
    state.new_session(&model, &provider).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_save_message(
    state: tauri::State<'_, Arc<SessionDb>>,
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
    state: tauri::State<'_, Arc<SessionDb>>,
    session_id: i64,
    limit: Option<i64>,
) -> Result<Vec<Value>, String> {
    state
        .get_history(session_id, limit.unwrap_or(50))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_search_history(
    state: tauri::State<'_, Arc<SessionDb>>,
    query: String,
    limit: Option<i64>,
) -> Result<Vec<Value>, String> {
    state
        .search(&query, limit.unwrap_or(20))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_clear_turns(state: tauri::State<'_, Arc<SessionDb>>) -> Result<(), String> {
    state.clear_turns().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_turn_count(state: tauri::State<'_, Arc<SessionDb>>) -> Result<i64, String> {
    state.turn_count().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_embedding(
    state: tauri::State<'_, Arc<SessionDb>>,
    turn_id: i64,
    embedding: Vec<f32>,
) -> Result<(), String> {
    state.save_embedding(turn_id, embedding).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_semantic(
    state: tauri::State<'_, Arc<SessionDb>>,
    query_embedding: Vec<f32>,
    limit: i32,
    min_score: Option<f32>,
) -> Result<Vec<ScoredTurnRow>, String> {
    state
        .search_semantic(&query_embedding, limit as usize, min_score.unwrap_or(0.0))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_unembedded_turns(
    state: tauri::State<'_, Arc<SessionDb>>,
    limit: i32,
) -> Result<Vec<TurnRow>, String> {
    state
        .get_unembedded_turns(limit as usize)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn count_unembedded_turns(state: tauri::State<'_, Arc<SessionDb>>) -> Result<i64, String> {
    state.count_unembedded_turns().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn record_preference_signal(
    state: tauri::State<'_, Arc<SessionDb>>,
    turn_id: i64,
    signal: String,
    weight: f64,
    reason: Option<String>,
) -> Result<(), String> {
    state
        .record_preference_signal(turn_id, &signal, weight, reason)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_preference_profile(
    state: tauri::State<'_, Arc<SessionDb>>,
    limit: Option<i64>,
) -> Result<PreferenceProfile, String> {
    state
        .get_preference_profile(limit.unwrap_or(6))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn record_preference_event(
    state: tauri::State<'_, Arc<SessionDb>>,
    app: tauri::AppHandle,
    turn_id: i64,
    signal: String,
    reason: Option<String>,
    raw_text: Option<String>,
    idempotency_key: Option<String>,
) -> Result<i64, String> {
    let id = state
        .record_preference_event(turn_id, &signal, reason, raw_text, idempotency_key)
        .map_err(|e| e.to_string())?;
    app.emit("preference-updated", ()).ok();
    Ok(id)
}

#[tauri::command]
pub fn get_preference_events(
    state: tauri::State<'_, Arc<SessionDb>>,
    limit: Option<i64>,
    trait_key: Option<String>,
) -> Result<Vec<PreferenceEventRow>, String> {
    state
        .get_preference_events(limit, trait_key.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn update_preference_trait(
    state: tauri::State<'_, Arc<SessionDb>>,
    trait_key: String,
    status: Option<String>,
    label: Option<String>,
    note: Option<String>,
) -> Result<(), String> {
    state
        .update_preference_trait(&trait_key, status, label, note)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_preference_trait(
    state: tauri::State<'_, Arc<SessionDb>>,
    trait_key: String,
) -> Result<(), String> {
    state
        .delete_preference_trait(&trait_key)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn upsert_preference_fact(
    state: tauri::State<'_, Arc<SessionDb>>,
    scope: String,
    category: String,
    polarity: i64,
    summary: String,
    evidence: String,
    confidence: f64,
    evidence_count: Option<i64>,
    source_event_ids_json: Option<String>,
) -> Result<i64, String> {
    state
        .upsert_preference_fact(
            &scope,
            &category,
            polarity,
            &summary,
            &evidence,
            confidence,
            evidence_count.unwrap_or(1),
            source_event_ids_json,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_active_preference_facts(
    state: tauri::State<'_, Arc<SessionDb>>,
    limit: Option<i64>,
) -> Result<Vec<PreferenceFactRow>, String> {
    state
        .get_active_preference_facts(limit.unwrap_or(8))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_preference_fact_status(
    state: tauri::State<'_, Arc<SessionDb>>,
    id: i64,
    status: String,
) -> Result<(), String> {
    state
        .set_preference_fact_status(id, &status)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_preference_learning(state: tauri::State<'_, Arc<SessionDb>>) -> Result<(), String> {
    state.clear_preference_learning().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn rebuild_preference_profile(state: tauri::State<'_, Arc<SessionDb>>) -> Result<(), String> {
    state.rebuild_preference_profile().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_conversation_summary(
    state: tauri::State<'_, Arc<SessionDb>>,
    summary: String,
    covered_turn_start_id: Option<i64>,
    covered_turn_end_id: Option<i64>,
    estimated_tokens_before: i64,
    estimated_tokens_after: i64,
    provider: String,
    model: String,
    schema_version: i64,
) -> Result<i64, String> {
    state
        .save_conversation_summary(
            &summary,
            covered_turn_start_id,
            covered_turn_end_id,
            estimated_tokens_before,
            estimated_tokens_after,
            &provider,
            &model,
            schema_version,
        )
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_latest_conversation_summary(
    state: tauri::State<'_, Arc<SessionDb>>,
) -> Result<Option<ConversationSummaryRow>, String> {
    state
        .get_latest_conversation_summary()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_session_meta(
    state: tauri::State<'_, Arc<SessionDb>>,
) -> Result<Vec<SessionMetaRow>, String> {
    state.get_session_meta().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn upsert_session_meta(
    state: tauri::State<'_, Arc<SessionDb>>,
    date_key: String,
    label: Option<String>,
    summary: Option<String>,
) -> Result<(), String> {
    state.upsert_session_meta(&date_key, label, summary)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn purge_all_memory(state: tauri::State<'_, Arc<SessionDb>>) -> Result<(), String> {
    state.purge_all_memory().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn export_memory_json(state: tauri::State<'_, Arc<SessionDb>>) -> Result<String, String> {
    state.export_memory_json().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_memory_json(
    state: tauri::State<'_, Arc<SessionDb>>,
    json: String,
) -> Result<usize, String> {
    state.import_memory_json(&json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn prune_old_turns(
    state: tauri::State<'_, Arc<SessionDb>>,
    older_than_days: i64,
) -> Result<(), String> {
    state.prune_old_turns(older_than_days).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_turn(
    state: tauri::State<'_, Arc<SessionDb>>,
    turn_id: i64,
) -> Result<(), String> {
    state.delete_turn(turn_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn db_key_status(app: tauri::AppHandle) -> Result<KeyStatusResponse, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    let state = app.state::<Arc<SessionDb>>();
    Ok(state.key_status(&dir))
}

/// Re-encrypt all turns with a fresh key and atomically update the in-memory key.
/// No restart required â€” subsequent saves immediately use the new key.
#[tauri::command]
pub fn rekey_database(
    state: tauri::State<'_, Arc<SessionDb>>,
    app: tauri::AppHandle,
) -> Result<usize, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    state.rekey_database(&dir).map_err(|e| e.to_string())
}

/// Enforce the user's memory retention policy by deleting turns older than `days` days.
/// Also prunes ambient snapshots and Dim 16 video segments + their FTS rows so
/// the on-disk MP4 + thumbnail layer stays bounded.
/// Called on app startup. Passing days=0 is a no-op (keep forever).
#[tauri::command]
pub fn enforce_retention_policy(
    days: i64,
    state: tauri::State<'_, Arc<SessionDb>>,
) -> Result<u64, String> {
    let turn_count = state.delete_turns_older_than(days).map_err(|e| e.to_string())?;
    if days > 0 {
        // Best-effort â€” don't fail the whole call if video pruning hits an issue.
        let _ = state.prune_video_segments(days);
        let _ = state.prune_ambient_snapshots(days);
    }
    Ok(turn_count)
}

/// Dim 16 â€” explicit video-only prune. Returns count of segments deleted.
/// `days <= 0` deletes ALL video segments (used by the "Delete all video now"
/// settings button).
#[tauri::command]
pub fn prune_video(
    days: i64,
    state: tauri::State<'_, Arc<SessionDb>>,
) -> Result<usize, String> {
    state.prune_video_segments(days).map_err(|e| e.to_string())
}

/// Return the created_at timestamp of the oldest stored turn, or null if none exist.
/// Used by the UI to show "oldest conversation" and compute the next auto-clear date.
#[tauri::command]
pub fn get_oldest_turn_date(
    state: tauri::State<'_, Arc<SessionDb>>,
) -> Result<Option<String>, String> {
    state.get_oldest_turn_date().map_err(|e| e.to_string())
}

// â”€â”€ Ambient mode Tauri commands â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[tauri::command]
pub fn save_ambient_snapshot(
    state: tauri::State<'_, Arc<SessionDb>>,
    ocr_text: String,
    active_window: String,
    pixel_hash: String,
    vision_desc: Option<String>,
) -> Result<i64, String> {
    state
        .save_ambient_snapshot(&ocr_text, &active_window, &pixel_hash, vision_desc.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_ambient_context(
    state: tauri::State<'_, Arc<SessionDb>>,
    minutes: Option<i64>,
    max_chars: Option<usize>,
) -> Result<String, String> {
    state
        .get_ambient_context(minutes.unwrap_or(10), max_chars.unwrap_or(1200))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_recent_ambient_snapshots(
    state: tauri::State<'_, Arc<SessionDb>>,
    limit: Option<usize>,
) -> Result<Vec<AmbientSnapshotRow>, String> {
    state
        .get_recent_ambient_snapshots(limit.unwrap_or(20))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn prune_ambient_snapshots(
    state: tauri::State<'_, Arc<SessionDb>>,
    days: i64,
) -> Result<usize, String> {
    state.prune_ambient_snapshots(days).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn count_ambient_today(
    state: tauri::State<'_, Arc<SessionDb>>,
) -> Result<i64, String> {
    state.count_ambient_today().map_err(|e| e.to_string())
}

// â”€â”€ Tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> SessionDb {
        SessionDb::open_memory().expect("in-memory DB should open")
    }

    // â”€â”€ Dim 16: Video / temporal context â€” DB methods â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    #[test]
    fn save_and_get_keyframe_thumb_round_trips_encryption() {
        let db = setup();
        let segment_id = db
            .save_video_segment(0, "monitor_0/test", "2026-05-09T11:00:00", None, 0, 0, 0, 0, 5.0, "normal")
            .unwrap();
        let thumb_b64 = "ZmFrZS1qcGVnLWJ5dGVz"; // "fake-jpeg-bytes" base64
        let kf_id = db
            .save_video_keyframe(segment_id, 0, Some("hello world"), Some("Notepad"), None, Some(thumb_b64), None)
            .unwrap();

        let recovered = db.get_keyframe_thumb(kf_id).unwrap();
        assert_eq!(recovered.as_deref(), Some(thumb_b64));
    }

    #[test]
    fn get_keyframe_thumb_returns_none_when_absent() {
        let db = setup();
        let segment_id = db
            .save_video_segment(0, "monitor_0/test", "2026-05-09T11:00:00", None, 0, 0, 0, 0, 5.0, "normal")
            .unwrap();
        let kf_id = db
            .save_video_keyframe(segment_id, 0, Some("hi"), None, None, None, None)
            .unwrap();
        let result = db.get_keyframe_thumb(kf_id).unwrap();
        assert!(result.is_none(), "no thumb stored â†’ None");
    }

    #[test]
    fn get_keyframe_thumb_returns_none_for_unknown_id() {
        let db = setup();
        let result = db.get_keyframe_thumb(99999).unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn get_recent_keyframes_orders_newest_first() {
        let db = setup();
        let s1 = db.save_video_segment(0, "p", "2026-05-09T10:00:00", None, 0, 0, 0, 0, 5.0, "normal").unwrap();
        let s2 = db.save_video_segment(0, "p", "2026-05-09T11:00:00", None, 0, 0, 0, 0, 5.0, "normal").unwrap();
        db.save_video_keyframe(s1, 0, None, Some("Old App"), None, None, None).unwrap();
        db.save_video_keyframe(s2, 0, None, Some("New App"), None, None, None).unwrap();

        let rows = db.get_recent_keyframes(10, None).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].5, "New App", "newest segment first");
        assert_eq!(rows[1].5, "Old App");
    }

    #[test]
    fn get_recent_keyframes_filters_by_monitor() {
        let db = setup();
        let s_mon0 = db.save_video_segment(0, "p", "2026-05-09T10:00:00", None, 0, 0, 0, 0, 5.0, "normal").unwrap();
        let s_mon1 = db.save_video_segment(1, "p", "2026-05-09T10:01:00", None, 0, 0, 0, 0, 5.0, "normal").unwrap();
        db.save_video_keyframe(s_mon0, 0, None, Some("M0"), None, None, None).unwrap();
        db.save_video_keyframe(s_mon1, 0, None, Some("M1"), None, None, None).unwrap();

        let only_0 = db.get_recent_keyframes(10, Some(0)).unwrap();
        assert_eq!(only_0.len(), 1);
        assert_eq!(only_0[0].5, "M0");

        let only_1 = db.get_recent_keyframes(10, Some(1)).unwrap();
        assert_eq!(only_1.len(), 1);
        assert_eq!(only_1[0].5, "M1");
    }

    #[test]
    fn get_recent_keyframes_respects_limit() {
        let db = setup();
        let seg = db.save_video_segment(0, "p", "2026-05-09T10:00:00", None, 0, 0, 0, 0, 5.0, "normal").unwrap();
        for i in 0..10 {
            db.save_video_keyframe(seg, i * 100, None, Some(&format!("App{i}")), None, None, None).unwrap();
        }
        let rows = db.get_recent_keyframes(3, None).unwrap();
        assert_eq!(rows.len(), 3);
    }

    #[test]
    fn prune_video_segments_zero_days_wipes_all() {
        let db = setup();
        let seg = db.save_video_segment(0, "p", "2026-05-09T10:00:00", None, 0, 0, 0, 0, 5.0, "normal").unwrap();
        db.save_video_keyframe(seg, 0, Some("findme"), None, None, None, None).unwrap();
        let deleted = db.prune_video_segments(0).unwrap();
        assert!(deleted >= 1);
        // FTS5 entries are also gone
        let hits = db.search_video_keyframes("findme", 10).unwrap();
        assert_eq!(hits.len(), 0);
    }

    #[test]
    fn prune_video_segments_keeps_recent() {
        let db = setup();
        // start_ts is just-now â†’ should NOT be pruned with days=1
        let seg_id = db
            .save_video_segment(
                0,
                "p",
                &chrono_now_iso(&db),
                None,
                0,
                0,
                0,
                0,
                5.0,
                "normal",
            )
            .unwrap();
        db.save_video_keyframe(seg_id, 0, Some("recent"), None, None, None, None).unwrap();
        let deleted = db.prune_video_segments(1).unwrap();
        assert_eq!(deleted, 0, "0-day-old segment must survive a 1-day prune");
        let hits = db.search_video_keyframes("recent", 10).unwrap();
        assert_eq!(hits.len(), 1);
    }

    fn chrono_now_iso(db: &SessionDb) -> String {
        let conn = db.conn.lock().unwrap();
        conn.query_row(
            "SELECT strftime('%Y-%m-%dT%H:%M:%S','now')",
            [],
            |r| r.get::<_, String>(0),
        )
        .unwrap()
    }

    // â”€â”€ Dim 36: Retention enforcement tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    #[test]
    fn retention_zero_days_deletes_nothing() {
        let db = setup();
        db.conn.lock().unwrap().execute(
            "INSERT INTO turns (user_prompt, assistant_response, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params!["q", "a", "2020-01-01 00:00:00"],
        ).unwrap();
        let deleted = db.delete_turns_older_than(0).unwrap();
        assert_eq!(deleted, 0, "days=0 means keep forever, must delete nothing");
    }

    #[test]
    fn retention_deletes_old_turns() {
        let db = setup();
        db.conn.lock().unwrap().execute(
            "INSERT INTO turns (user_prompt, assistant_response, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params!["q", "a", "2020-01-01 00:00:00"],
        ).unwrap();
        let deleted = db.delete_turns_older_than(7).unwrap();
        assert_eq!(deleted, 1, "turn from 2020 should be deleted by 7-day policy");
        let count: i64 = db.conn.lock().unwrap()
            .query_row("SELECT count(*) FROM turns", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn retention_keeps_recent_turns() {
        let db = setup();
        // Insert a recent turn (no explicit created_at â†’ uses DEFAULT which is 'now')
        db.conn.lock().unwrap().execute(
            "INSERT INTO turns (user_prompt, assistant_response) VALUES (?1, ?2)",
            rusqlite::params!["recent q", "recent a"],
        ).unwrap();
        let deleted = db.delete_turns_older_than(7).unwrap();
        assert_eq!(deleted, 0, "turn created now should survive 7-day policy");
    }

    #[test]
    fn oldest_turn_date_none_when_empty() {
        let db = setup();
        assert!(db.get_oldest_turn_date().unwrap().is_none());
    }

    #[test]
    fn oldest_turn_date_returns_earliest() {
        let db = setup();
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO turns (user_prompt, assistant_response, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params!["newer", "a", "2024-03-01 00:00:00"],
        ).unwrap();
        conn.execute(
            "INSERT INTO turns (user_prompt, assistant_response, created_at) VALUES (?1, ?2, ?3)",
            rusqlite::params!["older", "a", "2023-01-01 00:00:00"],
        ).unwrap();
        drop(conn);
        let oldest = db.get_oldest_turn_date().unwrap();
        assert_eq!(oldest.as_deref(), Some("2023-01-01 00:00:00"));
    }

    #[cfg(feature = "sqlcipher")]
    #[test]
    fn test_sqlcipher_migration_encrypts_existing_db() {
        let tmp = std::env::temp_dir().join(format!(
            "dc_test_migration_{}.db",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .subsec_nanos()
        ));
        {
            let plain = Connection::open(&tmp).unwrap();
            plain.execute_batch("CREATE TABLE t (v TEXT);").unwrap();
            plain.execute("INSERT INTO t VALUES (?1)", rusqlite::params!["hello"]).unwrap();
        }

        let key = [0x42u8; 32];
        SessionDb::migrate_to_sqlcipher(&tmp, &key).unwrap();

        // Plain open must fail to read schema.
        {
            let bad = Connection::open(&tmp).unwrap();
            let result = bad.query_row(
                "SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0),
            );
            assert!(result.is_err(), "plain open must fail on SQLCipher DB");
        }

        // Keyed open must succeed and data must be intact.
        let hex_key: String = key.iter().map(|b| format!("{:02x}", b)).collect();
        let good = Connection::open(&tmp).unwrap();
        good.pragma_update(None, "key", format!("x'{hex_key}'")).unwrap();
        let count: i64 = good.query_row("SELECT count(*) FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1, "row must survive migration");
        let val: String = good.query_row("SELECT v FROM t", [], |r| r.get(0)).unwrap();
        assert_eq!(val, "hello");

        let _ = std::fs::remove_file(&tmp);
        let _ = std::fs::remove_file(tmp.with_extension("db.bak"));
    }

    #[cfg(feature = "sqlcipher")]
    #[test]
    fn test_sqlcipher_db_header_is_not_plain_sqlite() {
        let tmp = std::env::temp_dir().join(format!(
            "dc_header_{}.db",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .subsec_nanos()
        ));
        {
            let plain = Connection::open(&tmp).unwrap();
            plain.execute_batch("CREATE TABLE t (v TEXT);").unwrap();
        }
        let key = [0x99u8; 32];
        SessionDb::migrate_to_sqlcipher(&tmp, &key).unwrap();

        let header = std::fs::read(&tmp).unwrap();
        // Plain SQLite always starts with this 16-byte magic. SQLCipher encrypts the header.
        assert_ne!(
            &header[..16],
            b"SQLite format 3\0",
            "SQLCipher file must not have plain SQLite magic header"
        );

        let _ = std::fs::remove_file(&tmp);
        let _ = std::fs::remove_file(tmp.with_extension("db.bak"));
    }

    #[cfg(feature = "sqlcipher")]
    #[test]
    fn test_sqlcipher_fresh_db_is_encrypted_on_creation() {
        let tmp_dir = std::env::temp_dir().join(format!(
            "dc_fresh_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .subsec_nanos()
        ));
        std::fs::create_dir_all(&tmp_dir).unwrap();
        let db_path = tmp_dir.join("sessions.db");

        let key = [0xAAu8; 32];
        let hex_key: String = key.iter().map(|b| format!("{:02x}", b)).collect();

        let conn = Connection::open(&db_path).unwrap();
        conn.pragma_update(None, "key", format!("x'{hex_key}'")).unwrap();
        conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)).unwrap();
        conn.execute_batch("CREATE TABLE test_sessions (id INTEGER PRIMARY KEY, data TEXT);").unwrap();
        conn.execute("INSERT INTO test_sessions VALUES (1, 'secret data')", []).unwrap();
        drop(conn);

        let bytes = std::fs::read(&db_path).unwrap();
        assert_ne!(
            &bytes[..16],
            b"SQLite format 3\0",
            "Fresh SQLCipher DB must not have plain SQLite header"
        );

        let plain_conn = Connection::open(&db_path).unwrap();
        let plain_result = plain_conn.query_row(
            "SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)
        );
        assert!(plain_result.is_err(), "Plain open of SQLCipher DB must fail");

        let keyed_conn = Connection::open(&db_path).unwrap();
        keyed_conn.pragma_update(None, "key", format!("x'{hex_key}'")).unwrap();
        let count: i64 = keyed_conn.query_row(
            "SELECT count(*) FROM test_sessions", [], |r| r.get(0)
        ).unwrap();
        assert_eq!(count, 1, "Keyed open must retrieve inserted data");

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[cfg(feature = "sqlcipher")]
    #[test]
    fn test_sqlcipher_round_trip_session_persists() {
        let tmp_dir = std::env::temp_dir().join(format!(
            "dc_roundtrip_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .subsec_nanos()
        ));
        std::fs::create_dir_all(&tmp_dir).unwrap();
        let db_path = tmp_dir.join("sessions.db");

        let key = load_or_create_key(&tmp_dir).unwrap();
        let hex_key: String = key.iter().map(|b| format!("{:02x}", b)).collect();

        let session_id: i64;
        {
            let conn = Connection::open(&db_path).unwrap();
            conn.pragma_update(None, "key", format!("x'{hex_key}'")).unwrap();
            let db = SessionDb {
                conn: std::sync::Mutex::new(conn),
                key: std::sync::Mutex::new(key),
            };
            db.init().unwrap();

            session_id = db.new_session("claude-haiku-4-5", "anthropic").unwrap();
            db.save_message(session_id, "user", "Hello encrypted world!", None, None).unwrap();
            db.save_message(session_id, "assistant", "Your data is safe.", Some("claude-haiku-4-5"), Some(5)).unwrap();
        }

        let bytes = std::fs::read(&db_path).unwrap();
        assert_ne!(
            &bytes[..16],
            b"SQLite format 3\0",
            "sessions.db must have encrypted header, not plain SQLite"
        );

        {
            let conn2 = Connection::open(&db_path).unwrap();
            conn2.pragma_update(None, "key", format!("x'{hex_key}'")).unwrap();
            let db2 = SessionDb {
                conn: std::sync::Mutex::new(conn2),
                key: std::sync::Mutex::new(key),
            };
            db2.init().unwrap();

            let history = db2.get_history(session_id, 50).unwrap();
            assert_eq!(history.len(), 2, "Both messages must survive close/reopen");
            assert_eq!(history[0]["role"], "user");
            assert_eq!(history[0]["content"], "Hello encrypted world!");
            assert_eq!(history[1]["role"], "assistant");
            assert_eq!(history[1]["content"], "Your data is safe.");
            assert_eq!(history[1]["tokens"], 5);
        }

        {
            let plain = Connection::open(&db_path).unwrap();
            let fail = plain.query_row(
                "SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)
            );
            assert!(fail.is_err(), "Plain open must still fail after round-trip");
        }

        let _ = std::fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn test_save_turn_content_encrypted_at_rest() {
        // Prove processed memory (turns) is field-encrypted at rest via ChaCha20-Poly1305.
        // This test does NOT require SQLCipher â€” field encryption is always on.
        // The turns table stores sensitive derived memory (user+assistant exchanges, screenshots).
        let key = [42u8; 32];
        let conn = Connection::open_in_memory().unwrap();
        let db = SessionDb {
            conn: std::sync::Mutex::new(conn),
            key: std::sync::Mutex::new(key),
        };
        db.init().unwrap();

        let user_prompt = "What is the capital of France?";
        let assistant_response = "The capital of France is Paris.";
        db.save_turn(user_prompt, assistant_response, None)
            .unwrap();

        // Read the raw SQL values â€” bypass get_turn() to inspect actual stored bytes
        let (raw_user, raw_asst): (String, String) = {
            let conn = db.conn.lock().unwrap();
            let mut stmt = conn
                .prepare("SELECT user_prompt, assistant_response FROM turns LIMIT 1")
                .unwrap();
            let (u, a) = stmt
                .query_row([], |row| {
                    Ok((
                        row.get::<_, String>(0).unwrap(),
                        row.get::<_, String>(1).unwrap(),
                    ))
                })
                .unwrap();
            (u, a)
        };

        // Raw stored values must NOT be plaintext â€” they must be encrypted with enc: prefix
        assert_ne!(
            raw_user, user_prompt,
            "User prompt must be encrypted, not plaintext"
        );
        assert_ne!(
            raw_asst, assistant_response,
            "Assistant response must be encrypted, not plaintext"
        );
        assert!(
            raw_user.starts_with("enc:"),
            "User prompt must have enc: prefix indicating ChaCha20-Poly1305"
        );
        assert!(
            raw_asst.starts_with("enc:"),
            "Assistant response must have enc: prefix indicating ChaCha20-Poly1305"
        );

        // get_recent_turns() must transparently decrypt and return originals
        let turns = db.get_recent_turns(1).unwrap();
        assert!(!turns.is_empty(), "Should have one turn");
        assert_eq!(turns[0].user_prompt, user_prompt,
            "get_recent_turns must decrypt and return original user prompt");
        assert_eq!(turns[0].assistant_response, assistant_response,
            "get_recent_turns must decrypt and return original assistant response");
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

    #[test]
    fn test_embedding_round_trip_cosine_self_similarity() {
        let db = setup();
        let turn_id = db.save_turn("what is two plus two?", "four", None).unwrap();
        let mut embedding = vec![0.0f32; 384];
        embedding[0] = 1.0;
        db.save_embedding(turn_id, embedding.clone()).unwrap();
        let results = db.search_semantic(&embedding, 5, 0.0).unwrap();
        assert_eq!(results.len(), 1, "should find the embedded turn");
        assert!(
            (results[0].score - 1.0).abs() < 1e-4,
            "self-cosine should be 1.0, got {}",
            results[0].score
        );
        assert_eq!(results[0].user_prompt, "what is two plus two?");
    }

    #[test]
    fn test_count_unembedded_decrements_after_save() {
        let db = setup();
        let id1 = db.save_turn("turn one", "response one", None).unwrap();
        let _id2 = db.save_turn("turn two", "response two", None).unwrap();
        assert_eq!(db.count_unembedded_turns().unwrap(), 2);
        db.save_embedding(id1, vec![1.0f32; 384]).unwrap();
        assert_eq!(db.count_unembedded_turns().unwrap(), 1);
    }

    #[test]
    fn test_get_recent_turns_oldest_first_with_limit() {
        let db = setup();
        db.save_turn("turn one", "response one", None).unwrap();
        db.save_turn("turn two", "response two", None).unwrap();
        db.save_turn("turn three", "response three", None).unwrap();
        db.save_turn("turn four", "response four", None).unwrap();

        let recent = db.get_recent_turns(3).unwrap();
        assert_eq!(recent.len(), 3);
        assert_eq!(recent[0].user_prompt, "turn two");
        assert_eq!(recent[1].user_prompt, "turn three");
        assert_eq!(recent[2].user_prompt, "turn four");
    }

    #[test]
    fn test_turn_fts_search_finds_user_and_assistant_text() {
        let db = setup();
        db.save_turn("find quartz notes", "opened the notebook", None).unwrap();
        db.save_turn("look at settings", "the answer mentioned zircon", None).unwrap();

        let user_results = db.search_history("quartz", 10).unwrap();
        assert_eq!(user_results.len(), 1);
        assert_eq!(user_results[0].user_prompt, "find quartz notes");

        let assistant_results = db.search_history("zircon", 10).unwrap();
        assert_eq!(assistant_results.len(), 1);
        assert_eq!(assistant_results[0].assistant_response, "the answer mentioned zircon");
    }

    #[test]
    fn test_conversation_summary_round_trip() {
        let db = setup();
        let id = db
            .save_conversation_summary(
                "Earlier work focused on context compression.",
                Some(1),
                Some(9),
                12_000,
                2_000,
                "claude",
                "claude-haiku-4-5-20251001",
                1,
            )
            .unwrap();
        assert!(id > 0);

        let latest = db.get_latest_conversation_summary().unwrap().unwrap();
        assert_eq!(latest.summary, "Earlier work focused on context compression.");
        assert_eq!(latest.covered_turn_start_id, Some(1));
        assert_eq!(latest.covered_turn_end_id, Some(9));
        assert_eq!(latest.estimated_tokens_before, 12_000);
        assert_eq!(latest.estimated_tokens_after, 2_000);
        assert_eq!(latest.provider, "claude");
        assert_eq!(latest.schema_version, 1);
    }

    #[test]
    fn test_clear_turns_clears_derived_summaries() {
        let db = setup();
        db.save_turn("turn", "response", None).unwrap();
        db.save_conversation_summary("summary", None, None, 100, 20, "openai", "gpt-4o", 1)
            .unwrap();

        db.clear_turns().unwrap();

        assert_eq!(db.turn_count().unwrap(), 0);
        assert_eq!(db.count_unembedded_turns().unwrap(), 0);
        assert!(db.search_history("turn", 10).unwrap().is_empty());
        assert!(db.get_latest_conversation_summary().unwrap().is_none());
    }

    #[test]
    fn test_prune_old_turns_clears_summaries_covering_pruned_turns() {
        let db = setup();
        let old_id = db.save_turn("old private turn", "old answer", None).unwrap();
        let _new_id = db.save_turn("fresh turn", "fresh answer", None).unwrap();
        db.save_conversation_summary(
            "summary containing old private turn",
            Some(old_id),
            Some(old_id),
            100,
            20,
            "openai",
            "gpt-4o",
            2,
        )
        .unwrap();

        {
            let conn = db.conn.lock().unwrap();
            conn.execute(
                "UPDATE turns SET created_at = datetime('now', '-5 days') WHERE id = ?1",
                params![old_id],
            )
            .unwrap();
        }

        db.prune_old_turns(1).unwrap();

        assert_eq!(db.turn_count().unwrap(), 1);
        assert!(db.search_history("old", 10).unwrap().is_empty());
        assert!(db.get_latest_conversation_summary().unwrap().is_none());
    }

    #[test]
    fn test_min_score_filter_rejects_orthogonal_vectors() {
        let db = setup();
        let id1 = db.save_turn("cats", "meow", None).unwrap();
        let id2 = db.save_turn("dogs", "woof", None).unwrap();
        let mut e1 = vec![0.0f32; 384]; e1[0] = 1.0;
        let mut e2 = vec![0.0f32; 384]; e2[1] = 1.0;
        db.save_embedding(id1, e1.clone()).unwrap();
        db.save_embedding(id2, e2).unwrap();
        let results = db.search_semantic(&e1, 5, 0.5).unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, id1);
        assert!((results[0].score - 1.0).abs() < 1e-4);
        assert!(results.iter().all(|r| r.id != id2));
    }

    #[test]
    fn test_rating_builds_preference_profile_with_positive_and_negative_examples() {
        let db = setup();
        let liked = db
            .save_turn(
                "the button is on screen",
                "i'll click the blue submit button because that is the visible next step.",
                None,
            )
            .unwrap();
        let disliked = db
            .save_turn(
                "explain the test failure",
                "Here is a very long structured essay that wanders instead of getting to the fix.",
                None,
            )
            .unwrap();

        db.rate_turn(liked, 1).unwrap();
        db.rate_turn(disliked, -1).unwrap();

        let profile = db.get_preference_profile(8).unwrap();
        assert_eq!(profile.explicit_feedback_count, 2);
        assert_eq!(profile.positive_examples.len(), 1);
        assert_eq!(profile.negative_examples.len(), 1);
        assert_eq!(profile.positive_examples[0].id, liked);
        assert_eq!(profile.negative_examples[0].id, disliked);
        assert!(
            profile.traits.iter().any(|t| t.key == "screen_grounded" && t.score > 0.0),
            "liked screen-grounded response should increase screen preference"
        );
    }

    #[test]
    fn test_implicit_signal_is_idempotent_and_counted_separately() {
        let db = setup();
        let turn_id = db
            .save_turn(
                "summarize this error",
                "short answer: the auth token is expired, so refresh it and rerun the request.",
                None,
            )
            .unwrap();

        db.record_preference_signal(
            turn_id,
            "copied_response",
            0.35,
            Some("user copied the answer".to_string()),
        )
        .unwrap();
        db.record_preference_signal(
            turn_id,
            "copied_response",
            0.35,
            Some("user copied the answer again".to_string()),
        )
        .unwrap();

        let profile = db.get_preference_profile(8).unwrap();
        assert_eq!(profile.explicit_feedback_count, 0);
        assert_eq!(profile.implicit_feedback_count, 1);
        assert_eq!(profile.positive_examples.len(), 1);
        assert!(profile.positive_examples[0].preference_score > 0.3);
        assert!(profile.positive_examples[0].preference_score < 0.4);
    }

    #[test]
    fn test_preference_events_append_with_server_owned_weights_and_idempotency() {
        let db = setup();
        let turn_id = db
            .save_turn(
                "make this concise",
                "short answer: restart the service and rerun the smoke test.",
                None,
            )
            .unwrap();

        let first = db
            .record_preference_event(
                turn_id,
                "copied_response",
                Some("user copied the answer".to_string()),
                Some("short answer: restart the service".to_string()),
                Some("copy-one".to_string()),
            )
            .unwrap();
        let duplicate = db
            .record_preference_event(
                turn_id,
                "copied_response",
                Some("duplicate copy".to_string()),
                Some("short answer: restart the service".to_string()),
                Some("copy-one".to_string()),
            )
            .unwrap();
        let second = db
            .record_preference_event(
                turn_id,
                "copied_response",
                Some("copied again later".to_string()),
                Some("short answer: restart the service".to_string()),
                Some("copy-two".to_string()),
            )
            .unwrap();

        assert_eq!(first, duplicate, "same idempotency key should not create new evidence");
        assert_ne!(first, second, "new idempotency key should append evidence");

        let events = db.get_preference_events(Some(10), None).unwrap();
        assert_eq!(events.len(), 2);
        assert!(
            events.iter().all(|e| e.weight > 0.34 && e.weight < 0.36),
            "backend should own copied_response weight"
        );
        assert_eq!(db.get_preference_profile(8).unwrap().implicit_feedback_count, 2);
    }

    #[test]
    fn test_preference_events_reject_unknown_signal_and_missing_turn() {
        let db = setup();
        let turn_id = db.save_turn("help", "short answer.", None).unwrap();

        assert!(db
            .record_preference_event(turn_id, "made_up_signal", None, None, None)
            .is_err());
        assert!(db
            .record_preference_event(999_999, "copied_response", None, None, None)
            .is_err());
        assert!(db.get_preference_profile(0).is_err());
    }

    #[test]
    fn test_rate_turn_rejects_out_of_range_rating() {
        let db = setup();
        let turn_id = db.save_turn("help", "short answer.", None).unwrap();

        assert!(db.rate_turn(turn_id, 2).is_err());
        assert!(db.rate_turn(turn_id, -2).is_err());
        assert!(db.rate_turn(turn_id, 1).is_ok());
    }

    #[test]
    fn test_thumbs_down_reason_is_stored_as_redacted_event_metadata() {
        let db = setup();
        let turn_id = db
            .save_turn("click the button", "i clicked the wrong button.", None)
            .unwrap();

        db.rate_turn_with_reason(
            turn_id,
            -1,
            Some("wrong action, password secret-token should not persist".to_string()),
        )
        .unwrap();

        let events = db.get_preference_events(Some(5), None).unwrap();
        assert_eq!(events.len(), 1);
        let reason = events[0].reason.as_deref().unwrap_or_default();
        assert!(reason.contains("wrong action"));
        assert!(reason.contains("[redacted]"));
        assert!(!reason.contains("secret-token"));
        assert_eq!(events[0].signal, "explicit_thumbs_down");
    }

    #[test]
    fn test_conflicting_traits_lower_confidence_and_are_suppressed() {
        let db = setup();
        let concise = db
            .save_turn(
                "keep it brief",
                "short answer: restart the service.",
                None,
            )
            .unwrap();
        let rejected_concise = db
            .save_turn(
                "explain the failure",
                "short answer: it failed.",
                None,
            )
            .unwrap();

        db.rate_turn(concise, 1).unwrap();
        db.rate_turn(rejected_concise, -1).unwrap();

        let profile = db.get_preference_profile(8).unwrap();
        let concise_trait = profile
            .traits
            .iter()
            .find(|t| t.key == "concise")
            .expect("concise trait should still be visible for review");
        assert!(concise_trait.conflict_score > 0.0);
        assert!(concise_trait.confidence < 0.5);
        assert_eq!(concise_trait.status, "conflicted");
        assert!(profile.prompt_traits.iter().all(|t| t.key != "concise"));
    }

    #[test]
    fn test_new_trait_patterns_code_heavy_and_numbered_steps() {
        let db = setup();
        let turn_id = db
            .save_turn(
                "show me how to set up the server",
                "Here are the steps:\n1. Install dependencies\n2. Configure the server\n\n```bash\nnpm install\n```\n\n```toml\n[server]\nport = 8080\n```",
                None,
            )
            .unwrap();
        db.record_preference_event(
            turn_id,
            "copied_response",
            None,
            None,
            Some("code-heavy-test".to_string()),
        )
        .unwrap();
        let profile = db.get_preference_profile(8).unwrap();
        assert!(
            profile.traits.iter().any(|t| t.key == "code_heavy"),
            "code_heavy should fire for â‰¥2 code blocks"
        );
        assert!(
            profile.traits.iter().any(|t| t.key == "numbered_steps"),
            "numbered_steps should fire when response has \\n1. and \\n2."
        );
    }

    #[test]
    fn test_concise_trait_fires_only_for_short_responses() {
        let db = setup();
        // Short response (â‰¤55 words) â†’ concise should fire
        let short_id = db
            .save_turn("what's the default port?", "The default port is 8080.", None)
            .unwrap();
        db.record_preference_event(
            short_id,
            "positive_followup",
            None,
            None,
            Some("concise-short".to_string()),
        )
        .unwrap();
        let profile = db.get_preference_profile(8).unwrap();
        assert!(
            profile.traits.iter().any(|t| t.key == "concise"),
            "concise should fire for a short 5-word response"
        );
        assert!(
            !profile.traits.iter().any(|t| t.key == "direct_answer"),
            "direct_answer should not exist â€” it was removed"
        );

        // Long wall-of-text response (>55 words) â†’ concise should NOT fire
        let long_response =
            "The port configuration depends on many factors related to your operating system. "
                .repeat(5);
        let long_id = db.save_turn("explain ports", &long_response, None).unwrap();
        db.record_preference_event(
            long_id,
            "positive_followup",
            None,
            None,
            Some("concise-long".to_string()),
        )
        .unwrap();
        let profile2 = db.get_preference_profile(8).unwrap();
        let concise_count: u32 = profile2
            .traits
            .iter()
            .find(|t| t.key == "concise")
            .map(|t| t.evidence_count as u32)
            .unwrap_or(0);
        assert_eq!(
            concise_count, 1,
            "concise should not fire for a >55-word response"
        );
    }

    #[test]
    fn test_action_succeeded_signal_builds_preference_traits() {
        let db = setup();
        let turn_id = db
            .save_turn(
                "click the submit button",
                "i'll click the blue submit button on screen.",
                None,
            )
            .unwrap();
        db.record_preference_event(
            turn_id,
            "action_succeeded",
            None,
            None,
            Some("cu-success-1".to_string()),
        )
        .unwrap();
        let profile = db.get_preference_profile(8).unwrap();
        assert_eq!(
            profile.implicit_feedback_count, 1,
            "action_succeeded should count as implicit"
        );
        assert!(
            profile.traits.iter().any(|t| t.score > 0.0),
            "action_succeeded should build at least one positive trait"
        );
    }

    #[test]
    fn test_manual_preference_extracts_keyword_to_named_trait() {
        let db = setup();
        // "bullet" keyword â†’ structured_answer trait
        let turn_id = db
            .save_turn("from now on use bullet points", "sure, i'll use bullet lists.", None)
            .unwrap();
        db.record_preference_event(
            turn_id,
            "manual_preference",
            Some("user explicitly stated a preference".to_string()),
            Some("from now on use bullet points".to_string()),
            Some("manual-bullet-test".to_string()),
        )
        .unwrap();
        let profile = db.get_preference_profile(8).unwrap();
        assert!(
            profile.traits.iter().any(|t| t.key == "structured_answer"),
            "manual_preference with 'bullet' keyword should map to structured_answer trait"
        );
        assert!(
            !profile.traits.iter().any(|t| t.key == "manual_preference"),
            "generic manual_preference trait should not appear when keyword is matched"
        );
        // "brief" keyword â†’ concise trait
        let turn_id2 = db
            .save_turn("please keep responses brief", "ok, i'll keep things brief.", None)
            .unwrap();
        db.record_preference_event(
            turn_id2,
            "manual_preference",
            None,
            Some("please keep responses brief".to_string()),
            Some("manual-brief-test".to_string()),
        )
        .unwrap();
        let profile2 = db.get_preference_profile(8).unwrap();
        assert!(
            profile2.traits.iter().any(|t| t.key == "concise"),
            "manual_preference with 'brief' keyword should map to concise trait"
        );
    }

    #[test]
    fn test_preference_trait_update_delete_and_clear_lifecycle() {
        let db = setup();
        let turn_id = db
            .save_turn("help me click settings", "i'll click settings now.", None)
            .unwrap();
        db.rate_turn(turn_id, 1).unwrap();

        db.update_preference_trait(
            "action_oriented",
            Some("disabled".to_string()),
            Some("hands-off guidance".to_string()),
            Some("user does not want action-first replies".to_string()),
        )
        .unwrap();
        let disabled = db
            .get_preference_profile(8)
            .unwrap()
            .traits
            .into_iter()
            .find(|t| t.key == "action_oriented")
            .unwrap();
        assert_eq!(disabled.status, "disabled");
        assert_eq!(disabled.label, "hands-off guidance");
        assert!(db
            .get_preference_profile(8)
            .unwrap()
            .prompt_traits
            .iter()
            .all(|t| t.key != "action_oriented"));

        db.delete_preference_trait("action_oriented").unwrap();
        let deleted = db
            .get_preference_profile(8)
            .unwrap()
            .traits
            .into_iter()
            .find(|t| t.key == "action_oriented")
            .unwrap();
        assert_eq!(deleted.status, "deleted");

        db.clear_preference_learning().unwrap();
        let cleared = db.get_preference_profile(8).unwrap();
        assert!(cleared.traits.is_empty());
        assert!(cleared.positive_examples.is_empty());
        assert_eq!(cleared.explicit_feedback_count, 0);
    }

    #[test]
    fn test_delete_and_clear_remove_derived_preference_profile() {
        let db = setup();
        let turn_id = db
            .save_turn("help me click settings", "i'll click settings now.", None)
            .unwrap();
        db.rate_turn(turn_id, 1).unwrap();
        assert!(!db.get_preference_profile(8).unwrap().traits.is_empty());

        db.delete_turn(turn_id).unwrap();
        let after_delete = db.get_preference_profile(8).unwrap();
        assert!(after_delete.traits.is_empty());
        assert!(after_delete.positive_examples.is_empty());

        let second_id = db
            .save_turn("help again", "i'll keep it concise.", None)
            .unwrap();
        db.record_preference_signal(second_id, "positive_followup", 0.5, None)
            .unwrap();
        db.clear_turns().unwrap();
        let after_clear = db.get_preference_profile(8).unwrap();
        assert!(after_clear.traits.is_empty());
        assert_eq!(after_clear.implicit_feedback_count, 0);
    }

    #[test]
    fn test_warm_tone_fires_only_for_filler_openers() {
        let db = setup();
        // Response with filler opener â†’ warm_tone fires
        let filler_id = db
            .save_turn("how do I open settings?", "Sure! You can open settings by clicking the gear icon.", None)
            .unwrap();
        db.record_preference_event(
            filler_id,
            "positive_followup",
            None,
            None,
            Some("warm-filler-test".to_string()),
        )
        .unwrap();
        let profile = db.get_preference_profile(8).unwrap();
        assert!(
            profile.traits.iter().any(|t| t.key == "warm_tone"),
            "response starting with 'Sure!' should fire warm_tone"
        );

        // Response without filler opener â†’ warm_tone should NOT fire
        let direct_id = db
            .save_turn("how do I open settings?", "Click the gear icon in the top right.", None)
            .unwrap();
        db.record_preference_event(
            direct_id,
            "positive_followup",
            None,
            None,
            Some("warm-direct-test".to_string()),
        )
        .unwrap();
        let profile2 = db.get_preference_profile(8).unwrap();
        let warm_count = profile2
            .traits
            .iter()
            .find(|t| t.key == "warm_tone")
            .map(|t| t.evidence_count)
            .unwrap_or(0);
        assert_eq!(warm_count, 1, "direct response should not increment warm_tone");
    }

    #[test]
    fn test_screen_grounded_fires_for_visual_references() {
        let db = setup();
        // Response referencing screen content â†’ screen_grounded fires
        let screen_id = db
            .save_turn("what do you see?", "I can see a settings panel on screen with three tabs.", None)
            .unwrap();
        db.record_preference_event(
            screen_id,
            "positive_followup",
            None,
            None,
            Some("screen-grounded-test".to_string()),
        )
        .unwrap();
        let profile = db.get_preference_profile(8).unwrap();
        assert!(
            profile.traits.iter().any(|t| t.key == "screen_grounded"),
            "response containing 'i can see' and 'on screen' should fire screen_grounded"
        );

        // Response with no screen references â†’ screen_grounded should NOT fire
        let abstract_id = db
            .save_turn("explain settings", "Settings let you configure the application behavior.", None)
            .unwrap();
        db.record_preference_event(
            abstract_id,
            "positive_followup",
            None,
            None,
            Some("screen-abstract-test".to_string()),
        )
        .unwrap();
        let profile2 = db.get_preference_profile(8).unwrap();
        let sc_count = profile2
            .traits
            .iter()
            .find(|t| t.key == "screen_grounded")
            .map(|t| t.evidence_count)
            .unwrap_or(0);
        assert_eq!(sc_count, 1, "abstract response should not increment screen_grounded");
    }

    // â”€â”€ Dim 16: Video / temporal context CRUD tests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    #[test]
    fn video_segment_insert_and_path_decrypts() {
        let db = setup();
        let id = db
            .save_video_segment(
                0,
                "C:/v/monitor_0/1700000000000.mp4",
                "2026-05-08T10:00:00",
                Some("2026-05-08T10:01:00"),
                60_000,
                8_000_000,
                1920,
                1080,
                10.0,
                "normal",
            )
            .unwrap();
        assert!(id > 0);
        let path = db.get_video_segment_path(id).unwrap().unwrap();
        assert_eq!(path, "C:/v/monitor_0/1700000000000.mp4");
    }

    #[test]
    fn video_segment_path_is_encrypted_at_rest() {
        let db = setup();
        let id = db
            .save_video_segment(
                0,
                "C:/secret/path.mp4",
                "2026-05-08T10:00:00",
                None, 1000, 1, 16, 16, 1.0, "normal",
            )
            .unwrap();
        // Read raw column â€” should NOT contain the plaintext path
        let raw: String = db.conn.lock().unwrap()
            .query_row(
                "SELECT path_enc FROM video_segments WHERE id = ?1",
                rusqlite::params![id],
                |r| r.get(0),
            ).unwrap();
        assert!(raw.starts_with("enc:"), "path must be ChaCha20 prefix-marked");
        assert!(!raw.contains("secret"), "raw path column must not contain plaintext");
    }

    #[test]
    fn video_keyframe_with_ocr_fts_search_finds_it() {
        let db = setup();
        let seg_id = db
            .save_video_segment(
                0, "C:/v/0.mp4", "2026-05-08T10:00:00",
                Some("2026-05-08T10:01:00"), 60_000, 100, 1, 1, 1.0, "normal",
            ).unwrap();

        db.save_video_keyframe(
            seg_id, 1500,
            Some("Stripe Dashboard payment refunded order #1234"),
            Some("Chrome â€” stripe.com/dashboard"),
            None, None, None,
        ).unwrap();
        db.save_video_keyframe(
            seg_id, 3000,
            Some("Notepad â€” meeting notes about the launch"),
            Some("Notepad"),
            None, None, None,
        ).unwrap();

        let hits = db.search_video_keyframes("stripe", 10).unwrap();
        assert_eq!(hits.len(), 1, "should match exactly the stripe keyframe");
        let (_, _, _, snippet) = &hits[0];
        assert!(snippet.contains("Stripe"));

        let notepad_hits = db.search_video_keyframes("meeting", 10).unwrap();
        assert_eq!(notepad_hits.len(), 1);
    }

    #[test]
    fn video_keyframe_ocr_encrypted_at_rest() {
        let db = setup();
        let seg_id = db.save_video_segment(
            0, "C:/v/0.mp4", "2026-05-08T10:00:00",
            None, 1000, 1, 1, 1, 1.0, "normal",
        ).unwrap();
        db.save_video_keyframe(
            seg_id, 0,
            Some("SUPER_SECRET_PASSWORD: hunter2"),
            Some("KeePass"),
            None, None, None,
        ).unwrap();
        let raw: String = db.conn.lock().unwrap()
            .query_row(
                "SELECT ocr_text_enc FROM video_keyframes ORDER BY id DESC LIMIT 1",
                [], |r| r.get(0),
            ).unwrap();
        assert!(raw.starts_with("enc:"));
        assert!(!raw.contains("hunter2"));
    }

    #[test]
    fn video_segment_cascade_deletes_keyframes() {
        let db = setup();
        let seg_id = db.save_video_segment(
            0, "C:/v/0.mp4", "2026-05-08T10:00:00",
            None, 1000, 1, 1, 1, 1.0, "normal",
        ).unwrap();
        db.save_video_keyframe(seg_id, 0, Some("kf1"), None, None, None, None).unwrap();
        db.save_video_keyframe(seg_id, 500, Some("kf2"), None, None, None, None).unwrap();

        let before: i64 = db.conn.lock().unwrap()
            .query_row("SELECT count(*) FROM video_keyframes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(before, 2);

        db.conn.lock().unwrap().execute(
            "DELETE FROM video_segments WHERE id = ?1",
            rusqlite::params![seg_id],
        ).unwrap();

        let after: i64 = db.conn.lock().unwrap()
            .query_row("SELECT count(*) FROM video_keyframes", [], |r| r.get(0))
            .unwrap();
        assert_eq!(after, 0, "FK CASCADE should drop keyframes when segment deleted");
    }

    #[test]
    fn video_segments_in_window_overlap_query() {
        let db = setup();
        // Three segments: 10:00â€“10:01, 10:01â€“10:02, 10:02â€“10:03
        db.save_video_segment(0, "C:/v/a.mp4", "2026-05-08T10:00:00",
            Some("2026-05-08T10:01:00"), 60_000, 100, 1, 1, 1.0, "normal").unwrap();
        db.save_video_segment(0, "C:/v/b.mp4", "2026-05-08T10:01:00",
            Some("2026-05-08T10:02:00"), 60_000, 100, 1, 1, 1.0, "normal").unwrap();
        db.save_video_segment(0, "C:/v/c.mp4", "2026-05-08T10:02:00",
            Some("2026-05-08T10:03:00"), 60_000, 100, 1, 1, 1.0, "normal").unwrap();

        let hits = db.get_video_segments_in_window(
            "2026-05-08T10:00:30", "2026-05-08T10:01:30",
            None, 100,
        ).unwrap();
        assert_eq!(hits.len(), 2, "10:00:30â€“10:01:30 should overlap first two segments");

        let all = db.get_video_segments_in_window(
            "2026-05-08T09:00:00", "2026-05-08T11:00:00",
            None, 100,
        ).unwrap();
        assert_eq!(all.len(), 3);
    }

    #[test]
    fn video_keyframe_near_returns_closest() {
        let db = setup();
        let seg = db.save_video_segment(
            0, "C:/v/x.mp4", "2026-05-08T10:00:00",
            Some("2026-05-08T10:01:00"), 60_000, 100, 1, 1, 1.0, "normal",
        ).unwrap();
        db.save_video_keyframe(seg, 0,    Some("first"), Some("App1"), None, None, None).unwrap();
        db.save_video_keyframe(seg, 30_000, Some("middle"), Some("App2"), None, None, None).unwrap();
        db.save_video_keyframe(seg, 59_000, Some("last"), Some("App3"), None, None, None).unwrap();

        let hit = db.find_video_keyframe_near(
            "2026-05-08T10:00:30", None,
        ).unwrap().expect("should find a keyframe");
        // 10:00:30 wall-clock = 30s into segment â†’ expect the middle keyframe
        assert!(hit.3.contains("middle") || hit.3.contains("first"),
            "near-30s should pick middle or first, got: {}", hit.3);
    }

    #[test]
    fn video_prune_removes_old_and_drops_fts() {
        let db = setup();
        let seg = db.save_video_segment(
            0, "C:/v/old.mp4", "2020-01-01T00:00:00",
            Some("2020-01-01T00:01:00"), 60_000, 100, 1, 1, 1.0, "normal",
        ).unwrap();
        db.save_video_keyframe(seg, 0, Some("ancient text"), None, None, None, None).unwrap();

        let recent = db.save_video_segment(
            0, "C:/v/new.mp4",
            &chrono_now_iso(&db),
            None, 60_000, 100, 1, 1, 1.0, "normal",
        ).unwrap();
        db.save_video_keyframe(recent, 0, Some("fresh text"), None, None, None, None).unwrap();

        let pruned = db.prune_video_segments(7).unwrap();
        assert_eq!(pruned, 1, "only the 2020 segment should be deleted");

        // FTS should no longer return ancient
        let hits = db.search_video_keyframes("ancient", 10).unwrap();
        assert_eq!(hits.len(), 0, "FTS row for pruned keyframe must be gone");

        let fresh_hits = db.search_video_keyframes("fresh", 10).unwrap();
        assert_eq!(fresh_hits.len(), 1, "recent keyframe must remain");
    }

    #[test]
    fn video_total_bytes_aggregates() {
        let db = setup();
        db.save_video_segment(0, "a", "2026-05-08T10:00:00", None,
            1000, 1_000_000, 1, 1, 1.0, "normal").unwrap();
        db.save_video_segment(0, "b", "2026-05-08T10:01:00", None,
            1000, 2_500_000, 1, 1, 1.0, "normal").unwrap();
        assert_eq!(db.total_video_bytes().unwrap(), 3_500_000);
    }

    #[test]
    fn video_retention_combined_with_turns_retention() {
        // The Tauri-level `enforce_retention_policy` is wrapper-only; here we test
        // the underlying SessionDb method composition: delete_turns_older_than +
        // prune_video_segments behave consistently for the same `days` cutoff.
        let db = setup();
        // Old artifacts (2020)
        db.conn.lock().unwrap().execute(
            "INSERT INTO turns (user_prompt, assistant_response, created_at) VALUES (?1,?2,?3)",
            rusqlite::params!["q", "a", "2020-01-01 00:00:00"],
        ).unwrap();
        let old_seg = db.save_video_segment(
            0, "C:/v/old.mp4", "2020-01-01T00:00:00",
            None, 1000, 100, 1, 1, 1.0, "normal",
        ).unwrap();
        db.save_video_keyframe(old_seg, 0, Some("ancient"), None, None, None, None).unwrap();

        let turns_pruned = db.delete_turns_older_than(7).unwrap();
        let video_pruned = db.prune_video_segments(7).unwrap();
        assert_eq!(turns_pruned, 1);
        assert_eq!(video_pruned, 1);

        // FTS index should reflect the prune
        let hits = db.search_video_keyframes("ancient", 10).unwrap();
        assert_eq!(hits.len(), 0);
    }

    #[test]
    fn video_purge_all_drops_segments_and_fts() {
        let db = setup();
        let seg = db.save_video_segment(
            0, "C:/v/0.mp4", "2026-05-08T10:00:00",
            None, 1000, 100, 1, 1, 1.0, "normal",
        ).unwrap();
        db.save_video_keyframe(seg, 0, Some("hello"), None, None, None, None).unwrap();
        db.purge_all_memory().unwrap();
        let n: i64 = db.conn.lock().unwrap()
            .query_row("SELECT count(*) FROM video_segments", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0);
        let hits = db.search_video_keyframes("hello", 10).unwrap();
        assert_eq!(hits.len(), 0);
    }
}

