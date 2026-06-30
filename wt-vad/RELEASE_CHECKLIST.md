# DanteClicky Windows — Release Checklist

## Before every release
- [ ] Bump version in `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`
- [ ] Run `npm run tauri build` — verify NSIS .exe and .msi produce correctly
- [ ] Test on clean Windows 11 VM (no dev tools installed)
- [ ] Verify Worker is deployed: `wrangler deploy` from `worker/`
- [ ] Test full pipeline: Ctrl+Alt+Space → speak → AI response → TTS → overlay

## GitHub Release steps
1. Tag: `git tag v0.x.x && git push origin v0.x.x`
2. Upload: `src-tauri/target/release/bundle/nsis/dante-clicky-windows_x.x.x_x64-setup.exe`
3. Upload: `src-tauri/target/release/bundle/msi/dante-clicky-windows_x.x.x_x64_en-US.msi`
4. Create `latest.json` for auto-updater:
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
5. Upload `latest.json` to the release

## EV Code Signing (required for no SmartScreen warning)
- Apply at DigiCert or Sectigo — takes 1-2 weeks
- Once issued: set `TAURI_SIGNING_PRIVATE_KEY` env var in CI
- Re-run `npm run tauri build` — installer will be signed
