// Port of ElementLocationDetector.swift — parses [POINT:x,y:label:screenN] tags
// emitted by the AI when it wants to point at a UI element on screen

export interface PointAnnotation {
  x: number;        // 0–1024 normalized x
  y: number;        // 0–1024 normalized y
  label: string;
  screenLabel: string; // e.g. "screen1"
}

const POINT_REGEX = /\[POINT:(\d+(?:\.\d+)?),(\d+(?:\.\d+)?):([^:]+):([^\]]+)\]/g;

export function parsePoints(text: string): PointAnnotation[] {
  const results: PointAnnotation[] = [];
  let match: RegExpExecArray | null;

  POINT_REGEX.lastIndex = 0;
  while ((match = POINT_REGEX.exec(text)) !== null) {
    results.push({
      x: parseFloat(match[1]),
      y: parseFloat(match[2]),
      label: match[3].trim(),
      screenLabel: match[4].trim(),
    });
  }

  return results;
}

export function stripPoints(text: string): string {
  return text.replace(POINT_REGEX, "").replace(/\s{2,}/g, " ").trim();
}

// Convert normalized (0–1024) coords to absolute screen pixels
export function denormalize(
  point: PointAnnotation,
  screenWidth: number,
  screenHeight: number
): { px: number; py: number } {
  return {
    px: Math.round((point.x / 1024) * screenWidth),
    py: Math.round((point.y / 1024) * screenHeight),
  };
}
