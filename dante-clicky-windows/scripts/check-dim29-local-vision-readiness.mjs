#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const args = parseArgs(process.argv.slice(2));
const reportPath = path.resolve(repoRoot, args.report ?? "docs/local-vision-grounding/dim29-grounding-results.json");
const telemetryPath = args.telemetry
  ? path.resolve(repoRoot, args.telemetry)
  : findNewest("docs/local-vision-grounding", /^dim29-production-telemetry-sample-\d{4}-\d{2}-\d{2}\.json$/);
const outPath = path.resolve(repoRoot, args.output ?? "docs/local-vision-grounding/dim29-readiness.json");

const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, "utf8")) : null;
const telemetry = telemetryPath && fs.existsSync(telemetryPath)
  ? JSON.parse(fs.readFileSync(telemetryPath, "utf8"))
  : null;

const summary = report?.summary ?? {};
const checks = [
  check("benchmark-report-present", Boolean(report), "Run npm run bench:dim29-grounding with real local model predictions."),
  check("fixture-count-50", (summary.fixtureCount ?? 0) >= 50, "Benchmark must include at least 50 fixtures."),
  check("measured-count-50", (summary.measuredCount ?? 0) >= 50, "Every fixture needs a measured prediction, not skipped/missing rows."),
  check("max-tolerance-50px", report ? summary.maxTolerancePx <= 50 : false, "Score 9 requires <=50px tolerance."),
  check("pass-rate-70", report ? summary.passRate >= 0.7 : false, "Score 9 requires >=70% pass rate."),
  check("no-missing-predictions", report ? summary.missingCount === 0 : false, "Every fixture needs a prediction row."),
  check("no-parse-errors", report ? summary.parseErrorCount === 0 : false, "The parser must understand every raw model output."),
  check("latency-p95-recorded", report ? typeof summary.p95LatencyMs === "number" : false, "Record latencyMs per fixture."),
  check("local-model-identity", hasLocalModelIdentity(report), "Report must identify the local model provider and revision."),
  check("production-point-hint-telemetry", hasProductionPointHintTelemetry(telemetry), "Attach production telemetry proving point_query fired and produced a [POINT:x,y] hint."),
];

const passedChecks = checks.filter((item) => item.passed).length;
const failedChecks = checks.length - passedChecks;
const green = failedChecks === 0;
const scoreGate = {
  status: green ? "green" : "blocked",
  currentCap: green ? 9.0 : inferCurrentCap(summary, checks),
  target: 9.0,
  reason: green
    ? "Dim 29 has a 50+ fixture local grounding pass plus latency, model identity, and production point-hint evidence."
    : "Dim 29 remains capped below 9 until all readiness checks pass against a real local model run.",
};

const readiness = {
  generatedAt: new Date().toISOString(),
  dimension: 29,
  name: "Local vision model to UI-TARS parity",
  status: scoreGate.status,
  scoreGate,
  passedChecks,
  failedChecks,
  checks,
  reportPath: fs.existsSync(reportPath) ? normalizePath(reportPath) : null,
  telemetryPath: telemetryPath && fs.existsSync(telemetryPath) ? normalizePath(telemetryPath) : null,
  summary,
  harshVerdict: scoreGate.currentCap >= 9
    ? "Harsh score may move to 9.0 if matrix reviewers accept this artifact."
    : "Harsh score remains 8.0 right now. The repo proves local caption inference, but not UI-TARS-class grounding parity.",
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(readiness, null, 2) + "\n", "utf8");
console.log(`Dim 29 readiness ${scoreGate.status}: ${passedChecks}/${checks.length} checks passed, cap=${scoreGate.currentCap}`);
console.log(`Wrote ${normalizePath(outPath)}`);

if (!green && (args.failOnBlocked === "true" || args.FailOnBlocked === "true")) {
  process.exit(1);
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--") && !arg.startsWith("-")) continue;
    const key = arg.replace(/^-+/, "");
    const next = argv[index + 1];
    if (!next || next.startsWith("-")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function check(id, passed, remediation) {
  return { id, passed: Boolean(passed), remediation: passed ? null : remediation };
}

function hasLocalModelIdentity(report) {
  if (!report?.model) return false;
  return Boolean(report.model.provider && report.model.revision && report.model.local !== false);
}

function hasProductionPointHintTelemetry(telemetry) {
  if (!telemetry) return false;
  const events = Array.isArray(telemetry.events) ? telemetry.events : [];
  return events.some((event) => {
    const name = String(event.name ?? event.event ?? "");
    const hint = String(event.pointHint ?? event.promptHint ?? event.hint ?? "");
    return name.includes("vision_point_hint") && /\[POINT:\d+,\d+/i.test(hint);
  });
}

function inferCurrentCap(summary, checks) {
  const byId = new Map(checks.map((item) => [item.id, item.passed]));
  if (!byId.get("benchmark-report-present")) return 8.0;
  if ((summary.fixtureCount ?? 0) < 50 || (summary.measuredCount ?? 0) < 50) return 8.0;
  if ((summary.maxTolerancePx ?? Number.POSITIVE_INFINITY) > 50) return 8.0;
  if ((summary.passRate ?? 0) >= 0.7) return 8.7;
  if ((summary.passRate ?? 0) >= 0.5) return 8.5;
  return 8.0;
}

function findNewest(dir, pattern) {
  const fullDir = path.resolve(repoRoot, dir);
  if (!fs.existsSync(fullDir)) return null;
  const matches = fs.readdirSync(fullDir)
    .filter((name) => pattern.test(name))
    .map((name) => path.join(fullDir, name))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return matches[0] ?? null;
}

function normalizePath(filePath) {
  return path.relative(repoRoot, filePath).replaceAll("\\", "/");
}
