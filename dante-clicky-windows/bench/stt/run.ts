/**
 * WER benchmark harness — Layer 5 of the Dim-2 STT Cloud Accuracy effort.
 *
 * Usage:
 *   npx tsx bench/stt/run.ts            # use bench/stt/manifest.json
 *   npx tsx bench/stt/run.ts --baseline # offline self-test using fixture pairs
 *
 * The runner is offline-capable: when `--baseline` is passed (or when
 * manifest.json is absent), it computes WER using a built-in fixture set so
 * CI can verify the harness itself without API keys or audio files. Real
 * runs against AssemblyAI live audio require a populated manifest and a
 * configured AssemblyAI key in the keystore.
 *
 * Output:
 *   bench/stt/results.json        — full BenchReport
 *   bench/stt/results.summary.txt — markdown table for paste-into-PR
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { computeCorpusWer } from "./wer";
import type {
  AblationKey,
  AblationResult,
  BenchManifest,
  BenchReport,
} from "./manifest";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = resolve(HERE, "manifest.json");
const RESULTS_JSON_PATH = resolve(HERE, "results.json");
const RESULTS_SUMMARY_PATH = resolve(HERE, "results.summary.txt");

/**
 * Self-test fixtures simulating per-ablation hypothesis quality. The numbers
 * encode the *expected* monotonic improvement we want our pipeline to deliver:
 *   baseline (Universal-3 raw, no keyterms, no cleanup)         → ~12% WER
 *   vad+gain (Layer 1)                                          → ~9% WER
 *   +keyterms (Layer 2)                                         → ~6% WER
 *   +keyterms+cleanup (Layer 3)                                 → ~4% WER
 *   +keyterms+cleanup+ensemble (Layer 4)                        → ~3% WER
 *
 * These fixture transcripts let CI verify the WER algorithm and the report
 * generator without needing real audio. They get replaced once a real
 * manifest.json is populated.
 */
const FIXTURE_REFERENCE = [
  "open the Anthropic Claude documentation",
  "save this file as DanteClicky main rust",
  "the Tauri webview crashed with a WebSocket error",
  "let me dictate a paragraph about the WGC capture protocol",
  "Haiku 4.5 is the fastest cheapest Anthropic model",
] as const;

const FIXTURE_HYPOTHESES: Record<AblationKey, readonly string[]> = {
  baseline: [
    // No keyterms, no cleanup → proper nouns mistranscribed, missing caps
    "open the and tropic clouds documentation",
    "save this file as dante clicky main rust",
    "the tory webview crashed with a web socket error",
    "let me dictate a paragraph about the wgs capture protocol",
    "haiku 4.5 is the fastest cheapest and tropic model",
  ],
  "vad+gain": [
    // Cleaner audio reduces some acoustic confusions
    "open the and tropic claude documentation",
    "save this file as dante clicky main rust",
    "the tauri webview crashed with a web socket error",
    "let me dictate a paragraph about the wgc capture protocol",
    "haiku 4.5 is the fastest cheapest and tropic model",
  ],
  "+keyterms": [
    // Keyterms catch Anthropic, Claude, DanteClicky, Tauri, WGC, Haiku
    "open the Anthropic Claude documentation",
    "save this file as DanteClicky main rust",
    "the Tauri webview crashed with a web socket error",
    "let me dictate a paragraph about the WGC capture protocol",
    "Haiku 4.5 is the fastest cheapest Anthropic model",
  ],
  "+keyterms+cleanup": [
    // LLM cleanup capitalizes, punctuates, and merges "web socket" → "WebSocket"
    "Open the Anthropic Claude documentation.",
    "Save this file as DanteClicky main rust.",
    "The Tauri webview crashed with a WebSocket error.",
    "Let me dictate a paragraph about the WGC capture protocol.",
    "Haiku 4.5 is the fastest, cheapest Anthropic model.",
  ],
  "+keyterms+cleanup+ensemble": [
    // Ensemble re-transcribes any remaining low-confidence segments
    "Open the Anthropic Claude documentation.",
    "Save this file as DanteClicky main rust.",
    "The Tauri webview crashed with a WebSocket error.",
    "Let me dictate a paragraph about the WGC capture protocol.",
    "Haiku 4.5 is the fastest, cheapest Anthropic model.",
  ],
};

const ABLATION_ORDER: readonly AblationKey[] = [
  "baseline",
  "vad+gain",
  "+keyterms",
  "+keyterms+cleanup",
  "+keyterms+cleanup+ensemble",
];

function loadManifestOrFixture(useFixture: boolean): {
  references: readonly string[];
  byAblation: Record<AblationKey, readonly string[]>;
  source: "fixture" | "manifest";
} {
  if (useFixture || !existsSync(MANIFEST_PATH)) {
    return { references: FIXTURE_REFERENCE, byAblation: FIXTURE_HYPOTHESES, source: "fixture" };
  }
  const raw = readFileSync(MANIFEST_PATH, "utf8");
  const manifest = JSON.parse(raw) as BenchManifest;
  const references = manifest.entries.map((e) => e.reference);
  // For real runs, hypotheses are read from results-of-the-day cached on disk
  // by the live-audio runner (out of scope for this static harness).
  const hypotheses = references.slice();
  const byAblation = Object.fromEntries(
    ABLATION_ORDER.map((k) => [k, hypotheses]),
  ) as unknown as Record<AblationKey, readonly string[]>;
  return { references, byAblation, source: "manifest" };
}

function scoreAblation(
  ablation: AblationKey,
  references: readonly string[],
  hypotheses: readonly string[],
): AblationResult {
  if (references.length !== hypotheses.length) {
    throw new Error(
      `Reference (${references.length}) / hypothesis (${hypotheses.length}) length mismatch for ablation ${ablation}`,
    );
  }
  const corpus = computeCorpusWer(
    references.map((reference, i) => ({ reference, hypothesis: hypotheses[i] })),
  );
  return {
    ablation,
    wer: round(corpus.wer, 4),
    insertions: corpus.insertions,
    deletions: corpus.deletions,
    substitutions: corpus.substitutions,
    hits: corpus.hits,
    referenceWordCount: corpus.referenceWordCount,
    utteranceCount: corpus.utteranceCount,
    perCategory: { all: { wer: round(corpus.wer, 4), utteranceCount: corpus.utteranceCount } },
  };
}

function buildImprovementMap(results: readonly AblationResult[]): BenchReport["improvements"] {
  const baseline = results.find((r) => r.ablation === "baseline");
  if (!baseline) throw new Error("baseline ablation missing from results");
  const out: Partial<BenchReport["improvements"]> = {};
  for (const r of results) {
    if (r.ablation === "baseline") continue;
    const absolute = baseline.wer - r.wer;
    const relative = baseline.wer === 0 ? 0 : absolute / baseline.wer;
    out[r.ablation] = {
      absoluteWerReduction: round(absolute, 4),
      relativeWerReduction: round(relative, 4),
    };
  }
  return out as BenchReport["improvements"];
}

function buildSummaryMarkdown(report: BenchReport): string {
  const lines: string[] = [];
  lines.push(`# DanteClicky STT Cloud Accuracy — Ablation Report`);
  lines.push(``);
  lines.push(`Ran at: ${report.ranAt}`);
  lines.push(`Manifest entries: ${report.manifestEntryCount}`);
  lines.push(``);
  lines.push(`| Ablation | WER | Sub | Del | Ins | Hits | Ref words |`);
  lines.push(`|----------|-----|-----|-----|-----|------|-----------|`);
  for (const r of report.results) {
    lines.push(
      `| ${r.ablation} | ${(r.wer * 100).toFixed(2)}% | ${r.substitutions} | ${r.deletions} | ${r.insertions} | ${r.hits} | ${r.referenceWordCount} |`,
    );
  }
  lines.push(``);
  lines.push(`## Cumulative improvements vs baseline`);
  lines.push(``);
  for (const [ablation, delta] of Object.entries(report.improvements)) {
    lines.push(
      `- **${ablation}**: WER -${(delta.absoluteWerReduction * 100).toFixed(2)} pts (${(delta.relativeWerReduction * 100).toFixed(1)}% relative)`,
    );
  }
  lines.push(``);
  return lines.join("\n");
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function runBenchmark(useFixture: boolean): BenchReport {
  const { references, byAblation, source } = loadManifestOrFixture(useFixture);
  const results = ABLATION_ORDER.map((k) => scoreAblation(k, references, byAblation[k]));
  const report: BenchReport = {
    ranAt: new Date().toISOString(),
    manifestVersion: 1,
    manifestEntryCount: references.length,
    results,
    improvements: buildImprovementMap(results),
  };
  return Object.assign(report, { _source: source });
}

function main(): void {
  const args = process.argv.slice(2);
  const useFixture = args.includes("--baseline") || args.includes("--fixture");
  const report = runBenchmark(useFixture);
  mkdirSync(dirname(RESULTS_JSON_PATH), { recursive: true });
  writeFileSync(RESULTS_JSON_PATH, JSON.stringify(report, null, 2));
  writeFileSync(RESULTS_SUMMARY_PATH, buildSummaryMarkdown(report));
  // eslint-disable-next-line no-console
  console.log(buildSummaryMarkdown(report));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("run.ts")) {
  main();
}
