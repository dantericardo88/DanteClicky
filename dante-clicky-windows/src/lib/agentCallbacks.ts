import type { CapturedScreen } from "../hooks/useScreenCapture";
import type {
  AgentAction,
  ResolvedAgentAction,
  SafetyAssessment,
} from "./agentLoop";

export type AgentProvider = "claude" | "openai" | "tag";

export interface AgentRunContext {
  runId: string;
  sessionId?: string;
  provider: AgentProvider;
  model?: string;
  startedAt: number;
  totalCostUsd: number;
  screenshotCount: number;
  actionCount: number;
  tokensIn: number;
  tokensOut: number;
}

export interface AgentRunResult {
  status: string;
  stepsTaken: number;
  finalText?: string;
  blockedReason?: string;
}

export interface AgentApiRequest {
  endpoint: string;
  body: Record<string, unknown>;
  startedAt: number;
}

export interface AgentApiResponse {
  ok: boolean;
  durationMs: number;
  error?: string;
}

export interface AgentUsage {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  responseCostUsd?: number;
  rawProviderUsage?: Record<string, unknown>;
}

export interface AgentScreenshotInfo {
  source: "primary" | "context-refresh" | "verification";
  width?: number;
  height?: number;
  screen?: CapturedScreen;
}

export interface AgentCallbackHandler {
  readonly name: string;

  onRunStart?(ctx: AgentRunContext): void | Promise<void>;
  onRunEnd?(ctx: AgentRunContext, result: AgentRunResult): void | Promise<void>;

  onComputerCallStart?(
    ctx: AgentRunContext,
    action: ResolvedAgentAction
  ): void | Promise<void>;
  onComputerCallEnd?(
    ctx: AgentRunContext,
    action: ResolvedAgentAction,
    success: boolean,
    error?: string
  ): void | Promise<void>;

  onSafetyDecision?(
    ctx: AgentRunContext,
    action: AgentAction,
    decision: SafetyAssessment
  ): void | Promise<void>;

  onScreenshot?(
    ctx: AgentRunContext,
    info: AgentScreenshotInfo
  ): void | Promise<void>;

  onApiStart?(
    ctx: AgentRunContext,
    request: AgentApiRequest
  ): void | Promise<void>;
  onApiEnd?(
    ctx: AgentRunContext,
    request: AgentApiRequest,
    response: AgentApiResponse
  ): void | Promise<void>;

  onUsage?(ctx: AgentRunContext, usage: AgentUsage): void | Promise<void>;

  onText?(ctx: AgentRunContext, text: string): void | Promise<void>;

  onFunctionCallStart?(
    ctx: AgentRunContext,
    name: string,
    args: Record<string, unknown>
  ): void | Promise<void>;
  onFunctionCallEnd?(
    ctx: AgentRunContext,
    name: string,
    result: unknown,
    error?: string
  ): void | Promise<void>;
}

export interface AgentCallbackChainOptions {
  onHandlerError?: (handler: AgentCallbackHandler, event: string, err: unknown) => void;
}

type HandlerEvent = keyof Omit<AgentCallbackHandler, "name">;

export class AgentCallbackChain {
  private readonly handlers: AgentCallbackHandler[] = [];
  private readonly options: AgentCallbackChainOptions;

  constructor(options: AgentCallbackChainOptions = {}) {
    this.options = options;
  }

  register(handler: AgentCallbackHandler): this {
    this.handlers.push(handler);
    return this;
  }

  unregister(handler: AgentCallbackHandler): boolean {
    const idx = this.handlers.indexOf(handler);
    if (idx === -1) return false;
    this.handlers.splice(idx, 1);
    return true;
  }

  list(): readonly AgentCallbackHandler[] {
    return this.handlers;
  }

  async dispatch<E extends HandlerEvent>(
    event: E,
    ...args: Parameters<NonNullable<AgentCallbackHandler[E]>>
  ): Promise<void> {
    for (const handler of this.handlers) {
      const fn = handler[event] as
        | ((...a: unknown[]) => void | Promise<void>)
        | undefined;
      if (typeof fn !== "function") continue;
      try {
        await fn.apply(handler, args as unknown[]);
      } catch (err) {
        if (this.options.onHandlerError) {
          this.options.onHandlerError(handler, event as string, err);
        }
        // Handler errors are isolated per-handler — never cancel the chain.
      }
    }
  }
}

let runIdCounter = 0;

export function createAgentRunContext(init: {
  provider: AgentProvider;
  model?: string;
  sessionId?: string;
  now?: number;
}): AgentRunContext {
  runIdCounter += 1;
  return {
    runId: `run-${Date.now().toString(36)}-${runIdCounter.toString(36)}`,
    sessionId: init.sessionId,
    provider: init.provider,
    model: init.model,
    startedAt: init.now ?? Date.now(),
    totalCostUsd: 0,
    screenshotCount: 0,
    actionCount: 0,
    tokensIn: 0,
    tokensOut: 0,
  };
}

export function accumulateUsage(ctx: AgentRunContext, usage: AgentUsage): void {
  if (usage.inputTokens) ctx.tokensIn += usage.inputTokens;
  if (usage.outputTokens) ctx.tokensOut += usage.outputTokens;
  if (usage.responseCostUsd) ctx.totalCostUsd += usage.responseCostUsd;
}
