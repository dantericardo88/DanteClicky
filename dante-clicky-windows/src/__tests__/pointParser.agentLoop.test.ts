import { describe, expect, it } from "vitest";
import {
  denormalize,
  parseAgentLoopActions,
  parsePoints,
} from "../providers/pointParser";

describe("parseAgentLoopActions", () => {
  it("preserves multiple POINT, TYPE, and SCROLL actions in response order", () => {
    const response = [
      'I will open search. [POINT:100,200:search field:screen1] [TYPE:"weather"]',
      "Then scroll the results. [POINT:512,768:results list:screen1] [SCROLL:3]",
      'Finally refine it. [POINT:120,210:search field:screen1] [TYPE:"weather tomorrow"]',
    ].join(" ");

    expect(parseAgentLoopActions(response)).toEqual([
      {
        kind: "point",
        point: { x: 100, y: 200, label: "search field", screenLabel: "screen1" },
      },
      { kind: "type", text: "weather" },
      {
        kind: "point",
        point: { x: 512, y: 768, label: "results list", screenLabel: "screen1" },
      },
      { kind: "scroll", delta: 3 },
      {
        kind: "point",
        point: { x: 120, y: 210, label: "search field", screenLabel: "screen1" },
      },
      { kind: "type", text: "weather tomorrow" },
    ]);
  });

  it("treats POINT none as an explicit no-action stop for the loop", () => {
    const response =
      'This asks for confirmation instead. [POINT:none:none:screen1] [POINT:400,500:danger button:screen1] [TYPE:"delete"] [SCROLL:-2]';

    expect(parseAgentLoopActions(response)).toEqual([
      { kind: "stop", reason: "no-action", screenLabel: "screen1" },
    ]);
  });
});

describe("multi-step point parsing", () => {
  it("does not continue collecting click targets after an explicit no-action POINT", () => {
    const response =
      "[POINT:111,222:first action:screen1] [POINT:none:none:screen1] [POINT:333,444:should not run:screen1]";

    expect(parsePoints(response)).toEqual([
      { x: 111, y: 222, label: "first action", screenLabel: "screen1" },
    ]);
  });
});

describe("coordinate denormalization boundaries", () => {
  it("clamps normalized coordinates to the target screen bounds", () => {
    expect(
      denormalize({ x: 2048, y: -128, label: "outside", screenLabel: "screen1" }, 1920, 1080),
    ).toEqual({ px: 1920, py: 0 });
  });

  it("rounds fractional normalized coordinates to stable pixels", () => {
    expect(
      denormalize({ x: 341.333, y: 682.667, label: "fractional", screenLabel: "screen2" }, 1440, 900),
    ).toEqual({
      px: Math.round((341.333 / 1024) * 1440),
      py: Math.round((682.667 / 1024) * 900),
    });
  });
});
