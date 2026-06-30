import { invoke } from "@tauri-apps/api/core";

export type KeyStatus = "unchecked" | "valid" | "invalid" | "checking";

export type Provider = "anthropic" | "openai" | "grok" | "elevenLabs" | "assemblyAi";

async function validateAnthropicKey(key: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "." }],
      }),
    });
    // 200 = success, 400 = bad request (auth passed), 401 = unauthorized
    if (res.status === 200 || res.status === 400) {
      return { valid: true };
    }
    if (res.status === 401) {
      return { valid: false, error: "Invalid API key" };
    }
    return { valid: false, error: `Unexpected status ${res.status}` };
  } catch (err) {
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
  if (!key.trim()) return "unchecked";

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
