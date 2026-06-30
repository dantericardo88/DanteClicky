import { describe, expect, it } from "vitest";
import {
  DEFAULT_WAKE_PHRASE,
  normalizeWakeText,
  stripWakePhraseCommand,
  transcriptContainsWakePhrase,
} from "../lib/wakeWord";

describe("wake word phrase matching", () => {
  it("keeps the built-in wake phrase short and explicit", () => {
    expect(DEFAULT_WAKE_PHRASE).toBe("hey dante");
  });

  it("normalizes case, punctuation, filler spacing, and possessives", () => {
    expect(normalizeWakeText("  Hey, DANTE's...  ")).toBe("hey dantes");
  });

  it("matches the default phrase inside a natural transcript", () => {
    expect(transcriptContainsWakePhrase("Okay, hey Dante, open the inbox.")).toBe(true);
  });

  it("does not activate on soundalikes in balanced mode", () => {
    expect(transcriptContainsWakePhrase("They dance when the music starts.")).toBe(false);
  });

  it("can use sensitive matching for one-edit transcription slips", () => {
    expect(transcriptContainsWakePhrase("hey dantee open settings", "hey dante", "sensitive")).toBe(true);
  });

  it("strips the wake phrase and keeps the command payload", () => {
    expect(stripWakePhraseCommand("Hey Dante, summarize this window.")).toBe("summarize this window");
  });
});
