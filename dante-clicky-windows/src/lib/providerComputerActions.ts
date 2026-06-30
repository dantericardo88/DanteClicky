import type { ToolResultBlock, ToolUseBlock } from "../providers/chat";
import type { AgentAction, PendingComputerAction, ResolvedAgentAction } from "./agentLoop";
import { createPendingComputerAction } from "./agentLoop";

export interface ComputerActionMappingContext {
  screenWidth: number;
  screenHeight: number;
  screenLabel?: string;
  providerCallId?: string;
}

export interface OpenAIComputerCall {
  type: "computer_call";
  call_id?: string;
  id?: string;
  actions?: Array<Record<string, unknown>>;
  action?: Record<string, unknown>;
  pendingSafetyChecks?: Array<Record<string, unknown>>;
}

export interface ComputerToolResult {
  text: string;
  screenshotBase64?: string;
}

type ProviderName = "claude" | "openai";

export function claudeToolUseToAgentActions(
  toolUse: ToolUseBlock,
  context: ComputerActionMappingContext
): AgentAction[] {
  if (toolUse.name !== "computer") return [];
  const input = toolUse.input;
  const actionName = readString(input.action);
  if (!actionName) return [];

  const base = baseAction("claude", toolUse.id, actionName, 1, context);

  switch (actionName) {
    case "screenshot":
      return [{ ...base, kind: "screenshot", label: "screenshot" }];
    case "left_click":
    case "mouse_down":
    case "left_mouse_down":
    case "left_mouse_up":
      return [withCoordinate({ ...base, kind: "click", label: "left click" }, input.coordinate, context)];
    case "double_click":
      return [
        withCoordinate(
          { ...base, kind: "double_click", label: "double click" },
          input.coordinate,
          context
        ),
      ];
    case "triple_click":
      return [
        withCoordinate(
          { ...base, kind: "triple_click", label: "triple click" },
          input.coordinate,
          context
        ),
      ];
    case "right_click":
      return [
        withCoordinate(
          { ...base, kind: "right_click", label: "right click" },
          input.coordinate,
          context
        ),
      ];
    case "middle_click":
      return [
        withCoordinate(
          { ...base, kind: "middle_click", label: "middle click" },
          input.coordinate,
          context
        ),
      ];
    case "type":
      return [
        {
          ...base,
          kind: "type",
          label: "current focus",
          text: readString(input.text) ?? "",
        },
      ];
    case "key":
    case "hold_key":
      return [
        {
          ...base,
          kind: "key",
          label: "keyboard",
          key: readString(input.text) ?? readString(input.key) ?? "",
        },
      ];
    case "mouse_move":
      return [withCoordinate({ ...base, kind: "move", label: "cursor" }, input.coordinate, context)];
    case "scroll":
      return [
        {
          ...withCoordinate({ ...base, kind: "scroll", label: "scroll target" }, input.coordinate, context),
          scrollDelta: claudeScrollDelta(input),
        },
      ];
    case "wait":
      return [
        {
          ...base,
          kind: "wait",
          label: "wait",
          waitMs: clampNumber(readNumber(input.duration_ms) ?? 800, 0, 30_000),
        },
      ];
    case "left_click_drag":
      return [
        withDragCoordinates(
          { ...base, kind: "drag", label: "drag target" },
          input.start_coordinate,
          input.coordinate,
          context
        ),
      ];
    default:
      return [];
  }
}

export function openAIComputerCallToAgentActions(
  call: OpenAIComputerCall,
  context: ComputerActionMappingContext
): AgentAction[] {
  const providerCallId = call.call_id ?? call.id ?? context.providerCallId ?? "computer_call";
  const rawActions = call.actions ?? (call.action ? [call.action] : []);
  return rawActions.flatMap((rawAction, index) =>
    openAIActionToAgentAction(rawAction, {
      ...context,
      providerCallId,
      sequence: index + 1,
    })
  );
}

export function extractOpenAIComputerCalls(response: unknown): OpenAIComputerCall[] {
  const output = readObject(response)?.output;
  if (!Array.isArray(output)) return [];

  return output
    .filter((item): item is Record<string, unknown> => readObject(item)?.type === "computer_call")
    .map((item) => ({
      type: "computer_call",
      call_id: readString(item.call_id) ?? undefined,
      id: readString(item.id) ?? undefined,
      actions: readOpenAIActionArray(item.actions),
      action: readObject(item.action) ?? undefined,
      pendingSafetyChecks: readObjectArray(item.pending_safety_checks),
    }));
}

export function extractOpenAIResponseText(response: unknown): string {
  const responseObject = readObject(response);
  const outputText = readString(responseObject?.output_text);
  if (outputText) return outputText;

  const output = responseObject?.output;
  if (!Array.isArray(output)) return "";

  const chunks: string[] = [];
  for (const item of output) {
    const itemObject = readObject(item);
    if (!itemObject) continue;

    if (itemObject.type === "output_text") {
      const text = readString(itemObject.text);
      if (text) chunks.push(text);
      continue;
    }

    const content = itemObject.content;
    if (!Array.isArray(content)) continue;
    for (const contentItem of content) {
      const contentObject = readObject(contentItem);
      if (!contentObject) continue;
      const text = readString(contentObject.text) ?? readString(contentObject.output_text);
      if (text) chunks.push(text);
    }
  }

  return chunks.join("");
}

export function buildClaudeComputerToolResult(
  toolUseId: string,
  result: ComputerToolResult
): ToolResultBlock {
  const content: Array<{ type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: string; data: string } }> = [{ type: "text", text: result.text }];
  if (result.screenshotBase64) {
    content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: "image/jpeg",
        data: result.screenshotBase64,
      },
    });
  }
  return { type: "tool_result", tool_use_id: toolUseId, content };
}

export function buildOpenAIComputerCallOutput(
  callId: string,
  screenshotBase64: string,
  acknowledgedSafetyChecks: Array<Record<string, unknown>> = []
) {
  const payload: Record<string, unknown> = {
    type: "computer_call_output",
    call_id: callId,
    output: {
      type: "computer_screenshot",
      image_url: `data:image/jpeg;base64,${screenshotBase64}`,
      detail: "original",
    },
  };
  if (acknowledgedSafetyChecks.length > 0) {
    payload.acknowledged_safety_checks = acknowledgedSafetyChecks;
  }
  return payload;
}

export function buildPendingAgentAction(input: {
  action: ResolvedAgentAction;
  originalTask: string;
  reason: string;
}): PendingComputerAction {
  return createPendingComputerAction(input);
}

export function resumePendingAgentAction(
  pending: PendingComputerAction,
  confirmation: string
): ResolvedAgentAction | null {
  const token = confirmation.trim().toLowerCase();
  return /\b(confirm|approve|yes|go ahead|continue|resume|proceed)\b/.test(token)
    ? pending.action
    : null;
}

export const mapClaudeComputerToolUse = claudeToolUseToAgentActions;
export const mapOpenAIComputerCall = openAIComputerCallToAgentActions;

function openAIActionToAgentAction(
  rawAction: Record<string, unknown>,
  context: ComputerActionMappingContext & { providerCallId: string; sequence: number }
): AgentAction[] {
  const type = readString(rawAction.type);
  if (!type) return [];
  const base = baseAction("openai", context.providerCallId, type, context.sequence, context);

  switch (type) {
    case "screenshot":
      return [{ ...base, kind: "screenshot", label: "screenshot" }];
    case "click": {
      const button = readString(rawAction.button)?.toLowerCase();
      const kind =
        button === "right" ? "right_click" : button === "middle" ? "middle_click" : "click";
      return [
        withXY(
          {
            ...base,
            kind,
            label: kind.replace("_", " "),
          },
          rawAction.x,
          rawAction.y,
          context
        ),
      ];
    }
    case "double_click":
    case "move":
      return [
        withXY(
          {
            ...base,
            kind: type === "double_click" ? "double_click" : type,
            label: type.replace("_", " "),
          },
          rawAction.x,
          rawAction.y,
          context
        ),
      ];
    case "scroll":
      return [
        {
          ...withXY({ ...base, kind: "scroll", label: "scroll target" }, rawAction.x, rawAction.y, context),
          scrollDelta: clampNumber(
            readNumber(rawAction.scrollY) ??
              readNumber(rawAction.scroll_y) ??
              readNumber(rawAction.delta) ??
              0,
            -30,
            30
          ),
        },
      ];
    case "type":
      return [{ ...base, kind: "type", label: "current focus", text: readString(rawAction.text) ?? "" }];
    case "keypress":
    case "key":
      return [{ ...base, kind: "key", label: "keyboard", key: readOpenAIKey(rawAction) }];
    case "drag":
      return openAIDragAction(base, rawAction, context);
    case "wait":
      return [{ ...base, kind: "wait", label: "wait", waitMs: 800 }];
    default:
      return [];
  }
}

function openAIDragAction(
  base: AgentAction,
  rawAction: Record<string, unknown>,
  context: ComputerActionMappingContext
): AgentAction[] {
  const path = readPath(rawAction.path);
  if (path.length >= 2) {
    return [
      withDragCoordinates(
        { ...base, kind: "drag", label: "drag target" },
        path[0],
        path[path.length - 1],
        context
      ),
    ];
  }

  return [
    withDragCoordinates(
      { ...base, kind: "drag", label: "drag target" },
      readPointFromXY(rawAction.x, rawAction.y),
      readPointFromXY(rawAction.to_x, rawAction.to_y) ??
        readPointFromXY(rawAction.end_x, rawAction.end_y),
      context
    ),
  ];
}

function readPath(value: unknown): Array<[number, number]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (Array.isArray(item)) {
      const point = readCoordinate(item);
      return point ? [point] : [];
    }
    const object = readObject(item);
    if (object) {
      const point = readPointFromXY(object.x, object.y);
      return point ? [point] : [];
    }
    return [];
  });
}

function baseAction(
  provider: ProviderName,
  providerCallId: string,
  label: string,
  sequence: number,
  context: ComputerActionMappingContext
): AgentAction {
  return {
    id: `${provider}-${providerCallId}-${sequence}`,
    sequence,
    kind: "screenshot",
    label,
    screenLabel: context.screenLabel ?? "screen1",
    normalizedX: null,
    normalizedY: null,
    provider,
    providerCallId,
    sourceText: label,
  };
}

function withCoordinate(
  action: AgentAction,
  coordinate: unknown,
  context: ComputerActionMappingContext
): AgentAction {
  const point = readCoordinate(coordinate);
  if (!point) return action;
  return {
    ...action,
    normalizedX: normalizeCoordinate(point[0], context.screenWidth),
    normalizedY: normalizeCoordinate(point[1], context.screenHeight),
  };
}

function withXY(
  action: AgentAction,
  x: unknown,
  y: unknown,
  context: ComputerActionMappingContext
): AgentAction {
  const px = readNumber(x);
  const py = readNumber(y);
  if (px === null || py === null) return action;
  return {
    ...action,
    normalizedX: normalizeCoordinate(px, context.screenWidth),
    normalizedY: normalizeCoordinate(py, context.screenHeight),
  };
}

function withDragCoordinates(
  action: AgentAction,
  start: unknown,
  end: unknown,
  context: ComputerActionMappingContext
): AgentAction {
  const withStart = withCoordinate(action, start, context);
  const endPoint = readCoordinate(end);
  if (!endPoint) return withStart;
  return {
    ...withStart,
    targetNormalizedX: normalizeCoordinate(endPoint[0], context.screenWidth),
    targetNormalizedY: normalizeCoordinate(endPoint[1], context.screenHeight),
  };
}

function claudeScrollDelta(input: Record<string, unknown>): number {
  const amount = clampNumber(readNumber(input.scroll_amount) ?? readNumber(input.amount) ?? 3, 1, 30);
  const direction = readString(input.scroll_direction)?.toLowerCase();
  if (direction === "up" || direction === "left") return -amount;
  return amount;
}

function readOpenAIKey(rawAction: Record<string, unknown>): string {
  const key = readString(rawAction.key);
  if (key) return key;
  const keys = rawAction.keys;
  if (Array.isArray(keys)) return keys.filter((item) => typeof item === "string").join("+");
  return "";
}

function readPointFromXY(x: unknown, y: unknown): [number, number] | null {
  const px = readNumber(x);
  const py = readNumber(y);
  return px === null || py === null ? null : [px, py];
}

function readOpenAIActionArray(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    const object = readObject(item);
    return object ? [object] : [];
  });
}

function readCoordinate(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const x = readNumber(value[0]);
  const y = readNumber(value[1]);
  return x === null || y === null ? null : [x, y];
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readObjectArray(value: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(value)) return undefined;
  const objects = value.filter((item): item is Record<string, unknown> => readObject(item) !== null);
  return objects.length > 0 ? objects : undefined;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeCoordinate(value: number, size: number): number {
  if (size <= 0) return 0;
  return Math.round(clampNumber((value / size) * 1024, 0, 1024));
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
