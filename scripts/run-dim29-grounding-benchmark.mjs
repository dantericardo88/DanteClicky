#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const args = parseArgs(process.argv.slice(2));
const fixturesPath = path.resolve(repoRoot, args.fixtures ?? "bench/local-vision/dim29-grounding-fixtures.json");
const predictionsPath = path.resolve(repoRoot, args.predictions ?? "bench/local-vision/dim29-grounding-predictions.jsonl");
const outPath = path.resolve(repoRoot, args.output ?? "docs/local-vision-grounding/dim29-grounding-results.json");

const fixturesDoc = JSON.parse(fs.readFileSync(fixturesPath, "utf8"));
const fixtures = fixturesDoc.fixtures ?? [];
const predictions = fs.existsSync(predictionsPath) ? readPredictions(predictionsPath) : [];
const report = evaluate(fixtures, predictions);
const status = report.fixtureCount >= 50
  && report.measuredCount >= 50
  && report.maxTolerancePx <= 50
  && report.passRate >= 0.7
  && report.missingCount === 0
  && report.parseErrorCount === 0
  ? "passed"
  : "blocked";

const artifact = {
  generatedAt: new Date().toISOString(),
  dimension: 29,
  status,
  scoreCap: inferScoreCap(report),
  fixturesPath: normalizePath(fixturesPath),
  predictionsPath: fs.existsSync(predictionsPath) ? normalizePath(predictionsPath) : null,
  model: summarizeModel(predictions),
  gates: {
    fixtureCountAtLeast50: report.fixtureCount >= 50,
    measuredCountAtLeast50: report.measuredCount >= 50,
    maxTolerancePxAtMost50: report.maxTolerancePx <= 50,
    passRateAtLeast70Percent: report.passRate >= 0.7,
    noMissingPredictions: report.missingCount === 0,
    noParseErrors: report.parseErrorCount === 0,
    latencyEvidencePresent: report.p95LatencyMs !== null,
  },
  summary: {
    fixtureCount: report.fixtureCount,
    measuredCount: report.measuredCount,
    passedCount: report.passedCount,
    failedCount: report.failedCount,
    missingCount: report.missingCount,
    parseErrorCount: report.parseErrorCount,
    passRate: Number(report.passRate.toFixed(4)),
    maxTolerancePx: report.maxTolerancePx,
    meanErrorPx: nullableRound(report.meanErrorPx),
    p50LatencyMs: nullableRound(report.p50LatencyMs),
    p95LatencyMs: nullableRound(report.p95LatencyMs),
  },
  harshVerdict: status === "passed"
    ? "Grounding benchmark meets the local Dim 29 numeric threshold. Run npm run check:dim29-local-vision to validate telemetry and readiness evidence."
    : "Blocked: Dim 29 stays below 9 until a real local model produces >=70% pass rate on 50+ fixtures within 50px, with latency and production point-hint evidence.",
  results: report.results,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(artifact, null, 2) + "\n", "utf8");
console.log(`Dim 29 grounding benchmark ${status}: ${artifact.summary.passedCount}/${artifact.summary.fixtureCount} passed, passRate=${artifact.summary.passRate}`);
console.log(`Wrote ${normalizePath(outPath)}`);
process.exit(status === "passed" || args.allowBlocked === "true" ? 0 : 1);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function readPredictions(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return [];
  if (raw.startsWith("[")) return JSON.parse(raw);
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function evaluate(fixtures, predictions) {
  const byId = new Map(predictions.map((prediction) => [prediction.id, prediction]));
  const results = fixtures.map((fixture) => {
    const prediction = byId.get(fixture.id);
    if (!prediction) {
      return {
        id: fixture.id,
        target: fixture.target,
        status: "missing",
        pass: false,
        errorPx: null,
        tolerancePx: fixture.tolerancePx,
        parsedPoint: null,
        rawOutput: null,
        latencyMs: null,
      };
    }

    const rawOutput = prediction.rawOutput ?? "";
    const parsedPoint = parsePoint(rawOutput, fixture);
    if (!parsedPoint) {
      return {
        id: fixture.id,
        target: fixture.target,
        status: "parse_error",
        pass: false,
        errorPx: null,
        tolerancePx: fixture.tolerancePx,
        parsedPoint: null,
        rawOutput,
        latencyMs: latencyOrNull(prediction.latencyMs),
      };
    }

    const dx = (parsedPoint.x - fixture.groundTruth.x) * fixture.width;
    const dy = (parsedPoint.y - fixture.groundTruth.y) * fixture.height;
    const errorPx = Math.sqrt(dx * dx + dy * dy);
    const pass = errorPx <= fixture.tolerancePx;
    return {
      id: fixture.id,
      target: fixture.target,
      status: pass ? "pass" : "fail",
      pass,
      errorPx: round(errorPx),
      tolerancePx: fixture.tolerancePx,
      parsedPoint,
      rawOutput,
      latencyMs: latencyOrNull(prediction.latencyMs),
    };
  });

  const measured = results.filter((result) => result.status === "pass" || result.status === "fail");
  const latencies = measured
    .map((result) => result.latencyMs)
    .filter((latency) => typeof latency === "number" && Number.isFinite(latency))
    .sort((a, b) => a - b);
  const errors = measured
    .map((result) => result.errorPx)
    .filter((error) => typeof error === "number" && Number.isFinite(error));
  const passedCount = results.filter((result) => result.pass).length;

  return {
    fixtureCount: fixtures.length,
    measuredCount: measured.length,
    passedCount,
    failedCount: results.filter((result) => result.status === "fail").length,
    missingCount: results.filter((result) => result.status === "missing").length,
    parseErrorCount: results.filter((result) => result.status === "parse_error").length,
    passRate: fixtures.length > 0 ? passedCount / fixtures.length : 0,
    maxTolerancePx: fixtures.reduce((max, fixture) => Math.max(max, fixture.tolerancePx), 0),
    meanErrorPx: errors.length > 0 ? errors.reduce((sum, error) => sum + error, 0) / errors.length : null,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    results,
  };
}

function parsePoint(raw, fixture) {
  const text = String(raw).trim();
  const pointTag = text.match(/\[POINT:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
  if (pointTag) return scaledPoint(text, Number(pointTag[1]), Number(pointTag[2]), 1024, 1024, "dante_point_tag");

  const uiTars = text.match(/(?:start_box|end_box|box)\s*=\s*['"]?\(([^)]*)\)/i);
  if (uiTars) {
    const nums = uiTars[1].split(/[^0-9.-]+/).filter(Boolean).map(Number).filter(Number.isFinite);
    if (nums.length === 2) return scaledPoint(text, nums[0], nums[1], 1000, 1000, "ui_tars_box");
    if (nums.length >= 4) {
      return scaledPoint(text, (nums[0] + nums[2]) / 2, (nums[1] + nums[3]) / 2, 1000, 1000, "ui_tars_box");
    }
  }

  const xmlX = text.match(/\bx\s*=\s*["'](-?\d+(?:\.\d+)?)["']/i);
  const xmlY = text.match(/\by\s*=\s*["'](-?\d+(?:\.\d+)?)["']/i);
  if (xmlX && xmlY) return maybeNormalizedPoint(text, Number(xmlX[1]), Number(xmlY[1]), fixture, "moondream_xml");

  const bareX = text.match(/(?:^|[^a-z])x\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
  const bareY = text.match(/(?:^|[^a-z])y\s*[:=]\s*(-?\d+(?:\.\d+)?)/i);
  if (bareX && bareY) return maybeNormalizedPoint(text, Number(bareX[1]), Number(bareY[1]), fixture, "bare_xy");

  const nums = text.split(/[^0-9.-]+/).filter(Boolean).map(Number).filter(Number.isFinite);
  if (nums.length >= 2) return maybeNormalizedPoint(text, nums[0], nums[1], fixture, "csv_normalized");
  return null;
}

function maybeNormalizedPoint(raw, x, y, fixture, source) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Math.abs(x) <= 1 && Math.abs(y) <= 1) return { x: clamp01(x), y: clamp01(y), source, raw };
  return scaledPoint(raw, x, y, fixture.width, fixture.height, "pixel_xy");
}

function scaledPoint(raw, x, y, scaleX, scaleY, source) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: clamp01(x / scaleX), y: clamp01(y / scaleY), source, raw };
}

function inferScoreCap(report) {
  if (report.fixtureCount < 50 || report.measuredCount < 50 || report.maxTolerancePx > 50) return 8.0;
  if (report.passRate >= 0.7 && report.missingCount === 0 && report.parseErrorCount === 0) return 9.0;
  if (report.passRate >= 0.5) return 8.5;
  return 8.0;
}

function summarizeModel(predictions) {
  const first = predictions.find((prediction) => prediction.provider || prediction.modelRevision);
  return {
    provider: first?.provider ?? null,
    revision: first?.modelRevision ?? null,
    local: first?.local ?? null,
    predictionCount: predictions.length,
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, index))];
}

function latencyOrNull(latencyMs) {
  return typeof latencyMs === "number" && Number.isFinite(latencyMs) ? latencyMs : null;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round(value) {
  return Number(value.toFixed(3));
}

function nullableRound(value) {
  return typeof value === "number" && Number.isFinite(value) ? round(value) : null;
}

function normalizePath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}
