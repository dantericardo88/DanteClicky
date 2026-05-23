# Dim 18 — Screen capture speed benchmark.
# Measures p50/p95/p99 latency for the REST screenshot endpoint over N iterations.
# Gate: p95 screenshot capture latency < 200ms.
#
# Usage: pwsh -File scripts/benchmark-capture-speed.ps1 [-Iterations 50]

param(
    [int]$Iterations = 50,
    [int]$Monitor    = 0
)

$DC_REST = "http://127.0.0.1:9002"

function Test-DcReady {
    try { (Invoke-RestMethod "$DC_REST/health" -TimeoutSec 2) | Out-Null; return $true }
    catch { return $false }
}

Write-Host "[dim18] Screen capture speed benchmark (${Iterations} iterations, monitor ${Monitor})"

if (-not (Test-DcReady)) {
    Write-Host "[dim18] DanteClicky not running. Start the app first."
    exit 1
}

# Warm-up: 3 discarded calls
for ($i = 0; $i -lt 3; $i++) {
    try { Invoke-RestMethod "$DC_REST/v1/screenshot?monitor=$Monitor" -TimeoutSec 10 | Out-Null } catch { }
}

$latencies = @()
$errors = 0
Write-Host "[dim18] Running $Iterations capture iterations..."

for ($i = 0; $i -lt $Iterations; $i++) {
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    try {
        $result = Invoke-RestMethod "$DC_REST/v1/screenshot?monitor=$Monitor" -TimeoutSec 10
        $sw.Stop()
        if ($result -and ($result.data -or $result.width)) {
            $latencies += $sw.ElapsedMilliseconds
        } else {
            $errors++
        }
    } catch {
        $sw.Stop()
        $errors++
    }
}

if ($latencies.Count -eq 0) {
    Write-Host "[dim18] No successful captures. Check that DanteClicky has screen capture permission."
    exit 1
}

$sorted = $latencies | Sort-Object
$count  = $sorted.Count
$p50    = $sorted[[math]::Floor($count * 0.50)]
$p95    = $sorted[[math]::Floor($count * 0.95)]
$p99    = $sorted[[math]::Floor($count * 0.99)]
$avg    = [math]::Round(($sorted | Measure-Object -Average).Average, 1)
$min    = ($sorted | Measure-Object -Minimum).Minimum
$max    = ($sorted | Measure-Object -Maximum).Maximum

Write-Host ""
Write-Host "[dim18] Capture speed results:"
Write-Host "  Successful: $count / $Iterations  (errors: $errors)"
Write-Host "  Min:  ${min}ms"
Write-Host "  Avg:  ${avg}ms"
Write-Host "  p50:  ${p50}ms"
Write-Host "  p95:  ${p95}ms  (gate: < 200ms)"
Write-Host "  p99:  ${p99}ms"
Write-Host "  Max:  ${max}ms"

$passed = $p95 -lt 200

Write-Host "  RESULT: $( if ($passed) { 'PASS' } else { 'FAIL' } )"

$outDir = "docs/benchmarks"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
@{
    timestamp      = (Get-Date -Format o)
    iterations     = $Iterations
    successful     = $count
    errors         = $errors
    min_ms         = $min
    avg_ms         = $avg
    p50_ms         = $p50
    p95_ms         = $p95
    p99_ms         = $p99
    max_ms         = $max
    gate_p95_ms    = 200
    passed         = $passed
} | ConvertTo-Json | Out-File "$outDir/capture-speed-results.json" -Encoding utf8
Write-Host "[dim18] Results written to $outDir/capture-speed-results.json"
exit $(if ($passed) { 0 } else { 1 })
