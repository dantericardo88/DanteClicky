export function timeAgo(ts: number): string {
  const seconds = Math.floor((Date.now() - ts) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}
export interface ClassifiedError {
  headline: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
}
export function classifyError(raw: string, goToSettings: () => void): ClassifiedError {
  const lower = raw.toLowerCase();
  // "No API key configured for X" = key was never entered / storage failure → ask user to re-enter
  if (lower.includes("no api key configured") || lower.includes("not found in secure storage")) {
    return {
      headline: "API key not set up",
      detail: "Open Settings and re-enter your API key",
      actionLabel: "Open Settings",
      onAction: goToSettings,
    };
  }
  if (lower.includes("assemblyai key") ||
      lower.includes("speech recognition needs a key") ||
      lower.includes("authentication") || lower.includes("invalid_api_key") ||
      lower.includes("401") || lower.includes("unauthorized")) {
    return {
      headline: "API key invalid",
      detail: "Check your key in Settings",
      actionLabel: "Open Settings",
      onAction: goToSettings,
    };
  }
  if (lower.includes("rate limit") || lower.includes("429") || lower.includes("too many")) {
    return { headline: "Rate limited", detail: "Too many requests - wait 30s and retry" };
  }
  if (lower.includes("network") || lower.includes("connection") || lower.includes("timeout") ||
      lower.includes("fetch") || lower.includes("offline")) {
    return { headline: "Connection issue", detail: "Check your internet connection" };
  }
  return { headline: "Something went wrong", detail: raw.slice(0, 120) };
}
const THUMBS_DOWN_REASONS = [
  "too long",
  "too short",
  "missed screen",
  "wrong action",
  "wrong tone",
  "not specific enough",
] as const;
export function requestThumbsDownReason(): string | null {
  const menu = THUMBS_DOWN_REASONS
    .map((reason, index) => `${index + 1}. ${reason}`)
    .join("\n");
  const selected = window.prompt(`What was off?\n${menu}\n7. custom note`, "4");
  if (selected === null) return null;
  const trimmed = selected.trim().toLowerCase();
  const index = Number.parseInt(trimmed, 10);
  if (Number.isInteger(index) && index >= 1 && index <= THUMBS_DOWN_REASONS.length) {
    return THUMBS_DOWN_REASONS[index - 1];
  }
  if (trimmed === "7" || trimmed === "custom" || trimmed === "custom note") {
    const custom = window.prompt("Add a short note about what was wrong", "");
    if (custom === null) return null;
    return custom.trim() || "custom note";
  }
  return trimmed || "custom note";
}
export function parseCloneError(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : String(raw ?? "");
  if (text.includes("invalid file") || text.includes("unsupported")) return "Use MP3, WAV, M4A, or OGG audio files.";
  if (text.includes("too large") || text.includes("413")) return "Audio files are too large. Try shorter samples.";
  if (text.includes("401") || text.includes("unauthorized")) return "ElevenLabs key is invalid. Check Settings.";
  if (text.includes("429")) return "ElevenLabs is rate limiting requests. Try again shortly.";
  return text || "Voice cloning failed.";
}
