# DanteClicky Windows — Release Checklist

## Project status (as of 2026-05-05)

| Phase | Name | Status |
|-------|------|--------|
| 0 | Scaffold & Tauri window | Complete |
| 1 | Overlay window (transparent, always-on-top) | Complete |
| 2 | CompanionPanel.tsx — chat bubble UI | Complete |
| 3 | Vercel AI SDK — Claude / GPT / Grok streaming | Complete |
| 4 | Whisper local transcription (useVoice.ts) | Complete |
| 5 | Screen capture + vision (computer-use) | Complete |
| 6 | TTS voice responses | Complete |
| 7 | MCP server (mcp_server.rs) | Complete |
| 8 | DanteAgents WebSocket bridge (ws_server.rs, port 9001) | Complete |
| 9 | Companion memory + action loop | Complete |
| 10 | Auto-updater + NSIS/MSI bundle targets | Complete |
| 11 | CI/CD, packaging, CONTRIBUTING docs | In progress |
| 12 | EV code signing + Microsoft Store submission | Pending |

**DanteForge score: 76 / 100**

---

## Before every release

- [ ] Bump version in `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`
- [ ] Run `npm run tauri build` — verify NSIS `.exe` and `.msi` produce correctly
- [ ] Test on clean Windows 11 VM (no dev tools installed)
- [ ] Verify Worker is deployed: `wrangler deploy` from `worker/`
- [ ] Test full pipeline: `Ctrl+Alt+Space` → speak → AI response → TTS → overlay

## GitHub Release steps

1. Tag: `git tag v0.x.x && git push origin v0.x.x`
   - CI will automatically build and publish a draft release via `tauri-apps/tauri-action`.
2. Review the draft release on GitHub — add release notes.
3. Verify artifacts are attached:
   - `src-tauri/target/release/bundle/nsis/dante-clicky-windows_x.x.x_x64-setup.exe`
   - `src-tauri/target/release/bundle/msi/dante-clicky-windows_x.x.x_x64_en-US.msi`
4. Create `latest.json` for the auto-updater:
```json
{
  "version": "v0.x.x",
  "notes": "Release notes here",
  "pub_date": "2026-05-05T00:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "",
      "url": "https://github.com/danteforge/dante-clicky-windows/releases/download/v0.x.x/dante-clicky-windows_x.x.x_x64-setup.exe"
    }
  }
}
```
5. Upload `latest.json` to the release.
6. Publish the release.

## EV Code Signing (required for no SmartScreen warning)

- Apply at DigiCert or Sectigo — takes 1–2 weeks.
- Once issued: set `TAURI_SIGNING_PRIVATE_KEY` env var in GitHub Actions secrets.
- CI will sign the installer automatically on the next tagged build.
