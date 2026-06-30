import { invoke } from "@tauri-apps/api/core";
import { PROVIDERS } from "./providerRegistry";

export type KeyStatus = "unchecked" | "valid" | "invalid" | "checking";

export type Provider = "anthropic" | "openai" | "grok" | "openrouter" | "ollama" | "elevenLabs" | "assemblyAi";

async function validateAnthropicKey(key: string): Promise<{ valid: boolean; error?: string }> {
  try {
    // Use GET /v1/models — no body/model ID required; 200 = valid key, 401 = invalid key.
    // Avoids false-negatives from POST /v1/messages (overload 529, deprecated model 404, etc.)
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
    });
    if (res.status === 200) return { valid: true };
    if (res.status === 401 || res.status === 403) return { valid: false, error: "Invalid API key" };
    return { valid: false, error: `Unexpected status ${res.status}` };
  } catch {
    return { valid: false, error: "Network error — could not reach Anthropic" };
  }
}

async function validateOpenAIKey(key: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.status === 200) return { valid: true };
    if (res.status === 401) return { valid: false, error: "Invalid API key" };
    return { valid: false, error: `Unexpected status ${res.status}` };
  } catch {
    return { valid: false, error: "Network error — could not reach OpenAI" };
  }
}

async function validateGrokKey(key: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch("https://api.x.ai/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.status === 200) return { valid: true };
    if (res.status === 401) return { valid: false, error: "Invalid API key" };
    return { valid: false, error: `Unexpected status ${res.status}` };
  } catch {
    return { valid: false, error: "Network error — could not reach xAI" };
  }
}

async function validateOpenRouterKey(key: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.status === 200) return { valid: true };
    if (res.status === 401 || res.status === 403) return { valid: false, error: "Invalid API key" };
    return { valid: false, error: `Unexpected status ${res.status}` };
  } catch {
    return { valid: false, error: "Network error - could not reach OpenRouter" };
  }
}

async function validateOllama(): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch("http://localhost:11434/api/tags");
    if (res.status === 200) return { valid: true };
    return { valid: false, error: `Ollama responded with ${res.status}` };
  } catch {
    return { valid: false, error: "Ollama is not running on localhost:11434" };
  }
}

async function validateElevenLabsKey(key: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch("https://api.elevenlabs.io/v1/voices", {
      headers: { "xi-api-key": key },
    });
    if (res.status === 200) return { valid: true };
    if (res.status === 401) return { valid: false, error: "Invalid API key" };
    return { valid: false, error: `Unexpected status ${res.status}` };
  } catch {
    return { valid: false, error: "Network error — could not reach ElevenLabs" };
  }
}

async function validateAssemblyAiKey(key: string): Promise<{ valid: boolean; error?: string }> {
  try {
    await invoke("get_assemblyai_token", { apiKey: key });
    return { valid: true };
  } catch (err) {
    const msg = String(err);
    if (msg.includes("401") || msg.toLowerCase().includes("unauthorized")) {
      return { valid: false, error: "Invalid API key" };
    }
    return { valid: false, error: "Could not validate AssemblyAI key" };
  }
}

export async function validateKey(provider: Provider, key: string): Promise<KeyStatus> {
  if (provider !== "ollama" && !key.trim()) return "unchecked";

  let result: { valid: boolean; error?: string };

  switch (provider) {
    case "anthropic":
      result = await validateAnthropicKey(key);
      break;
    case "openai":
      result = await validateOpenAIKey(key);
      break;
    case "grok":
      result = await validateGrokKey(key);
      break;
    case "openrouter":
      result = await validateOpenRouterKey(key);
      break;
    case "ollama":
      result = await validateOllama();
      break;
    case "elevenLabs":
      result = await validateElevenLabsKey(key);
      break;
    case "assemblyAi":
      result = await validateAssemblyAiKey(key);
      break;
    default: {
      const _: never = provider;
      void _;
      return "unchecked";
    }
  }

  return result.valid ? "valid" : "invalid";
}

export interface DiscoveredModel {
  id: string;
  name?: string;
  supportsVision?: boolean;
}

export async function discoverProviderModels(provider: "openai" | "grok" | "openrouter" | "ollama", key?: string): Promise<DiscoveredModel[]> {
  const definition = PROVIDERS[provider];
  if (!definition.modelsUrl) return [];

  const headers: Record<string, string> = {};
  if (definition.requiresKey && key?.trim()) headers.Authorization = `Bearer ${key.trim()}`;
  if (definition.requiresKey && !key?.trim()) return [];

  const res = await fetch(definition.modelsUrl, { headers });
  if (!res.ok) return [];
  const json = await res.json();
  const rows = Array.isArray(json.models) ? json.models : Array.isArray(json.data) ? json.data : [];
  return rows
    .map((row: any) => {
      const id = typeof row.name === "string" && provider === "ollama" ? row.name : row.id;
      if (typeof id !== "string") return null;
      const modalities = row.input_modalities ?? row.output_modalities ?? row.architecture?.input_modalities ?? [];
      const supportsVision = Array.isArray(modalities) && modalities.includes("image");
      return { id, name: row.name, supportsVision };
    })
    .filter(Boolean);
}
