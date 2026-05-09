param(
  [string]$ArtifactDir = "dist-artifacts",
  [string]$ManifestPath = "latest.json"
)

$ErrorActionPreference = "Stop"

function Assert-AnyMatch {
  param(
    [string[]]$Patterns,
    [string]$Label
  )

  foreach ($pattern in $Patterns) {
    $matches = Get-ChildItem -Path $ArtifactDir -Recurse -File -Filter $pattern -ErrorAction SilentlyContinue
    if ($matches -and $matches.Count -gt 0) {
      return $matches[0].FullName
    }
  }

  throw "Missing $Label artifact matching any of '$($Patterns -join "', '")' under '$ArtifactDir'."
}

function Assert-ManifestArtifact {
  param(
    [string]$Url,
    [string]$Platform
  )

  $assetName = [System.IO.Path]::GetFileName(([Uri]$Url).LocalPath)
  $assetName = [Uri]::UnescapeDataString($assetName)
  $matches = Get-ChildItem -Path $ArtifactDir -Recurse -File -Filter $assetName -ErrorAction SilentlyContinue
  if (-not $matches -or $matches.Count -eq 0) {
    throw "latest.json platform '$Platform' URL points to '$assetName', but that artifact was not downloaded."
  }
}

if (-not (Test-Path $ArtifactDir)) {
  throw "Artifact directory '$ArtifactDir' does not exist."
}

$checks = @(
  @{ Patterns = @("*.exe", "*.msi"); Label = "Windows installer" },
  @{ Patterns = @("*.exe.sig", "*.msi.sig", "*.nsis.sig"); Label = "Windows updater signature" },
  @{ Patterns = @("*aarch64*.app.tar.gz", "*arm64*.app.tar.gz"); Label = "macOS Apple Silicon updater bundle" },
  @{ Patterns = @("*aarch64*.app.tar.gz.sig", "*arm64*.app.tar.gz.sig"); Label = "macOS Apple Silicon updater signature" },
  @{ Patterns = @("*x64*.app.tar.gz", "*x86_64*.app.tar.gz"); Label = "macOS Intel updater bundle" },
  @{ Patterns = @("*x64*.app.tar.gz.sig", "*x86_64*.app.tar.gz.sig"); Label = "macOS Intel updater signature" },
  @{ Patterns = @("*.AppImage"); Label = "Linux AppImage" },
  @{ Patterns = @("*.AppImage.sig"); Label = "Linux updater signature" }
)

foreach ($check in $checks) {
  $path = Assert-AnyMatch -Patterns $check.Patterns -Label $check.Label
  Write-Host "ok: $($check.Label) -> $path"
}

if (Test-Path $ManifestPath) {
  $manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
  foreach ($platform in @("windows-x86_64", "darwin-aarch64", "darwin-x86_64", "linux-x86_64")) {
    if (-not $manifest.platforms.$platform) {
      throw "latest.json is missing platform '$platform'."
    }
    if (-not $manifest.platforms.$platform.signature) {
      throw "latest.json platform '$platform' is missing a signature."
    }
    if (-not $manifest.platforms.$platform.url) {
      throw "latest.json platform '$platform' is missing a URL."
    }
    Assert-ManifestArtifact -Url $manifest.platforms.$platform.url -Platform $platform
  }
  Write-Host "ok: latest.json contains all expected updater platforms"
}

Write-Host "release artifact verification passed"
