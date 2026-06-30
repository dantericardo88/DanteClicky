export interface UiElement {
  id: number;
  name: string;
  role: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  screenLabel: string;
}

// Parses the uiTreeText string produced by accessibility.rs or buildSomSystemPromptSection.
// Handles two line formats:
//   SoM:   [1] button "Save" → [POINT:512,256:Save:screen1]
//   Plain: button "Save" → [POINT:512,256:Save:screen1]
// Returns numbered list of interactive elements for Set-of-Mark overlay.
export function parseUiTree(uiTreeText: string): UiElement[] {
  if (!uiTreeText.trim()) return [];

  const elements: UiElement[] = [];
  let seqId = 1;

  const pointPattern = /\[POINT:(\d+(?:\.\d+)?),(\d+(?:\.\d+)?):([^:\]]+):([^\]]+)\]/g;
  const seen = new Set<string>();

  for (const line of uiTreeText.split("\n")) {
    pointPattern.lastIndex = 0;
    const match = pointPattern.exec(line);
    if (!match) continue;

    const [, cxStr, cyStr, pointName, screenLabelFromTag] = match;
    const key = `${cxStr},${cyStr}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const cx = Math.round(Number(cxStr));
    const cy = Math.round(Number(cyStr));

    // Try [N] prefix format: "[1] button "Save" → ..."
    const somMatch = line.match(/^\[(\d+)\]\s+(\w+)\s+"([^"]+)"/);
    // Fall back to plain format: "button "Save" → ..."
    const plainMatch = somMatch ? null : line.match(/^(\w+)\s+"([^"]+)"/);

    const elemId = somMatch ? Number(somMatch[1]) : seqId++;
    const elemRole = somMatch ? somMatch[2] : (plainMatch?.[1] ?? "element");
    const elemName = somMatch ? somMatch[3] : (plainMatch?.[2] ?? pointName);
    const elemScreenLabel = screenLabelFromTag ?? "screen1";

    elements.push({
      id: elemId,
      name: elemName,
      role: elemRole,
      x: cx - 20,
      y: cy - 10,
      w: 40,
      h: 20,
      cx,
      cy,
      screenLabel: elemScreenLabel,
    });
  }

  return elements;
}

// Builds the numbered element list injected into the system prompt.
// AI is instructed to use [ELEM:N] tags to reference elements by number.
export function buildElementList(elements: UiElement[]): string {
  if (elements.length === 0) return "";
  const lines = elements.map(
    (e) => `${e.id}. ${e.role} "${e.name}" at center (${e.cx},${e.cy}) on ${e.screenLabel}`
  );
  return "[clickable elements — reference by number using [ELEM:N]]\n" + lines.join("\n");
}

// Resolves [ELEM:N] tags in AI output to [POINT:...] tags using the parsed UI element list.
export function resolveElemTags(
  text: string,
  elements: UiElement[]
): { resolved: string; points: Array<{ x: number; y: number; label: string }> } {
  const points: Array<{ x: number; y: number; label: string }> = [];
  const resolved = text.replace(/\[ELEM:(\d+)\]/g, (match, numStr) => {
    const n = Number(numStr);
    const el = elements.find((e) => e.id === n);
    if (!el) return match;
    points.push({ x: el.cx, y: el.cy, label: el.name });
    return `[POINT:${el.cx},${el.cy}:${el.name}:${el.screenLabel}]`;
  });
  return { resolved, points };
}
