import { describe, expect, it } from "vitest";
import {
  buildContextDepthBlock,
  renderCurrentScreensContext,
  renderMultiScreenOcrContext,
  shouldAttachTemporalVisualHistory,
  type ScreenContextLike,
} from "../lib/contextDepth";
import { buildSystemPrompt } from "../lib/buildSystemPrompt";

const primary: ScreenContextLike = {
  label: "screen1",
  width: 1920,
  height: 1080,
  x: 0,
  y: 0,
  scale_factor: 1,
  is_primary: true,
  contains_cursor: true,
};

const secondary: ScreenContextLike = {
  label: "screen2",
  width: 1280,
  height: 1024,
  x: 1920,
  y: 0,
  scale_factor: 1.25,
  is_primary: false,
};

describe("context depth rendering", () => {
  it("renders current screen inventory with stable labels and geometry", () => {
    const out = renderCurrentScreensContext([primary, secondary]);

    expect(out).toContain("screen1: primary/cursor, 1920x1080, origin 0,0");
    expect(out).toContain("screen2: secondary, 1280x1024, origin 1920,0 scale 1.25");
  });

  it("renders per-screen OCR blocks without leaking image payload text", () => {
    const out = renderMultiScreenOcrContext([
      { screen: primary, text: "VS Code deploy succeeded" },
      { screen: secondary, text: "Figma mockup data:image/jpeg;base64,AAA base64" },
    ]);

    expect(out).toContain("[ocr:screen1 primary/cursor 1920x1080]");
    expect(out).toContain("VS Code deploy succeeded");
    expect(out).toContain("[ocr:screen2 secondary 1280x1024]");
    expect(out).toContain("Figma mockup [redacted image payload]");
    expect(out).not.toContain("data:image");
    expect(out).not.toContain("base64,AAA");
  });

  it("builds a bounded context-depth packet with recent visual-history anchors", () => {
    const out = buildContextDepthBlock({
      screens: [primary, secondary],
      temporalContext: "5m ago - screen2 - Terminal (keyframe #42)",
      temporalImageKeyframes: [42, 43],
    });

    expect(out).toContain("[current screens]");
    expect(out).toContain("screen2");
    expect(out).toContain("[recent visual history]");
    expect(out).toContain("5m ago");
    expect(out).toContain("image 1: keyframe #42");
    expect(out.length).toBeLessThanOrEqual(1600);
  });

  it("injects context-depth into the system prompt without image payloads", () => {
    const prompt = buildSystemPrompt({
      contextDepth: buildContextDepthBlock({
        screens: [primary, secondary],
        temporalContext: "3m ago - screen1 - VS Code (keyframe #7)",
      }),
      ocrText: renderMultiScreenOcrContext([
        { screen: primary, text: "Editor" },
        { screen: secondary, text: "Docs" },
      ]),
      screenWidth: primary.width,
      screenHeight: primary.height,
      numScreens: 2,
    });

    expect(prompt).toContain("[context depth - current screens and recent visual history]");
    expect(prompt).toContain("screen1");
    expect(prompt).toContain("screen2");
    expect(prompt).toContain("VS Code");
    expect(prompt).not.toContain("data:image");
    expect(prompt).not.toContain("base64");
  });

  it("only requests temporal images for history-seeking utterances", () => {
    expect(shouldAttachTemporalVisualHistory("what was I working on five minutes ago?")).toBe(true);
    expect(shouldAttachTemporalVisualHistory("click the submit button")).toBe(false);
  });
});
