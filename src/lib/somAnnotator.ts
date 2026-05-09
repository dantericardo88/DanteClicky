export interface SomElement {
  index: number;
  name: string;
  role: string;
  x: number;
  y: number;
  width: number;
  height: number;
  normalizedCx: number;
  normalizedCy: number;
  normalizedX: number;
  normalizedY: number;
  normalizedW: number;
  normalizedH: number;
  screenLabel: string;
  enabled: boolean;
  checked: string | null;
  value: string | null;
  expanded: string | null;
  focused: boolean;
  selected: boolean | null;
  automationId: string | null;
  scrollPct: number | null;
}

export interface SomResult {
  annotatedBase64: string;
  elements: SomElement[];
}

const MAX_ELEMENTS = 20;
const MIN_DIM = 4;

export async function annotateSom(
  screenshotBase64: string,
  rawElements: Array<{
    name: string;
    role: string;
    x: number;
    y: number;
    width: number;
    height: number;
    enabled?: boolean;
    checked?: string | null;
    value?: string | null;
    expanded?: string | null;
    focused?: boolean;
    selected?: boolean | null;
    automation_id?: string | null;
    scroll_pct?: number | null;
  }>,
  screenWidth: number,
  screenHeight: number,
  screenLabel: string
): Promise<SomResult> {
  const canvas = document.createElement("canvas");
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = reject;
    img.src = `data:image/jpeg;base64,${screenshotBase64}`;
  });

  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  const sw = screenWidth > 0 ? screenWidth : 1920;
  const sh = screenHeight > 0 ? screenHeight : 1080;
  const scaleX = canvas.width / sw;
  const scaleY = canvas.height / sh;

  // Filter: skip empty names and sub-pixel elements; sort top-to-bottom, left-to-right
  const sorted = rawElements
    .filter((e) => e.name.trim().length > 0 && e.width >= MIN_DIM && e.height >= MIN_DIM)
    .sort((a, b) => a.y - b.y || a.x - b.x);

  // Deduplicate: skip elements whose center is within 15px of an already-kept element
  // (removes invisible parent containers that share coords with their labeled child)
  const DEDUP_PX = 15;
  const dedupSorted: typeof sorted = [];
  for (const el of sorted) {
    const ecx = el.x + el.width / 2;
    const ecy = el.y + el.height / 2;
    const tooClose = dedupSorted.some((kept) => {
      const kcx = kept.x + kept.width / 2;
      const kcy = kept.y + kept.height / 2;
      return Math.abs(ecx - kcx) < DEDUP_PX && Math.abs(ecy - kcy) < DEDUP_PX;
    });
    if (!tooClose) dedupSorted.push(el);
    if (dedupSorted.length >= MAX_ELEMENTS) break;
  }

  const elements: SomElement[] = dedupSorted.map((el, i) => {
    const index = i + 1;
    const cx = Math.round(((el.x + el.width / 2) / sw) * 1024);
    const cy = Math.round(((el.y + el.height / 2) / sh) * 1024);
    const nx = Math.round((el.x / sw) * 1024);
    const ny = Math.round((el.y / sh) * 1024);
    const nw = Math.round((el.width / sw) * 1024);
    const nh = Math.round((el.height / sh) * 1024);

    const canvasX = el.x * scaleX;
    const canvasY = el.y * scaleY;
    const canvasW = el.width * scaleX;
    const canvasH = el.height * scaleY;

    const isFocused = el.focused === true;
    const isDisabled = el.enabled === false;
    const strokeColor = isFocused
      ? "rgba(245,158,11,0.85)"
      : isDisabled
      ? "rgba(156,163,175,0.6)"
      : "rgba(99,102,241,0.85)";
    const badgeColor = isFocused
      ? "rgba(245,158,11,0.9)"
      : isDisabled
      ? "rgba(156,163,175,0.7)"
      : "rgba(99,102,241,0.9)";

    // Bounding box
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = Math.max(1.5, scaleX);
    ctx.strokeRect(canvasX, canvasY, canvasW, canvasH);

    // Badge background
    const label = String(index);
    const fontSize = Math.round(Math.max(10, 11 * scaleX));
    ctx.font = `bold ${fontSize}px sans-serif`;
    const textW = ctx.measureText(label).width;
    const badgeW = textW + 6 * scaleX;
    const badgeH = 16 * scaleY;
    const badgeX = canvasX;
    const badgeY = Math.max(0, canvasY - badgeH);

    ctx.fillStyle = badgeColor;
    ctx.fillRect(badgeX, badgeY, badgeW, badgeH);

    // Badge text
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, badgeX + 3 * scaleX, badgeY + badgeH - 3 * scaleY);

    return {
      index,
      name: el.name,
      role: el.role,
      x: el.x,
      y: el.y,
      width: el.width,
      height: el.height,
      normalizedCx: cx,
      normalizedCy: cy,
      normalizedX: nx,
      normalizedY: ny,
      normalizedW: nw,
      normalizedH: nh,
      screenLabel,
      enabled: el.enabled !== false,
      checked: el.checked ?? null,
      value: el.value ?? null,
      expanded: el.expanded ?? null,
      focused: el.focused === true,
      selected: el.selected ?? null,
      automationId: el.automation_id ?? null,
      scrollPct: el.scroll_pct ?? null,
    };
  });

  const annotatedBase64 = canvas
    .toDataURL("image/jpeg", 0.95)
    .replace("data:image/jpeg;base64,", "");

  return { annotatedBase64, elements };
}

// Produces lines in the same format as the existing UIAutomation builder so that
// parseUiTree() can parse them in order, assigning IDs that match image box numbers.
export function buildSomSystemPromptSection(elements: SomElement[]): string {
  if (elements.length === 0) return "";
  return elements
    .map((e) => {
      const stateParts: string[] = [];
      if (!e.enabled) stateParts.push("disabled");
      if (e.checked === "checked") stateParts.push("checked");
      if (e.checked === "unchecked") stateParts.push("unchecked");
      if (e.checked === "indeterminate") stateParts.push("indeterminate");
      if (e.expanded === "expanded") stateParts.push("expanded");
      if (e.expanded === "collapsed") stateParts.push("collapsed");
      if (e.expanded === "partially-expanded") stateParts.push("partially-expanded");
      if (e.focused) stateParts.push("focused");
      if (e.selected === true) stateParts.push("selected");
      const stateStr = stateParts.length > 0 ? ` (${stateParts.join(", ")})` : "";
      const valueStr = e.value ? ` = "${e.value}"` : "";
      const idHint = e.automationId && e.automationId !== e.name ? ` [id:${e.automationId}]` : "";
      const scrollHint = e.scrollPct != null ? ` [scrolled ${e.scrollPct}% — more items below]` : "";
      return `[${e.index}] ${e.role} "${e.name}"${stateStr}${valueStr}${idHint}${scrollHint} → [POINT:${e.normalizedCx},${e.normalizedCy}:${e.name}:${e.screenLabel}]`;
    })
    .join("\n");
}
