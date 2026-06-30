import { describe, expect, it } from "vitest";
import { CURATED_MODELS, PROVIDERS } from "../lib/providerRegistry";

describe("provider registry", () => {
  it("contains the requested first-class providers", () => {
    expect(Object.keys(PROVIDERS)).toEqual(
      expect.arrayContaining(["openai", "claude", "grok", "openrouter", "ollama"]),
    );
  });

  it("keeps provider base URLs on the approved endpoints", () => {
    expect(PROVIDERS.openai.baseUrl).toBe("https://api.openai.com/v1");
    expect(PROVIDERS.grok.baseUrl).toBe("https://api.x.ai/v1");
    expect(PROVIDERS.openrouter.baseUrl).toBe("https://openrouter.ai/api/v1");
    expect(PROVIDERS.ollama.baseUrl).toBe("http://localhost:11434/v1");
  });

  it("ships curated cloud and local defaults", () => {
    expect(CURATED_MODELS.some((model) => model.modelId === "gpt-4o")).toBe(true);
    expect(CURATED_MODELS.some((model) => model.modelId === "claude-opus-4-7")).toBe(true);
    expect(CURATED_MODELS.some((model) => model.modelId === "grok-3")).toBe(true);
    expect(CURATED_MODELS.some((model) => model.provider === "ollama")).toBe(true);
  });
});
