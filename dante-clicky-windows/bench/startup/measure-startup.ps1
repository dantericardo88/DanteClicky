param(
  [Parameter(Mandatory = $true)]
  [string]$ExePath,
  [int]$Runs = 30,
  [int]$TimeoutSeconds = 10,
  [string]$ProbePath = (Join-Path $env:LOCALAPPDATA "com.danteforge.dante-clicky\startup-probe.jsonl"),
  [string]$OutPath = "bench\startup\results.json"
)

$ErrorActionPreference = "Stop"

function Get-Percentile {
  param(
    [Parameter(Mandatory = $true)]
    [AllowEmptyCollection()]
    [long[]]$Values,
    [Parameter(Mandatory = $true)]
    [double]$Percentile
  )

  if ($Values.Count -eq 0) {
    return $null
  }

  $sorted = $Values | Sort-Object
  $index = [Math]::Ceiling(($Percentile / 100.0) * $sorted.Count) - 1
  $index = [Math]::Max(0, [Math]::Min($sorted.Count - 1, $index))
  return [long]$sorted[$index]
}

$exe = (Resolve-Path $ExePath).Path
$processName = [IO.Path]::GetFileNameWithoutExtension($exe)
$existing = Get-Process -Name $processName -ErrorAction SilentlyContinue
if ($existing) {
  throw "Close existing $processName processes before measuring startup."
}

$probeDir = Split-Path $ProbePath -Parent
New-Item -ItemType Directory -Force -Path $probeDir | Out-Null
if (Test-Path $ProbePath) {
  Remove-Item -Force $ProbePath
}

$oldProbe = $env:DANTE_STARTUP_PROBE
$results = New-Object System.Collections.Generic.List[object]

try {
  $env:DANTE_STARTUP_PROBE = "1"

  for ($i = 1; $i -le $Runs; $i++) {
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $process = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden
    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    $marker = $null

    try {
      while ([DateTime]::UtcNow -lt $deadline) {
        if (Test-Path $ProbePath) {
          $lines = Get-Content -Path $ProbePath -Tail 30
          foreach ($line in $lines) {
            if ([string]::IsNullOrWhiteSpace($line)) {
              continue
            }
            try {
              $parsed = $line | ConvertFrom-Json
              $hasReadyElapsed = $parsed.PSObject.Properties.Name -contains "ready_elapsed_ms"
              $isNativeReady = (-not ($parsed.PSObject.Properties.Name -contains "marker")) -or $parsed.marker -eq "native_ready"
              if ([int]$parsed.pid -eq $process.Id -and $hasReadyElapsed -and $isNativeReady) {
                $marker = $parsed
                break
              }
            } catch {
              continue
            }
          }
        }

        if ($marker) {
          break
        }
        if ($process.HasExited) {
          break
        }
        Start-Sleep -Milliseconds 25
      }
    } finally {
      $watch.Stop()
      if (-not $process.HasExited) {
        Stop-Process -Id $process.Id -Force
      }
      $process.WaitForExit(5000) | Out-Null
    }

    if ($marker) {
      $results.Add([ordered]@{
        run = $i
        status = "ok"
        pid = $process.Id
        launch_observed_ms = [long]$watch.ElapsedMilliseconds
        app_ready_elapsed_ms = [long]$marker.ready_elapsed_ms
      }) | Out-Null
    } else {
      $results.Add([ordered]@{
        run = $i
        status = "timeout"
        pid = $process.Id
        launch_observed_ms = [long]$watch.ElapsedMilliseconds
        app_ready_elapsed_ms = $null
      }) | Out-Null
    }

    Start-Sleep -Milliseconds 750
  }
} finally {
  $env:DANTE_STARTUP_PROBE = $oldProbe
}

$successes = @($results | Where-Object { $_.status -eq "ok" })
$appReady = [long[]]@($successes | ForEach-Object { $_.app_ready_elapsed_ms })
$observed = [long[]]@($successes | ForEach-Object { $_.launch_observed_ms })

$summary = [ordered]@{
  exe = $exe
  runs_requested = $Runs
  runs_ok = $successes.Count
  runs_timeout = $Runs - $successes.Count
  app_ready_p50_ms = Get-Percentile -Values $appReady -Percentile 50
  app_ready_p95_ms = Get-Percentile -Values $appReady -Percentile 95
  launch_observed_p50_ms = Get-Percentile -Values $observed -Percentile 50
  launch_observed_p95_ms = Get-Percentile -Values $observed -Percentile 95
}

$report = [ordered]@{
  summary = $summary
  results = $results
}

$outDir = Split-Path $OutPath -Parent
if ($outDir) {
  New-Item -ItemType Directory -Force -Path $outDir | Out-Null
}
$report | ConvertTo-Json -Depth 5 | Set-Content -Path $OutPath -Encoding UTF8

$summary | ConvertTo-Json -Depth 3
if ($summary.runs_timeout -gt 0) {
  exit 1
}
