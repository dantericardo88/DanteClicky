import { describe, expect, it } from "vitest";
import { buildPreferenceGuidance, inferPreferenceSignal } from "../lib/preferenceLearning";

describe("preference learning pipeline integration", () => {
  it("signal from corrective phrase produces correct invoke args shape", () => {
    const signal = inferPreferenceSignal("no, that's wrong");
    expect(signal).not.toBeNull();
    expect(signal!.signal).toBe("corrective_followup");
    expect(signal!.weight).toBe(-0.8);
    expect(signal!.reason).toMatch(/corrected|rejected/);
  });

  it("profile from invoke flows through buildPreferenceGuidance into system prompt text", () => {
    // Simulates the object invoke("get_preference_profile") returns from Rust
    const profile = {
      traits: [
        {
          key: "concise",
          label: "concise responses",
          score: 2.4,
          evidence_count: 3,
          positive_count: 3,
          negative_count: 0,
          last_seen: "2026-05-07 12:00:00",
        },
      ],
      positive_examples: [
        {
          id: 1,
          user_prompt: "what broke?",
          assistant_response: "the build: missing semicolon.",
          created_at: "2026-05-07 12:00:00",
          preference_score: 1,
          feedback_source: "explicit_rating",
          feedback_reason: "thumbs up",
        },
      ],
      negative_examples: [],
      explicit_feedback_count: 1,
      implicit_feedback_count: 2,
    };

    const guidance = buildPreferenceGuidance(profile);

    expect(guidance).toContain("[learned user preferences]");
    expect(guidance).toContain("prefer concise responses");
    expect(guidance).toContain("[/learned user preferences]");
    expect(guidance).toContain("explicit 1, implicit 2");
    expect(guidance).not.toContain("[preference profile]");
    expect(guidance).not.toContain("liked:");
  });

  it("negative trait from corrective signal produces 'avoid' line in guidance", () => {
    const profile = {
      traits: [
        {
          key: "structured_answer",
          label: "structured answers",
          score: -1.5,
          evidence_count: 2,
          positive_count: 0,
          negative_count: 2,
          last_seen: "2026-05-07 12:01:00",
        },
      ],
      positive_examples: [],
      negative_examples: [
        {
          id: 2,
          user_prompt: "explain it",
          assistant_response: "1. First…\n2. Second…",
          created_at: "2026-05-07 12:01:00",
          preference_score: -1,
          feedback_source: "corrective_followup",
          feedback_reason: "user corrected",
        },
      ],
      explicit_feedback_count: 0,
      implicit_feedback_count: 2,
    };

    const guidance = buildPreferenceGuidance(profile);
    expect(guidance).toContain("avoid structured answers");
    expect(guidance).not.toContain("avoid repeating:");
  });

  it("empty profile produces empty system prompt contribution", () => {
    expect(
      buildPreferenceGuidance({
        traits: [],
        positive_examples: [],
        negative_examples: [],
        explicit_feedback_count: 0,
        implicit_feedback_count: 0,
      })
    ).toBe("");
  });

  it("suppresses traits whose decayed_score is near zero even when raw score is large", () => {
    const g = buildPreferenceGuidance({
      traits: [
        {
          key: "verbose",
          label: "verbose responses",
          score: 3.0,
          decayed_score: 0.04,
          evidence_count: 6,
          positive_count: 6,
          negative_count: 0,
          last_seen: "2025-11-01 10:00:00",
          confidence: 0.8,
          status: "active",
        },
      ],
      positive_examples: [],
      negative_examples: [],
      explicit_feedback_count: 0,
      implicit_feedback_count: 6,
    });
    expect(g).toBe("");
  });

  it("uses user_label over inferred label when present", () => {
    const g = buildPreferenceGuidance({
      traits: [
        {
          key: "concise",
          label: "concise responses",
          user_label: "brief bullet-point answers",
          score: 2,
          decayed_score: 1.8,
          evidence_count: 3,
          positive_count: 3,
          negative_count: 0,
          last_seen: "",
          confidence: 0.7,
          status: "active",
        },
      ],
      positive_examples: [],
      negative_examples: [],
      explicit_feedback_count: 2,
      implicit_feedback_count: 1,
    });
    expect(g).toContain("brief bullet-point answers");
    expect(g).not.toContain("concise responses");
  });

  it("returns manual_preference for explicit preference declarations", () => {
    expect(inferPreferenceSignal("remember that I prefer concise answers")?.signal).toBe("manual_preference");
    expect(inferPreferenceSignal("I always prefer bullet points")?.signal).toBe("manual_preference");
    expect(inferPreferenceSignal("my preference is brief answers")?.signal).toBe("manual_preference");
    expect(inferPreferenceSignal("please open settings")).toBeNull();
  });

  it("catches expanded negative patterns as corrective signals", () => {
    expect(inferPreferenceSignal("not quite what I meant")?.signal).toBe("corrective_followup");
    expect(inferPreferenceSignal("that missed the mark")?.signal).toBe("corrective_followup");
    expect(inferPreferenceSignal("can you redo that")?.signal).toBe("corrective_followup");
    expect(inferPreferenceSignal("not really what I was looking for")?.signal).toBe("corrective_followup");
  });

  it("full pipeline: corrective follow-up flows through to system prompt guidance", () => {
    const signal = inferPreferenceSignal("not quite, that was too verbose");
    expect(signal?.signal).toBe("corrective_followup");

    const profile = {
      traits: [{
        key: "verbose", label: "verbose responses",
        score: -0.85, decayed_score: -0.82,
        evidence_count: 1, positive_count: 0, negative_count: 1,
        last_seen: "2026-05-07 10:00:00", confidence: 0.41, status: "active",
      }],
      positive_examples: [], negative_examples: [],
      explicit_feedback_count: 0, implicit_feedback_count: 1,
    };

    const guidance = buildPreferenceGuidance(profile);
    expect(guidance).toContain("avoid verbose responses");

    const systemPrompt = ["You are a helpful voice assistant.", guidance].filter(Boolean).join("\n\n");
    expect(systemPrompt).toContain("[learned user preferences]");
    expect(systemPrompt).toContain("avoid verbose responses");
    expect(systemPrompt.indexOf("[learned user preferences]")).toBeGreaterThan(10);
  });

  it("forward-looking preference declarations resolve to manual_preference", () => {
    expect(inferPreferenceSignal("from now on be more concise")?.signal).toBe("manual_preference");
    expect(inferPreferenceSignal("next time keep it brief")?.signal).toBe("manual_preference");
    expect(inferPreferenceSignal("I prefer plain text")?.signal).toBe("manual_preference");
    expect(inferPreferenceSignal("in general I prefer shorter responses")?.signal).toBe("manual_preference");
    expect(inferPreferenceSignal("remember my preference for bullet points")?.signal).toBe("manual_preference");
    // Must not fire for plain action requests
    expect(inferPreferenceSignal("next time open the settings")).toBeNull();
    expect(inferPreferenceSignal("from now on please open Chrome")).toBeNull();
  });
});
