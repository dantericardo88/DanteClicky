import { describe, it, expect } from "vitest";
import { parsePoints, stripPoints, denormalize } from "../providers/pointParser";

describe("parsePoints", () => {
  it("returns empty array on empty string", () => {
    expect(parsePoints("")).toEqual([]);
  });

  it("parses a single POINT tag correctly", () => {
    const result = parsePoints("[POINT:512,256:button:screen1]");
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({ x: 512, y: 256, label: "button", screenLabel: "screen1" });
  });

  it("parses multiple POINT tags", () => {
    const text =
      "[POINT:100,200:close:screen1] some text [POINT:800,600:menu:screen2]";
    const result = parsePoints(text);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ x: 100, y: 200, label: "close", screenLabel: "screen1" });
    expect(result[1]).toEqual({ x: 800, y: 600, label: "menu", screenLabel: "screen2" });
  });

  it("handles decimal coordinates", () => {
    const result = parsePoints("[POINT:512.5,256.3:btn:screen1]");
    expect(result).toHaveLength(1);
    expect(result[0].x).toBeCloseTo(512.5);
    expect(result[0].y).toBeCloseTo(256.3);
    expect(result[0].label).toBe("btn");
    expect(result[0].screenLabel).toBe("screen1");
  });

  it("ignores malformed tags — missing fields", () => {
    // Only two fields inside brackets — no label or screenLabel
    expect(parsePoints("[POINT:512,256]")).toEqual([]);
    // Three fields, missing screenLabel
    expect(parsePoints("[POINT:512,256:btn]")).toEqual([]);
  });

  it("ignores text that looks like a point tag but has wrong format", () => {
    // Non-numeric coordinates
    expect(parsePoints("[POINT:abc,def:btn:screen1]")).toEqual([]);
    // No colon separator between x and y
    expect(parsePoints("[POINT:512 256:btn:screen1]")).toEqual([]);
  });
});

describe("stripPoints", () => {
  it("removes [POINT:...] tags from text", () => {
    const result = stripPoints("Click [POINT:512,256:button:screen1] here");
    expect(result).not.toContain("[POINT:");
    expect(result).toContain("Click");
    expect(result).toContain("here");
  });

  it("cleans up double spaces after removal", () => {
    const result = stripPoints("Click [POINT:512,256:button:screen1] here");
    expect(result).not.toMatch(/\s{2,}/);
  });

  it("handles text with no POINT tags unchanged", () => {
    expect(stripPoints("Hello world")).toBe("Hello world");
  });

  it("handles text that is only POINT tags", () => {
    const result = stripPoints("[POINT:512,256:button:screen1]");
    expect(result).toBe("");
  });
});

describe("denormalize", () => {
  it("converts (512, 256) at 1920x1080 to correct pixel coords", () => {
    const point = { x: 512, y: 256, label: "btn", screenLabel: "screen1" };
    const { px, py } = denormalize(point, 1920, 1080);
    expect(px).toBe(Math.round((512 / 1024) * 1920));
    expect(py).toBe(Math.round((256 / 1024) * 1080));
  });

  it("converts (0, 0) to (0, 0)", () => {
    const point = { x: 0, y: 0, label: "origin", screenLabel: "screen1" };
    const { px, py } = denormalize(point, 1920, 1080);
    expect(px).toBe(0);
    expect(py).toBe(0);
  });

  it("converts (1024, 1024) to (screenWidth, screenHeight)", () => {
    const point = { x: 1024, y: 1024, label: "corner", screenLabel: "screen1" };
    const { px, py } = denormalize(point, 1920, 1080);
    expect(px).toBe(1920);
    expect(py).toBe(1080);
  });
});
