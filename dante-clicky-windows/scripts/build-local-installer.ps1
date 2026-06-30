param(
  [switch]$SkipTests,
  [switch]$PlainSqlite
)

$ErrorActionPreference = "Stop"
$repo = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repo

Write-Host "DanteClicky local Windows installer build" -ForegroundColor Cyan
Write-Host "Repo: $repo"

if (-not $SkipTests) {
  Write-Host "Running frontend tests..." -ForegroundColor Cyan
  npm run test:frontend -- --reporter=dot

  Write-Host "Running TypeScript check..." -ForegroundColor Cyan
  npx tsc --noEmit --pretty false
}

Write-Host "Building Tauri NSIS installer..." -ForegroundColor Cyan
$localConfig = '{\"bundle\":{\"createUpdaterArtifacts\":false}}'
if ($PlainSqlite) {
  Write-Host "Building without SQLCipher for isolated plain-SQLite debugging." -ForegroundColor Yellow
  npx tauri build "--config=$localConfig"
} else {
  npx tauri build "--config=$localConfig" -- --features sqlcipher
}

$bundleRoot = Join-Path $repo "src-tauri\target\release\bundle\nsis"
$installer = Get-ChildItem -Path $bundleRoot -Filter "*.exe" -ErrorAction SilentlyContinue |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $installer) {
  throw "No NSIS installer was found in $bundleRoot"
}

Write-Host ""
Write-Host "Installer ready:" -ForegroundColor Green
Write-Host $installer.FullName -ForegroundColor Green
Write-Host ""
Write-Host "Preview builds may be unsigned. The enterprise-ready RC remains gated on signed release artifacts and installed smoke logs." -ForegroundColor Yellow
