import { describe, expect, it } from "vitest";
import {
  evaluateGroundingFixtures,
  inferDim29ScoreCap,
  parseVisionPoint,
  type GroundingFixture,
  type GroundingPrediction,
} from "../lib/localVisionGrounding";

describe("local vision grounding parser", () => {
  it("parses Moondream XML points", () => {
    expect(parseVisionPoint(`<point x="0.512" y="0.394">`)).toMatchObject({
      x: 0.512,
      y: 0.394,
      source: "moondream_xml",
    });
  });

  it("parses bare x/y responses", () => {
    expect(parseVisionPoint("The target is x=0.42, y=0.67.")).toMatchObject({
      x: 0.42,
      y: 0.67,
      source: "bare_xy",
    });
  });

  it("parses normalized CSV responses", () => {
    expect(parseVisionPoint("0.31, 0.88")).toMatchObject({
      x: 0.31,
      y: 0.88,
      source: "csv_normalized",
    });
  });

  it("parses DanteClicky POINT tags on the 0-1024 system prompt scale", () => {
    expect(parseVisionPoint("[POINT:512,394:submit:screen1]")).toMatchObject({
      x: 0.5,
      y: 394 / 1024,
      source: "dante_point_tag",
    });
  });

  it("parses UI-TARS start_box actions on the 0-1000 grounding scale", () => {
    expect(parseVisionPoint("click(start_box='(100,200,300,400)')")).toMatchObject({
      x: 0.2,
      y: 0.3,
      source: "ui_tars_box",
    });
  });

  it("parses pixel coordinates when image dimensions are supplied", () => {
    expect(parseVisionPoint("x=512 y=384", { width: 1024, height: 768 })).toMatchObject({
      x: 0.5,
      y: 0.5,
      source: "pixel_xy",
    });
  });
});

describe("local vision grounding evaluator", () => {
  it("scores missing, parse-error, fail, and pass results distinctly", () => {
    const fixtures: GroundingFixture[] = [
      fixture("a", 0.5, 0.5),
      fixture("b", 0.25, 0.25),
      fixture("c", 0.75, 0.75),
      fixture("d", 0.9, 0.1),
    ];
    const predictions: GroundingPrediction[] = [
      { id: "a", rawOutput: `<point x="0.5" y="0.5">`, latencyMs: 110 },
      { id: "b", rawOutput: "I cannot find it.", latencyMs: 120 },
      { id: "c", rawOutput: `<point x="0.1" y="0.1">`, latencyMs: 130 },
    ];

    const report = evaluateGroundingFixtures(fixtures, predictions);

    expect(report.fixtureCount).toBe(4);
    expect(report.measuredCount).toBe(2);
    expect(report.passedCount).toBe(1);
    expect(report.parseErrorCount).toBe(1);
    expect(report.missingCount).toBe(1);
    expect(report.passRate).toBe(0.25);
    expect(report.p50LatencyMs).toBe(110);
    expect(report.p95LatencyMs).toBe(130);
    expect(report.results.map((result) => result.status)).toEqual([
      "pass",
      "parse_error",
      "fail",
      "missing",
    ]);
  });

  it("only permits a Dim 29 score cap of 9 with 50 measured fixtures, 50px tolerance, and >=70 percent pass rate", () => {
    const fixtures = Array.from({ length: 50 }, (_, index) =>
      fixture(`fixture-${index + 1}`, 0.5, 0.5),
    );
    const predictions = fixtures.map((item, index) => ({
      id: item.id,
      rawOutput: index < 35 ? `<point x="0.5" y="0.5">` : `<point x="0.9" y="0.9">`,
      latencyMs: 100 + index,
    }));

    const report = evaluateGroundingFixtures(fixtures, predictions);

    expect(report.passRate).toBe(0.7);
    expect(inferDim29ScoreCap(report)).toBe(9);
  });

  it("keeps the score cap at 8.5 for a reliable but sub-70-percent grounding benchmark", () => {
    const fixtures = Array.from({ length: 50 }, (_, index) =>
      fixture(`fixture-${index + 1}`, 0.5, 0.5),
    );
    const predictions = fixtures.map((item, index) => ({
      id: item.id,
      rawOutput: index < 30 ? `<point x="0.5" y="0.5">` : `<point x="0.9" y="0.9">`,
      latencyMs: 100 + index,
    }));

    const report = evaluateGroundingFixtures(fixtures, predictions);

    expect(report.passRate).toBe(0.6);
    expect(inferDim29ScoreCap(report)).toBe(8.5);
  });
});

function fixture(id: string, x: number, y: number): GroundingFixture {
  return {
    id,
    width: 1024,
    height: 768,
    target: id,
    groundTruth: { x, y },
    tolerancePx: 50,
  };
}
