export interface ScreenContextLike {
  label?: string;
  width: number;
  height: number;
  x: number;
  y: number;
  scale_factor?: number;
  is_primary: boolean;
  contains_cursor?: boolean;
}

export interface ScreenOcrEntry {
  screen: ScreenContextLike;
  text: string;
}

export interface ContextDepthBlockInput {
  screens: ScreenContextLike[];
  temporalContext?: string;
  temporalImageKeyframes?: number[];
}

const IMAGE_PAYLOAD_PATTERNS = [
  /\bdata:image\/[a-z0-9.+-]+;base64,/gi,
  /\bbase64\b/gi,
];

export function screenLabel(screen: ScreenContextLike, index: number): string {
  return screen.label?.trim() || `screen${index + 1}`;
}

export function renderCurrentScreensContext(screens: ScreenContextLike[]): string {
  if (screens.length === 0) return "";
  return screens
    .map((screen, index) => {
      const label = screenLabel(screen, index);
      const role = screenRole(screen);
      const scale = screen.scale_factor ? ` scale ${formatNumber(screen.scale_factor)}` : "";
      return `${label}: ${role}, ${screen.width}x${screen.height}, origin ${screen.x},${screen.y}${scale}`;
    })
    .join("\n");
}

export function renderMultiScreenOcrContext(entries: ScreenOcrEntry[], maxChars = 6000): string {
  const blocks = entries
    .map(({ screen, text }, index) => {
      const clean = sanitizePromptText(text);
      if (!clean) return "";
      const label = screenLabel(screen, index);
      const role = screenRole(screen);
      return `[ocr:${label} ${role} ${screen.width}x${screen.height}]\n${clean}\n[/ocr:${label}]`;
    })
    .filter(Boolean);
  return truncateByLines(blocks.join("\n\n"), maxChars);
}

export function buildContextDepthBlock(input: ContextDepthBlockInput, maxChars = 1600): string {
  const sections: string[] = [];
  const currentScreens = renderCurrentScreensContext(input.screens);
  if (currentScreens) {
    sections.push(`[current screens]\n${currentScreens}\n[/current screens]`);
  }
  if (input.temporalContext?.trim()) {
    sections.push(`[recent visual history]\n${sanitizePromptText(input.temporalContext)}\n[/recent visual history]`);
  }
  if (input.temporalImageKeyframes && input.temporalImageKeyframes.length > 0) {
    sections.push(
      `[attached recent keyframe images]\n${input.temporalImageKeyframes
        .map((id, index) => `image ${index + 1}: keyframe #${id}`)
        .join("\n")}\n[/attached recent keyframe images]`
    );
  }
  return truncateByLines(sections.join("\n\n"), maxChars);
}

export function shouldAttachTemporalVisualHistory(utterance: string): boolean {
  const text = utterance.toLowerCase();
  return [
    "what was",
    "what did",
    "what have i",
    "what was i",
    "earlier",
    "ago",
    "previous",
    "before",
    "recent",
    "history",
    "context",
    "working on",
    "last few",
  ].some((needle) => text.includes(needle));
}

function sanitizePromptText(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return IMAGE_PAYLOAD_PATTERNS.reduce(
    (acc, pattern) => acc.replace(pattern, "[redacted image payload]"),
    compact
  );
}

function truncateByLines(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const lines = text.split("\n");
  const kept: string[] = [];
  let used = 0;
  for (const line of lines) {
    const next = used + line.length + 1;
    if (next > Math.max(0, maxChars - 28)) break;
    kept.push(line);
    used = next;
  }
  return `${kept.join("\n").trimEnd()} [truncated for context]`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function screenRole(screen: ScreenContextLike): string {
  if (screen.contains_cursor) return screen.is_primary ? "primary/cursor" : "cursor";
  return screen.is_primary ? "primary" : "secondary";
}
