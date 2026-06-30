# Changelog

All notable changes to DanteClicky are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Local vision model integration (Moondream2, 1.8B via Candle)
- Ambient mode: passive screenshot diffing with OCR context injection
- Voice language selector in Settings (multilingual Whisper auto-select)

### Changed
- Memory consolidation algorithm: improved Jaccard word-overlap deduplication
- UI tree extraction: enhanced element filtering for accessibility

### Security
- Dependencies: updated to latest secure versions via cargo deny and npm audit

## [0.1.0] - 2026-05-09

### Added

#### Voice Interface
- Push-to-talk (PTT) voice input with configurable key binding
- Text-to-speech (TTS) response synthesis
- Whisper STT for local speech recognition (no cloud required)
- Multilingual support: English, Spanish, French, German, Chinese, Japanese, etc.
- Customizable voice and speech rate

#### Computer Use
- Visual grounding with set-of-marks (SoM) element numbering
- Windows UIAutomation for UI tree extraction and analysis
- Smart action safety checks (logout button detection, dangerous action prevention)
- Multi-monitor support with correct coordinate mapping
- Element state tracking (focused, checked, expanded, disabled)
- System prompt optimization for GUI interaction

#### Memory System
- Encrypted at-rest (SQLCipher AES-256)
- Field-level encryption (ChaCha20 for credentials/API keys)
- OS-level key protection (DPAPI on Windows)
- Automatic fact consolidation with Jaccard word-overlap deduplication
- Preference learning from conversation history
- Full-text search (SQLite FTS5)
- Configurable data retention and expiration
- One-click data deletion

#### User Experience
- Tauri 2.0 native desktop app for Windows 11/10
- Clean, intuitive settings panel
- Conversation transcript with turn history
- Ambient context viewing
- Incognito mode (disables memory recording)
- Data inventory (view/delete stored facts)
- Quick-access taskbar integration

#### Security & Privacy
- Open source (MIT License)
- Full dependency audit (cargo deny, npm audit)
- Vulnerability disclosure policy with 24-hour response SLA
- SECURITY.md with security features documentation

#### LLM Integration
- Multi-provider support via Vercel AI SDK (Claude, OpenAI, Grok, others)
- Easy API key configuration (stored encrypted)
- Fallback provider support

#### Reliability
- Auto-updater (Tauri native)
- Crash reporting (opt-in)
- Error recovery and graceful degradation
- Comprehensive test coverage (TypeScript + Rust)

### Technical Details

- **Frontend:** Tauri 2.0 + React 18 + TypeScript 5.0
- **Backend:** Rust (Tokio async runtime)
- **Database:** SQLite + SQLCipher encryption
- **Voice:** Whisper STT (local), TTS SDK integrations
- **Vision:** Windows UIAutomation, OCR
- **Desktop:** Tauri native bindings, Windows APIs
- **CI/CD:** GitHub Actions (build, test, security audit, release)

### Known Limitations

- **Windows-only** — macOS/Linux ports planned for Q3-Q4 2026
- **No 24/7 recording** — By design (privacy-first); periodic snapshots via ambient mode
- **Local vision pending** — Currently uses cloud vision; local model integration in progress
- **Whisper latency** — First request ~2-3s (model load); subsequent requests cached

### Security Fixes

- None in this release (initial launch)

### Deprecated

- None

---

## Versioning

- `0.1.0`: Initial public release
- `0.x.y`: Pre-1.0 feature development (API may change)
- `1.0.0+`: Stable API (backwards-compatible within major version)

---

## How to Contribute

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Links

- **Repository:** https://github.com/dantericardo88/DanteClicky
- **Issues:** https://github.com/dantericardo88/DanteClicky/issues
- **Discussions:** https://github.com/dantericardo88/DanteClicky/discussions
- **Security:** See [SECURITY.md](SECURITY.md)
