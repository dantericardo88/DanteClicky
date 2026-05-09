import type { TelemetryProperties, TelemetryValue } from "./telemetry";

export const TELEMETRY_SCHEMA_VERSION = "2026-05-08.d45-observability-v2";

export type TelemetryRecordKind = "event" | "span" | "metric" | "error";
export type TelemetryPropertyType = "string" | "number" | "boolean" | "bucket" | "nullable";

export interface TelemetryPropertySpec {
  type: TelemetryPropertyType;
  description: string;
}

export interface TelemetryCatalogEntry {
  kind: TelemetryRecordKind;
  name: string;
  category: string;
  description: string;
  userExplanation: string;
  allowedProperties: Record<string, TelemetryPropertySpec>;
}

export interface TelemetryCatalogSummaryEntry {
  kind: TelemetryRecordKind;
  name: string;
  category: string;
  description: string;
  userExplanation: string;
  allowedProperties: string[];
}

export interface TelemetryPropertyFilterResult {
  properties: TelemetryProperties;
  droppedUnknownPropertyCount: number;
}

const stringProp = (description: string): TelemetryPropertySpec => ({ type: "string", description });
const numberProp = (description: string): TelemetryPropertySpec => ({ type: "number", description });
const booleanProp = (description: string): TelemetryPropertySpec => ({ type: "boolean", description });
const bucketProp = (description: string): TelemetryPropertySpec => ({ type: "bucket", description });
const nullableProp = (description: string): TelemetryPropertySpec => ({ type: "nullable", description });

const COMMON_PROPERTIES: Record<string, TelemetryPropertySpec> = {
  provider: stringProp("AI provider identifier such as openai, claude, or grok."),
  modelId: stringProp("Selected model identifier."),
  route: stringProp("Internal code path or command route."),
  status: stringProp("Operation status."),
  reason: stringProp("Non-sensitive categorical reason."),
  stage: stringProp("Non-sensitive lifecycle stage."),
  source: stringProp("Error source category."),
  span: stringProp("Span name associated with an error."),
  filename: stringProp("Script filename for browser errors."),
  line: numberProp("Browser error line number."),
  column: numberProp("Browser error column number."),
  step: numberProp("Computer-use step number or onboarding step."),
  step_reached: numberProp("Highest onboarding step reached."),
  value: numberProp("Metric numeric value."),
  durationMs: numberProp("Elapsed duration in milliseconds."),
  success: booleanProp("Whether the operation succeeded."),
  started: booleanProp("Whether the operation started."),
  blocked: stringProp("Categorical block reason."),
  skipped: nullableProp("Whether and why an optional operation was skipped."),
};

const VOICE_PROPERTIES: Record<string, TelemetryPropertySpec> = {
  sttMode: stringProp("Speech-to-text mode."),
  speechLanguage: stringProp("Configured speech language."),
  languageCode: stringProp("Language code sent to a speech provider."),
  sampleRate: numberProp("Audio sample rate."),
  detectedLanguage: stringProp("Detected language code."),
  hasConfidence: booleanProp("Whether language confidence was available."),
  transcriptLengthBucket: bucketProp("Approximate transcript size bucket."),
  responseLengthBucket: bucketProp("Approximate assistant response size bucket."),
  wakeSensitivity: stringProp("Configured wake word sensitivity."),
  wakePhraseLength: numberProp("Length of the configured wake phrase."),
  localOnly: booleanProp("Whether audio stayed local for this stage."),
  firstTokenMs: numberProp("Time to first model token."),
  memoryEnabled: booleanProp("Whether memory features were enabled."),
  preferenceLearningEnabled: booleanProp("Whether preference learning was enabled."),
  incognitoMode: booleanProp("Whether incognito mode was enabled."),
  stopReason: stringProp("Model or turn stop reason."),
};

const MODEL_PROPERTIES: Record<string, TelemetryPropertySpec> = {
  imageCount: numberProp("Count of images attached to the model request."),
  messageCount: numberProp("Count of messages sent to the model."),
  maxTokens: nullableProp("Configured maximum output token count."),
  hasScreenDimensions: booleanProp("Whether screen dimensions were included."),
  stopReason: stringProp("Model stop reason."),
  chunkCount: numberProp("Number of streamed text chunks."),
  toolUseCount: numberProp("Number of native model tool-use blocks."),
  outputLengthBucket: bucketProp("Approximate model output size bucket."),
  inputKind: stringProp("OpenAI Responses input shape."),
  inputItemCount: numberProp("OpenAI Responses input item count."),
  hasPreviousResponse: booleanProp("Whether a previous response id was used."),
};

const SCREEN_PROPERTIES: Record<string, TelemetryPropertySpec> = {
  screenCount: numberProp("Number of screens captured."),
  primaryCount: numberProp("Number of primary screens in capture output."),
  saved: booleanProp("Whether the local ambient snapshot was saved."),
  hasOcr: booleanProp("Whether OCR text existed locally."),
  hasVision: booleanProp("Whether local vision text existed locally."),
  hasWindowTitle: booleanProp("Whether an active window title was available locally."),
  visionEnabled: booleanProp("Whether ambient local vision is enabled."),
  localVisionReady: booleanProp("Whether the local vision model is loaded."),
};

const AGENT_PROPERTIES: Record<string, TelemetryPropertySpec> = {
  decision: stringProp("Safety decision category."),
  tier: stringProp("Safety risk tier."),
  safetyTier: stringProp("Safety risk tier."),
  actionKind: stringProp("Computer-use action category."),
  maxSteps: numberProp("Configured maximum computer-use steps."),
  stepsTaken: numberProp("Number of computer-use steps completed."),
};

const TTS_PROPERTIES: Record<string, TelemetryPropertySpec> = {
  mode: stringProp("Text-to-speech mode."),
  outputFormat: stringProp("Audio output format."),
  latencyOptimization: numberProp("Provider latency optimization level."),
  textLengthBucket: bucketProp("Approximate text size bucket."),
  byteLengthBucket: bucketProp("Approximate audio byte size bucket."),
};

const SETTINGS_PROPERTIES: Record<string, TelemetryPropertySpec> = {
  localEnabled: booleanProp("Whether local diagnostics are enabled."),
  remoteEnabled: booleanProp("Whether remote analytics are enabled."),
};

const ONBOARDING_PROPERTIES: Record<string, TelemetryPropertySpec> = {
  step: numberProp("Onboarding step number."),
  step_reached: numberProp("Highest onboarding step reached."),
};

function props(...sets: Array<Record<string, TelemetryPropertySpec>>): Record<string, TelemetryPropertySpec> {
  return Object.assign({}, COMMON_PROPERTIES, ...sets);
}

const entries: TelemetryCatalogEntry[] = [
  {
    kind: "event",
    name: "app.telemetry_configured",
    category: "settings",
    description: "Telemetry settings changed.",
    userExplanation: "Records whether local diagnostics or remote analytics were enabled.",
    allowedProperties: props(SETTINGS_PROPERTIES),
  },
  {
    kind: "event",
    name: "diagnostics.export_requested",
    category: "diagnostics",
    description: "User requested a diagnostics export.",
    userExplanation: "Records that a local diagnostics export was generated.",
    allowedProperties: props(),
  },
  {
    kind: "event",
    name: "model.stream.completed",
    category: "model",
    description: "Streaming model request completed.",
    userExplanation: "Records provider, model, and coarse streaming counts without prompts or responses.",
    allowedProperties: props(MODEL_PROPERTIES),
  },
  {
    kind: "event",
    name: "voice.start.blocked",
    category: "voice",
    description: "Voice capture was blocked before starting.",
    userExplanation: "Records why push-to-talk could not start.",
    allowedProperties: props(VOICE_PROPERTIES),
  },
  {
    kind: "event",
    name: "voice.stt.completed",
    category: "voice",
    description: "Speech-to-text completed.",
    userExplanation: "Records STT mode and rough transcript length bucket, never the transcript.",
    allowedProperties: props(VOICE_PROPERTIES),
  },
  {
    kind: "event",
    name: "voice.turn.completed",
    category: "voice",
    description: "A voice turn completed.",
    userExplanation: "Records provider/model and coarse completion metadata.",
    allowedProperties: props(VOICE_PROPERTIES),
  },
  {
    kind: "event",
    name: "wake_word.monitor_started",
    category: "voice",
    description: "Local wake word monitor started.",
    userExplanation: "Records that the opt-in local wake monitor started; no audio or transcript is recorded.",
    allowedProperties: props(VOICE_PROPERTIES),
  },
  {
    kind: "event",
    name: "wake_word.detected",
    category: "voice",
    description: "Local wake phrase matched.",
    userExplanation: "Records a successful wake phrase detection with coarse metadata only.",
    allowedProperties: props(VOICE_PROPERTIES),
  },
  {
    kind: "event",
    name: "wake_word.rejected",
    category: "voice",
    description: "Local wake phrase check did not match.",
    userExplanation: "Records a local wake check miss with coarse metadata only.",
    allowedProperties: props(VOICE_PROPERTIES),
  },
  {
    kind: "event",
    name: "wake_word.error",
    category: "voice",
    description: "Local wake monitor hit an error.",
    userExplanation: "Records a categorical wake monitor error; no audio or transcript is recorded.",
    allowedProperties: props(VOICE_PROPERTIES),
  },
  {
    kind: "event",
    name: "agent.safety_decision",
    category: "computer-use",
    description: "Computer-use safety classifier made a decision.",
    userExplanation: "Records action category and safety tier, not screen content.",
    allowedProperties: props(AGENT_PROPERTIES),
  },
  {
    kind: "event",
    name: "agent.step.started",
    category: "computer-use",
    description: "Computer-use loop started a step.",
    userExplanation: "Records step number and action category.",
    allowedProperties: props(AGENT_PROPERTIES),
  },
  {
    kind: "event",
    name: "agent.action_verified",
    category: "computer-use",
    description: "Computer-use action verification completed.",
    userExplanation: "Records whether verification succeeded.",
    allowedProperties: props(AGENT_PROPERTIES),
  },
  {
    kind: "event",
    name: "agent.loop.completed",
    category: "computer-use",
    description: "Computer-use loop completed.",
    userExplanation: "Records step count and stop reason.",
    allowedProperties: props(AGENT_PROPERTIES, VOICE_PROPERTIES),
  },
  {
    kind: "event",
    name: "ambient.capture.skipped",
    category: "ambient",
    description: "Ambient capture was skipped.",
    userExplanation: "Records a categorical skip reason only.",
    allowedProperties: props(SCREEN_PROPERTIES),
  },
  {
    kind: "event",
    name: "video.start",
    category: "screen",
    description: "Video capture subsystem started.",
    userExplanation: "Records FPS bounds and retention settings; no screen content.",
    allowedProperties: props(SCREEN_PROPERTIES),
  },
  {
    kind: "event",
    name: "video.stop",
    category: "screen",
    description: "Video capture subsystem stopped.",
    userExplanation: "Records runtime duration; no screen content.",
    allowedProperties: props(SCREEN_PROPERTIES),
  },
  {
    kind: "event",
    name: "video.tick",
    category: "screen",
    description: "Video capture loop saved a keyframe.",
    userExplanation: "Records keyframe outcome category (keyframe/no-keyframe/private/blackout) — never screen content.",
    allowedProperties: props(SCREEN_PROPERTIES),
  },
  {
    kind: "event",
    name: "video.privacy.changed",
    category: "screen",
    description: "Video subsystem privacy snapshot was updated.",
    userExplanation: "Records the new flags (incognito/paused/excluded counts) — never window titles.",
    allowedProperties: props(SCREEN_PROPERTIES),
  },
  {
    kind: "event",
    name: "video.action_keyframe",
    category: "computer-use",
    description: "Agent triggered an action-driven keyframe.",
    userExplanation: "Records action category that caused the keyframe; no screen content.",
    allowedProperties: props(AGENT_PROPERTIES),
  },
  {
    kind: "event",
    name: "screen.capture.completed",
    category: "screen",
    description: "Screen capture command completed.",
    userExplanation: "Records screen counts only, never screenshots.",
    allowedProperties: props(SCREEN_PROPERTIES),
  },
  {
    kind: "event",
    name: "stt.assemblyai.reused_prewarm",
    category: "speech",
    description: "AssemblyAI reused a prewarmed socket.",
    userExplanation: "Records language and sample-rate metadata.",
    allowedProperties: props(VOICE_PROPERTIES),
  },
  {
    kind: "event",
    name: "stt.assemblyai.disconnected",
    category: "speech",
    description: "AssemblyAI socket disconnected.",
    userExplanation: "Records transcript length bucket and language detection metadata.",
    allowedProperties: props(VOICE_PROPERTIES),
  },
  ...[
    "onboarding_started",
    "onboarding_mic_granted",
    "onboarding_mic_denied",
    "onboarding_email_captured",
    "onboarding_demo_completed",
    "onboarding_key_validated",
    "onboarding_completed",
    "onboarding_skipped",
  ].map((name): TelemetryCatalogEntry => ({
    kind: "event",
    name,
    category: "onboarding",
    description: "Onboarding progress event.",
    userExplanation: "Records coarse onboarding progress only.",
    allowedProperties: props(ONBOARDING_PROPERTIES),
  })),
  {
    kind: "error",
    name: "error.captured",
    category: "errors",
    description: "Sanitized application error.",
    userExplanation: "Records sanitized error text and safe route metadata.",
    allowedProperties: props(VOICE_PROPERTIES, MODEL_PROPERTIES),
  },
  ...[
    "voice.hotkey_down",
    "voice.turn",
    "model.stream",
    "model.openai_responses",
    "stt.assemblyai_connect",
    "ambient.tick",
    "screen.capture_all",
    "tts.fetch_audio",
    "agent.computer_loop",
  ].map((name): TelemetryCatalogEntry => ({
    kind: "span",
    name,
    category: name.split(".")[0] ?? "app",
    description: `Span for ${name}.`,
    userExplanation: "Records timing and safe categorical attributes.",
    allowedProperties: props(VOICE_PROPERTIES, MODEL_PROPERTIES, SCREEN_PROPERTIES, AGENT_PROPERTIES, TTS_PROPERTIES),
  })),
  ...[
    "voice.first_token_ms",
    "voice.hotkey_down.duration_ms",
    "voice.turn.duration_ms",
    "model.stream.duration_ms",
    "model.openai_responses.duration_ms",
    "stt.assemblyai_connect.duration_ms",
    "ambient.tick.duration_ms",
    "screen.capture_all.duration_ms",
    "tts.fetch_audio.duration_ms",
    "agent.computer_loop.duration_ms",
  ].map((name): TelemetryCatalogEntry => ({
    kind: "metric",
    name,
    category: name.split(".")[0] ?? "app",
    description: `Metric for ${name}.`,
    userExplanation: "Records numeric timing or count values with safe attributes.",
    allowedProperties: props(VOICE_PROPERTIES, MODEL_PROPERTIES, SCREEN_PROPERTIES, AGENT_PROPERTIES, TTS_PROPERTIES),
  })),
];

export const TELEMETRY_CATALOG: Record<string, TelemetryCatalogEntry> = Object.fromEntries(
  entries.map((entry) => [`${entry.kind}:${entry.name}`, entry])
);

export function getTelemetryCatalogEntry(
  kind: TelemetryRecordKind,
  name: string
): TelemetryCatalogEntry | null {
  return TELEMETRY_CATALOG[`${kind}:${name}`] ?? null;
}

export function isAllowedTelemetryName(kind: TelemetryRecordKind, name: string): boolean {
  return Boolean(getTelemetryCatalogEntry(kind, name));
}

export function filterTelemetryProperties(
  kind: TelemetryRecordKind,
  name: string,
  properties: TelemetryProperties
): TelemetryPropertyFilterResult {
  const entry = getTelemetryCatalogEntry(kind, name);
  if (!entry) {
    return { properties: {}, droppedUnknownPropertyCount: Object.keys(properties).length };
  }

  const output: TelemetryProperties = {};
  let droppedUnknownPropertyCount = 0;
  for (const [key, value] of Object.entries(properties)) {
    const spec = entry.allowedProperties[key];
    if (!spec) {
      droppedUnknownPropertyCount++;
      continue;
    }
    const coerced = coerceTelemetryValue(value, spec);
    if (coerced !== undefined) {
      output[key] = coerced;
    }
  }
  return { properties: output, droppedUnknownPropertyCount };
}

export function getTelemetryCatalogSummary(): TelemetryCatalogSummaryEntry[] {
  return entries.map((entry) => ({
    kind: entry.kind,
    name: entry.name,
    category: entry.category,
    description: entry.description,
    userExplanation: entry.userExplanation,
    allowedProperties: Object.keys(entry.allowedProperties).sort(),
  }));
}

function coerceTelemetryValue(value: TelemetryValue | undefined, spec: TelemetryPropertySpec): TelemetryValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return spec.type === "nullable" ? null : undefined;
  if (spec.type === "boolean") {
    return typeof value === "boolean" ? value : Boolean(value);
  }
  if (spec.type === "number") {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  if (spec.type === "nullable") {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return value;
    }
    return null;
  }
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}
