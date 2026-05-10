# Dimension 47 Manual Smoke Log Template

Copy this file to `YYYY-MM-DD-<platform>-vX.Y.Z.md` after testing a tagged release artifact.
Use `PASS`, `FAIL`, or `DEGRADED` in the Result column. `DEGRADED` is only accepted for the two rows whose labels explicitly allow a degraded state.

## Release

- Tag:
- GitHub release URL:
- Workflow run URL:
- Commit SHA:
- Artifact filename:
- Artifact SHA256:
- Tester:
- OS and version:
- Hardware:

## Trust Checks

- Windows: paste `signtool verify /pa /all /tw /v <installer>` output.
- macOS: paste `codesign --verify --deep --strict --verbose=2`, `spctl --assess --type execute --verbose=4`, and `xcrun stapler validate` output.
- Linux: paste Tauri updater `.AppImage.sig` verification status, and GPG/AppImage signature output if used.
- `latest.json`: confirm this platform has a non-empty `signature` and an asset URL that matches the tested artifact.
- Release trust evidence: confirm the matching `danteclicky-*-trust-evidence` text asset is attached to the GitHub release and matches the platform trust command output.
- GitHub attestation: run `gh attestation verify <artifact> --repo dantericardo88/DanteClicky` for the installed artifact and paste the verification summary.

## Runtime Checks

| Check | Result | Evidence |
|---|---|---|
| Install release artifact | PASS/FAIL |  |
| Launch from clean user profile | PASS/FAIL |  |
| Tray or menu bar visible | PASS/FAIL |  |
| Onboarding opens and completes | PASS/FAIL |  |
| Microphone permission path | PASS/FAIL |  |
| Screen capture permission path | PASS/FAIL |  |
| Screenshot capture works or explicit degraded state appears | PASS/FAIL/DEGRADED |  |
| Global shortcut opens companion | PASS/FAIL |  |
| Chat turn completes | PASS/FAIL |  |
| Cursor/input action works or explicit degraded state appears | PASS/FAIL/DEGRADED |  |
| Close-to-tray/menu bar behavior works | PASS/FAIL |  |
| Relaunch preserves expected state | PASS/FAIL |  |
| Updater check reaches signed manifest | PASS/FAIL | Paste Settings > Platform updater manifest result, including platform target and signature status. |

## Notes

- Capability differences:
- Regressions:
- Follow-up issues:
