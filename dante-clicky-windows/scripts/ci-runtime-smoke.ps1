param(
  [Parameter(Mandatory = $true)]
  [string]$ExePath,

  [int]$TimeoutSeconds = 25,

  [string[]]$RequiredMarkers = @("tray_ready", "hotkey_registered", "native_ready"),

  [string]$ProbePath = (Join-Path (Get-Location) "target/runtime-smoke/startup-probe.jsonl"),

  [string]$OutPath = (Join-Path (Get-Location) "target/runtime-smoke/runtime-smoke.json")
)

$ErrorActionPreference = "Stop"

function Resolve-UncreatedPath([string]$Path) {
  return $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
}

$exe = Resolve-Path -LiteralPath $ExePath
$probeFullPath = Resolve-UncreatedPath $ProbePath
$outFullPath = Resolve-UncreatedPath $OutPath
$smokeDir = Split-Path -Parent $outFullPath
$probeDir = Split-Path -Parent $probeFullPath

New-Item -ItemType Directory -Force -Path $smokeDir | Out-Null
New-Item -ItemType Directory -Force -Path $probeDir | Out-Null
Remove-Item -LiteralPath $probeFullPath -Force -ErrorAction SilentlyContinue

$previousProbe = $env:DANTE_STARTUP_PROBE
$previousProbePath = $env:DANTE_STARTUP_PROBE_PATH
$env:DANTE_STARTUP_PROBE = "1"
$env:DANTE_STARTUP_PROBE_PATH = $probeFullPath

$process = $null
$startedAt = Get-Date
$found = @{}
$events = @()
$status = "failed"
$errorMessage = $null

try {
  $process = Start-Process `
    -FilePath $exe.Path `
    -WorkingDirectory (Split-Path -Parent $exe.Path) `
    -PassThru

  while (((Get-Date) - $startedAt).TotalSeconds -lt $TimeoutSeconds) {
    if (Test-Path -LiteralPath $probeFullPath) {
      $events = Get-Content -LiteralPath $probeFullPath |
        Where-Object { $_.Trim().Length -gt 0 } |
        ForEach-Object { $_ | ConvertFrom-Json }

      foreach ($event in $events) {
        if ($event.pid -eq $process.Id -and $event.marker) {
          $found[$event.marker] = $event
        }
      }

      $missing = @($RequiredMarkers | Where-Object { -not $found.ContainsKey($_) })
      if ($missing.Count -eq 0) {
        $status = "passed"
        break
      }
    }

    if ($process.HasExited) {
      throw "Runtime smoke process exited before markers were observed. ExitCode=$($process.ExitCode)"
    }

    Start-Sleep -Milliseconds 200
  }

  $missing = @($RequiredMarkers | Where-Object { -not $found.ContainsKey($_) })
  if ($missing.Count -gt 0) {
    throw "Timed out waiting for startup markers: $($missing -join ', ')"
  }
} catch {
  $errorMessage = $_.Exception.Message
  $status = "failed"
} finally {
  if ($process -and -not $process.HasExited) {
    Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    $process.WaitForExit(5000) | Out-Null
  }

  $env:DANTE_STARTUP_PROBE = $previousProbe
  $env:DANTE_STARTUP_PROBE_PATH = $previousProbePath
}

$nativeReady = $null
if ($found.ContainsKey("native_ready")) {
  $nativeReady = $found["native_ready"].ready_elapsed_ms
}

$report = [ordered]@{
  status = $status
  executable = $exe.Path
  pid = if ($process) { $process.Id } else { $null }
  timeoutSeconds = $TimeoutSeconds
  elapsedMs = [int](((Get-Date) - $startedAt).TotalMilliseconds)
  requiredMarkers = $RequiredMarkers
  foundMarkers = @($found.Keys | Sort-Object)
  nativeReadyMs = $nativeReady
  probePath = $probeFullPath
  eventCount = @($events).Count
  error = $errorMessage
}

$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outFullPath -Encoding UTF8

if ($status -ne "passed") {
  Get-Content -LiteralPath $outFullPath | Write-Error
  exit 1
}

Get-Content -LiteralPath $outFullPath
