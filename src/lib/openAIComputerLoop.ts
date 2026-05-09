import type { CapturedScreen } from "../hooks/useScreenCapture";
import {
  classifyAgentActionSafety,
  createPendingComputerAction,
  resolveAgentAction,
  type PendingComputerAction,
  type ResolvedAgentAction,
} from "./agentLoop";
import {
  AgentCallbackChain,
  createAgentRunContext,
  type AgentRunContext,
} from "./agentCallbacks";
import {
  buildOpenAIComputerCallOutput,
  extractOpenAIComputerCalls,
  extractOpenAIResponseText,
  openAIComputerCallToAgentActions,
} from "./providerComputerActions";

export type OpenAIComputerLoopStatus =
  | "complete"
  | "max_steps"
  | "pending_confirmation"
  | "blocked";

export interface RunOpenAIComputerUseLoopOptions {
  initialResponse: unknown;
  initialScreens: CapturedScreen[];
  originalTask: string;
  maxSteps?: number;
  screenContext?: string;
  refreshScreenContext?: () => Promise<{
    screens: CapturedScreen[];
    screenContext?: string;
  }>;
  createResponse: (body: Record<string, unknown>) => Promise<unknown>;
  executeAction: (action: ResolvedAgentAction) => Promise<void>;
  capturePrimaryScreen: () => Promise<string>;
  now?: () => number;
  /**
   * Optional callback chain for lifecycle observation. When omitted, no
   * dispatches occur and behavior is identical to the pre-callback loop.
   * Wave 6 cua harvest, Phase 0c — see foamy-foraging-lynx.md.
   */
  callbacks?: AgentCallbackChain;
  /**
   * Optional pre-built run context. When omitted but `callbacks` is provided,
   * a default context is created. Useful for sharing accumulators across
   * adjacent loop invocations (resume after pending_confirmation).
   */
  runContext?: AgentRunContext;
  model?: string;
}

export interface OpenAIComputerUseLoopResult {
  status: OpenAIComputerLoopStatus;
  stepsTaken: number;
  finalResponse: unknown;
  finalText: string;
  pendingConfirmation?: PendingComputerAction;
  blockedReason?: string;
}

export async function runOpenAIComputerUseLoop(
  opts: RunOpenAIComputerUseLoopOptions
): Promise<OpenAIComputerUseLoopResult> {
  const maxSteps = opts.maxSteps ?? 10;
  let currentResponse = opts.initialResponse;
  let currentScreens = opts.initialScreens;
  let currentScreenContext = opts.screenContext;
  let stepsTaken = 0;

  const callbacks = opts.callbacks;
  const runContext =
    opts.runContext ??
    (callbacks
      ? createAgentRunContext({ provider: "openai", model: opts.model, now: opts.now?.() })
      : undefined);

  if (callbacks && runContext) {
    await callbacks.dispatch("onRunStart", runContext);
  }

  const finalize = async (
    result: OpenAIComputerUseLoopResult
  ): Promise<OpenAIComputerUseLoopResult> => {
    if (callbacks && runContext) {
      await callbacks.dispatch("onRunEnd", runContext, {
        status: result.status,
        stepsTaken: result.stepsTaken,
        finalText: result.finalText,
        blockedReason: result.blockedReason,
      });
    }
    return result;
  };

  while (stepsTaken < maxSteps) {
    const computerCall = extractOpenAIComputerCalls(currentResponse)[0];
    if (!computerCall) {
      return finalize(completeResult(currentResponse, stepsTaken));
    }

    const screen = currentScreens[0];
    const actions = screen
      ? openAIComputerCallToAgentActions(computerCall, {
          screenWidth: screen.width,
          screenHeight: screen.height,
        })
      : [];

    for (const action of actions) {
      if (stepsTaken >= maxSteps) {
        return finalize({
          status: "max_steps",
          stepsTaken,
          finalResponse: currentResponse,
          finalText: extractOpenAIResponseText(currentResponse),
        });
      }

      const resolvedAction = resolveAgentAction(action, currentScreens);
      const safety = classifyAgentActionSafety(
        action,
        opts.originalTask,
        extractOpenAIResponseText(currentResponse),
        { screenContext: currentScreenContext }
      );

      if (callbacks && runContext) {
        await callbacks.dispatch("onSafetyDecision", runContext, action, safety);
      }

      if (safety.decision !== "allow") {
        if (safety.decision === "block") {
          return finalize({
            status: "blocked",
            stepsTaken,
            finalResponse: currentResponse,
            finalText: extractOpenAIResponseText(currentResponse),
            blockedReason: safety.reason,
          });
        }

        return finalize({
          status: "pending_confirmation",
          stepsTaken,
          finalResponse: currentResponse,
          finalText: extractOpenAIResponseText(currentResponse),
          pendingConfirmation: createPendingComputerAction({
            action: resolvedAction,
            originalTask: opts.originalTask,
            reason: safety.reason,
            tier: safety.tier,
            now: opts.now?.(),
            resume: {
              provider: "openai",
              previousResponseId: readResponseId(currentResponse),
              providerCallId: computerCall.call_id ?? computerCall.id,
              stepNumber: stepsTaken + 1,
            },
          }),
        });
      }

      if (callbacks && runContext) {
        await callbacks.dispatch("onComputerCallStart", runContext, resolvedAction);
      }

      let executionError: string | undefined;
      try {
        await opts.executeAction(resolvedAction);
      } catch (err) {
        executionError = err instanceof Error ? err.message : String(err);
        if (callbacks && runContext) {
          await callbacks.dispatch(
            "onComputerCallEnd",
            runContext,
            resolvedAction,
            false,
            executionError
          );
        }
        throw err;
      }

      stepsTaken++;
      if (runContext) runContext.actionCount += 1;
      if (callbacks && runContext) {
        await callbacks.dispatch(
          "onComputerCallEnd",
          runContext,
          resolvedAction,
          true,
          undefined
        );
      }
    }

    const screenshotBase64 = await opts.capturePrimaryScreen();
    if (runContext) runContext.screenshotCount += 1;
    if (callbacks && runContext) {
      const primaryScreen = currentScreens[0];
      await callbacks.dispatch("onScreenshot", runContext, {
        source: "primary",
        width: primaryScreen?.width,
        height: primaryScreen?.height,
        screen: primaryScreen,
      });
    }

    const apiBody: Record<string, unknown> = {
      previous_response_id: readResponseId(currentResponse),
      input: [
        buildOpenAIComputerCallOutput(
          computerCall.call_id ?? computerCall.id ?? "computer_call",
          screenshotBase64,
          computerCall.pendingSafetyChecks ?? []
        ),
      ],
    };
    const apiRequest = {
      endpoint: "openai.responses.create",
      body: apiBody,
      startedAt: opts.now?.() ?? Date.now(),
    };

    if (callbacks && runContext) {
      await callbacks.dispatch("onApiStart", runContext, apiRequest);
    }

    let apiOk = true;
    let apiError: string | undefined;
    try {
      currentResponse = await opts.createResponse(apiBody);
    } catch (err) {
      apiOk = false;
      apiError = err instanceof Error ? err.message : String(err);
      if (callbacks && runContext) {
        await callbacks.dispatch("onApiEnd", runContext, apiRequest, {
          ok: apiOk,
          durationMs: (opts.now?.() ?? Date.now()) - apiRequest.startedAt,
          error: apiError,
        });
      }
      throw err;
    }

    if (callbacks && runContext) {
      await callbacks.dispatch("onApiEnd", runContext, apiRequest, {
        ok: apiOk,
        durationMs: (opts.now?.() ?? Date.now()) - apiRequest.startedAt,
      });
    }

    if (opts.refreshScreenContext) {
      const refreshed = await opts.refreshScreenContext();
      currentScreens = refreshed.screens.length > 0 ? refreshed.screens : currentScreens;
      currentScreenContext = refreshed.screenContext ?? currentScreenContext;
    }
  }

  return finalize({
    status: "max_steps",
    stepsTaken,
    finalResponse: currentResponse,
    finalText: extractOpenAIResponseText(currentResponse),
  });
}

function completeResult(response: unknown, stepsTaken: number): OpenAIComputerUseLoopResult {
  return {
    status: "complete",
    stepsTaken,
    finalResponse: response,
    finalText: extractOpenAIResponseText(response),
  };
}

function readResponseId(response: unknown): string | undefined {
  return response !== null &&
    typeof response === "object" &&
    !Array.isArray(response) &&
    typeof (response as Record<string, unknown>).id === "string"
    ? ((response as Record<string, unknown>).id as string)
    : undefined;
}
