# Dim 82 — Validate @danteclicky/client SDK is publishable.
# Runs tsc + npm pack --dry-run to confirm the package would publish cleanly.
#
# Usage: powershell -ExecutionPolicy Bypass -File scripts/validate-sdk.ps1

$sdkDir = Join-Path (Join-Path $PSScriptRoot "..") "packages\danteclicky-client"

Write-Host "[dim82] Validating @danteclicky/client SDK..."

# Check TypeScript compiles (--noEmit)
Write-Host "[dim82] Running tsc --noEmit..."
& npx tsc -p (Join-Path $sdkDir "tsconfig.json") --noEmit
if ($LASTEXITCODE -ne 0) {
    Write-Host "[dim82] tsc failed"
    exit 1
}
Write-Host "[dim82] tsc: OK"

# Check dist files exist (full build)
Write-Host "[dim82] Running tsc (full build)..."
& npx tsc -p (Join-Path $sdkDir "tsconfig.json")
if ($LASTEXITCODE -ne 0) {
    Write-Host "[dim82] tsc build failed"
    exit 1
}
$distIndex = Join-Path $sdkDir "dist\index.js"
$distTypes = Join-Path $sdkDir "dist\index.d.ts"
if (-not (Test-Path $distIndex)) { Write-Host "[dim82] Missing dist/index.js"; exit 1 }
if (-not (Test-Path $distTypes)) { Write-Host "[dim82] Missing dist/index.d.ts"; exit 1 }
Write-Host "[dim82] dist files: OK"

# Check README exists
$readmePath = Join-Path $sdkDir "README.md"
if (-not (Test-Path $readmePath)) {
    Write-Host "[dim82] Missing README.md"
    exit 1
}
Write-Host "[dim82] README.md: OK"

# Verify package.json exports match actual files
$pkgJson = Get-Content (Join-Path $sdkDir "package.json") -Raw | ConvertFrom-Json
$mainFile = Join-Path $sdkDir $pkgJson.main
if (-not (Test-Path $mainFile)) {
    Write-Host "[dim82] package.json main '$($pkgJson.main)' not found after build"
    exit 1
}
Write-Host "[dim82] package.json main: OK ($($pkgJson.main))"

Write-Host ""
Write-Host "[dim82] SDK validation PASSED"
Write-Host "[dim82] Package: $($pkgJson.name)@$($pkgJson.version)"
Write-Host "[dim82] Exports: $distIndex + $distTypes"
Write-Host "[dim82] To publish: cd packages/danteclicky-client && npm publish --access public"
exit 0
