import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildContextDepthBlock,
  renderMultiScreenOcrContext,
  type ScreenContextLike,
} from "../../src/lib/contextDepth";
import { renderTemporalContext } from "../../src/lib/temporalContext";
import type { RecentKeyframe } from "../../src/lib/videoSchemas";

interface Fixture {
  id: string;
  screens: ScreenContextLike[];
  keyframes: RecentKeyframe[];
  ocrEntries: Array<{ screen: ScreenContextLike; text: string }>;
  expectedWindow: string;
  expectedOcr: string[];
}

interface Result {
  fixture_count: number;
  multi_monitor_fixture_count: number;
  top1_window_accuracy: number;
  top3_ocr_recall: number;
  private_leak_count: number;
  base64_leak_count: number;
  p95_render_ms: number;
  max_context_chars: number;
  passed: boolean;
  gates: Record<string, number>;
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outputDir = join(repoRoot, "bench", "context-depth");

const gates = {
  fixture_count_min: 25,
  multi_monitor_fixture_count_min: 10,
  top1_window_accuracy_min: 0.9,
  top3_ocr_recall_min: 0.85,
  private_leak_count: 0,
  base64_leak_count: 0,
  p95_render_ms_max: 50,
  max_context_chars_max: 1200,
};

function screen(index: number, primary: boolean): ScreenContextLike {
  return {
    label: `screen${index + 1}`,
    width: primary ? 1920 : 1280,
    height: primary ? 1080 : 1024,
    x: primary ? 0 : 1920,
    y: 0,
    scale_factor: primary ? 1 : 1.25,
    is_primary: primary,
  };
}

function frame(overrides: Partial<RecentKeyframe>): RecentKeyframe {
  return {
    keyframe_id: 1,
    segment_id: 1,
    monitor_idx: 0,
    start_ts: "2026-05-09T11:55:00",
    pts_ms: 0,
    active_window: "VS Code",
    privacy_flag: "normal",
    has_thumb: true,
    ...overrides,
  };
}

function makeFixtures(): Fixture[] {
  return Array.from({ length: 25 }, (_, i) => {
    const multi = i < 12;
    const screens = multi ? [screen(0, true), screen(1, false)] : [screen(0, true)];
    const expectedWindow = i % 2 === 0 ? "VS Code" : "Figma";
    const expectedOcr = [`ticket-${i}`, `deploy-${i}`, `review-${i}`];
    return {
      id: `fixture-${i + 1}`,
      screens,
      keyframes: [
        frame({
          keyframe_id: i * 10 + 1,
          monitor_idx: multi && i % 2 === 1 ? 1 : 0,
          active_window: expectedWindow,
          start_ts: "2026-05-09T11:55:00",
        }),
        frame({
          keyframe_id: i * 10 + 2,
          monitor_idx: 0,
          active_window: "1Password Bank",
          privacy_flag: "incognito",
          start_ts: "2026-05-09T11:54:00",
        }),
        frame({
          keyframe_id: i * 10 + 3,
          monitor_idx: multi ? 1 : 0,
          active_window: "Terminal",
          start_ts: "2026-05-09T11:53:00",
        }),
      ],
      ocrEntries: screens.map((s, screenIndex) => ({
        screen: s,
        text: `${expectedOcr.join(" ")} screen-${screenIndex + 1} data:image/jpeg;base64,SECRET base64`,
      })),
      expectedWindow,
      expectedOcr,
    };
  });
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index] ?? 0;
}

function run(): Result {
  const fixtures = makeFixtures();
  let top1WindowHits = 0;
  let ocrHits = 0;
  let ocrTotal = 0;
  let privateLeakCount = 0;
  let base64LeakCount = 0;
  let maxContextChars = 0;
  const renderTimes: number[] = [];

  for (const fixture of fixtures) {
    const started = performance.now();
    const temporal = renderTemporalContext(fixture.keyframes, {
      now: Date.parse("2026-05-09T12:00:00Z"),
      maxChars: 500,
    });
    const ocr = renderMultiScreenOcrContext(fixture.ocrEntries, 500);
    const contextDepth = buildContextDepthBlock({
      screens: fixture.screens,
      temporalContext: temporal,
      temporalImageKeyframes: fixture.keyframes
        .filter((k) => k.privacy_flag === "normal" && k.has_thumb)
        .slice(0, 3)
        .map((k) => k.keyframe_id),
    }, 700);
    const packet = `${contextDepth}\n${ocr}`.trim();
    renderTimes.push(performance.now() - started);

    if (packet.includes(fixture.expectedWindow)) top1WindowHits++;
    for (const term of fixture.expectedOcr) {
      ocrTotal++;
      if (packet.includes(term)) ocrHits++;
    }
    if (packet.includes("1Password") || packet.includes("Bank")) privateLeakCount++;
    if (/data:image|base64/i.test(packet)) base64LeakCount++;
    maxContextChars = Math.max(maxContextChars, packet.length);
  }

  const result: Result = {
    fixture_count: fixtures.length,
    multi_monitor_fixture_count: fixtures.filter((f) => f.screens.length > 1).length,
    top1_window_accuracy: Number((top1WindowHits / fixtures.length).toFixed(3)),
    top3_ocr_recall: Number((ocrHits / ocrTotal).toFixed(3)),
    private_leak_count: privateLeakCount,
    base64_leak_count: base64LeakCount,
    p95_render_ms: Number(percentile(renderTimes, 95).toFixed(3)),
    max_context_chars: maxContextChars,
    passed: false,
    gates,
  };
  result.passed =
    result.fixture_count >= gates.fixture_count_min &&
    result.multi_monitor_fixture_count >= gates.multi_monitor_fixture_count_min &&
    result.top1_window_accuracy >= gates.top1_window_accuracy_min &&
    result.top3_ocr_recall >= gates.top3_ocr_recall_min &&
    result.private_leak_count === gates.private_leak_count &&
    result.base64_leak_count === gates.base64_leak_count &&
    result.p95_render_ms <= gates.p95_render_ms_max &&
    result.max_context_chars <= gates.max_context_chars_max;

  return result;
}

mkdirSync(outputDir, { recursive: true });
const result = run();
writeFileSync(join(outputDir, "results.json"), `${JSON.stringify(result, null, 2)}\n`);
writeFileSync(
  join(outputDir, "results.summary.txt"),
  [
    `passed=${result.passed}`,
    `fixtures=${result.fixture_count}`,
    `multi_monitor_fixtures=${result.multi_monitor_fixture_count}`,
    `top1_window_accuracy=${result.top1_window_accuracy}`,
    `top3_ocr_recall=${result.top3_ocr_recall}`,
    `private_leak_count=${result.private_leak_count}`,
    `base64_leak_count=${result.base64_leak_count}`,
    `p95_render_ms=${result.p95_render_ms}`,
    `max_context_chars=${result.max_context_chars}`,
  ].join("\n") + "\n"
);

if (!result.passed) {
  console.error("context-depth benchmark failed gates", result);
  process.exit(1);
}

console.log(JSON.stringify(result, null, 2));
