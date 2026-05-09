// Detect whether a user's spoken transcript wants to act on a specific UI target,
// and extract the target phrase. Used by useVoice.ts:716 (UIAutomation-poor fallback)
// to feed Moondream2 point_query when click intent is present.
//
// Returns the target noun phrase ("login button", "submit", "OK") or null when
// the utterance is conceptual/observational rather than action-oriented.

const CLICK_VERBS = [
  "click",
  "tap",
  "press",
  "select",
  "open",
  "hit",
  "push",
  "choose",
];

// Filler words that commonly precede a target ("click ON the X", "tap THAT button")
const ARTICLES = new Set(["the", "a", "an", "that", "this", "on", "to", "for"]);

// Trailing fillers we strip from the captured target ("click submit please")
const TRAILING_FILLERS = new Set([
  "please",
  "now",
  "for me",
  "thanks",
  "thank you",
  "okay",
  "alright",
]);

/**
 * Returns the target string (lowercased, trimmed) when the transcript expresses
 * click-intent against a named target, otherwise null.
 *
 * Examples:
 *   "click the login button"        → "login button"
 *   "tap submit please"             → "submit"
 *   "press OK"                      → "ok"
 *   "open the settings menu"        → "settings menu"
 *   "what's on screen"              → null
 *   "describe this image"           → null
 *   "explain what just happened"    → null
 */
export function matchClickIntent(transcript: string): string | null {
  if (!transcript) return null;
  const lower = transcript.toLowerCase().trim();
  if (lower.length === 0) return null;

  // Tokenize on whitespace, strip punctuation
  const tokens = lower
    .split(/\s+/)
    .map((t) => t.replace(/^[^\w]+|[^\w]+$/g, ""))
    .filter(Boolean);

  // Find the first click verb
  const verbIdx = tokens.findIndex((t) => CLICK_VERBS.includes(t));
  if (verbIdx === -1) return null;

  // Collect tokens after the verb, skipping leading articles
  let i = verbIdx + 1;
  while (i < tokens.length && ARTICLES.has(tokens[i])) {
    i++;
  }

  if (i >= tokens.length) return null;

  // Stop at sentence-end-ish punctuation that survived stripping (none expected),
  // or when we hit a known trailing filler.
  const targetTokens: string[] = [];
  while (i < tokens.length) {
    const t = tokens[i];
    if (TRAILING_FILLERS.has(t)) break;
    targetTokens.push(t);
    i++;
  }

  if (targetTokens.length === 0) return null;

  // Drop trailing filler tokens (e.g. "click submit please" already handled,
  // but "click the OK button now" needs trimming)
  while (
    targetTokens.length > 0 &&
    TRAILING_FILLERS.has(targetTokens[targetTokens.length - 1])
  ) {
    targetTokens.pop();
  }

  if (targetTokens.length === 0) return null;
  return targetTokens.join(" ");
}
