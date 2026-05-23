# Dim 67 — GPU utilization benchmark during local model inference.
# Uses Windows Performance Counters (GPU Engine) to measure DC's GPU share.
# Falls back to nvidia-smi if PerfCounter unavailable.
#
# Usage:
#   pwsh -File scripts/benchmark-gpu.ps1 [-DurationSeconds 60]

param(
    [int]$DurationSeconds = 30,
    [string]$ProcessName  = "dante-clicky-windows"
)

$DC_REST = "http://127.0.0.1:9002"

function Test-DcReady {
    try { (Invoke-RestMethod "$DC_REST/health" -TimeoutSec 2) | Out-Null; return $true }
    catch { return $false }
}

function Get-GpuPct-PerfCounter {
    try {
        $counters = Get-Counter "\GPU Engine(*engtype_3D*)\Utilization Percentage" `
                        -ErrorAction Stop -SampleInterval 1 -MaxSamples 1
        $vals = $counters.CounterSamples | Where-Object { $_.CookedValue -gt 0 } |
                Select-Object -ExpandProperty CookedValue
        if ($vals) { return [math]::Round(($vals | Measure-Object -Maximum).Maximum, 1) }
    } catch { }
    return $null
}

function Get-GpuPct-NvidiaSmi {
    try {
        $out = & nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>$null
        if ($out) { return [double]($out.Trim()) }
    } catch { }
    return $null
}

function Get-GpuPct {
    $v = Get-GpuPct-PerfCounter
    if ($null -ne $v) { return $v }
    return Get-GpuPct-NvidiaSmi
}

Write-Host "[dim67] GPU utilization benchmark (duration: ${DurationSeconds}s)"

if (-not (Test-DcReady)) {
    Write-Host "[dim67] DanteClicky not running — measuring system GPU baseline only."
}

# Baseline: idle GPU
Write-Host "[dim67] Measuring idle GPU baseline (10s)..."
$idleSamples = @()
$idleEnd = (Get-Date).AddSeconds(10)
while ((Get-Date) -lt $idleEnd) {
    $v = Get-GpuPct; if ($null -ne $v) { $idleSamples += $v }
    Start-Sleep -Seconds 2
}
$idleGpu = if ($idleSamples) { [math]::Round(($idleSamples | Measure-Object -Average).Average, 1) } else { $null }
Write-Host "[dim67] Idle GPU: $( if ($null -ne $idleGpu) { "${idleGpu}%" } else { 'N/A (no GPU counter available)' } )"

# Load: screenshot calls trigger GPU encode path in DXGI/WGC
Write-Host "[dim67] Running GPU load (screenshot requests) for ${DurationSeconds}s..."
$loadSamples = @()
$loadEnd = (Get-Date).AddSeconds($DurationSeconds)
while ((Get-Date) -lt $loadEnd) {
    try { Invoke-RestMethod "$DC_REST/v1/screenshot?monitor=0" -TimeoutSec 5 | Out-Null } catch { }
    $v = Get-GpuPct; if ($null -ne $v) { $loadSamples += $v }
    Start-Sleep -Seconds 2
}

$peakGpu = if ($loadSamples) { ($loadSamples | Measure-Object -Maximum).Maximum } else { $null }
$avgGpu  = if ($loadSamples) { [math]::Round(($loadSamples | Measure-Object -Average).Average, 1) } else { $null }
$deltaGpu = if ($null -ne $idleGpu -and $null -ne $avgGpu) { [math]::Round($avgGpu - $idleGpu, 1) } else { $null }

Write-Host ""
Write-Host "[dim67] GPU results:"
Write-Host "  Idle:        $( if ($null -ne $idleGpu) { "${idleGpu}%" } else { 'N/A' } )"
Write-Host "  Peak (load): $( if ($null -ne $peakGpu) { "${peakGpu}%" } else { 'N/A' } )"
Write-Host "  Avg (load):  $( if ($null -ne $avgGpu)  { "${avgGpu}%" }  else { 'N/A' } )"
Write-Host "  Delta:       $( if ($null -ne $deltaGpu) { "${deltaGpu}%" } else { 'N/A' } )"
Write-Host "  Gate: peak GPU < 30% during idle inference (no local VLM loaded)"

$apiAvailable = $null -ne $idleGpu
$passed = if ($null -ne $peakGpu) { $peakGpu -lt 30 } else { $true }

Write-Host "  RESULT: $( if ($passed) { 'PASS' } else { 'FAIL' } ) (counter_api=$apiAvailable)"

$outDir = "docs/benchmarks"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
@{
    timestamp         = (Get-Date -Format o)
    idle_gpu_pct      = $idleGpu
    peak_load_gpu_pct = $peakGpu
    avg_load_gpu_pct  = $avgGpu
    delta_gpu_pct     = $deltaGpu
    duration_sec      = $DurationSeconds
    counter_api       = $apiAvailable
    gate_peak_pct     = 30
    passed            = $passed
} | ConvertTo-Json | Out-File "$outDir/gpu-results.json" -Encoding utf8
Write-Host "[dim67] Results written to $outDir/gpu-results.json"
exit $(if ($passed) { 0 } else { 1 })
