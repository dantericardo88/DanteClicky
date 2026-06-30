export type SpeechLanguageCode =
  | "auto"
  | "en"
  | "es"
  | "de"
  | "fr"
  | "pt"
  | "it"
  | "zh"
  | "ja"
  | "ko"
  | "hi"
  | "ar"
  | "nl"
  | "pl"
  | "tr"
  | "uk"
  | "vi"
  | "id"
  | "sv";

export interface SpeechLanguageOption {
  code: SpeechLanguageCode;
  label: string;
  nativeLabel: string;
  whisperCode: string | null;
  localWhisperModel: "auto" | "english" | "multilingual";
}

export type SpeechRecognitionMode = "Cloud" | "Local";
export type CloudSpeechLanguageTier = "auto-detect" | "native" | "local-recommended";
export type LocalSpeechLanguageTier = "english" | "multilingual";
export type SpeechLanguageStatusTone = "success" | "warning" | "info";

export interface SpeechLanguageSupport {
  cloudTier: CloudSpeechLanguageTier;
  localTier: LocalSpeechLanguageTier;
  recommendedMode: SpeechRecognitionMode;
  cloudLabel: string;
  localLabel: string;
  fallbackLabel: string;
}

export interface SpeechLanguageStatus {
  tone: SpeechLanguageStatusTone;
  title: string;
  message: string;
  confidenceLabel: string;
  recommendedMode: SpeechRecognitionMode;
  cloudTier: CloudSpeechLanguageTier;
  localTier: LocalSpeechLanguageTier;
}

export const SPEECH_LANGUAGE_OPTIONS: SpeechLanguageOption[] = [
  { code: "auto", label: "Auto-detect", nativeLabel: "Auto", whisperCode: null, localWhisperModel: "multilingual" },
  { code: "en", label: "English", nativeLabel: "English", whisperCode: "en", localWhisperModel: "english" },
  { code: "es", label: "Spanish", nativeLabel: "Español", whisperCode: "es", localWhisperModel: "multilingual" },
  { code: "de", label: "German", nativeLabel: "Deutsch", whisperCode: "de", localWhisperModel: "multilingual" },
  { code: "fr", label: "French", nativeLabel: "Français", whisperCode: "fr", localWhisperModel: "multilingual" },
  { code: "pt", label: "Portuguese", nativeLabel: "Português", whisperCode: "pt", localWhisperModel: "multilingual" },
  { code: "it", label: "Italian", nativeLabel: "Italiano", whisperCode: "it", localWhisperModel: "multilingual" },
  { code: "zh", label: "Chinese", nativeLabel: "中文", whisperCode: "zh", localWhisperModel: "multilingual" },
  { code: "ja", label: "Japanese", nativeLabel: "日本語", whisperCode: "ja", localWhisperModel: "multilingual" },
  { code: "ko", label: "Korean", nativeLabel: "한국어", whisperCode: "ko", localWhisperModel: "multilingual" },
  { code: "hi", label: "Hindi", nativeLabel: "हिन्दी", whisperCode: "hi", localWhisperModel: "multilingual" },
  { code: "ar", label: "Arabic", nativeLabel: "العربية", whisperCode: "ar", localWhisperModel: "multilingual" },
  { code: "nl", label: "Dutch", nativeLabel: "Nederlands", whisperCode: "nl", localWhisperModel: "multilingual" },
  { code: "pl", label: "Polish", nativeLabel: "Polski", whisperCode: "pl", localWhisperModel: "multilingual" },
  { code: "tr", label: "Turkish", nativeLabel: "Türkçe", whisperCode: "tr", localWhisperModel: "multilingual" },
  { code: "uk", label: "Ukrainian", nativeLabel: "Українська", whisperCode: "uk", localWhisperModel: "multilingual" },
  { code: "vi", label: "Vietnamese", nativeLabel: "Tiếng Việt", whisperCode: "vi", localWhisperModel: "multilingual" },
  { code: "id", label: "Indonesian", nativeLabel: "Bahasa Indonesia", whisperCode: "id", localWhisperModel: "multilingual" },
  { code: "sv", label: "Swedish", nativeLabel: "Svenska", whisperCode: "sv", localWhisperModel: "multilingual" },
];

export const ASSEMBLYAI_U3_PRO_NATIVE_LANGUAGE_CODES = [
  "en",
  "es",
  "fr",
  "de",
  "it",
  "pt",
] as const satisfies readonly SpeechLanguageCode[];

const ASSEMBLYAI_U3_PRO_NATIVE_LANGUAGE_SET = new Set<SpeechLanguageCode>(
  ASSEMBLYAI_U3_PRO_NATIVE_LANGUAGE_CODES
);

export const LANGUAGE_CONFIDENCE_THRESHOLDS: Partial<Record<SpeechLanguageCode, number>> = {
  en: 0.80, es: 0.78, fr: 0.78, de: 0.78, it: 0.80, pt: 0.80,
  zh: 0.85, ja: 0.85, ko: 0.85,
  hi: 0.87, ar: 0.87, nl: 0.82, pl: 0.85, tr: 0.85,
  uk: 0.90,
  vi: 0.92,
  id: 0.88, sv: 0.82,
};

export function getLanguageConfidenceThreshold(code: SpeechLanguageCode): number {
  return LANGUAGE_CONFIDENCE_THRESHOLDS[code] ?? 0.85;
}

const LANGUAGE_CODE_ALIASES: Record<string, SpeechLanguageCode> = {
  automatic: "auto",
  detect: "auto",
  english: "en",
  spanish: "es",
  castilian: "es",
  german: "de",
  french: "fr",
  portuguese: "pt",
  italian: "it",
  chinese: "zh",
  mandarin: "zh",
  "zh-cn": "zh",
  "zh-tw": "zh",
  japanese: "ja",
  korean: "ko",
  hindi: "hi",
  arabic: "ar",
  dutch: "nl",
  polish: "pl",
  turkish: "tr",
  ukrainian: "uk",
  vietnamese: "vi",
  indonesian: "id",
  swedish: "sv",
};

const SUPPORTED_CODES = new Set(SPEECH_LANGUAGE_OPTIONS.map((option) => option.code));

export function normalizeSpeechLanguageCode(
  languageCode: string | null | undefined
): SpeechLanguageCode {
  const normalized = (languageCode ?? "").trim().toLowerCase().replace("_", "-");
  if (!normalized) return "auto";
  if (SUPPORTED_CODES.has(normalized as SpeechLanguageCode)) {
    return normalized as SpeechLanguageCode;
  }
  const baseCode = normalized.split("-")[0];
  if (SUPPORTED_CODES.has(baseCode as SpeechLanguageCode)) {
    return baseCode as SpeechLanguageCode;
  }
  return LANGUAGE_CODE_ALIASES[normalized] ?? LANGUAGE_CODE_ALIASES[baseCode] ?? "auto";
}

export function speechLanguageOptionForCode(
  languageCode: string | null | undefined
): SpeechLanguageOption {
  const normalized = normalizeSpeechLanguageCode(languageCode);
  return SPEECH_LANGUAGE_OPTIONS.find((option) => option.code === normalized) ?? SPEECH_LANGUAGE_OPTIONS[0];
}

export function isAssemblyAINativeStreamingLanguage(
  languageCode: string | null | undefined
): boolean {
  return ASSEMBLYAI_U3_PRO_NATIVE_LANGUAGE_SET.has(normalizeSpeechLanguageCode(languageCode));
}

export function getSpeechLanguageSupport(
  languageCode: string | null | undefined
): SpeechLanguageSupport {
  const option = speechLanguageOptionForCode(languageCode);
  const localTier: LocalSpeechLanguageTier =
    option.localWhisperModel === "english" ? "english" : "multilingual";

  if (option.code === "auto") {
    return {
      cloudTier: "auto-detect",
      localTier: "multilingual",
      recommendedMode: "Cloud",
      cloudLabel: "AssemblyAI U3 Pro auto-detects English, Spanish, French, German, Italian, and Portuguese.",
      localLabel: "Local Whisper multilingual auto-detects the broader Whisper language set.",
      fallbackLabel: "Choose Local Whisper for languages outside the native U3 Pro streaming set.",
    };
  }

  if (isAssemblyAINativeStreamingLanguage(option.code)) {
    return {
      cloudTier: "native",
      localTier,
      recommendedMode: "Cloud",
      cloudLabel: `AssemblyAI U3 Pro has native real-time support for ${option.label}.`,
      localLabel:
        option.localWhisperModel === "english"
          ? "Local Whisper tiny.en is the offline English path."
          : `Local Whisper multilingual can transcribe ${option.label} offline.`,
      fallbackLabel: "Use Local Whisper when privacy or offline transcription matters more than cloud latency.",
    };
  }

  return {
    cloudTier: "local-recommended",
    localTier,
    recommendedMode: "Local",
    cloudLabel: `AssemblyAI U3 Pro streaming is not native for ${option.label}; cloud is best effort without a language prompt.`,
    localLabel: `Local Whisper multilingual is the recommended path for ${option.label}.`,
    fallbackLabel: `Switch to Local Whisper for reliable ${option.label} transcription.`,
  };
}

export function buildSpeechLanguageStatus(
  languageCode: string | null | undefined,
  activeMode: SpeechRecognitionMode
): SpeechLanguageStatus {
  const option = speechLanguageOptionForCode(languageCode);
  const support = getSpeechLanguageSupport(option.code);

  if (option.code === "auto") {
    return {
      tone: activeMode === "Cloud" ? "info" : "success",
      title: activeMode === "Cloud" ? "Auto-detect cloud" : "Auto-detect local",
      message:
        activeMode === "Cloud"
          ? `${support.cloudLabel} ${support.fallbackLabel}`
          : `${support.localLabel} Cloud remains faster for the six native U3 Pro languages.`,
      confidenceLabel: activeMode === "Cloud" ? "provider auto-detect" : "local auto-detect",
      recommendedMode: support.recommendedMode,
      cloudTier: support.cloudTier,
      localTier: support.localTier,
    };
  }

  if (support.cloudTier === "local-recommended") {
    const isLocal = activeMode === "Local";
    return {
      tone: isLocal ? "success" : "warning",
      title: isLocal ? `${option.label} on Local Whisper` : `${option.label} needs Local Whisper`,
      message: isLocal
        ? `${support.localLabel} ${support.cloudLabel}`
        : `${option.label} is local-first. ${support.localLabel} Cloud U3 Pro may not reliably transcribe it, so no ${option.label} prompt is sent.`,
      confidenceLabel: isLocal ? "selected language" : "selected language, cloud not native",
      recommendedMode: support.recommendedMode,
      cloudTier: support.cloudTier,
      localTier: support.localTier,
    };
  }

  return {
    tone: activeMode === "Cloud" ? "success" : "info",
    title: activeMode === "Cloud" ? `${option.label} native cloud` : `${option.label} offline`,
    message:
      activeMode === "Cloud"
        ? `${support.cloudLabel} ${support.localLabel}`
        : `${support.localLabel} ${support.cloudLabel}`,
    confidenceLabel: "selected language",
    recommendedMode: support.recommendedMode,
    cloudTier: support.cloudTier,
    localTier: support.localTier,
  };
}

export function buildSpeechLanguagePrompt(languageCode: string | null | undefined): string {
  const option = speechLanguageOptionForCode(languageCode);
  if (option.code === "auto") {
    return "# Language\nSpeech: auto-detect. Infer the language from the transcript and reply in that language. Maintain cultural context appropriate to the detected language.";
  }

  const base = `# Language\nAlways reply in ${option.label}. Do not translate the request into English before answering. Use natural ${option.label} expressions, idioms, and conventions. If the transcript appears to be in a different language due to speech recognition errors — still reply in ${option.label} and interpret the intent charitably.`;

  // Cultural and grammatical guidance for specific languages
  const culturalGuidance: Record<string, string> = {
    es: "use appropriate formality level (tú/usted). include regional variations naturally.",
    fr: "maintain proper french grammar and accent conventions. use appropriate tu/vous formality.",
    de: "maintain capitalization rules. use formal/informal du/sie appropriately.",
    pt: "distinguish brazil (você, gerunds, open vowels) from european portuguese (tu, infinitive preference, nasal vowels). if region unknown, prefer brazilian portuguese as default for wider comprehension.",
    it: "use proper italian grammatical structures and formality levels.",
    zh: "use simplified chinese (simplified hanzi) as default unless context signals traditional chinese. do not mix character sets within a response.",
    ja: "use appropriate politeness levels (casual/formal/keigo). maintain natural japanese flow.",
    ko: "use appropriate formality levels (informal/formal/very formal). maintain natural flow.",
    hi: "use आप for formal address, तुम for familiar, तू for intimate contexts. prefer devanagari script. code-mixing with english technical terms is natural and acceptable.",
    ar: "balance modern standard arabic with conversational naturalness where appropriate.",
    nl: "use `u` for formal address, `jij`/`je` informally. dutch is direct — avoid over-hedging or excessive politeness markers common in english.",
    pl: "use pan/pani formal forms with strangers or in professional contexts, ty informally. polish is case-rich — maintain grammatical case agreement.",
    tr: "use siz for formal address, sen informally. turkish is agglutinative — avoid over-literal translations of english idioms.",
    uk: "use ви for formal address, ти informally. maintain cyrillic script consistently. ukrainian and russian are distinct — do not conflate vocabulary or spelling.",
    vi: "vietnamese has six tones and distinct northern/southern registers. use appropriate formality markers. avoid mixing northern and southern vocabulary.",
    id: "use `anda` for formal address, `kamu` informally. use standard bahasa indonesia (baku) rather than colloquial jakarta speech unless context is explicitly casual.",
    sv: "swedish second-person du is standard across all contexts — avoid formal ni in modern swedish. maintain swedish number/currency conventions.",
  };

  const guidance = culturalGuidance[option.code];
  return guidance ? `${base}\n\n## Cultural Conventions\n${guidance}` : base;
}

// Enhanced system prompt for multilingual responses (kept for backward compatibility)
export function buildMultilingualSystemPrompt(): string {
  // Multilingual guidance now integrated into buildSpeechLanguagePrompt
  return "";
}

const RTL_LANGUAGE_CODES = new Set<SpeechLanguageCode>(["ar"]);

export function isRTLLanguage(code: string | null | undefined): boolean {
  return RTL_LANGUAGE_CODES.has(normalizeSpeechLanguageCode(code));
}

export function buildAssemblyAILanguagePrompt(code: SpeechLanguageCode): string | null {
  if (code === "auto") return null;

  const prompts: Partial<Record<SpeechLanguageCode, string>> = {
    en: "The user is speaking English. Transcribe faithfully including filler words.",
    es: "The user is speaking Spanish (Español). Both Latin American and Castilian are valid. Do not translate.",
    fr: "The user is speaking French (Français). Transcribe including contractions. Do not translate.",
    de: "The user is speaking German (Deutsch). Include compound words faithfully. Do not translate.",
    it: "The user is speaking Italian (Italiano). Transcribe faithfully. Do not translate.",
    pt: "The user is speaking Portuguese (Português). Both Brazilian and European Portuguese are valid. Do not translate.",
    zh: "The user is speaking Chinese (中文). Transcribe in simplified Chinese characters. Do not romanize.",
    ja: "The user is speaking Japanese (日本語). Transcribe in kanji and kana. Do not romanize.",
    ko: "The user is speaking Korean (한국어). Transcribe in hangul. Do not romanize.",
    hi: "The user is speaking Hindi (हिन्दी). Transcribe in devanagari. Code-mixing with English is acceptable.",
    ar: "The user is speaking Arabic (العربية). Transcribe in Arabic script. Do not transliterate.",
    nl: "The user is speaking Dutch (Nederlands). Transcribe faithfully. Do not translate.",
    pl: "The user is speaking Polish (Polski). Include diacritics (ą, ę, ś, etc.). Do not translate.",
    tr: "The user is speaking Turkish (Türkçe). Include diacritics. Do not translate.",
    uk: "The user is speaking Ukrainian (Українська). Transcribe in Cyrillic. Do not render as Russian.",
    vi: "The user is speaking Vietnamese (Tiếng Việt). Include all tone diacritics. Do not translate.",
    id: "The user is speaking Indonesian (Bahasa Indonesia). Use standard Indonesian. Do not translate.",
    sv: "The user is speaking Swedish (Svenska). Transcribe faithfully. Do not translate.",
  };

  return prompts[code] ?? null;
}

/// Maximum number of keyterms accepted by AssemblyAI U3 streaming. Above this
/// the API silently drops the tail; we trim before sending.
export const ASSEMBLYAI_KEYTERMS_MAX = 1000;

/// Maximum total characters across all keyterms. Empirically the URL header
/// budget runs out somewhere in the 6–8KB range; 6KB is safe across reverse
/// proxies and CDNs that gate WebSocket upgrades.
export const ASSEMBLYAI_KEYTERMS_BUDGET_BYTES = 6_000;

/**
 * Build a deduped, length-capped keyterms list ready for the AssemblyAI URL.
 * - Strips empty/whitespace-only entries.
 * - Casefold-deduplicates (preserving the first-cased occurrence).
 * - Trims to the API's term-count maximum and to a safe URL-budget byte limit.
 */
export function sanitizeKeyterms(raw: readonly string[] | null | undefined): string[] {
  if (!raw || raw.length === 0) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  let totalBytes = 0;
  for (const candidate of raw) {
    if (typeof candidate !== "string") continue;
    const trimmed = candidate.trim();
    if (!trimmed || trimmed.length > 60) continue; // very long terms rarely help
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const bytes = new TextEncoder().encode(trimmed).length + 1; // +1 for separator
    if (totalBytes + bytes > ASSEMBLYAI_KEYTERMS_BUDGET_BYTES) break;
    totalBytes += bytes;
    out.push(trimmed);
    if (out.length >= ASSEMBLYAI_KEYTERMS_MAX) break;
  }
  return out;
}

export interface AssemblyAIStreamingUrlOptions {
  token: string;
  sampleRate: number;
  languageCode: string | null | undefined;
  /** Hotwords / domain vocabulary biasing recognition. Up to 1,000 terms. */
  keyterms?: readonly string[] | null;
  /** Enables AssemblyAI smart formatting (capitalization, numerals, dates). */
  formatText?: boolean;
  /** When false (default) the model removes filler/disfluencies from finals. */
  preserveDisfluencies?: boolean;
}

export function buildAssemblyAIStreamingUrl(input: AssemblyAIStreamingUrlOptions): string {
  const option = speechLanguageOptionForCode(input.languageCode);
  const params = new URLSearchParams({
    token: input.token,
    sample_rate: String(input.sampleRate),
    encoding: "pcm_s16le",
    speech_model: "u3-rt-pro",
    language_detection: "true",
  });

  if (input.formatText !== false) {
    params.set("format_text", "true");
  }
  if (input.preserveDisfluencies === true) {
    params.set("disfluencies", "true");
  }

  const langPrompt = buildAssemblyAILanguagePrompt(option.code);
  if (langPrompt) {
    params.set("prompt", langPrompt);
  }

  const keyterms = sanitizeKeyterms(input.keyterms);
  if (keyterms.length > 0) {
    // AssemblyAI accepts keyterms_prompt as a single comma-joined string
    // (their SDK encodes it that way). Join with commas; the URLSearchParams
    // encoder handles escaping.
    params.set("keyterms_prompt", keyterms.join(","));
  }

  return `wss://streaming.assemblyai.com/v3/ws?${params.toString().replace(/\+/g, "%20")}`;
}
