# Dim 90 — Package the DanteClicky Browser Bridge extension for distribution.
# Creates a zip file that can be loaded in Chrome (Developer mode) or converted to CRX.
# Also validates the manifest and required files.
#
# Usage: pwsh -File scripts/build-browser-extension.ps1

$ErrorActionPreference = "Stop"
$extDir = Join-Path (Join-Path $PSScriptRoot "..") "packages\browser-extension"
$outDir = Join-Path (Join-Path $PSScriptRoot "..") "docs\releases"
$zipName = "danteclicky-browser-bridge.zip"

Write-Host "[dim90] Building DanteClicky Browser Bridge extension..."

# Validate required files
$required = @("manifest.json", "background.js", "content.js", "popup.html", "popup.js")
foreach ($file in $required) {
    $p = Join-Path $extDir $file
    if (-not (Test-Path $p)) {
        Write-Host "[dim90] ERROR: Missing required file: $file"
        exit 1
    }
}
Write-Host "[dim90] Required files: OK"

# Validate manifest
$manifest = Get-Content (Join-Path $extDir "manifest.json") | ConvertFrom-Json
if ($manifest.manifest_version -ne 3) {
    Write-Host "[dim90] ERROR: Expected manifest_version 3, got $($manifest.manifest_version)"
    exit 1
}
Write-Host "[dim90] Manifest v$($manifest.manifest_version) '$($manifest.name)' v$($manifest.version): OK"

# Create placeholder icon files if missing (16x16 and 48x48 PNG placeholders)
foreach ($size in @(16, 48)) {
    $iconPath = Join-Path $extDir "icon${size}.png"
    if (-not (Test-Path $iconPath)) {
        # Create a minimal 1-byte placeholder so the zip is valid
        # Real icons should be provided before Chrome Web Store submission
        [System.IO.File]::WriteAllBytes($iconPath, [byte[]](137,80,78,71,13,10,26,10))
        Write-Host "[dim90] Created placeholder icon${size}.png"
    }
}

# Create output zip
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
$zipPath = Join-Path $outDir $zipName
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

# Include only the extension files (no node_modules, no README build artifacts)
$filesToZip = @("manifest.json", "background.js", "content.js", "popup.html", "popup.js",
                "icon16.png", "icon48.png")

Add-Type -Assembly System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, "Create")
foreach ($file in $filesToZip) {
    $filePath = Join-Path $extDir $file
    if (Test-Path $filePath) {
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $filePath, $file) | Out-Null
    }
}
$zip.Dispose()

$zipSize = [math]::Round((Get-Item $zipPath).Length / 1KB, 1)
Write-Host "[dim90] Built: $zipPath (${zipSize}KB)"
Write-Host "[dim90] To install in Chrome:"
Write-Host "  1. Open chrome://extensions"
Write-Host "  2. Enable Developer mode"
Write-Host "  3. Drag and drop $zipPath onto the page"
Write-Host "  OR: Extract zip and 'Load unpacked' from the extracted directory"
Write-Host "[dim90] Build PASSED"
exit 0
