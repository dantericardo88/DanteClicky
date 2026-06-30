export const DEFAULT_WAKE_PHRASE = "hey dante";

export type WakeSensitivity = "strict" | "balanced" | "sensitive";
export type WakeStatus = "off" | "downloading" | "starting" | "listening" | "checking" | "armed" | "error";

export function normalizeWakeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function transcriptContainsWakePhrase(
  transcript: string,
  phrase = DEFAULT_WAKE_PHRASE,
  sensitivity: WakeSensitivity = "balanced"
): boolean {
  return findWakePhraseTokenIndex(transcript, phrase, sensitivity) !== -1;
}

export function stripWakePhraseCommand(
  transcript: string,
  phrase = DEFAULT_WAKE_PHRASE,
  sensitivity: WakeSensitivity = "balanced"
): string {
  const transcriptTokens = tokenize(transcript);
  const phraseTokens = tokenize(phrase);
  const index = findWakePhraseTokenIndex(transcript, phrase, sensitivity);
  if (index === -1 || phraseTokens.length === 0) {
    return normalizeWakeText(transcript);
  }
  return transcriptTokens
    .slice(index + phraseTokens.length)
    .join(" ")
    .trim();
}

export function wakeStatusLabel(status: WakeStatus, phrase = DEFAULT_WAKE_PHRASE): string {
  switch (status) {
    case "off":
      return "Wake word off";
    case "downloading":
      return "Preparing local wake model";
    case "starting":
      return "Starting local wake monitor";
    case "listening":
      return `Say "${phrase}"`;
    case "checking":
      return "Checking wake phrase locally";
    case "armed":
      return "Wake phrase detected";
    case "error":
      return "Wake monitor needs attention";
  }
}

function findWakePhraseTokenIndex(
  transcript: string,
  phrase: string,
  sensitivity: WakeSensitivity
): number {
  const transcriptTokens = tokenize(transcript);
  const phraseTokens = tokenize(phrase);
  if (transcriptTokens.length === 0 || phraseTokens.length === 0) {
    return -1;
  }
  if (phraseTokens.some((token) => token.length < 2)) {
    return -1;
  }

  for (let i = 0; i <= transcriptTokens.length - phraseTokens.length; i += 1) {
    const candidate = transcriptTokens.slice(i, i + phraseTokens.length);
    if (tokensMatch(candidate, phraseTokens, sensitivity)) {
      return i;
    }
  }
  return -1;
}

function tokenize(input: string): string[] {
  const normalized = normalizeWakeText(input);
  return normalized ? normalized.split(" ") : [];
}

function tokensMatch(candidate: string[], phrase: string[], sensitivity: WakeSensitivity): boolean {
  if (candidate.length !== phrase.length) {
    return false;
  }
  return candidate.every((token, index) => {
    const phraseToken = phrase[index];
    if (token === phraseToken) {
      return true;
    }
    if (sensitivity !== "sensitive" || phraseToken.length < 5) {
      return false;
    }
    return levenshteinDistance(token, phraseToken) <= 1;
  });
}

function levenshteinDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = Array.from({ length: b.length + 1 }, () => 0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      const insertion = current[j - 1] + 1;
      const deletion = previous[j] + 1;
      current[j] = Math.min(substitution, insertion, deletion);
    }
    for (let j = 0; j <= b.length; j += 1) {
      previous[j] = current[j];
    }
  }

  return previous[b.length];
}
