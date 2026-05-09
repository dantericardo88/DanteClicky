param(
  [string]$ArtifactDir = "dist-artifacts",
  [string]$ManifestPath = "latest.json"
)

$ErrorActionPreference = "Stop"

function Assert-Match {
  param(
    [string]$Pattern,
    [string]$Label
  )

  $matches = Get-ChildItem -Path $ArtifactDir -Recurse -File -Filter $Pattern -ErrorAction SilentlyContinue
  if (-not $matches -or $matches.Count -eq 0) {
    throw "Missing $Label artifact matching '$Pattern' under '$ArtifactDir'."
  }
  return $matches[0].FullName
}

if (-not (Test-Path $ArtifactDir)) {
  throw "Artifact directory '$ArtifactDir' does not exist."
}

$checks = @(
  @{ Pattern = "*.exe"; Label = "Windows installer" },
  @{ Pattern = "*.exe.sig"; Label = "Windows updater signature" },
  @{ Pattern = "*.app.tar.gz"; Label = "macOS updater bundle" },
  @{ Pattern = "*.app.tar.gz.sig"; Label = "macOS updater signature" },
  @{ Pattern = "*.AppImage"; Label = "Linux AppImage" },
  @{ Pattern = "*.AppImage.sig"; Label = "Linux updater signature" }
)

foreach ($check in $checks) {
  $path = Assert-Match -Pattern $check.Pattern -Label $check.Label
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
  }
  Write-Host "ok: latest.json contains all expected updater platforms"
}

Write-Host "release artifact verification passed"

