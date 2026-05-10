param(
  [string]$ArtifactDir = "dist-artifacts",
  [string]$ManifestPath = "latest.json",
  [string]$ExpectedTag = "",
  [string]$ExpectedRepository = ""
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

  return $matches[0].FullName
}

function Assert-ManifestUrl {
  param(
    [string]$Url,
    [string]$Platform,
    [string]$ExpectedTag,
    [string]$ExpectedRepository
  )

  $uri = [Uri]$Url
  if ($uri.Scheme -ne "https") {
    throw "latest.json platform '$Platform' URL must use https."
  }
  if ($ExpectedRepository -and $uri.Host -ne "github.com") {
    throw "latest.json platform '$Platform' URL must point to github.com for $ExpectedRepository."
  }
  if ($ExpectedRepository) {
    $expectedPath = "/$ExpectedRepository/releases/download/"
    if (-not $uri.AbsolutePath.StartsWith($expectedPath, [System.StringComparison]::OrdinalIgnoreCase)) {
      throw "latest.json platform '$Platform' URL does not point to $ExpectedRepository release downloads."
    }
  }
  if ($ExpectedTag -and $uri.AbsolutePath -notmatch "/releases/download/$([regex]::Escape($ExpectedTag))/") {
    throw "latest.json platform '$Platform' URL does not point to release tag '$ExpectedTag'."
  }
}

function Assert-ManifestSignature {
  param(
    [string]$ArtifactPath,
    [string]$ManifestSignature,
    [string]$Platform
  )

  $sigName = "$([System.IO.Path]::GetFileName($ArtifactPath)).sig"
  $sigMatches = Get-ChildItem -Path $ArtifactDir -Recurse -File -Filter $sigName -ErrorAction SilentlyContinue
  if (-not $sigMatches -or $sigMatches.Count -eq 0) {
    throw "latest.json platform '$Platform' references artifact '$([System.IO.Path]::GetFileName($ArtifactPath))', but '$sigName' was not downloaded."
  }

  $sigContent = (Get-Content -LiteralPath $sigMatches[0].FullName -Raw).Trim()
  if (-not $sigContent) {
    throw "Updater signature file '$sigName' is empty."
  }
  if ($ManifestSignature.Trim() -ne $sigContent) {
    throw "latest.json platform '$Platform' signature does not match '$sigName' content."
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

if (-not (Test-Path $ManifestPath)) {
  throw "Manifest '$ManifestPath' does not exist."
}

$manifest = Get-Content $ManifestPath -Raw | ConvertFrom-Json
if ($manifest.version -notmatch "^\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$") {
  throw "latest.json version '$($manifest.version)' is not a valid SemVer-like version."
}
if (-not $manifest.pub_date -or $manifest.pub_date -notmatch "^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$") {
  throw "latest.json pub_date must be an RFC3339 UTC timestamp like 2026-05-10T00:00:00Z."
}
if ($ExpectedTag) {
  $expectedVersion = $ExpectedTag.TrimStart("v")
  if ($manifest.version -ne $expectedVersion) {
    throw "latest.json version '$($manifest.version)' does not match expected tag '$ExpectedTag'."
  }
}
$requiredPlatforms = @("windows-x86_64", "darwin-aarch64", "darwin-x86_64", "linux-x86_64")
$platformKeys = @($manifest.platforms.PSObject.Properties.Name)
foreach ($platformKey in $platformKeys) {
  if ($requiredPlatforms -notcontains $platformKey) {
    throw "latest.json contains unexpected platform key '$platformKey'."
  }
}
foreach ($platform in $requiredPlatforms) {
  if (-not $manifest.platforms.$platform) {
    throw "latest.json is missing platform '$platform'."
  }
  if (-not $manifest.platforms.$platform.signature) {
    throw "latest.json platform '$platform' is missing a signature."
  }
  if (-not $manifest.platforms.$platform.url) {
    throw "latest.json platform '$platform' is missing a URL."
  }
  Assert-ManifestUrl -Url $manifest.platforms.$platform.url -Platform $platform -ExpectedTag $ExpectedTag -ExpectedRepository $ExpectedRepository
  $artifactPath = Assert-ManifestArtifact -Url $manifest.platforms.$platform.url -Platform $platform
  Assert-ManifestSignature -ArtifactPath $artifactPath -ManifestSignature $manifest.platforms.$platform.signature -Platform $platform
}
Write-Host "ok: latest.json contains all expected updater platforms"

Write-Host "release artifact verification passed"
