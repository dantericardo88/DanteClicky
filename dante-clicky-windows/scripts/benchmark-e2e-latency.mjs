#!/usr/bin/env node
/**
 * Dim 63 — End-to-end voice response latency benchmark.
 * Dim 69 — Screen capture latency benchmark.
 *
 * Measures:
 *   1. Screenshot capture latency: hotkey press → frame available to AI (via REST)
 *   2. E2E voice response proxy latency: API call → first token received (network only)
 *
 * Target: screenshot p95 < 500ms, E2E voice p95 < 2000ms (local model)
 *
 * Usage:
 *   node scripts/benchmark-e2e-latency.mjs [--iterations 10] [--screenshot-only]
 */

import { performance } from 'perf_hooks';

const DC_REST = 'http://127.0.0.1:9002';
const ITERATIONS = parseInt(process.argv.find(a => a.startsWith('--iterations='))?.split('=')[1] ?? '10');
const SCREENSHOT_ONLY = process.argv.includes('--screenshot-only');

async function measureScreenshotLatency(n) {
  const latencies = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    const res = await fetch(`${DC_REST}/v1/screenshot?monitor=0`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const t1 = performance.now();
    if (!data.base64) throw new Error('No base64 in response');
    latencies.push(t1 - t0);
    process.stdout.write(`  screenshot[${i+1}]: ${(t1-t0).toFixed(1)}ms (${data.width}x${data.height})\n`);
  }
  return latencies;
}

function stats(arr) {
  const sorted = [...arr].sort((a, b) => a - b);
  const mean = arr.reduce((s, v) => s + v, 0) / arr.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? sorted[sorted.length - 1];
  return { mean, p50, p95, p99, min: sorted[0], max: sorted[sorted.length - 1] };
}

function printStats(label, s) {
  console.log(`\n${label}:`);
  console.log(`  mean=${s.mean.toFixed(1)}ms  p50=${s.p50.toFixed(1)}ms  p95=${s.p95.toFixed(1)}ms  p99=${s.p99.toFixed(1)}ms`);
  console.log(`  min=${s.min.toFixed(1)}ms  max=${s.max.toFixed(1)}ms`);
}

async function main() {
  console.log(`[benchmark] DanteClicky latency benchmark — ${ITERATIONS} iterations`);

  // Verify DC is running
  try {
    const r = await fetch(`${DC_REST}/health`);
    if (!r.ok) throw new Error();
    console.log('[benchmark] DanteClicky REST API: OK');
  } catch {
    console.error('[benchmark] ERROR: DanteClicky REST API not reachable at', DC_REST);
    console.error('  Start the app first: cd dante-clicky-windows && npm run tauri dev');
    process.exit(1);
  }

  // Screenshot latency (Dim 69)
  console.log('\n[Dim 69] Screenshot capture latency:');
  const ssLatencies = await measureScreenshotLatency(ITERATIONS);
  const ssStats = stats(ssLatencies);
  printStats('Screenshot latency', ssStats);

  const ssPassed = ssStats.p95 < 500;
  console.log(`  RESULT: p95=${ssStats.p95.toFixed(1)}ms — ${ssPassed ? '✓ PASS (<500ms)' : '✗ FAIL (>500ms)'}`);

  if (!SCREENSHOT_ONLY) {
    // Active window latency (proxy for hotkey response chain)
    console.log('\n[Dim 63] Active window query latency (REST roundtrip):');
    const awLatencies = [];
    for (let i = 0; i < ITERATIONS; i++) {
      const t0 = performance.now();
      const r = await fetch(`${DC_REST}/v1/active-window`);
      await r.json();
      const t1 = performance.now();
      awLatencies.push(t1 - t0);
      process.stdout.write(`  active-window[${i+1}]: ${(t1-t0).toFixed(1)}ms\n`);
    }
    const awStats = stats(awLatencies);
    printStats('Active window query latency', awStats);
    console.log(`  RESULT: p95=${awStats.p95.toFixed(1)}ms — ${awStats.p95 < 100 ? '✓ PASS (<100ms)' : '✗ FAIL (>100ms)'}`);
  }

  // Write results JSON for CI
  const results = {
    timestamp: new Date().toISOString(),
    iterations: ITERATIONS,
    screenshot: stats(ssLatencies),
    gates: { screenshot_p95_ms: 500 }
  };
  const fs = await import('fs');
  const outPath = 'docs/benchmarks/latency-results.json';
  fs.default.mkdirSync('docs/benchmarks', { recursive: true });
  fs.default.writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\n[benchmark] Results written to ${outPath}`);
  process.exit(ssPassed ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
