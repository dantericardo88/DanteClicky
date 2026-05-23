/**
 * @danteclicky/client — TypeScript SDK for the DanteClicky REST API.
 *
 * Quick start:
 *   import { DanteClickyClient } from '@danteclicky/client';
 *   const dc = new DanteClickyClient();
 *   const status = await dc.health();
 *   const tools = await dc.listTools();
 *   const screenshot = await dc.screenshot();
 *   await dc.callTool('clicky_keypress', { keys: ['ctrl', 'c'] });
 *
 * Event streaming:
 *   const stream = dc.streamEvents();
 *   stream.on('bus', (event) => console.log(event));
 *
 * Plugin registration:
 *   await dc.registerPlugin({
 *     name: 'my_tool',
 *     description: 'Does something cool',
 *     input_schema: { type: 'object', properties: { text: { type: 'string' } } },
 *     callback_url: 'http://localhost:9999/tool',
 *   });
 */

export interface DanteClickyConfig {
  baseUrl?: string;
  timeout?: number;
}

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ScreenshotResult {
  monitorIndex: number;
  width: number;
  height: number;
  base64: string;
  format: string;
}

export interface BusEvent {
  topic: string;
  payload: unknown;
  timestamp_ms: number;
}

export interface PluginTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  callback_url: string;
}

export interface WebhookPayload {
  topic: string;
  [key: string]: unknown;
}

export class DanteClickyClient {
  private baseUrl: string;
  private timeout: number;

  constructor(config: DanteClickyConfig = {}) {
    this.baseUrl = config.baseUrl ?? 'http://127.0.0.1:9002';
    this.timeout = config.timeout ?? 10_000;
  }

  private async fetch(path: string, init?: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${path}`);
      return res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /** GET /health — check if DanteClicky is running. */
  async health(): Promise<{ ok: boolean; sessions: number }> {
    return this.fetch('/health') as Promise<{ ok: boolean; sessions: number }>;
  }

  /** GET /openapi.json — retrieve the OpenAPI spec. */
  async openApiSpec(): Promise<unknown> {
    return this.fetch('/openapi.json');
  }

  /** GET /v1/tools — list all available tools. */
  async listTools(): Promise<{ tools: Tool[] }> {
    return this.fetch('/v1/tools') as Promise<{ tools: Tool[] }>;
  }

  /** POST /v1/tool/:name — call a named tool with input. */
  async callTool(name: string, input: Record<string, unknown> = {}): Promise<unknown> {
    return this.fetch(`/v1/tool/${encodeURIComponent(name)}`, {
      method: 'POST',
      body: JSON.stringify({ name, input }),
    });
  }

  /** GET /v1/screenshot?monitor=N — capture a screenshot. */
  async screenshot(monitorIndex = 0): Promise<ScreenshotResult> {
    return this.fetch(`/v1/screenshot?monitor=${monitorIndex}`) as Promise<ScreenshotResult>;
  }

  /** GET /v1/active-window — get the current foreground window title. */
  async activeWindow(): Promise<{ title: string }> {
    return this.fetch('/v1/active-window') as Promise<{ title: string }>;
  }

  /** GET /v1/events?limit=N — pull recent observability events. */
  async recentEvents(limit = 50): Promise<{ ok: boolean; events: unknown[] }> {
    return this.fetch(`/v1/events?limit=${limit}`) as Promise<{ ok: boolean; events: unknown[] }>;
  }

  /** POST /v1/tools/register — register an external plugin tool. */
  async registerPlugin(plugin: PluginTool): Promise<{ ok: boolean }> {
    return this.fetch('/v1/tools/register', {
      method: 'POST',
      body: JSON.stringify(plugin),
    }) as Promise<{ ok: boolean }>;
  }

  /** GET /v1/tools/registered — list registered plugin tools. */
  async listPlugins(): Promise<{ ok: boolean; plugins: PluginTool[] }> {
    return this.fetch('/v1/tools/registered') as Promise<{ ok: boolean; plugins: PluginTool[] }>;
  }

  /** POST /v1/webhook — push an inbound webhook event into DanteClicky. */
  async sendWebhook(payload: WebhookPayload): Promise<{ ok: boolean; topic: string }> {
    return this.fetch('/v1/webhook', {
      method: 'POST',
      body: JSON.stringify(payload),
    }) as Promise<{ ok: boolean; topic: string }>;
  }

  /** GET /v1/heap-stats — current process memory/heap counters. */
  async heapStats(): Promise<{
    working_set_mb: number;
    peak_working_set_mb: number;
    private_bytes_mb?: number;
    page_fault_count?: number;
    source: string;
  }> {
    return this.fetch('/v1/heap-stats') as ReturnType<typeof this.heapStats>;
  }

  /** POST /v1/model/ping — measure first-byte latency to a model provider. */
  async modelPing(opts: {
    provider: 'anthropic' | 'openai' | 'ollama';
    model?: string;
  }): Promise<{ provider: string; model: string; latency_ms: number; error?: string }> {
    return this.fetch('/v1/model/ping', {
      method: 'POST',
      body: JSON.stringify(opts),
    }) as ReturnType<typeof this.modelPing>;
  }

  /** POST /v1/tools/:name/reload — hot-reload a registered plugin tool. */
  async reloadPlugin(
    name: string,
    patch: Partial<Omit<PluginTool, 'name'>>,
  ): Promise<{ ok: boolean; reloaded: string }> {
    return this.fetch(`/v1/tools/${encodeURIComponent(name)}/reload`, {
      method: 'POST',
      body: JSON.stringify(patch),
    }) as ReturnType<typeof this.reloadPlugin>;
  }

  /**
   * GET /v1/events/stream — subscribe to live event bus via SSE.
   * Returns an EventSource. Add listeners: source.addEventListener('bus', handler).
   * Only works in browser / Node.js 18+ with native EventSource support.
   */
  streamEvents(): EventSource {
    return new EventSource(`${this.baseUrl}/v1/events/stream`);
  }
}

export default DanteClickyClient;
