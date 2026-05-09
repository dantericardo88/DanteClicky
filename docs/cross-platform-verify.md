# Cross-Platform Verification

Dimension 47 is scored on proven desktop reach across Windows, macOS, and Linux. The current implementation is architecture-ready, but not yet 9+ until the platform matrix produces real artifacts and smoke evidence.

## Current Status

| Area | Windows | macOS | Linux |
|---|---|---|---|
| Tauri shell | supported | CI configured | CI configured |
| Tray/menu bar | supported | expected via Tauri | expected via Tauri |
| Global shortcut | supported | expected via Tauri plugin | expected via Tauri plugin |
| Screen capture | supported via `screenshots` | expected with permissions | expected with desktop portal/session support |
| Cursor/input control | supported via Win32/Enigo | fallback path present | fallback path present |
| Accessibility tree | Win32 UIAutomation | fallback returns empty | fallback returns empty |
| OCR | WinRT OCR | fallback returns empty | fallback returns empty |
| Overlay capture exclusion | Win32 display affinity | unavailable | unavailable |
| Auto-start/updater | configured | CI/release configured | CI/release configured |

## Required 9+ Evidence

1. Green GitHub Actions build matrix on `windows-latest`, `macos-latest`, and `ubuntu-latest`.
2. Green release matrix with downloadable Windows, macOS, and Linux artifacts.
3. macOS smoke: launch, menu bar/tray presence, onboarding, microphone permission, screen recording permission, screenshot capture, global shortcut, chat turn, cursor/input action, close-to-tray/menu bar, update check.
4. Linux smoke: launch, tray support under the target desktop session, screenshot capture, global shortcut, chat turn, cursor/input action, close-to-tray, update check.
5. Platform capability panel or diagnostics export confirming degraded features are explicit rather than silent.
6. Documentation of unsupported or degraded features per OS.

## Local Verification Commands

```powershell
npx vitest run src/__tests__/crossPlatformArchitecture.test.ts --reporter=dot
npx tsc --noEmit --pretty false
npm test -- --reporter=dot
npm run build
cargo check --manifest-path src-tauri/Cargo.toml --locked
cargo test --manifest-path src-tauri/Cargo.toml --lib --no-run
npm run tauri -- build --no-bundle
```

`cargo test --lib --quiet` may be blocked on some managed Windows machines by Application Control when it tries to execute generated test binaries. Treat that as an environment block only if `cargo test --lib --no-run` compiles and CI executes the test binary on a runner.

## Score Gate

- **6.5**: architecture target-gated, fallback-safe, CI/release matrices present, Windows release smoke passes.
- **8.0**: macOS and Linux CI build/test jobs pass at least once.
- **9.0**: all three OSes produce artifacts and pass manual smoke with documented capability differences.
- **9.3+**: macOS Accessibility and Linux AT-SPI/portal integrations move core capabilities from fallback to native support.
