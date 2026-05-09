import { describe, it, expect } from "vitest";
import { matchClickIntent } from "../lib/clickIntent";

describe("matchClickIntent — Dim 29 click-intent extraction", () => {
  it("extracts target from explicit click verb", () => {
    expect(matchClickIntent("click the login button")).toBe("login button");
  });

  it("handles tap/press/hit/select/open/push/choose verbs", () => {
    expect(matchClickIntent("tap submit")).toBe("submit");
    expect(matchClickIntent("press OK")).toBe("ok");
    expect(matchClickIntent("hit enter")).toBe("enter");
    expect(matchClickIntent("select first option")).toBe("first option");
    expect(matchClickIntent("open the settings menu")).toBe("settings menu");
    expect(matchClickIntent("push play")).toBe("play");
    expect(matchClickIntent("choose dark mode")).toBe("dark mode");
  });

  it("skips leading articles after the verb", () => {
    expect(matchClickIntent("click the save icon")).toBe("save icon");
    expect(matchClickIntent("tap that big red button")).toBe("big red button");
    expect(matchClickIntent("press on the link")).toBe("link");
  });

  it("strips trailing politeness fillers", () => {
    expect(matchClickIntent("click submit please")).toBe("submit");
    expect(matchClickIntent("tap OK thanks")).toBe("ok");
    expect(matchClickIntent("press cancel now")).toBe("cancel");
  });

  it("returns null when no click verb is present", () => {
    expect(matchClickIntent("what's on screen")).toBeNull();
    expect(matchClickIntent("describe this image")).toBeNull();
    expect(matchClickIntent("explain what just happened")).toBeNull();
    expect(matchClickIntent("read the headline")).toBeNull();
  });

  it("returns null on empty / whitespace-only input", () => {
    expect(matchClickIntent("")).toBeNull();
    expect(matchClickIntent("   ")).toBeNull();
  });

  it("returns null when verb has no target after it", () => {
    expect(matchClickIntent("click")).toBeNull();
    expect(matchClickIntent("click the")).toBeNull();
    expect(matchClickIntent("press")).toBeNull();
  });

  it("captures multi-word targets correctly", () => {
    expect(matchClickIntent("click the create new project button")).toBe(
      "create new project button"
    );
  });
});
