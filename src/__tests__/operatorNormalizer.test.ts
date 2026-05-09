import { describe, expect, it } from "vitest";
import {
  OperatorNormalizerCallback,
  normalizeComputerCallAction,
} from "../lib/callbacks/operatorNormalizer";

describe("normalizeComputerCallAction", () => {
  it("renames left_click → click with button='left'", () => {
    const result = normalizeComputerCallAction({ type: "left_click", x: 10, y: 20 });
    expect(result).toEqual({ type: "click", button: "left", x: 10, y: 20 });
  });

  it.each([
    ["right_click", "right"],
    ["wheel_click", "wheel"],
    ["back_click", "back"],
    ["forward_click", "forward"],
  ])("renames %s → click with button=%s", (input, expectedButton) => {
    const result = normalizeComputerCallAction({ type: input, x: 1, y: 2 });
    expect(result.type).toBe("click");
    expect(result.button).toBe(expectedButton);
  });

  it.each(["hotkey", "key", "press", "key_press"])(
    "renames %s → keypress",
    (alias) => {
      const result = normalizeComputerCallAction({ type: alias, keys: ["a"] });
      expect(result.type).toBe("keypress");
    }
  );

  it("flattens coordinate array into x/y and removes coordinate", () => {
    const result = normalizeComputerCallAction({
      type: "click",
      coordinate: [42, 99],
    });
    expect(result.x).toBe(42);
    expect(result.y).toBe(99);
    expect(result).not.toHaveProperty("coordinate");
  });

  it("renames click property → button on click action", () => {
    const result = normalizeComputerCallAction({
      type: "click",
      click: "right",
      x: 0,
      y: 0,
    });
    expect(result.button).toBe("right");
    expect(result).not.toHaveProperty("click");
  });

  it("defaults click button to 'left' when missing", () => {
    const result = normalizeComputerCallAction({ type: "click", x: 1, y: 2 });
    expect(result.button).toBe("left");
  });

  it("defaults scroll_x and scroll_y to 0 when missing", () => {
    const result = normalizeComputerCallAction({ type: "scroll", x: 1, y: 2 });
    expect(result.scroll_x).toBe(0);
    expect(result.scroll_y).toBe(0);
  });

  it("normalizes keys string with '+' separators into an array", () => {
    const result = normalizeComputerCallAction({
      type: "keypress",
      keys: "ctrl+shift+t",
    });
    expect(result.keys).toEqual(["ctrl", "shift", "t"]);
  });

  it("normalizes keys string with '-' separators (treated as '+')", () => {
    const result = normalizeComputerCallAction({
      type: "keypress",
      keys: "alt-tab",
    });
    expect(result.keys).toEqual(["alt", "tab"]);
  });

  it("wraps single-char keys string into a 1-element array", () => {
    const result = normalizeComputerCallAction({ type: "keypress", keys: "a" });
    expect(result.keys).toEqual(["a"]);
  });

  it("aliases keypress field names (keypress, key, press, key_press, text) to keys", () => {
    const result = normalizeComputerCallAction({ type: "keypress", press: "enter" });
    expect(result.keys).toEqual(["enter"]);
    expect(result).not.toHaveProperty("press");
  });

  it("infers click type when only button is present", () => {
    const result = normalizeComputerCallAction({ button: "left", x: 1, y: 2 });
    expect(result.type).toBe("click");
  });

  it("infers scroll type when scroll_x or scroll_y is present", () => {
    const result = normalizeComputerCallAction({ scroll_y: 100, x: 5, y: 5 });
    expect(result.type).toBe("scroll");
    expect(result.scroll_x).toBe(0);
  });

  it("infers type type when text is present and no type", () => {
    const result = normalizeComputerCallAction({ text: "hello" });
    expect(result.type).toBe("type");
  });

  it("strips fields not in the required-keys whitelist for the action type", () => {
    const result = normalizeComputerCallAction({
      type: "click",
      x: 1,
      y: 2,
      extra_garbage: "remove me",
      hallucinated_field: 42,
    });
    expect(result).not.toHaveProperty("extra_garbage");
    expect(result).not.toHaveProperty("hallucinated_field");
    expect(result.type).toBe("click");
    expect(result.x).toBe(1);
    expect(result.y).toBe(2);
    expect(result.button).toBe("left");
  });

  it("keeps required keys for screenshot (just type)", () => {
    const result = normalizeComputerCallAction({ type: "screenshot", garbage: 1 });
    expect(result).toEqual({ type: "screenshot" });
  });

  it("keeps drag path field", () => {
    const result = normalizeComputerCallAction({
      type: "drag",
      path: [
        [0, 0],
        [10, 10],
      ],
    });
    expect(result.type).toBe("drag");
    expect(result.path).toEqual([
      [0, 0],
      [10, 10],
    ]);
  });

  it("does not mutate the input object", () => {
    const input = { type: "left_click", x: 1, y: 2 };
    normalizeComputerCallAction(input);
    expect(input.type).toBe("left_click");
  });

  it("OperatorNormalizerCallback exposes normalize and fires onNormalize hook", () => {
    const observed: Array<{ before: unknown; after: unknown }> = [];
    const cb = new OperatorNormalizerCallback({
      onNormalize: (before, after) => observed.push({ before, after }),
    });
    expect(cb.name).toBe("operator-normalizer");
    const result = cb.normalize({ type: "left_click", x: 1, y: 2 });
    expect(result.type).toBe("click");
    expect(observed).toHaveLength(1);
  });
});
