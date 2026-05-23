# DanteClicky Windows Preview Installer

This is the fastest path for installing DanteClicky on your own Windows PC.

## Build

```powershell
npm run installer:local
```

For a faster local build when you already ran tests:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-local-installer.ps1 -SkipTests
```

To force the production SQLCipher feature locally:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-local-installer.ps1 -WithSqlCipher
```

The script prints the exact NSIS `.exe` path under:

```text
src-tauri\target\release\bundle\nsis
```

## Install

Run the printed `.exe`. Preview installers can be unsigned, so Windows may show a SmartScreen warning.

## First Run

Onboarding now checks:

- PC hardware profile
- microphone readiness
- Ollama installed/running state
- cloud model key validation
- model recommendation status
- guarded Power User automation defaults

## Release Labels

- **Daily Driver Preview**: installable locally, suitable for personal testing.
- **Enterprise Ready RC**: requires signed artifacts, updater manifest signatures, checksums, attestations, and installed smoke logs.
