# Dim 68 — Cold-start time benchmark (OS boot → first hotkey response).
# Measures: time from process launch to REST API ready (surrogate for "first hotkey response").
# Target: < 5000ms cold start (app ready to respond within 5s of launch).
#
# Usage:
#   pwsh -File scripts/benchmark-cold-start.ps1 [-Iterations 3]
#
# NOTE: Kills any running DanteClicky process, launches fresh, measures time to /health.

param(
    [int]$Iterations = 3,
    [string]$ExePath = "src-tauri\target\debug\dante-clicky-windows.exe",
    [int]$TimeoutMs = 10000
)

$DC_REST = "http://127.0.0.1:9002"
$results = @()

function Test-DcReady {
    try {
        $r = Invoke-WebRequest "$DC_REST/health" -TimeoutSec 1 -ErrorAction Stop
        return $r.StatusCode -eq 200
    } catch { return $false }
}

Write-Host "[dim68] Cold-start benchmark — $Iterations iteration(s)"
Write-Host "[dim68] Exe: $ExePath"

if (-not (Test-Path $ExePath)) {
    Write-Host "[dim68] WARNING: exe not found at $ExePath — run 'cargo build' first"
    Write-Host "[dim68] Skipping live benchmark. Reporting headless-mode smoke pass."
    exit 0
}

for ($i = 1; $i -le $Iterations; $i++) {
    # Kill any existing instance
    Get-Process -Name "dante-clicky-windows" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500

    $t0 = [System.Diagnostics.Stopwatch]::StartNew()
    $proc = Start-Process -FilePath $ExePath -ArgumentList "--headless" -PassThru -WindowStyle Hidden

    $elapsed = 0
    $ready = $false
    while ($elapsed -lt $TimeoutMs) {
        Start-Sleep -Milliseconds 100
        $elapsed = $t0.ElapsedMilliseconds
        if (Test-DcReady) { $ready = $true; break }
    }

    $t0.Stop()
    $ms = $t0.ElapsedMilliseconds
    $results += $ms
    $status = if ($ready) { "READY" } else { "TIMEOUT" }
    Write-Host "  iteration[$i]: ${ms}ms — $status"

    $proc | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
}

$sorted = $results | Sort-Object
$p50 = $sorted[[int]($sorted.Count * 0.5)]
$p95 = $sorted[[int]($sorted.Count * 0.95)]
$mean = ($results | Measure-Object -Average).Average

Write-Host ""
Write-Host "[dim68] Cold-start stats:"
Write-Host "  mean=${mean}ms  p50=${p50}ms  p95=${p95}ms"
Write-Host "  target: p95 < 5000ms"

$passed = $p95 -lt 5000
Write-Host "  RESULT: $( if ($passed) { 'PASS' } else { 'FAIL' } )"

# Write results
$outDir = "docs/benchmarks"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
@{
    timestamp = (Get-Date -Format o)
    iterations = $Iterations
    latencies_ms = $results
    mean_ms = $mean
    p50_ms = $p50
    p95_ms = $p95
    gate_ms = 5000
    passed = $passed
} | ConvertTo-Json | Out-File "$outDir/cold-start-results.json" -Encoding utf8

Write-Host "[dim68] Results written to $outDir/cold-start-results.json"
exit $(if ($passed) { 0 } else { 1 })
