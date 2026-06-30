// Port of ElementLocationDetector.swift: parses action tags emitted by the AI.
//
// [POINT:x,y:label:screenN]   animate cursor, then left-click
// [POINT:none:none:screenN]   explicit no-action stop
// [TYPE:"text to type"]       type after focusing the preceding point
// [SCROLL:delta]              scroll at the preceding point

export interface PointAnnotation {
  x: number;
  y: number;
  label: string;
  screenLabel: string;
}

export type AgentLoopParsedAction =
  | { kind: "point"; point: PointAnnotation }
  | { kind: "type"; text: string }
  | { kind: "scroll"; delta: number }
  | { kind: "stop"; reason: "no-action"; screenLabel: string };

const POINT_REGEX =
  /\[POINT:(?:(\d+(?:\.\d+)?),(\d+(?:\.\d+)?):([^:\]]+):([^\]]+)|none:none:([^\]]+))\]/g;
const TYPE_REGEX = /\[TYPE:"([^"]+)"\]/;
const SCROLL_REGEX = /\[SCROLL:(-?\d+)\]/;
const LOOP_ACTION_REGEX =
  /\[POINT:(?:(\d+(?:\.\d+)?),(\d+(?:\.\d+)?):([^:\]]+):([^\]]+)|none:none:([^\]]+))\]|\[TYPE:"([^"]+)"\]|\[SCROLL:(-?\d+)\]/g;

export function parsePoints(text: string): PointAnnotation[] {
  const results: PointAnnotation[] = [];
  let match: RegExpExecArray | null;

  POINT_REGEX.lastIndex = 0;
  while ((match = POINT_REGEX.exec(text)) !== null) {
    const rawX = match[1];
    const rawY = match[2];
    if (match[5] !== undefined) break;
    results.push({
      x: parseFloat(rawX),
      y: parseFloat(rawY),
      label: match[3].trim(),
      screenLabel: match[4].trim(),
    });
  }

  return results;
}

export function parseAgentLoopActions(text: string): AgentLoopParsedAction[] {
  const actions: AgentLoopParsedAction[] = [];
  let match: RegExpExecArray | null;

  LOOP_ACTION_REGEX.lastIndex = 0;
  while ((match = LOOP_ACTION_REGEX.exec(text)) !== null) {
    const rawX = match[1];
    const rawY = match[2];

    if (rawX !== undefined && rawY !== undefined) {
      const screenLabel = match[4].trim();
      actions.push({
        kind: "point",
        point: {
          x: parseFloat(rawX),
          y: parseFloat(rawY),
          label: match[3].trim(),
          screenLabel,
        },
      });
      continue;
    }

    if (match[5] !== undefined) {
      return [{ kind: "stop", reason: "no-action", screenLabel: match[5].trim() }];
    }

    if (match[6] !== undefined) {
      actions.push({ kind: "type", text: match[6] });
      continue;
    }

    if (match[7] !== undefined) {
      actions.push({ kind: "scroll", delta: parseInt(match[7], 10) });
    }
  }

  return actions;
}

export function parseTypeAction(text: string): string | null {
  const match = TYPE_REGEX.exec(text);
  return match ? match[1] : null;
}

export function parseScrollAction(text: string): number | null {
  const match = SCROLL_REGEX.exec(text);
  return match ? parseInt(match[1], 10) : null;
}

export function stripPoints(text: string): string {
  return text
    .replace(POINT_REGEX, "")
    .replace(TYPE_REGEX, "")
    .replace(SCROLL_REGEX, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function denormalize(
  point: PointAnnotation,
  screenWidth: number,
  screenHeight: number
): { px: number; py: number } {
  const normalizedX = Math.min(1024, Math.max(0, point.x));
  const normalizedY = Math.min(1024, Math.max(0, point.y));
  return {
    px: Math.round((normalizedX / 1024) * screenWidth),
    py: Math.round((normalizedY / 1024) * screenHeight),
  };
}
