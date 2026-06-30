/**
 * DanteClicky Proxy Worker
 *
 * Model-agnostic proxy — routes to Claude, OpenAI, or Grok based on
 * the `provider` field in the request body. API keys stay server-side.
 *
 * Routes:
 *   POST /chat              → Claude | OpenAI | Grok (streaming SSE)
 *   POST /tts               → ElevenLabs TTS (returns audio/mpeg)
 *   GET  /transcribe-token  → AssemblyAI temporary token
 *
 * Secrets (set via `wrangler secret put <NAME>`):
 *   ANTHROPIC_API_KEY
 *   OPENAI_API_KEY
 *   GROK_API_KEY
 *   ELEVENLABS_API_KEY
 *   ASSEMBLYAI_API_KEY
 */

type Provider = "claude" | "openai" | "grok";

interface ChatRequestBody {
  provider: Provider;
  [key: string]: unknown;
}

interface Env {
  ANTHROPIC_API_KEY: string;
  OPENAI_API_KEY: string;
  GROK_API_KEY: string;
  ELEVENLABS_API_KEY: string;
  ASSEMBLYAI_API_KEY: string;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === "/chat" && request.method === "POST") {
        return await handleChat(request, env);
      }
      if (url.pathname === "/tts" && request.method === "POST") {
        return await handleTTS(request, env);
      }
      if (url.pathname === "/transcribe-token" && request.method === "GET") {
        return await handleTranscribeToken(env);
      }
    } catch (error) {
      console.error(`[${url.pathname}] Unhandled error:`, error);
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers: { "content-type": "application/json", ...CORS_HEADERS },
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

async function handleChat(request: Request, env: Env): Promise<Response> {
  const rawBody = await request.text();
  let parsed: ChatRequestBody;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json", ...CORS_HEADERS },
    });
  }

  const provider: Provider = (parsed.provider as Provider) ?? "claude";

  switch (provider) {
    case "claude":
      return forwardToClaude(parsed, env);
    case "openai":
      return forwardToOpenAI(parsed, env);
    case "grok":
      return forwardToGrok(parsed, env);
    default:
      return new Response(
        JSON.stringify({ error: `Unknown provider: ${provider}` }),
        { status: 400, headers: { "content-type": "application/json", ...CORS_HEADERS } }
      );
  }
}

async function forwardToClaude(parsed: ChatRequestBody, env: Env): Promise<Response> {
  const { provider: _p, ...body } = parsed;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[/chat:claude] ${response.status}: ${errorBody}`);
    return new Response(errorBody, {
      status: response.status,
      headers: { "content-type": "application/json", ...CORS_HEADERS },
    });
  }

  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "text/event-stream",
      "cache-control": "no-cache",
      ...CORS_HEADERS,
    },
  });
}

async function forwardToOpenAI(parsed: ChatRequestBody, env: Env): Promise<Response> {
  const { provider: _p, ...body } = parsed;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[/chat:openai] ${response.status}: ${errorBody}`);
    return new Response(errorBody, {
      status: response.status,
      headers: { "content-type": "application/json", ...CORS_HEADERS },
    });
  }

  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "text/event-stream",
      "cache-control": "no-cache",
      ...CORS_HEADERS,
    },
  });
}

// Grok uses an OpenAI-compatible API format at api.x.ai
async function forwardToGrok(parsed: ChatRequestBody, env: Env): Promise<Response> {
  const { provider: _p, ...body } = parsed;

  const response = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.GROK_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[/chat:grok] ${response.status}: ${errorBody}`);
    return new Response(errorBody, {
      status: response.status,
      headers: { "content-type": "application/json", ...CORS_HEADERS },
    });
  }

  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") || "text/event-stream",
      "cache-control": "no-cache",
      ...CORS_HEADERS,
    },
  });
}

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM"; // Rachel

async function handleTTS(request: Request, env: Env): Promise<Response> {
  let parsed: { text: string; voice_id?: string; model_id?: string };
  try {
    parsed = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "content-type": "application/json", ...CORS_HEADERS },
    });
  }

  const voiceId = parsed.voice_id || DEFAULT_VOICE_ID;
  const elevenLabsBody: Record<string, unknown> = { text: parsed.text };
  if (parsed.model_id) elevenLabsBody.model_id = parsed.model_id;

  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": env.ELEVENLABS_API_KEY,
        "content-type": "application/json",
        accept: "audio/mpeg",
      },
      body: JSON.stringify(elevenLabsBody),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[/tts] ${response.status}: ${errorBody}`);
    return new Response(errorBody, {
      status: response.status,
      headers: { "content-type": "application/json", ...CORS_HEADERS },
    });
  }

  return new Response(response.body, {
    status: response.status,
    headers: {
      "content-type": "audio/mpeg",
      ...CORS_HEADERS,
    },
  });
}

async function handleTranscribeToken(env: Env): Promise<Response> {
  const response = await fetch(
    "https://api.assemblyai.com/v2/realtime/token",
    {
      method: "POST",
      headers: {
        authorization: env.ASSEMBLYAI_API_KEY,
        "content-type": "application/json",
      },
      body: JSON.stringify({ expires_in: 480 }),
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    console.error(`[/transcribe-token] ${response.status}: ${errorBody}`);
    return new Response(errorBody, {
      status: response.status,
      headers: { "content-type": "application/json", ...CORS_HEADERS },
    });
  }

  return new Response(await response.text(), {
    status: 200,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}
