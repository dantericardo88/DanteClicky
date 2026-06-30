import type { ProviderType } from "../state/companionStore";

export type ProviderKind = "anthropic" | "openai-compatible" | "ollama";
export type ProviderLocality = "cloud" | "local";
export type ModelTask = "chat" | "vision" | "computer-use" | "fallback";

export interface ProviderDefinition {
  id: ProviderType;
  label: string;
  keyProvider: "anthropic" | "openai" | "grok" | "openrouter" | "ollama";
  nativeStoreKey: string;
  kind: ProviderKind;
  baseUrl: string;
  modelsUrl?: string;
  requiresKey: boolean;
  locality: ProviderLocality;
  docsUrl: string;
}

export interface RegistryModel {
  provider: ProviderType;
  modelId: string;
  displayName: string;
  supportsVision: boolean;
  supportsComputerUse: boolean;
  locality: ProviderLocality;
  tasks: ModelTask[];
  quality: "fast" | "balanced" | "frontier" | "local";
  costHint: "free-local" | "low" | "medium" | "high" | "provider";
  privacyHint: "local" | "cloud";
  description: string;
}

export const PROVIDERS: Record<ProviderType, ProviderDefinition> = {
  claude: {
    id: "claude",
    label: "Anthropic",
    keyProvider: "anthropic",
    nativeStoreKey: "anthropic",
    kind: "anthropic",
    baseUrl: "https://api.anthropic.com/v1",
    modelsUrl: "https://api.anthropic.com/v1/models",
    requiresKey: true,
    locality: "cloud",
    docsUrl: "https://platform.claude.com/docs/en/about-claude/models",
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    keyProvider: "openai",
    nativeStoreKey: "openai",
    kind: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    modelsUrl: "https://api.openai.com/v1/models",
    requiresKey: true,
    locality: "cloud",
    docsUrl: "https://developers.openai.com/api/docs/models",
  },
  grok: {
    id: "grok",
    label: "xAI",
    keyProvider: "grok",
    nativeStoreKey: "xai",
    kind: "openai-compatible",
    baseUrl: "https://api.x.ai/v1",
    modelsUrl: "https://api.x.ai/v1/models",
    requiresKey: true,
    locality: "cloud",
    docsUrl: "https://docs.x.ai/developers/models",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    keyProvider: "openrouter",
    nativeStoreKey: "openrouter",
    kind: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    requiresKey: true,
    locality: "cloud",
    docsUrl: "https://openrouter.ai/docs/guides/overview/models",
  },
  ollama: {
    id: "ollama",
    label: "Ollama",
    keyProvider: "ollama",
    nativeStoreKey: "ollama",
    kind: "ollama",
    baseUrl: "http://localhost:11434/v1",
    modelsUrl: "http://localhost:11434/api/tags",
    requiresKey: false,
    locality: "local",
    docsUrl: "https://docs.ollama.com/api/introduction",
  },
};

export const CURATED_MODELS: RegistryModel[] = [
  {
    provider: "openai",
    modelId: "gpt-4o",
    displayName: "GPT-4o",
    supportsVision: true,
    supportsComputerUse: true,
    locality: "cloud",
    tasks: ["chat", "vision", "computer-use"],
    quality: "frontier",
    costHint: "high",
    privacyHint: "cloud",
    description: "Frontier reasoning, coding, vision input, and computer-use capable workflows.",
  },
  {
    provider: "claude",
    modelId: "claude-opus-4-7",
    displayName: "Claude Opus 4.7",
    supportsVision: true,
    supportsComputerUse: true,
    locality: "cloud",
    tasks: ["chat", "vision", "computer-use"],
    quality: "frontier",
    costHint: "high",
    privacyHint: "cloud",
    description: "High-resolution visual reasoning and strong long-running agentic work.",
  },
  {
    provider: "claude",
    modelId: "claude-sonnet-4-6",
    displayName: "Claude Sonnet 4.6",
    supportsVision: true,
    supportsComputerUse: true,
    locality: "cloud",
    tasks: ["chat", "vision", "computer-use"],
    quality: "balanced",
    costHint: "medium",
    privacyHint: "cloud",
    description: "Balanced daily driver for screen-aware help and tool use.",
  },
  {
    provider: "grok",
    modelId: "grok-3",
    displayName: "Grok 3",
    supportsVision: true,
    supportsComputerUse: false,
    locality: "cloud",
    tasks: ["chat", "vision"],
    quality: "frontier",
    costHint: "medium",
    privacyHint: "cloud",
    description: "Fast xAI chat and image-understanding model for general use.",
  },
  {
    provider: "openrouter",
    modelId: "anthropic/claude-opus-4.7",
    displayName: "Claude Opus 4.7 via OpenRouter",
    supportsVision: true,
    supportsComputerUse: false,
    locality: "cloud",
    tasks: ["chat", "vision"],
    quality: "frontier",
    costHint: "provider",
    privacyHint: "cloud",
    description: "OpenRouter route for frontier Claude-class reasoning when available.",
  },
  {
    provider: "openrouter",
    modelId: "openai/gpt-4o",
    displayName: "GPT-4o via OpenRouter",
    supportsVision: true,
    supportsComputerUse: false,
    locality: "cloud",
    tasks: ["chat", "vision"],
    quality: "frontier",
    costHint: "provider",
    privacyHint: "cloud",
    description: "OpenRouter route for GPT-4o when the route is available to your account.",
  },
  {
    provider: "ollama",
    modelId: "llama3.2",
    displayName: "Llama 3.2 via Ollama",
    supportsVision: false,
    supportsComputerUse: false,
    locality: "local",
    tasks: ["chat", "fallback"],
    quality: "local",
    costHint: "free-local",
    privacyHint: "local",
    description: "Light local fallback for private chat on modest CPUs.",
  },
  {
    provider: "ollama",
    modelId: "qwen2.5vl",
    displayName: "Qwen2.5-VL via Ollama",
    supportsVision: true,
    supportsComputerUse: false,
    locality: "local",
    tasks: ["vision", "fallback"],
    quality: "local",
    costHint: "free-local",
    privacyHint: "local",
    description: "Local vision option when installed through Ollama on stronger machines.",
  },
];

export function providerForModel(provider: ProviderType): ProviderDefinition {
  return PROVIDERS[provider];
}

export function nativeStoreKeyForProvider(provider: ProviderType): string {
  return PROVIDERS[provider].nativeStoreKey;
}

export function isLocalProvider(provider: ProviderType): boolean {
  return PROVIDERS[provider].locality === "local";
}

export function modelKey(model: Pick<RegistryModel, "provider" | "modelId">): string {
  return `${model.provider}:${model.modelId}`;
}
