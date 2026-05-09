import type { CapturedScreen } from "../hooks/useScreenCapture";
import { resolveElemTags, type UiElement } from "./uiTreeParser";

export type AgentActionKind =
  | "click"
  | "double_click"
  | "triple_click"
  | "right_click"
  | "middle_click"
  | "type"
  | "scroll"
  | "move"
  | "drag"
  | "key"
  | "screenshot"
  | "wait"
  | "none";
export type SafetyDecision = "allow" | "needs_confirmation" | "block";
export type SafetyTier = 0 | 1 | 2 | 3 | 4;

export interface AgentAction {
  id: string;
  sequence: number;
  kind: AgentActionKind;
  label: string;
  screenLabel: string;
  normalizedX: number | null;
  normalizedY: number | null;
  targetNormalizedX?: number | null;
  targetNormalizedY?: number | null;
  text?: string;
  key?: string;
  scrollDelta?: number;
  waitMs?: number;
  provider?: "tag" | "claude" | "openai";
  providerCallId?: string;
  sourceText: string;
}

export interface ResolvedAgentAction extends AgentAction {
  absoluteX: number | null;
  absoluteY: number | null;
  targetAbsoluteX?: number | null;
  targetAbsoluteY?: number | null;
  screen: CapturedScreen | null;
}

export interface SafetyAssessment {
  decision: SafetyDecision;
  tier: SafetyTier;
  reason: string;
}

export interface LoopContinuationPromptInput {
  originalTask: string;
  stepNumber: number;
  maxSteps: number;
  action: ResolvedAgentAction;
  verification: {
    success: boolean;
    explanation: string;
  };
}

export interface PendingComputerAction {
  id: string;
  createdAt: number;
  reason: string;
  tier: SafetyTier;
  originalTask: string;
  action: ResolvedAgentAction;
  resume?: {
    provider: "claude" | "openai" | "tag";
    modelId?: string;
    previousResponseId?: string;
    providerCallId?: string;
    stepNumber?: number;
  };
}

const POINT_TAG_REGEX =
  /\[POINT:(?:(\d+(?:\.\d+)?),(\d+(?:\.\d+)?):([^:\]]+):([^\]]+)|none:none:([^\]]+))\]/g;
const TYPE_TAG_REGEX = /\[TYPE:"((?:\\"|[^"])*)"\]/;
const SCROLL_TAG_REGEX = /\[SCROLL:(-?\d+)\]/;
const WAIT_TAG_REGEX = /\[WAIT:(\d{1,5})\]/;
const DOUBLE_CLICK_TAG_REGEX = /\[DOUBLE_CLICK\]/;
const RIGHT_CLICK_TAG_REGEX = /\[RIGHT_CLICK\]/;
const KEY_TAG_REGEX = /\[KEY:"((?:\\"|[^"])*)"\]/;

const SENSITIVE_PATTERN =
  /\b(password|passcode|two-factor|2fa|otp|one-time code|credit card|card number|cvv|ssn|social security|bank|wire|crypto|wallet|seed phrase|private key|secret|api key)\b/i;
const DESTRUCTIVE_PATTERN =
  /\b(delete|remove|erase|format|reset|factory reset|uninstall|overwrite|discard|drop table|terminate|kill process|shutdown|restart|trash|empty|wipe|revoke|make public|grant access)\b/i;
const COMMITMENT_PATTERN =
  /\b(purchase|buy|order|checkout|pay|transfer|wire|send|share|upload|submit|post|publish|email|message|dm|sign|accept|agree|confirm)\b/i;
const HIGH_RISK_KEY_PATTERN = /\b(enter|return|ctrl\+enter|control\+enter|delete|backspace)\b/i;
const PROMPT_INJECTION_PATTERN =
  /\b(ignore|disregard|override|bypass)\b.{0,48}\b(previous|prior|system|developer|user|original)?\s*instructions?\b|\bdo not tell the user\b|\bsecretly\b|\bsystem:\s*ignore\b|\breveal\b.{0,24}\b(system prompt|developer message|instructions?)\b/i;
const SECRET_TOKEN_PATTERN =
  /\b(sk-(?:live|test|proj)-[a-z0-9_-]{6,}|[a-z0-9_-]{24,}\.[a-z0-9_-]{12,}\.[a-z0-9_-]{12,})\b/i;
const EXFILTRATION_PATTERN =
  /\b(send|share|post|publish|upload|paste|copy|message|email|dm|transfer)\b/i;
const SYSTEM_COMPROMISE_PATTERN =
  /\b(disable|turn off|bypass)\b.{0,32}\b(windows defender|antivirus|anti-virus|firewall|security|protection)\b|\b(install malware|run malware|phishing kit|steal credentials|exfiltrate|grant admin|run as administrator)\b/i;

export interface SafetyContext {
  screenContext?: string;
}

// Resolve [ELEM:N] tags to [POINT:...] tags using the parsed UI element list,
// then extract actions from the resolved text.
export function extractAgentActionsWithElements(
  responseText: string,
  elements: UiElement[]
): AgentAction[] {
  const { resolved } = resolveElemTags(responseText, elements);
  return extractAgentActions(resolved);
}

export function extractAgentActions(responseText: string): AgentAction[] {
  const pointMatches = [...responseText.matchAll(POINT_TAG_REGEX)];
  const actions: AgentAction[] = [];

  for (let index = 0; index < pointMatches.length; index++) {
    const match = pointMatches[index];
    const nextMatch = pointMatches[index + 1];
    const sourceText = responseText.slice(
      match.index ?? 0,
      nextMatch?.index ?? responseText.length
    );
    const rawX = match[1];
    const rawY = match[2];
    const noActionScreenLabel = match[5];
    if (noActionScreenLabel !== undefined) {
      actions.push({
        id: `action-${index + 1}`,
        sequence: index + 1,
        kind: "none",
        label: "none",
        screenLabel: noActionScreenLabel.trim(),
        normalizedX: null,
        normalizedY: null,
        sourceText,
      });
      break;
    }

    const normalizedX = rawX === "none" ? null : Number.parseFloat(rawX);
    const normalizedY = rawY === "none" ? null : Number.parseFloat(rawY);
    const typeText = parseTypeTag(sourceText);
    const scrollDelta = parseScrollTag(sourceText);
    const waitMs = parseWaitTag(sourceText);
    const keyText = parseKeyTag(sourceText);

    let kind: AgentActionKind = "click";
    if (normalizedX === null || normalizedY === null) {
      kind = keyText !== null ? "key" : waitMs ? "wait" : "none";
    } else if (typeText !== null) {
      kind = "type";
    } else if (scrollDelta !== null) {
      kind = "scroll";
    } else if (RIGHT_CLICK_TAG_REGEX.test(sourceText)) {
      kind = "right_click";
    } else if (DOUBLE_CLICK_TAG_REGEX.test(sourceText)) {
      kind = "double_click";
    } else if (keyText !== null) {
      kind = "key";
    } else if (waitMs !== null) {
      kind = "wait";
    }

    actions.push({
      id: `action-${index + 1}`,
      sequence: index + 1,
      kind,
      label: match[3].trim(),
      screenLabel: match[4].trim(),
      normalizedX,
      normalizedY,
      text: typeText ?? undefined,
      key: keyText ?? undefined,
      scrollDelta: scrollDelta ?? undefined,
      waitMs: waitMs ?? undefined,
      provider: "tag",
      sourceText,
    });
  }

  return actions;
}

export function resolveAgentAction(
  action: AgentAction,
  screens: CapturedScreen[]
): ResolvedAgentAction {
  if (action.normalizedX === null || action.normalizedY === null) {
    return { ...action, absoluteX: null, absoluteY: null, screen: null };
  }

  const screen =
    screens.find((candidate) => candidate.label === action.screenLabel) ??
    screens.find((candidate) => candidate.is_primary) ??
    screens[0] ??
    null;

  if (!screen) {
    return { ...action, absoluteX: null, absoluteY: null, screen: null };
  }

  const normalizedX = clamp(action.normalizedX, 0, 1024);
  const normalizedY = clamp(action.normalizedY, 0, 1024);

  const target =
    action.targetNormalizedX !== undefined && action.targetNormalizedY !== undefined
      ? {
          targetAbsoluteX: Math.round(
            screen.x + (clamp(action.targetNormalizedX ?? 0, 0, 1024) / 1024) * screen.width
          ),
          targetAbsoluteY: Math.round(
            screen.y + (clamp(action.targetNormalizedY ?? 0, 0, 1024) / 1024) * screen.height
          ),
        }
      : {};

  return {
    ...action,
    absoluteX: Math.round(screen.x + (normalizedX / 1024) * screen.width),
    absoluteY: Math.round(screen.y + (normalizedY / 1024) * screen.height),
    ...target,
    screen,
  };
}

export function classifyAgentActionSafety(
  action: AgentAction,
  userPrompt: string,
  assistantText: string,
  context: SafetyContext = {}
): SafetyAssessment {
  const combinedIntent = `${userPrompt}\n${assistantText}\n${action.label}\n${action.text ?? ""}\n${context.screenContext ?? ""}`;
  const screenContext = context.screenContext ?? "";
  const actionIntent = `${assistantText}\n${action.label}\n${action.text ?? ""}`;

  if (
    action.kind === "none" ||
    action.kind === "move" ||
    action.kind === "screenshot" ||
    action.kind === "wait"
  ) {
    return { decision: "allow", tier: 0, reason: "read-only or non-mutating action" };
  }

  if (
    PROMPT_INJECTION_PATTERN.test(screenContext) &&
    (SENSITIVE_PATTERN.test(actionIntent) ||
      SECRET_TOKEN_PATTERN.test(actionIntent) ||
      DESTRUCTIVE_PATTERN.test(actionIntent) ||
      COMMITMENT_PATTERN.test(actionIntent) ||
      DESTRUCTIVE_PATTERN.test(screenContext) ||
      COMMITMENT_PATTERN.test(screenContext) ||
      /\b(approve|allow|authorize|continue)\b/i.test(action.label))
  ) {
    return {
      decision: "block",
      tier: 4,
      reason: "screen prompt-injection attempt detected",
    };
  }

  if (
    (SENSITIVE_PATTERN.test(combinedIntent) || SECRET_TOKEN_PATTERN.test(combinedIntent)) &&
    EXFILTRATION_PATTERN.test(combinedIntent)
  ) {
    return {
      decision: "block",
      tier: 4,
      reason: "credential exfiltration is blocked",
    };
  }

  if (SYSTEM_COMPROMISE_PATTERN.test(combinedIntent)) {
    return {
      decision: "block",
      tier: 4,
      reason: "system compromise action is blocked",
    };
  }

  if (SENSITIVE_PATTERN.test(combinedIntent)) {
    return {
      decision: "needs_confirmation",
      tier: 3,
      reason: "sensitive data or credentials may be involved",
    };
  }

  if (DESTRUCTIVE_PATTERN.test(combinedIntent)) {
    return {
      decision: "needs_confirmation",
      tier: 3,
      reason: "destructive or hard-to-reverse action detected",
    };
  }

  if (COMMITMENT_PATTERN.test(combinedIntent)) {
    return {
      decision: "needs_confirmation",
      tier: 3,
      reason: "external commitment action detected",
    };
  }

  if (
    action.kind === "key" &&
    HIGH_RISK_KEY_PATTERN.test(action.key ?? action.label) &&
    (DESTRUCTIVE_PATTERN.test(context.screenContext ?? "") ||
      SENSITIVE_PATTERN.test(context.screenContext ?? "") ||
      COMMITMENT_PATTERN.test(context.screenContext ?? ""))
  ) {
    return {
      decision: "needs_confirmation",
      tier: 3,
      reason: "high-impact keypress on sensitive screen context",
    };
  }

  if (
    action.kind === "drag" &&
    (DESTRUCTIVE_PATTERN.test(context.screenContext ?? "") ||
      COMMITMENT_PATTERN.test(context.screenContext ?? ""))
  ) {
    return {
      decision: "needs_confirmation",
      tier: 3,
      reason: "drag action on high-impact screen context",
    };
  }

  if (action.kind === "type") {
    return { decision: "allow", tier: 2, reason: "typing benign text into the active UI" };
  }

  if (action.kind === "key" || action.kind === "drag") {
    return { decision: "allow", tier: 2, reason: "keyboard or drag action in the active UI" };
  }

  return { decision: "allow", tier: 1, reason: "navigation-level pointer action" };
}

export function describeAgentAction(action: AgentAction): string {
  if (action.kind === "none") return "no further action";
  if (action.kind === "type") return `type into ${action.label}`;
  if (action.kind === "key") return `press ${action.key ?? action.label}`;
  if (action.kind === "scroll") return `scroll ${action.label}`;
  if (action.kind === "move") return `move cursor to ${action.label}`;
  if (action.kind === "drag") return `drag ${action.label}`;
  if (action.kind === "double_click") return `double-click ${action.label}`;
  if (action.kind === "triple_click") return `triple-click ${action.label}`;
  if (action.kind === "right_click") return `right-click ${action.label}`;
  if (action.kind === "middle_click") return `middle-click ${action.label}`;
  if (action.kind === "screenshot") return "capture screenshot";
  if (action.kind === "wait") return `wait ${action.waitMs ?? 800}ms`;
  return `click ${action.label}`;
}

export function createPendingComputerAction(input: {
  action: ResolvedAgentAction;
  originalTask: string;
  reason: string;
  tier?: SafetyTier;
  now?: number;
  resume?: PendingComputerAction["resume"];
}): PendingComputerAction {
  const createdAt = input.now ?? Date.now();
  return {
    id: `pending-${createdAt}-${input.action.sequence}`,
    createdAt,
    reason: input.reason,
    tier: input.tier ?? 2,
    originalTask: input.originalTask,
    action: input.action,
    resume: input.resume,
  };
}

export function isComputerActionConfirmation(text: string): "confirm" | "cancel" | "none" {
  const normalized = text.trim().toLowerCase();
  if (
    /\b(cancel|stop|abort|never mind|nevermind|do not|don't|no)\b/.test(normalized)
  ) {
    return "cancel";
  }
  if (
    /\b(confirm|approve|yes|yep|yeah|go ahead|continue|resume|do it|proceed)\b/.test(
      normalized
    )
  ) {
    return "confirm";
  }
  return "none";
}

export function buildLoopContinuationPrompt(input: LoopContinuationPromptInput): string {
  const { originalTask, stepNumber, maxSteps, action, verification } = input;
  const verificationLine = verification.success
    ? `the action succeeded: ${verification.explanation || "the screen changed as expected"}`
    : `the action failed — ${verification.explanation || "the screen did not change as expected"}. do not repeat this action. try a completely different approach, element, or sequence to achieve the same goal.`;

  return [
    `original task: ${originalTask}`,
    `i executed step ${stepNumber} of ${maxSteps}: ${describeAgentAction(action)}.`,
    verificationLine,
    "look at the current screenshot and decide the next step.",
    "if the task is complete, say a short confirmation and end with [POINT:none:none:screen1].",
    "if another action is needed, return exactly one next action tag using the existing formats.",
    "do not repeat an action that already succeeded unless the screen clearly shows it is still needed.",
    "do not ask the user for confirmation unless the next action involves credentials, payments, sending messages, deleting data, installing software, or other hard-to-reverse changes.",
  ].join("\n");
}

export function buildVerificationResultText(
  actionDescription: string,
  verification: { success: boolean; explanation: string }
): string {
  return verification.success
    ? `${actionDescription}: ${verification.explanation}`
    : `${actionDescription}: the action failed — ${verification.explanation}. do not repeat this action. try a completely different approach, element, or sequence to achieve the same goal.`;
}

export function hasExecutableAction(actions: AgentAction[]): boolean {
  return actions.some((action) => action.kind !== "none");
}

function parseTypeTag(sourceText: string): string | null {
  const match = TYPE_TAG_REGEX.exec(sourceText);
  if (!match) return null;
  return match[1].replace(/\\"/g, '"');
}

function parseScrollTag(sourceText: string): number | null {
  const match = SCROLL_TAG_REGEX.exec(sourceText);
  return match ? Number.parseInt(match[1], 10) : null;
}

function parseWaitTag(sourceText: string): number | null {
  const match = WAIT_TAG_REGEX.exec(sourceText);
  return match ? Number.parseInt(match[1], 10) : null;
}

function parseKeyTag(sourceText: string): string | null {
  const match = KEY_TAG_REGEX.exec(sourceText);
  if (!match) return null;
  return match[1].replace(/\\"/g, '"');
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
