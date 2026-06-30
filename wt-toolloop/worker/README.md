# DanteClicky Cloudflare Worker

API secrets proxy for DanteClicky. Keeps all provider keys server-side and exposes
a simple HTTP API that the desktop app calls.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/chat` | Route to Claude, OpenAI, or Grok. Set `body.provider` to `"claude"`, `"openai"`, or `"grok"`. Streams SSE back. |
| POST | `/tts` | ElevenLabs TTS. Body: `{ text, voice_id?, model_id? }`. Returns `audio/mpeg`. Default voice: Rachel (`21m00Tcm4TlvDq8ikWAM`). |
| GET | `/transcribe-token` | Returns a short-lived AssemblyAI realtime token: `{ token }`. |

## Setup

### 1. Install dependencies

```bash
cd worker && npm install
```

### 2. Set secrets

```bash
wrangler secret put ANTHROPIC_API_KEY
wrangler secret put OPENAI_API_KEY
wrangler secret put GROK_API_KEY
wrangler secret put ELEVENLABS_API_KEY
wrangler secret put ASSEMBLYAI_API_KEY
```

### 3. Deploy

```bash
wrangler deploy
```

### 4. Configure DanteClicky

Copy the worker URL printed after deploy (e.g. `https://dante-clicky-worker.<your-subdomain>.workers.dev`)
and paste it into DanteClicky Settings > Worker URL.

## Local development

```bash
npm run dev
```

Wrangler will serve the worker locally at `http://localhost:8787`. You will need to
set the secrets in a `.dev.vars` file (not committed):

```
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GROK_API_KEY=xai-...
ELEVENLABS_API_KEY=...
ASSEMBLYAI_API_KEY=...
```
