export type VisionPointSource =
  | "moondream_xml"
  | "bare_xy"
  | "csv_normalized"
  | "pixel_xy"
  | "dante_point_tag"
  | "ui_tars_box";

export interface ParsedVisionPoint {
  x: number;
  y: number;
  source: VisionPointSource;
  raw: string;
}

export interface GroundingFixture {
  id: string;
  width: number;
  height: number;
  target: string;
  groundTruth: {
    x: number;
    y: number;
  };
  tolerancePx: number;
}

export interface GroundingPrediction {
  id: string;
  rawOutput?: string;
  latencyMs?: number;
  provider?: string;
  modelRevision?: string;
}

export interface GroundingResult {
  id: string;
  target: string;
  status: "pass" | "fail" | "missing" | "parse_error";
  pass: boolean;
  errorPx: number | null;
  tolerancePx: number;
  parsedPoint: ParsedVisionPoint | null;
  rawOutput: string | null;
  latencyMs: number | null;
}

export interface GroundingReport {
  fixtureCount: number;
  measuredCount: number;
  passedCount: number;
  failedCount: number;
  missingCount: number;
  parseErrorCount: number;
  passRate: number;
  maxTolerancePx: number;
  meanErrorPx: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
  results: GroundingResult[];
}

const FLOAT = "(-?\\d+(?:\\.\\d+)?)";

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function parseVisionPoint(
  raw: string,
  imageSize?: { width: number; height: number },
): ParsedVisionPoint | null {
  const text = raw.trim();
  if (!text) return null;

  const pointTag = text.match(/\[POINT:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
  if (pointTag) {
    return pointFromScaled(text, Number(pointTag[1]), Number(pointTag[2]), 1024, 1024, "dante_point_tag");
  }

  const uiTars = parseUiTarsBox(text);
  if (uiTars) return uiTars;

  const xmlX = text.match(new RegExp(`\\bx\\s*=\\s*["']${FLOAT}["']`, "i"));
  const xmlY = text.match(new RegExp(`\\by\\s*=\\s*["']${FLOAT}["']`, "i"));
  if (xmlX && xmlY) {
    return pointFromMaybeNormalized(text, Number(xmlX[1]), Number(xmlY[1]), imageSize, "moondream_xml");
  }

  const bareX = text.match(new RegExp(`(?:^|[^a-z])x\\s*[:=]\\s*${FLOAT}`, "i"));
  const bareY = text.match(new RegExp(`(?:^|[^a-z])y\\s*[:=]\\s*${FLOAT}`, "i"));
  if (bareX && bareY) {
    return pointFromMaybeNormalized(text, Number(bareX[1]), Number(bareY[1]), imageSize, "bare_xy");
  }

  const nums = text
    .split(/[^0-9.-]+/)
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
  if (nums.length >= 2) {
    const [x, y] = nums;
    return pointFromMaybeNormalized(text, x, y, imageSize, "csv_normalized");
  }

  return null;
}

export function evaluateGroundingFixtures(
  fixtures: GroundingFixture[],
  predictions: GroundingPrediction[],
): GroundingReport {
  const byId = new Map(predictions.map((prediction) => [prediction.id, prediction]));
  const results: GroundingResult[] = fixtures.map((fixture) => {
    const prediction = byId.get(fixture.id);
    if (!prediction) {
      return makeMissingResult(fixture);
    }

    const rawOutput = prediction.rawOutput ?? "";
    const parsedPoint = parseVisionPoint(rawOutput, { width: fixture.width, height: fixture.height });
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

    const errorPx = pixelDistance(parsedPoint, fixture);
    const pass = errorPx <= fixture.tolerancePx;
    return {
      id: fixture.id,
      target: fixture.target,
      status: pass ? "pass" : "fail",
      pass,
      errorPx,
      tolerancePx: fixture.tolerancePx,
      parsedPoint,
      rawOutput,
      latencyMs: latencyOrNull(prediction.latencyMs),
    };
  });

  const measured = results.filter((result) => result.status === "pass" || result.status === "fail");
  const latencies = measured
    .map((result) => result.latencyMs)
    .filter((latency): latency is number => typeof latency === "number" && Number.isFinite(latency))
    .sort((a, b) => a - b);
  const errors = measured
    .map((result) => result.errorPx)
    .filter((error): error is number => typeof error === "number" && Number.isFinite(error));
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

export function inferDim29ScoreCap(report: GroundingReport): number {
  if (report.fixtureCount < 50 || report.measuredCount < 50) return 8.0;
  if (report.maxTolerancePx > 50) return 8.0;
  if (report.passRate >= 0.7 && report.parseErrorCount === 0 && report.missingCount === 0) return 9.0;
  if (report.passRate >= 0.5) return 8.5;
  return 8.0;
}

function parseUiTarsBox(raw: string): ParsedVisionPoint | null {
  const match = raw.match(/(?:start_box|end_box|box)\s*=\s*['"]?\(([^)]*)\)/i);
  if (!match) return null;

  const nums = match[1]
    .split(/[^0-9.-]+/)
    .filter(Boolean)
    .map(Number)
    .filter(Number.isFinite);
  if (nums.length === 2) {
    return pointFromScaled(raw, nums[0], nums[1], 1000, 1000, "ui_tars_box");
  }
  if (nums.length >= 4) {
    const x = (nums[0] + nums[2]) / 2;
    const y = (nums[1] + nums[3]) / 2;
    return pointFromScaled(raw, x, y, 1000, 1000, "ui_tars_box");
  }
  return null;
}

function pointFromMaybeNormalized(
  raw: string,
  x: number,
  y: number,
  imageSize: { width: number; height: number } | undefined,
  source: VisionPointSource,
): ParsedVisionPoint | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (Math.abs(x) <= 1 && Math.abs(y) <= 1) {
    return { x: clamp01(x), y: clamp01(y), source, raw };
  }
  if (imageSize) {
    return pointFromScaled(raw, x, y, imageSize.width, imageSize.height, "pixel_xy");
  }
  return null;
}

function pointFromScaled(
  raw: string,
  x: number,
  y: number,
  scaleX: number,
  scaleY: number,
  source: VisionPointSource,
): ParsedVisionPoint | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: clamp01(x / scaleX),
    y: clamp01(y / scaleY),
    source,
    raw,
  };
}

function pixelDistance(point: ParsedVisionPoint, fixture: GroundingFixture): number {
  const dx = (point.x - fixture.groundTruth.x) * fixture.width;
  const dy = (point.y - fixture.groundTruth.y) * fixture.height;
  return Math.sqrt(dx * dx + dy * dy);
}

function makeMissingResult(fixture: GroundingFixture): GroundingResult {
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

function latencyOrNull(latencyMs: number | undefined): number | null {
  return typeof latencyMs === "number" && Number.isFinite(latencyMs) ? latencyMs : null;
}

function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(sorted.length - 1, Math.max(0, index))];
}
