## [Workflow] Keep PowerShell Inline JSON Out Of Here-Strings
_Added: 2026-05-10T03:37:00Z_
_Source: verify failure_

**Mistake:** Used a single-line PowerShell command with a here-string whose header was not on its own line, causing a parser failure before the synthetic verifier test could run.
**Rule:** For inline PowerShell test fixtures, build structured objects and pipe them through `ConvertTo-Json`, or put here-string headers and terminators on their own lines.

## [Environment] Do Not Assume Local Bash Works On Windows
_Added: 2026-05-10T03:39:00Z_
_Source: verify failure_

**Mistake:** Tried to run `bash -n` on Windows where `bash.exe` was WSL-backed but `/bin/bash` was unavailable.
**Rule:** On this workstation, verify Bash release scripts through CI/Ubuntu or an explicit working Bash installation; do not treat `Get-Command bash` as proof that local Bash execution works.

## [Testing] Keep Workflow Architecture Assertions Scoped To The Actual Risk
_Added: 2026-05-10T05:27:00Z_
_Source: verify failure_

**Mistake:** Used broad string assertions against the release workflow, so a legitimate Cargo version-parsing Python snippet failed a test intended to prevent inline manifest generation.
**Rule:** Workflow tests should assert the specific risky behavior is absent, such as old inline `latest.json` generation, rather than banning a tool or language globally.

## [Release] Verify Action Refs Exist Before Treating Them As Hardening
_Added: 2026-05-10T06:10:00Z_
_Source: verify failure_

**Mistake:** Treated `tauri-apps/tauri-action@v1` as a release hardening improvement before checking the upstream ref, and a later focused test had to be repaired after SHA pinning invalidated the old tag-based assertion.
**Rule:** For release workflows, verify every action ref with the upstream repository, pin to a full commit SHA, and make tests assert immutable refs instead of broad `@vN` strings.

## [Shell] Avoid JavaScript Template Literals In PowerShell Inline Node Checks
_Added: 2026-05-10T06:15:00Z_
_Source: verify failure_

**Mistake:** Used a JavaScript template literal inside a PowerShell command string, so PowerShell consumed the backticks before Node evaluated the snippet.
**Rule:** For `node -e` inside PowerShell, use string concatenation or single-quoted PowerShell strings; do not embed JavaScript backtick templates in double-quoted command strings.

## [Environment] Do Not Assume PowerShell 7 Encoding Switches
_Added: 2026-05-10T06:16:00Z_
_Source: verify failure_

**Mistake:** Used `Set-Content -Encoding utf8NoBOM`, which is not available in this Windows PowerShell 5 environment.
**Rule:** When BOM-free UTF-8 matters here, write with `[System.IO.File]::WriteAllText(..., [System.Text.UTF8Encoding]::new($false))` instead of relying on newer PowerShell encoding names.
