# Cross-Platform Smoke Evidence

Dimension 47 cannot be scored 9+ from architecture alone. CI now proves no-bundle launch/runtime readiness on Windows, macOS, and Linux, but 9+ still requires one dated manual smoke log per operating system after a tagged release produces signed artifacts.

Current CI runtime gate:

- `scripts/ci-runtime-smoke.ps1` launches the built executable with `DANTE_STARTUP_PROBE=1`.
- The smoke report must include `tray_ready`, `hotkey_registered`, and `native_ready` for the launched process.
- Latest proof: GitHub Actions run `25610105987`, commit `18e712a`, with runtime-smoke artifacts for Windows, macOS, and Ubuntu.

Required manual checks per platform:

1. Install the release artifact for the platform.
2. Launch the app from a clean user profile.
3. Confirm tray or menu bar presence.
4. Confirm global shortcut opens the companion.
5. Confirm screenshot/capture path reports native or degraded status in Settings.
6. Confirm input automation either works or shows a degraded platform reason.
7. Confirm onboarding, chat, close-to-tray, and relaunch work.
8. Confirm updater manifest contains the current platform entry and signature.

Use `scripts/verify-release-artifacts.ps1` or `scripts/verify-release-artifacts.sh` against the downloaded release bundle before recording the smoke result.
