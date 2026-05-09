export interface AssemblyAILanguageDetection {
  languageCode: string;
  confidence: number | null;
}

/**
 * Per-word data surfaced from AssemblyAI v3 Turn messages. Confidence is in
 * 0..1 — the UI renders < 0.6 at reduced opacity so users can spot likely
 * mistranscriptions before the cleanup pass overwrites them.
 */
export interface AssemblyAIWord {
  text: string;
  confidence: number | null;
  /** True once AssemblyAI has finalized the word (no longer subject to revision). */
  isFinal: boolean;
}

export interface AssemblyAITranscriptState {
  finalText: string;
  partialText: string;
  committedTurnOrder: number | null;
  detectedLanguageCode: string | null;
  languageConfidence: number | null;
  /** Word-level data from the most recent Turn (rolling — replaced per turn). */
  liveWords: AssemblyAIWord[];
  /** Cumulative finalized words; appended on each end_of_turn. */
  committedWords: AssemblyAIWord[];
}

interface LegacyAssemblyAIMessage {
  message_type?: "SessionBegins" | "PartialTranscript" | "FinalTranscript" | "SessionTerminated" | "Error";
  text?: string;
}

interface TurnWord {
  text?: string;
  word?: string;
  confidence?: number;
  word_is_final?: boolean;
}

interface TurnAssemblyAIMessage {
  type?: string;
  turn_order?: number;
  end_of_turn?: boolean;
  transcript?: string;
  utterance?: string;
  language_code?: string;
  language_confidence?: number;
  words?: TurnWord[];
}

export function createAssemblyAITranscriptState(): AssemblyAITranscriptState {
  return {
    finalText: "",
    partialText: "",
    committedTurnOrder: null,
    detectedLanguageCode: null,
    languageConfidence: null,
    liveWords: [],
    committedWords: [],
  };
}

/**
 * Live word stream for the current in-progress utterance, with finalized
 * words from earlier turns in this session prepended. UI renders this in
 * the "listening" state and uses confidence to drive opacity.
 */
export function assemblyAILiveWords(state: AssemblyAITranscriptState): AssemblyAIWord[] {
  return [...state.committedWords, ...state.liveWords];
}

function normalizeTurnWords(raw: TurnWord[] | undefined, fallbackText: string): AssemblyAIWord[] {
  if (Array.isArray(raw) && raw.length > 0) {
    return raw
      .map((w) => {
        const text = (w.text ?? w.word ?? "").trim();
        if (!text) return null;
        const confidence = typeof w.confidence === "number" ? clamp01(w.confidence) : null;
        return { text, confidence, isFinal: w.word_is_final === true };
      })
      .filter((w): w is AssemblyAIWord => w !== null);
  }
  // Older Turn messages without word-level data: synthesize words with null
  // confidence so the UI still renders text but does not stylize it.
  return fallbackText
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .map((text) => ({ text, confidence: null, isFinal: false }));
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

export function assemblyAITranscriptText(state: AssemblyAITranscriptState): string {
  return [state.finalText, state.partialText].filter(Boolean).join(" ").trim();
}

export function assemblyAILanguageDetection(
  state: AssemblyAITranscriptState
): AssemblyAILanguageDetection | null {
  if (!state.detectedLanguageCode) return null;
  return {
    languageCode: state.detectedLanguageCode,
    confidence: state.languageConfidence,
  };
}

export function reduceAssemblyAIStreamingMessage(
  state: AssemblyAITranscriptState,
  rawMessage: string
): AssemblyAITranscriptState {
  let parsed: LegacyAssemblyAIMessage & TurnAssemblyAIMessage;
  try {
    parsed = JSON.parse(rawMessage) as LegacyAssemblyAIMessage & TurnAssemblyAIMessage;
  } catch {
    return state;
  }

  if (parsed.language_code) {
    state = {
      ...state,
      detectedLanguageCode: parsed.language_code,
      languageConfidence:
        typeof parsed.language_confidence === "number" ? parsed.language_confidence : state.languageConfidence,
    };
  }

  if (parsed.message_type === "PartialTranscript" && parsed.text) {
    return { ...state, partialText: parsed.text };
  }

  if (parsed.message_type === "FinalTranscript" && parsed.text) {
    return {
      ...state,
      finalText: appendTranscriptText(state.finalText, parsed.text),
      partialText: "",
    };
  }

  if (parsed.type === "Turn") {
    const transcript = (parsed.transcript ?? parsed.utterance ?? "").trim();
    if (!transcript) return state;

    const words = normalizeTurnWords(parsed.words, transcript);
    const turnOrder = typeof parsed.turn_order === "number" ? parsed.turn_order : null;
    if (parsed.end_of_turn) {
      if (turnOrder !== null && state.committedTurnOrder === turnOrder) {
        return { ...state, partialText: "", liveWords: [] };
      }
      return {
        ...state,
        finalText: appendTranscriptText(state.finalText, transcript),
        partialText: "",
        committedTurnOrder: turnOrder,
        liveWords: [],
        committedWords: [...state.committedWords, ...markFinal(words)],
      };
    }

    return {
      ...state,
      partialText: transcript,
      liveWords: words,
      committedTurnOrder:
        turnOrder !== null && state.committedTurnOrder !== turnOrder
          ? state.committedTurnOrder
          : state.committedTurnOrder,
    };
  }

  return state;
}

function markFinal(words: AssemblyAIWord[]): AssemblyAIWord[] {
  return words.map((w) => (w.isFinal ? w : { ...w, isFinal: true }));
}

function appendTranscriptText(existing: string, addition: string): string {
  const trimmedAddition = addition.trim();
  if (!trimmedAddition) return existing;
  return existing ? `${existing} ${trimmedAddition}` : trimmedAddition;
}
