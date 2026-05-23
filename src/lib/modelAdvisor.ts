import { CURATED_MODELS, PROVIDERS, type ModelTask, type RegistryModel } from "./providerRegistry";
import type { ModelOption, ProviderType } from "../state/companionStore";

export interface GpuAdapter {
  name: string;
  vendor?: string | null;
  vramGb?: number | null;
}

export interface HardwareProfile {
  os: string;
  arch: string;
  cpuBrand: string;
  physicalCores: number;
  logicalCores: number;
  totalRamGb: number;
  diskFreeGb?: number | null;
  gpuAdapters: GpuAdapter[];
  hasNvidia: boolean;
  hasAmd: boolean;
  hasAppleSilicon: boolean;
  ollamaInstalled: boolean;
  ollamaRunning: boolean;
  ollamaVersion?: string | null;
}

export interface ModelRecommendation {
  model: RegistryModel;
  score: number;
  reason: string;
  readiness: "ready" | "needs-key" | "needs-ollama" | "needs-install";
}

export interface KeyPresence {
  anthropic?: boolean;
  openai?: boolean;
  grok?: boolean;
  openrouter?: boolean;
}

export function toModelOption(model: RegistryModel): ModelOption {
  return {
    provider: model.provider,
    modelId: model.modelId,
    displayName: model.displayName,
    supportsVision: model.supportsVision,
    supportsComputerUse: model.supportsComputerUse,
    locality: model.locality,
    costHint: model.costHint,
    privacyHint: model.privacyHint,
    description: model.description,
  };
}

export function hasProviderKey(provider: ProviderType, keys: KeyPresence): boolean {
  const keyProvider = PROVIDERS[provider].keyProvider;
  if (keyProvider === "ollama") return true;
  return Boolean(keys[keyProvider]);
}

export function recommendModels(
  profile: HardwareProfile | null,
  keys: KeyPresence,
  task: ModelTask = "chat",
): ModelRecommendation[] {
  const ram = profile?.totalRamGb ?? 0;
  const hasDiscreteGpu = Boolean(profile?.hasNvidia || profile?.hasAmd);
  const ollamaReady = Boolean(profile?.ollamaRunning);

  return CURATED_MODELS
    .filter((model) => model.tasks.includes(task) || model.tasks.includes("fallback"))
    .map((model): ModelRecommendation => {
      const provider = PROVIDERS[model.provider];
      const keyed = !provider.requiresKey || hasProviderKey(model.provider, keys);
      let score = 50;
      let readiness: ModelRecommendation["readiness"] = "ready";
      const reasons: string[] = [];

      if (model.quality === "frontier") score += 25;
      if (model.quality === "balanced") score += 15;
      if (model.supportsVision && task === "vision") score += 20;
      if (model.supportsComputerUse && task === "computer-use") score += 20;
      if (model.locality === "local") {
        score += 8;
        reasons.push("private local fallback");
        if (!ollamaReady) {
          score -= 35;
          readiness = profile?.ollamaInstalled ? "needs-ollama" : "needs-install";
          reasons.push(profile?.ollamaInstalled ? "start Ollama" : "install Ollama");
        }
        if (ram >= 32 || hasDiscreteGpu) score += 12;
        if (ram > 0 && ram < 16 && model.supportsVision) score -= 20;
      } else {
        reasons.push("cloud quality");
        if (!keyed) {
          score -= 30;
          readiness = "needs-key";
          reasons.push(`add ${provider.label} key`);
        } else {
          score += 14;
          reasons.push("key configured");
        }
      }

      if (model.costHint === "free-local") score += 8;
      if (model.costHint === "high") score -= 4;
      if (task === "chat" && model.provider === "grok") score += 5;
      if (task === "chat" && model.provider === "openai") score += 6;
      if (task === "computer-use" && model.provider !== "openai" && model.provider !== "claude") score -= 15;

      if (reasons.length === 0) reasons.push("good general fit");
      return {
        model,
        score,
        readiness,
        reason: reasons.join(", "),
      };
    })
    .sort((a, b) => b.score - a.score);
}

export function summarizeHardware(profile: HardwareProfile | null): string {
  if (!profile) return "Hardware profile not loaded";
  const gpu = profile.gpuAdapters[0]?.name ?? "no discrete GPU detected";
  return `${profile.cpuBrand || profile.arch}, ${profile.totalRamGb || "unknown"} GB RAM, ${gpu}`;
}
