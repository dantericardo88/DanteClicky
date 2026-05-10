# DanteClicky — Competitive Harvest Loop Matrix
> Generated: 2026-05-05 | Updated: 2026-05-10 (Session 39 adversarial Dim 47 correction; full 50-dim JSON/chat render updated; Dim 47 8.6 -> 8.2) | CHL Engine

---

## Overall Self Score: 8.49/10 (canonical 50-dim composite; see `.danteforge/50_DIMENSION_COMPETITIVE_MATRIX.json`)
## Composite Target: 9.3/10

---

## Gap Table (sorted by gap, descending)

| Dimension | DC Self | Leader | Leader Score | Gap | Sprint? |
|-----------|---------|--------|-------------|-----|---------|
| computer_use_arch | 9.0 | trycua/cua | 9.5 | **-0.5** | 🎯 Wave 6 (cua harvest in progress) |
| model_coverage | ~7.0 | trycua/cua | 9.5 | **-2.5** | Wave 6 — Phase 2 wt-cua-registry |
| extensibility | ~6.0 | trycua/cua | 9.5 | **-3.5** | Wave 6 — Phase 0 callback foundation |
| ambient_ux | 7.0 | trycua/cua human-tool | 9.0 | **-2.0** | Wave 6 — Phase 2 wt-cua-human |
| memory_context | 8.75 | screenpipe | 10.0 | **-1.25** | (Sprint #1 closed; preference learning at 9.2) |
| integration_mcp | 8.0 | screenpipe | 8.0 | 0.0 | ✅ Leading (sustained via wt-cua-mcp Phase 2) |
| quality_dist | 2.0 | Cluely | 8.0 | **-6.0** | Sprint #3 |
| computer_use | 9.0 | UI-TARS / cua | 9.5 | **-0.5** | Wave 6 covers via composed_grounded |
| voice_pipeline | 9.1 | (DC leads) | 9.1 | 0.0 | ✅ Leading |
| screen_capture | 9.0 | screenpipe/UI-TARS | 9.0 | 0.0 | ✅ Leading |
| model_agnostic | 9.0 | (DC leads) | 9.0 | 0.0 | ✅ Leading |
| platform_fidelity | 9.0 | screenpipe/Pluely | 9.0 | 0.0 | ✅ Leading |

### Catalogued Competitor: trycua/cua

| Metric | Value |
|--------|-------|
| Stars | 15.8k |
| License | MIT |
| Domain | Computer-use agent framework (cross-platform sandbox + agent loops) |
| Strengths | 21 vendor agent loops, callback lifecycle, composed grounding, MCP session manager, decorator-based agent registry, trajectory replay, PII anonymization, budget tracking |
| Where they lead us | Dim 27 (architecture), Dim 49 (model coverage), Dim 50 (extensibility), Dim 38 (human-in-the-loop ambient UX) |
| Where we lead them | Windows-native UIAutomation + Whisper Candle, screen-capture stealth (WDA_EXCLUDEFROMCAPTURE), preference-learning memory (Dim 33 9.2), DanteAgents bridge |
| Harvest plan | `C:/Users/richa/.claude/plans/foamy-foraging-lynx.md` (Wave 6) |
| Status | Phase 0a metadata catalogued 2026-05-08 |

---

## Sprint #1 — memory_context (Gap: -9.0)

### Target
- Dimension: `memory_context`
- Current: 1.0 (in-memory only, no persistence)
- Target: 7.5 (SQLite session history + FTS5 search + Screenpipe client)
- Gold standard: screenpipe 10.0 (24/7 screen memory, FTS5, vector search)

### OSS Sources (Phase 3 confirmed)

| Repo | License | Stars | Pattern to Harvest |
|------|---------|-------|--------------------|
| [rusqlite/rusqlite](https://github.com/rusqlite/rusqlite) | MIT | 3k+ | Session + messages schema, WAL mode, FTS5 virtual table |
| [screenpipe/screenpipe](https://github.com/screenpipe/screenpipe) | MIT | 10k+ | SQLite schema design for screen events + FTS5 full-text search |
| [asg017/sqlite-vec](https://github.com/asg017/sqlite-vec) | MIT | 2k+ | Vector search extension for future RAG pipeline |
| [KPCOFGS/RustyChat](https://github.com/KPCOFGS/RustyChat) | MIT | 100+ | Chat UI SQLite conversation history pattern |

### Implementation Plan

```toml
# Cargo.toml additions
rusqlite = { version = "0.32", features = ["bundled", "vtab", "window"] }
```

```rust
// src-tauri/src/session.rs — schema
fn init_db(db: &Connection) -> Result<()> {
    db.execute_batch("
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY,
            created_at INTEGER NOT NULL,
            model TEXT NOT NULL,
            provider TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY,
            session_id INTEGER REFERENCES sessions(id),
            role TEXT NOT NULL,  -- 'user' | 'assistant' | 'system'
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            screenshot_hash TEXT,
            token_count INTEGER,
            model TEXT
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts
            USING fts5(content, content='messages', content_rowid='id');
        CREATE TABLE IF NOT EXISTS screen_events (
            id INTEGER PRIMARY KEY,
            created_at INTEGER NOT NULL,
            app_name TEXT,
            window_title TEXT,
            screenshot_path TEXT,
            screenshot_hash TEXT
        );
    ")?;
    Ok(())
}
```

### Tauri Commands to Expose
```rust
#[tauri::command] fn create_session(model: String, provider: String) -> Result<i64>
#[tauri::command] fn save_message(session_id: i64, role: String, content: String, screenshot_hash: Option<String>) -> Result<()>
#[tauri::command] fn get_session_history(session_id: i64) -> Result<Vec<Message>>
#[tauri::command] fn search_history(query: String, limit: usize) -> Result<Vec<Message>>
```

### Expected Score After Sprint: 1.0 → 7.5 (+6.5)

---

## Sprint #2 — integration_mcp (Gap: -8.0)

### Target
- Dimension: `integration_mcp`
- Current: 0.0 (no MCP server, no WebSocket bridge)
- Target: 7.0 (WebSocket DanteAgents bridge + MCP server using official SDK)

### OSS Sources
| Repo | License | Stars | Pattern |
|------|---------|-------|---------|
| [modelcontextprotocol/rust-sdk](https://github.com/modelcontextprotocol/rust-sdk) | MIT | 1k+ | Official Rust MCP SDK — replaces hand-rolled SSE |
| [techgopal/ultrafast-mcp](https://github.com/techgopal/ultrafast-mcp) | MIT | 200+ | High-perf MCP server patterns, minimal boilerplate |

### Implementation Plan
```toml
rmcp = { version = "0.1", features = ["server", "transport-sse-server"] }
```
Tools to expose: `capture_screen`, `click`, `type_text`, `speak`, `search_memory`

---

## Sprint #3 — quality_dist (Gap: -6.0)

### Target
- Current: 2.0 (NSIS wired, no icons/CI/tests)
- Target: 7.0 (signed installer, GitHub Actions CI, auto-updater, README+demo)

### Key Actions
1. `npm run tauri icon` from SVG → app icon set
2. `tauri-plugin-updater` → GitHub Releases feed
3. GitHub Actions: `cargo test` + `npm run test` + `cargo tauri build`
4. README.md with demo GIF (screen record, 30s)
5. DigiCert EV cert application (2 weeks lead time — START NOW)

---

## Sprint #4 — computer_use (Gap: -5.0)

### Target
- Current: 4.0 (cursor animation done, no input control)
- Target: 8.0 (enigo click/type/scroll + tool-use loop + [POINT] wire)

### Key Actions
1. `input.rs` — enigo click, type, scroll, drag (3 hours)
2. Wire `[POINT] → invoke('animate_cursor_to', {x, y})` in OverlayPanel.tsx (30 min)
3. Tool-use loop in useVoice.ts — parse tool calls, execute, re-submit to AI (4 hours)
4. Safety gate: classify actions as safe/dangerous before executing (2 hours)

---

## CHL Trend Lines

```
memory_context:   1.0 ────────────────────────────────► 7.5  (+6.5 after Sprint #1)
integration_mcp:  0.0 ─────────────────────────────► 7.0  (+7.0 after Sprint #2)
quality_dist:     2.0 ──────────────────────────► 7.0  (+5.0 after Sprint #3)
computer_use:     4.0 ──────────────────────────────────► 8.0  (+4.0 after Sprint #4)
voice_pipeline:   8.0 [LEADING — maintain]
screen_capture:   9.0 [LEADING — maintain]
model_agnostic:   9.0 [LEADING — maintain]
platform_fidelity:9.0 [LEADING — maintain]

Composite after 4 sprints: 5.3 → 8.4 (+3.1)
```

---

## OSS Harvest Legal Summary

All sources confirmed MIT or Apache-2.0. No GPL/AGPL contamination.
Patterns extracted — no code copied verbatim. All implementations are fresh.

*Report: .danteforge/COMPETE_MATRIX.md | CHL Engine v1 | 2026-05-05*
