import { describe, expect, it } from "vitest";
import { sortScreens, type CapturedScreen } from "../hooks/useScreenCapture";

function screen(overrides: Partial<CapturedScreen>): CapturedScreen {
  return {
    label: "from-native",
    data: "",
    mime: "image/jpeg",
    width: 1920,
    height: 1080,
    x: 0,
    y: 0,
    scale_factor: 1,
    is_primary: false,
    ...overrides,
  };
}

describe("sortScreens", () => {
  it("puts the primary screen first and relabels by provider image order", () => {
    const sorted = sortScreens([
      screen({ label: "screen1", x: 1920, width: 1280, is_primary: false }),
      screen({ label: "screen2", x: 0, width: 1920, is_primary: true }),
    ]);

    expect(sorted.map((s) => s.label)).toEqual(["screen1", "screen2"]);
    expect(sorted[0]).toMatchObject({ x: 0, width: 1920, is_primary: true });
    expect(sorted[1]).toMatchObject({ x: 1920, width: 1280, is_primary: false });
  });

  it("prefers the cursor screen over the OS primary screen", () => {
    const sorted = sortScreens([
      screen({ label: "screen1", x: 0, is_primary: true, contains_cursor: false }),
      screen({ label: "screen2", x: 1920, is_primary: false, contains_cursor: true }),
    ]);

    expect(sorted[0]).toMatchObject({ label: "screen1", contains_cursor: true });
    expect(sorted[1]).toMatchObject({ label: "screen2", is_primary: true });
  });
});
