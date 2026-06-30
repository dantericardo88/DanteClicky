# @danteclicky/client

TypeScript/JavaScript SDK for the [DanteClicky](https://github.com/dantericardo88/DanteClicky) REST + MCP API.

## Install

```bash
npm install @danteclicky/client
```

## Quick start

```ts
import { DanteClickyClient } from '@danteclicky/client';

const dc = new DanteClickyClient();          // defaults to http://127.0.0.1:9002

// Health check
const status = await dc.health();            // { ok: true, sessions: 0 }

// List available tools
const { tools } = await dc.listTools();

// Take a screenshot
const shot = await dc.screenshot({ monitor: 0 });
// shot.data  → base64 JPEG string
// shot.width / shot.height → dimensions in pixels

// Call any tool
await dc.callTool('clicky_keypress', { keys: ['ctrl', 'c'] });

// Stream live events over SSE
const stream = dc.streamEvents();
stream.on('bus', (event) => {
  console.log(event.topic, event.payload);
});
stream.close();   // when done
```

## Plugin registration

```ts
await dc.registerPlugin({
  name: 'my_tool',
  description: 'Does something cool',
  input_schema: { type: 'object', properties: { text: { type: 'string' } } },
  callback_url: 'http://localhost:9999/tool',
});

// Hot-reload a running plugin without restarting DanteClicky
await dc.reloadPlugin('my_tool', { callback_url: 'http://localhost:9999/tool/v2' });

// List all registered plugins
const { plugins } = await dc.listPlugins();
```

## API surface

| Method | REST endpoint | Description |
|---|---|---|
| `health()` | `GET /health` | Connectivity + session count |
| `openApiSpec()` | `GET /openapi.json` | Full OpenAPI 3.0.3 spec |
| `listTools()` | `GET /v1/tools` | All built-in + plugin tools |
| `callTool(name, input)` | `POST /v1/tool/:name` | Invoke a tool |
| `screenshot(opts?)` | `GET /v1/screenshot` | Capture monitor |
| `activeWindow()` | `GET /v1/active-window` | Foreground window context |
| `recentEvents(limit?)` | `GET /v1/events` | Observability ring buffer |
| `heapStats()` | `GET /v1/heap-stats` | Process memory counters |
| `modelPing(opts)` | `POST /v1/model/ping` | Provider latency probe |
| `registerPlugin(tool)` | `POST /v1/tools/register` | Register external tool |
| `reloadPlugin(name, patch)` | `POST /v1/tools/:name/reload` | Hot-reload plugin |
| `listPlugins()` | `GET /v1/tools/registered` | List registered plugins |
| `sendWebhook(payload)` | `POST /v1/webhook` | Inbound webhook trigger |
| `streamEvents()` | `GET /v1/events/stream` | SSE live event stream |

## Configuration

```ts
const dc = new DanteClickyClient({
  baseUrl: 'http://127.0.0.1:9002',  // default
  timeout: 10_000,                    // ms, default 10 000
});
```

## Building from source

```bash
cd packages/danteclicky-client
npm run build   # tsc → dist/
npm pack        # produces danteclicky-client-0.1.0.tgz
```

## Publishing

```bash
npm login --scope=@danteclicky
npm publish --access public
```
