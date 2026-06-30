import { describe, expect, it } from "vitest";
import { recommendModels, type HardwareProfile } from "../lib/modelAdvisor";

const baseProfile: HardwareProfile = {
  os: "windows",
  arch: "x86_64",
  cpuBrand: "test cpu",
  physicalCores: 8,
  logicalCores: 16,
  totalRamGb: 32,
  diskFreeGb: 120,
  gpuAdapters: [{ name: "NVIDIA RTX", vendor: "NVIDIA", vramGb: 12 }],
  hasNvidia: true,
  hasAmd: false,
  hasAppleSilicon: false,
  ollamaInstalled: true,
  ollamaRunning: true,
  ollamaVersion: "ollama version test",
};

describe("model advisor", () => {
  it("prefers ready frontier cloud models when keys exist", () => {
    const recs = recommendModels(baseProfile, { openai: true, anthropic: true }, "chat");
    expect(recs[0].readiness).toBe("ready");
    expect(["openai", "claude"]).toContain(recs[0].model.provider);
  });

  it("marks cloud models as needing keys when no key is configured", () => {
    const recs = recommendModels(baseProfile, {}, "computer-use");
    expect(recs.some((rec) => rec.readiness === "needs-key")).toBe(true);
  });

  it("keeps local fallback ready when Ollama is running", () => {
    const recs = recommendModels(baseProfile, {}, "fallback");
    const local = recs.find((rec) => rec.model.provider === "ollama");
    expect(local?.readiness).toBe("ready");
  });

  it("does not pretend local models are ready when Ollama is missing", () => {
    const recs = recommendModels(
      { ...baseProfile, ollamaInstalled: false, ollamaRunning: false },
      {},
      "fallback",
    );
    const local = recs.find((rec) => rec.model.provider === "ollama");
    expect(local?.readiness).toBe("needs-install");
  });
});
