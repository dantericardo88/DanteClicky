param(
  [string]$ReleaseTag = "",
  [string]$OutputPath = "docs/cross-platform-smoke/dim47-release-readiness.json",
  [switch]$FailOnBlocked
)

$ErrorActionPreference = "Stop"

function Test-CommandExists {
  param([string]$Name)
  $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function New-Check {
  param(
    [string]$Name,
    [bool]$Passed,
    [string]$Detail
  )

  [PSCustomObject]@{
    name = $Name
    passed = $Passed
    detail = $Detail
  }
}

function Test-ContentHasToken {
  param(
    [string]$Content,
    [string]$Token
  )

  return $Content -match [regex]::Escape($Token)
}

function Test-ManualSmokeLogContent {
  param(
    [string]$Content,
    [string]$Platform,
    [string]$ExpectedReleaseTag
  )

  $issues = New-Object System.Collections.Generic.List[string]
  $requiredFields = @(
    "Tag",
    "GitHub release URL",
    "Workflow run URL",
    "Commit SHA",
    "Artifact filename",
    "Artifact SHA256",
    "Tester",
    "OS and version",
    "Hardware"
  )

  foreach ($field in $requiredFields) {
    if ($Content -notmatch "(?m)^- $([regex]::Escape($field)):\s*\S+") {
      $issues.Add("missing field '$field'")
    }
  }

  if ($Content -notmatch "(?m)^- Artifact SHA256:\s*[A-Fa-f0-9]{64}\s*$") {
    $issues.Add("Artifact SHA256 must be a 64-character hex digest")
  }
  if ($Content -notmatch "(?m)^- Workflow run URL:\s*https://github\.com/.+/actions/runs/\d+\s*$") {
    $issues.Add("Workflow run URL must point to a GitHub Actions run")
  }
  if ($ExpectedReleaseTag -and $Content -notmatch "(?m)^- GitHub release URL:\s*https://github\.com/.+/releases/tag/$([regex]::Escape($ExpectedReleaseTag))\s*$") {
    $issues.Add("GitHub release URL does not point to $ExpectedReleaseTag")
  }
  if ($ExpectedReleaseTag -and $Content -notmatch "(?m)^- Tag:\s*$([regex]::Escape($ExpectedReleaseTag))\s*$") {
    $issues.Add("Tag field does not match $ExpectedReleaseTag")
  }

  $trustTokens = @("latest.json", "signature", "gh attestation verify")
  switch ($Platform) {
    "windows" { $trustTokens += @("signtool verify") }
    "macos" { $trustTokens += @("codesign --verify", "spctl --assess", "xcrun stapler validate") }
    "linux" { $trustTokens += @(".AppImage.sig") }
  }

  foreach ($token in $trustTokens) {
    if (-not (Test-ContentHasToken -Content $Content -Token $token)) {
      $issues.Add("missing trust evidence token '$token'")
    }
  }

  $requiredRuntimeRows = @(
    "Install release artifact",
    "Launch from clean user profile",
    "Tray or menu bar visible",
    "Onboarding opens and completes",
    "Microphone permission path",
    "Screen capture permission path",
    "Screenshot capture works or explicit degraded state appears",
    "Global shortcut opens companion",
    "Chat turn completes",
    "Cursor/input action works or explicit degraded state appears",
    "Close-to-tray/menu bar behavior works",
    "Relaunch preserves expected state",
    "Updater check reaches signed manifest"
  )
  $degradedAllowed = @(
    "Screenshot capture works or explicit degraded state appears",
    "Cursor/input action works or explicit degraded state appears"
  )

  foreach ($row in $requiredRuntimeRows) {
    $allowedResult = if ($degradedAllowed -contains $row) { "(PASS|DEGRADED)" } else { "PASS" }
    $pattern = "(?im)^\|\s*$([regex]::Escape($row))\s*\|\s*$allowedResult\s*\|\s*\S.*\|\s*$"
    if ($Content -notmatch $pattern) {
      $issues.Add("runtime row '$row' is not marked with an accepted result and non-empty evidence")
    }
  }

  return @($issues)
}

function Test-TrustEvidenceContent {
  param(
    [string]$Content,
    [string]$Kind
  )

  $issues = New-Object System.Collections.Generic.List[string]
  $requiredTokens = switch ($Kind) {
    "windows" { @("signtool verify /pa /all /tw /v", "Successfully verified", "timestamp") }
    "macos" { @("codesign --verify --deep --strict --verbose=2", "spctl --assess --type execute", "xcrun stapler validate") }
    "linux" { @("===== AppImage =====", "===== Tauri updater signature =====") }
    "attestation" { @("GitHub artifact attestation evidence", "attestation-url=", "subject-path=") }
    default { @() }
  }

  if ($requiredTokens.Count -eq 0) {
    $issues.Add("unknown trust evidence kind '$Kind'")
  }

  foreach ($token in $requiredTokens) {
    if (-not (Test-ContentHasToken -Content $Content -Token $token)) {
      $issues.Add("missing release trust evidence token '$token'")
    }
  }

  return @($issues)
}

function Get-ManualSmokeStatus {
  param(
    [string]$Platform,
    [string]$ExpectedReleaseTag
  )

  $tagPattern = if ($ExpectedReleaseTag) {
    [regex]::Escape($ExpectedReleaseTag)
  } else {
    "v\d+\.\d+\.\d+[^.]*"
  }
  $namePattern = "^\d{4}-\d{2}-\d{2}-$Platform-$tagPattern\.md$"

  $matches = Get-ChildItem -Path "docs/cross-platform-smoke" -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match $namePattern } |
    Sort-Object LastWriteTime -Descending

  if ($matches.Count -eq 0) {
    return New-Check "manual-smoke-$Platform" $false "No strict dated $Platform smoke log matching '$namePattern' found under docs/cross-platform-smoke."
  }

  foreach ($candidate in $matches) {
    $content = Get-Content -LiteralPath $candidate.FullName -Raw
    $issues = Test-ManualSmokeLogContent -Content $content -Platform $Platform -ExpectedReleaseTag $ExpectedReleaseTag
    if ($issues.Count -eq 0) {
      return New-Check "manual-smoke-$Platform" $true "Validated log: $($candidate.FullName)"
    }
  }

  return New-Check "manual-smoke-$Platform" $false "Found $Platform smoke log candidates, but none passed strict validation. Latest issues: $($issues -join '; ')"
}

$checks = New-Object System.Collections.Generic.List[object]

$configPath = "src-tauri/tauri.conf.json"
if (-not (Test-Path -LiteralPath $configPath)) {
  throw "Missing $configPath"
}

$configText = Get-Content -LiteralPath $configPath -Raw
$checks.Add((New-Check "updater-pubkey-not-placeholder" (-not $configText.Contains("__TAURI_UPDATER_PUBKEY__")) "src-tauri/tauri.conf.json must contain the real Tauri updater public key."))
$checks.Add((New-Check "updater-artifacts-enabled" ($configText.Contains('"createUpdaterArtifacts": true')) "Tauri must emit updater bundles and .sig files."))

$releaseWorkflowPath = ".github/workflows/release.yml"
if (Test-Path -LiteralPath $releaseWorkflowPath) {
  $releaseWorkflowText = Get-Content -LiteralPath $releaseWorkflowPath -Raw
  $movingActionRefs = [regex]::Matches($releaseWorkflowText, "(?m)^\s*uses:\s+\S+@(v\d+|stable)\b")
  $checks.Add((New-Check "release-workflow-actions-sha-pinned" ($movingActionRefs.Count -eq 0) "Release workflow must pin actions used for signing/publishing to full commit SHAs, not moving tags."))
  $checks.Add((New-Check "release-workflow-attestations-configured" ($releaseWorkflowText.Contains("actions/attest@") -and $releaseWorkflowText.Contains("attestations: write") -and $releaseWorkflowText.Contains("id-token: write")) "Release workflow must generate GitHub artifact attestations for release artifacts and latest.json."))
  $checks.Add((New-Check "release-workflow-developer-id-only" ($releaseWorkflowText.Contains("Developer ID Application") -and -not $releaseWorkflowText.Contains("Developer ID Application|Apple Distribution")) "macOS direct GitHub distribution must require Developer ID Application signing, not Apple Distribution."))
} else {
  $checks.Add((New-Check "release-workflow-exists" $false "Missing .github/workflows/release.yml."))
}

$requiredSecrets = @(
  "TAURI_SIGNING_PRIVATE_KEY",
  "TAURI_SIGNING_PRIVATE_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_PASSWORD",
  "APPLE_TEAM_ID",
  "APPLE_CERTIFICATE",
  "APPLE_CERTIFICATE_PASSWORD",
  "KEYCHAIN_PASSWORD",
  "WINDOWS_CERTIFICATE",
  "WINDOWS_CERTIFICATE_PASSWORD"
)

$secretNames = @()
if (Test-CommandExists "gh") {
  try {
    $secretNames = @(gh secret list --json name | ConvertFrom-Json | ForEach-Object { $_.name })
  } catch {
    $checks.Add((New-Check "github-secret-list" $false "Unable to list GitHub secrets with gh: $($_.Exception.Message)"))
  }
} else {
  $checks.Add((New-Check "github-cli" $false "gh CLI is not installed or not on PATH."))
}

foreach ($secret in $requiredSecrets) {
  $checks.Add((New-Check "secret-$secret" ($secretNames -contains $secret) "Required by .github/workflows/release.yml release preflight."))
}

$manualPlatforms = @("windows", "macos", "linux")
foreach ($platform in $manualPlatforms) {
  $checks.Add((Get-ManualSmokeStatus -Platform $platform -ExpectedReleaseTag $ReleaseTag))
}

$releaseEvidence = $null
if ($ReleaseTag) {
  if (-not (Test-CommandExists "gh")) {
    $checks.Add((New-Check "release-$ReleaseTag" $false "Cannot inspect release because gh CLI is unavailable."))
  } else {
    $previousErrorActionPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = "Continue"
      $releaseJson = gh release view $ReleaseTag --json tagName,url,targetCommitish,createdAt,isDraft,isPrerelease,assets 2>$null
      $releaseViewExit = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($releaseViewExit -ne 0 -or -not $releaseJson) {
      $checks.Add((New-Check "release-$ReleaseTag" $false "GitHub release was not found or gh release view failed."))
    } else {
      $release = $releaseJson | ConvertFrom-Json
      $checks.Add((New-Check "release-not-draft" (-not [bool]$release.isDraft) "GitHub release must be published, not left as a draft."))
      $checks.Add((New-Check "release-not-prerelease" (-not [bool]$release.isPrerelease) "GitHub release must be a stable release, not a prerelease."))
      $assetNames = @($release.assets | ForEach-Object { $_.name })
      $patterns = @(
        @{ Name = "windows-installer"; Pattern = "\.(exe|msi)$" },
        @{ Name = "windows-updater-signature"; Pattern = "\.(exe|msi|nsis)\.sig$" },
        @{ Name = "macos-arm-updater-bundle"; Pattern = "(aarch64|arm64).*\.app\.tar\.gz$" },
        @{ Name = "macos-arm-updater-signature"; Pattern = "(aarch64|arm64).*\.app\.tar\.gz\.sig$" },
        @{ Name = "macos-intel-updater-bundle"; Pattern = "(x64|x86_64).*\.app\.tar\.gz$" },
        @{ Name = "macos-intel-updater-signature"; Pattern = "(x64|x86_64).*\.app\.tar\.gz\.sig$" },
        @{ Name = "linux-appimage"; Pattern = "\.AppImage$" },
        @{ Name = "linux-updater-signature"; Pattern = "\.AppImage\.sig$" },
        @{ Name = "latest-json"; Pattern = "^latest\.json$" },
        @{ Name = "windows-trust-evidence"; Pattern = "^danteclicky-windows-x86_64-windows-signing\.txt$" },
        @{ Name = "macos-arm-trust-evidence"; Pattern = "^danteclicky-macos-aarch64-macos-signing-notarization\.txt$" },
        @{ Name = "macos-intel-trust-evidence"; Pattern = "^danteclicky-macos-x86_64-macos-signing-notarization\.txt$" },
        @{ Name = "linux-trust-evidence"; Pattern = "^danteclicky-linux-x86_64-linux-appimage-updater\.txt$" },
        @{ Name = "windows-attestation-evidence"; Pattern = "^danteclicky-windows-x86_64-github-attestation\.txt$" },
        @{ Name = "macos-arm-attestation-evidence"; Pattern = "^danteclicky-macos-aarch64-github-attestation\.txt$" },
        @{ Name = "macos-intel-attestation-evidence"; Pattern = "^danteclicky-macos-x86_64-github-attestation\.txt$" },
        @{ Name = "linux-attestation-evidence"; Pattern = "^danteclicky-linux-x86_64-github-attestation\.txt$" },
        @{ Name = "release-manifest-attestation-evidence"; Pattern = "^danteclicky-release-manifest-attestation\.txt$" },
        @{ Name = "checksums"; Pattern = "^SHA256SUMS$" }
      )

      foreach ($item in $patterns) {
        $checks.Add((New-Check "release-asset-$($item.Name)" (($assetNames | Where-Object { $_ -match $item.Pattern }).Count -gt 0) "Required release asset pattern: $($item.Pattern)"))
      }

      $downloadDir = Join-Path ([System.IO.Path]::GetTempPath()) "dim47-release-$([guid]::NewGuid().ToString('N'))"
      try {
        New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null
        gh release download $ReleaseTag --dir $downloadDir --clobber | Out-Null
        $checks.Add((New-Check "release-assets-downloadable" $true "Downloaded release assets to a temporary directory for verification."))

        $checksumsPath = Join-Path $downloadDir "SHA256SUMS"
        if (-not (Test-Path -LiteralPath $checksumsPath)) {
          $checks.Add((New-Check "release-checksums-content" $false "Missing release checksum manifest: SHA256SUMS"))
        } else {
          $checksumsContent = Get-Content -LiteralPath $checksumsPath -Raw
          $checksumIssues = New-Object System.Collections.Generic.List[string]
          if ($checksumsContent -notmatch "(?m)^[a-fA-F0-9]{64}\s+.+latest\.json\s*$") {
            $checksumIssues.Add("missing latest.json checksum")
          }
          foreach ($checksumPattern in @("\.(exe|msi)\s*$", "\.app\.tar\.gz\s*$", "\.AppImage\s*$")) {
            if ($checksumsContent -notmatch "(?m)^[a-fA-F0-9]{64}\s+.+$checksumPattern") {
              $checksumIssues.Add("missing checksum line matching $checksumPattern")
            }
          }
          $badChecksumLines = @($checksumsContent -split "`r?`n" | Where-Object {
            $_.Trim() -and $_ -notmatch "^[a-fA-F0-9]{64}\s+.+$"
          })
          if ($badChecksumLines.Count -gt 0) {
            $checksumIssues.Add("contains malformed checksum lines")
          }
          $checks.Add((New-Check "release-checksums-content" ($checksumIssues.Count -eq 0) "SHA256SUMS: $($checksumIssues -join '; ')"))
        }

        $trustEvidenceFiles = @(
          @{ Name = "windows"; Kind = "windows"; File = "danteclicky-windows-x86_64-windows-signing.txt" },
          @{ Name = "macos-arm"; Kind = "macos"; File = "danteclicky-macos-aarch64-macos-signing-notarization.txt" },
          @{ Name = "macos-intel"; Kind = "macos"; File = "danteclicky-macos-x86_64-macos-signing-notarization.txt" },
          @{ Name = "linux"; Kind = "linux"; File = "danteclicky-linux-x86_64-linux-appimage-updater.txt" },
          @{ Name = "windows-attestation"; Kind = "attestation"; File = "danteclicky-windows-x86_64-github-attestation.txt" },
          @{ Name = "macos-arm-attestation"; Kind = "attestation"; File = "danteclicky-macos-aarch64-github-attestation.txt" },
          @{ Name = "macos-intel-attestation"; Kind = "attestation"; File = "danteclicky-macos-x86_64-github-attestation.txt" },
          @{ Name = "linux-attestation"; Kind = "attestation"; File = "danteclicky-linux-x86_64-github-attestation.txt" },
          @{ Name = "release-manifest-attestation"; Kind = "attestation"; File = "danteclicky-release-manifest-attestation.txt" }
        )

        foreach ($evidence in $trustEvidenceFiles) {
          $evidenceName = $evidence["Name"]
          $evidenceKind = $evidence["Kind"]
          $evidenceFile = $evidence["File"]
          $evidencePath = Join-Path $downloadDir $evidenceFile
          if (-not (Test-Path -LiteralPath $evidencePath)) {
            $checks.Add((New-Check "release-trust-evidence-content-$evidenceName" $false "Missing release trust evidence file: $evidenceFile"))
            continue
          }

          $evidenceContent = Get-Content -LiteralPath $evidencePath -Raw
          $evidenceIssues = Test-TrustEvidenceContent -Content $evidenceContent -Kind $evidenceKind
          $checks.Add((New-Check "release-trust-evidence-content-$evidenceName" ($evidenceIssues.Count -eq 0) "Trust evidence file ${evidenceFile}: $($evidenceIssues -join '; ')"))
        }

        $manifestPath = Join-Path $downloadDir "latest.json"
        $psExe = if (Test-CommandExists "powershell") { "powershell" } elseif (Test-CommandExists "pwsh") { "pwsh" } else { "" }
        if (-not $psExe) {
          $checks.Add((New-Check "release-artifact-manifest-verification" $false "Could not find powershell or pwsh to run scripts/verify-release-artifacts.ps1."))
        } else {
          & $psExe -NoProfile -ExecutionPolicy Bypass -File scripts/verify-release-artifacts.ps1 -ArtifactDir $downloadDir -ManifestPath $manifestPath -ExpectedTag $ReleaseTag -ExpectedRepository "dantericardo88/DanteClicky" | Out-Host
          $checks.Add((New-Check "release-artifact-manifest-verification" $true "Downloaded release assets passed scripts/verify-release-artifacts.ps1."))
        }

        try {
          $attestationTargets = @(Get-ChildItem -Path $downloadDir -File -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -match '(\.exe|\.msi|\.AppImage|\.app\.tar\.gz|^latest\.json)$' })
          if ($attestationTargets.Count -eq 0) {
            $checks.Add((New-Check "release-artifact-attestations" $false "No release artifacts were available for gh attestation verification."))
          } else {
            foreach ($target in $attestationTargets) {
              gh attestation verify $target.FullName --repo "dantericardo88/DanteClicky" | Out-Host
            }
            $checks.Add((New-Check "release-artifact-attestations" $true "gh attestation verify passed for $($attestationTargets.Count) downloaded release artifacts including latest.json."))
          }
        } catch {
          $checks.Add((New-Check "release-artifact-attestations" $false "gh attestation verify failed for downloaded release artifacts: $($_.Exception.Message)"))
        }
      } catch {
        $checks.Add((New-Check "release-artifact-manifest-verification" $false "Downloaded release asset verification failed: $($_.Exception.Message)"))
      } finally {
        if (Test-Path -LiteralPath $downloadDir) {
          Remove-Item -LiteralPath $downloadDir -Recurse -Force
        }
      }

      $releaseEvidence = [PSCustomObject]@{
        tag = $release.tagName
        url = $release.url
        targetCommitish = $release.targetCommitish
        createdAt = $release.createdAt
        isDraft = $release.isDraft
        isPrerelease = $release.isPrerelease
        assets = $assetNames
      }
    }
  }
} else {
  $checks.Add((New-Check "release-tag-provided" $false "Pass -ReleaseTag vX.Y.Z so this gate can inspect signed release assets and latest.json."))
}

$passed = @($checks | Where-Object { $_.passed }).Count
$failed = @($checks | Where-Object { -not $_.passed })
$status = if ($failed.Count -eq 0) { "ready-for-9-gate-review" } else { "blocked" }

$report = [PSCustomObject]@{
  dimension = 47
  generatedAt = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  releaseTag = $ReleaseTag
  status = $status
  passedChecks = $passed
  failedChecks = $failed.Count
  checks = $checks
  release = $releaseEvidence
  scoreGate = [PSCustomObject]@{
    currentCap = 8.2
    ninePlusRequires = @(
      "Real updater public key and private key secret",
      "Windows code signing certificate secret and signed installer verification",
      "macOS Developer ID certificate, notarization credentials, and notarization/staple verification",
      "Linux updater signature verification for AppImage",
      "latest.json with non-empty signatures and release URLs for every platform",
      "SHA256SUMS covering release artifacts and latest.json",
      "Release-attached trust evidence logs for Windows signing, macOS signing/notarization/stapling, and Linux AppImage updater signatures",
      "GitHub artifact attestations for release artifacts, latest.json, SHA256SUMS, and trust evidence verified with gh attestation verify",
      "A green -ReleaseTag readiness run against downloadable release assets",
      "Strict dated manual smoke logs for Windows, macOS, and Linux using release artifacts"
    )
  }
}

$outDir = Split-Path -Parent $OutputPath
if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Path $outDir | Out-Null
}
$reportJson = (($report | ConvertTo-Json -Depth 20) -split "`r?`n" | ForEach-Object { $_.TrimEnd() }) -join "`n"
$resolvedOutputPath = if (Test-Path -LiteralPath $OutputPath) {
  (Resolve-Path -LiteralPath $OutputPath).Path
} else {
  $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutputPath)
}
[System.IO.File]::WriteAllText($resolvedOutputPath, $reportJson + "`n", [System.Text.UTF8Encoding]::new($false))

Write-Host "Dim 47 release readiness: $status ($passed passed, $($failed.Count) failed)"
Write-Host "Report: $OutputPath"

if ($FailOnBlocked -and $failed.Count -gt 0) {
  foreach ($check in $failed) {
    Write-Host "blocked: $($check.name) - $($check.detail)"
  }
  exit 1
}
