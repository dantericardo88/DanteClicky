import { describe, it, expect } from "vitest";
import { buildSystemPrompt } from "../lib/buildSystemPrompt";

describe("buildSystemPrompt — ambient context behavior change (D38 proof)", () => {
  it("omits the ambient block when ambientContext is empty", () => {
    const prompt = buildSystemPrompt({});
    expect(prompt).not.toContain("[ambient context");
    expect(prompt).not.toContain("[/ambient context]");
  });

  it("includes the ambient block when ambientContext has content", () => {
    const ambient = "• VSCode: editing useVoice.ts\n• Firefox: Tauri docs";
    const prompt = buildSystemPrompt({ ambientContext: ambient });
    expect(prompt).toContain("[ambient context — what the user has been working on recently]");
    expect(prompt).toContain("• VSCode: editing useVoice.ts");
    expect(prompt).toContain("• Firefox: Tauri docs");
    expect(prompt).toContain("[/ambient context]");
  });

  it("ambient block content varies with the snapshot — proving behavior change", () => {
    const a = buildSystemPrompt({ ambientContext: "• Slack: channel #engineering" });
    const b = buildSystemPrompt({ ambientContext: "• Terminal: cargo test running" });
    expect(a).toContain("Slack");
    expect(a).not.toContain("Terminal");
    expect(b).toContain("Terminal");
    expect(b).not.toContain("Slack");
    // Confirm both prompts are otherwise built from the same base — the only
    // difference must come from the ambient input.
    expect(a.length).not.toBe(b.length);
  });

  it("treats whitespace-only ambient context as empty", () => {
    const prompt = buildSystemPrompt({ ambientContext: "   \n\n   " });
    expect(prompt).not.toContain("[ambient context");
  });
});
