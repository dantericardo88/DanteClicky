# Dim 79 — Headless / CLI mode smoke test.
# Launches DanteClicky in --headless mode, exercises the REST API,
# verifies all key endpoints respond, then terminates cleanly.
#
# Usage:
#   pwsh -File scripts/smoke-headless.ps1 [-ExePath "..."] [-TimeoutMs 10000]
#
# Exit 0 = all checks passed. Exit 1 = failure.

param(
    [string]$ExePath = "src-tauri\target\debug\dante-clicky-windows.exe",
    [int]$TimeoutMs = 10000,
    [switch]$SkipExe   # skip process launch if DC already running
)

$DC_REST = "http://127.0.0.1:9002"
$pass = 0; $fail = 0; $proc = $null

function Check($name, $url, $method = "GET", $body = $null) {
    try {
        $params = @{ Uri = $url; Method = $method; TimeoutSec = 5; ErrorAction = "Stop" }
        if ($body) { $params["Body"] = ($body | ConvertTo-Json); $params["ContentType"] = "application/json" }
        $r = Invoke-WebRequest @params
        Write-Host "  [PASS] $name (HTTP $($r.StatusCode))"
        $script:pass++
    } catch {
        Write-Host "  [FAIL] $name — $_"
        $script:fail++
    }
}

Write-Host "[smoke-headless] DanteClicky headless mode smoke test"

if (-not $SkipExe) {
    if (-not (Test-Path $ExePath)) {
        Write-Host "[smoke-headless] WARNING: exe not found at $ExePath — run 'cargo build' first."
        Write-Host "[smoke-headless] Attempting to connect to already-running instance..."
    } else {
        Write-Host "[smoke-headless] Launching: $ExePath --headless"
        $proc = Start-Process -FilePath $ExePath -ArgumentList "--headless" -PassThru -WindowStyle Hidden
        Write-Host "[smoke-headless] PID: $($proc.Id)"
    }

    # Wait for REST API to come up
    $t0 = [System.Diagnostics.Stopwatch]::StartNew()
    $ready = $false
    while ($t0.ElapsedMilliseconds -lt $TimeoutMs) {
        try {
            $r = Invoke-WebRequest "$DC_REST/health" -TimeoutSec 1 -ErrorAction Stop
            if ($r.StatusCode -eq 200) { $ready = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 200
    }

    if (-not $ready) {
        Write-Host "[smoke-headless] FAIL: DanteClicky did not become ready within ${TimeoutMs}ms"
        if ($proc) { $proc | Stop-Process -Force -ErrorAction SilentlyContinue }
        exit 1
    }
    Write-Host "[smoke-headless] Ready in $($t0.ElapsedMilliseconds)ms"
}

Write-Host "`n[smoke-headless] Running endpoint checks..."

Check "GET /health"              "$DC_REST/health"
Check "GET /openapi.json"        "$DC_REST/openapi.json"
Check "GET /v1/tools"            "$DC_REST/v1/tools"
Check "GET /v1/screenshot"       "$DC_REST/v1/screenshot?monitor=0"
Check "GET /v1/active-window"    "$DC_REST/v1/active-window"
Check "GET /v1/events"           "$DC_REST/v1/events?limit=5"
Check "GET /v1/tools/registered" "$DC_REST/v1/tools/registered"
Check "POST /v1/webhook"         "$DC_REST/v1/webhook" "POST" @{ topic = "smoke.test"; source = "headless-smoke" }
Check "POST /v1/model/ping"      "$DC_REST/v1/model/ping" "POST" @{ provider = "ollama" }

Write-Host "`n[smoke-headless] Results: $pass passed, $fail failed"

if ($proc) {
    $proc | Stop-Process -Force -ErrorAction SilentlyContinue
    Write-Host "[smoke-headless] Process terminated."
}

# Write results JSON
$outDir = "docs/benchmarks"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
@{
    timestamp = (Get-Date -Format o)
    mode = "headless"
    passed = $pass
    failed = $fail
    total = ($pass + $fail)
} | ConvertTo-Json | Out-File "$outDir/headless-smoke-results.json" -Encoding utf8

Write-Host "[smoke-headless] Results written to $outDir/headless-smoke-results.json"
exit $(if ($fail -eq 0) { 0 } else { 1 })
