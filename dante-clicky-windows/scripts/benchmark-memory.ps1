# Dim 65 — Memory footprint benchmark.
# Measures DC's RSS (Working Set) at idle and after 10 minutes of simulated load.
# Target: idle RSS < 200MB, load RSS < 400MB.
#
# Usage:
#   pwsh -File scripts/benchmark-memory.ps1 [-DurationMinutes 1]

param(
    [int]$DurationMinutes = 1,
    [string]$ProcessName = "dante-clicky-windows"
)

$DC_REST = "http://127.0.0.1:9002"

function Get-DcMemoryMB {
    $proc = Get-Process -Name $ProcessName -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $proc) { return $null }
    return [math]::Round($proc.WorkingSet64 / 1MB, 1)
}

function Test-DcReady {
    try { (Invoke-RestMethod "$DC_REST/health" -TimeoutSec 2) | Out-Null; return $true }
    catch { return $false }
}

Write-Host "[dim65] Memory footprint benchmark (duration: ${DurationMinutes}min)"

if (-not (Test-DcReady)) {
    Write-Host "[dim65] DanteClicky not running — exiting. Start the app first."
    exit 1
}

$idle_mb = Get-DcMemoryMB
Write-Host "[dim65] Idle memory: ${idle_mb}MB"

# Simulate load: rapid screenshot + tool-list calls
Write-Host "[dim65] Running load simulation for ${DurationMinutes} minute(s)..."
$samples = @()
$end = (Get-Date).AddMinutes($DurationMinutes)

while ((Get-Date) -lt $end) {
    try {
        Invoke-RestMethod "$DC_REST/v1/screenshot?monitor=0" -TimeoutSec 5 | Out-Null
        Invoke-RestMethod "$DC_REST/v1/tools" -TimeoutSec 2 | Out-Null
        Invoke-RestMethod "$DC_REST/v1/events?limit=10" -TimeoutSec 2 | Out-Null
    } catch { }
    $mb = Get-DcMemoryMB
    if ($mb) { $samples += $mb }
    Start-Sleep -Seconds 5
}

$peak_mb = if ($samples) { ($samples | Measure-Object -Maximum).Maximum } else { $idle_mb }
$avg_mb = if ($samples) { [math]::Round(($samples | Measure-Object -Average).Average, 1) } else { $idle_mb }

Write-Host ""
Write-Host "[dim65] Memory results:"
Write-Host "  Idle: ${idle_mb}MB"
Write-Host "  Peak under load: ${peak_mb}MB"
Write-Host "  Average under load: ${avg_mb}MB"
Write-Host "  Gates: idle < 200MB, load < 400MB"

$passed = $idle_mb -lt 200 -and $peak_mb -lt 400
Write-Host "  RESULT: $( if ($passed) { 'PASS' } else { 'FAIL' } )"

$outDir = "docs/benchmarks"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
@{
    timestamp = (Get-Date -Format o)
    idle_mb = $idle_mb
    peak_load_mb = $peak_mb
    avg_load_mb = $avg_mb
    duration_min = $DurationMinutes
    gate_idle_mb = 200
    gate_load_mb = 400
    passed = $passed
} | ConvertTo-Json | Out-File "$outDir/memory-results.json" -Encoding utf8
Write-Host "[dim65] Results written to $outDir/memory-results.json"
exit $(if ($passed) { 0 } else { 1 })
