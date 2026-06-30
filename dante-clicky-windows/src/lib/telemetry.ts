import {
  TELEMETRY_SCHEMA_VERSION,
  filterTelemetryProperties,
  getTelemetryCatalogEntry,
  getTelemetryCatalogSummary,
  type TelemetryCatalogSummaryEntry,
  type TelemetryRecordKind,
} from "./telemetrySchema";

export type TelemetryRemoteStatus =
  | "disabled"
  | "not-configured"
  | "loading"
  | "ready"
  | "privacy-paused"
  | "error";

export type TelemetryNativeStoreStatus = "unavailable" | "ready" | "error";

export interface TelemetrySettings {
  localEnabled: boolean;
  remoteEnabled: boolean;
  remoteProjectKey: string;
  remoteHost: string;
  maxEvents: number;
  maxSpans: number;
  incognito: boolean;
  sampleRate: number;
}

export interface TelemetryContext {
  runtimeSessionId: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  traceparent: string;
}

export interface TelemetryEvent extends Partial<TelemetryContext> {
  id: string;
  name: string;
  timestamp: string;
  properties: TelemetryProperties;
}

export interface TelemetrySpanRecord extends TelemetryContext {
  id: string;
  name: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: "ok" | "error";
  attributes: TelemetryProperties;
}

export interface TelemetryErrorRecord extends Partial<TelemetryContext> {
  id: string;
  timestamp: string;
  message: string;
  stack?: string;
  context: TelemetryProperties;
}

export interface TelemetryMetricSample extends TelemetryContext {
  value: number;
  timestamp: string;
  properties: TelemetryProperties;
}

export interface TelemetryMetricSummary {
  count: number;
  min: number;
  max: number;
  avg: number;
  p95: number;
}

export interface TelemetrySnapshot {
  generatedAt: string;
  catalogVersion: string;
  catalog: TelemetryCatalogSummaryEntry[];
  settings: TelemetrySettings;
  remoteStatus: TelemetryRemoteStatus;
  nativeStoreStatus: TelemetryNativeStoreStatus;
  nativeRecordCount: number;
  queuedRemoteCount: number;
  droppedRemoteCount: number;
  lastFlushAt?: string;
  lastFlushError?: string;
  suppressedCount: number;
  droppedUnknownEventCount: number;
  droppedUnknownPropertyCount: number;
  redactedValueCount: number;
  events: TelemetryEvent[];
  spans: TelemetrySpanRecord[];
  errors: TelemetryErrorRecord[];
  metrics: Record<string, TelemetryMetricSummary>;
  metricSamples: Record<string, TelemetryMetricSample[]>;
}

export type TelemetryPrimitive = string | number | boolean | null;
export type TelemetryValue =
  | TelemetryPrimitive
  | TelemetryObject
  | TelemetryValue[];
export interface TelemetryObject {
  [key: string]: TelemetryValue;
}
export type TelemetryProperties = TelemetryObject;

interface NativeObservabilityRecord {
  kind: TelemetryRecordKind;
  name: string;
  timestamp?: string;
  runtime_session_id: string;
  trace_id: string;
  span_id?: string;
  parent_span_id?: string;
  payload: TelemetryProperties;
}

interface NativeObservabilitySnapshot {
  status?: TelemetryNativeStoreStatus;
  record_count?: number;
  records?: unknown[];
  crash_markers?: unknown[];
}

const DEFAULT_SETTINGS: TelemetrySettings = {
  localEnabled: true,
  remoteEnabled: false,
  remoteProjectKey: "",
  remoteHost: "https://us.i.posthog.com",
  maxEvents: 200,
  maxSpans: 120,
  incognito: false,
  sampleRate: 1,
};

const MAX_STRING_LENGTH = 180;
const MAX_ARRAY_ITEMS = 12;
const MAX_REMOTE_QUEUE = 100;
const REMOTE_RETRY_BASE_MS = 1_000;
const REMOTE_RETRY_MAX_MS = 30_000;
const TELEMETRY_STORAGE_KEY = "dante-clicky.telemetry.v1";
const SENSITIVE_KEY_PATTERN =
  /(api.?key|authorization|bearer|token|secret|password|passwd|passphrase|credential|cookie|session|screenshot|image|base64|b64|prompt|transcript|response|assistantResponse|userPrompt|content)/i;
const SECRET_VALUE_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{6,}\b/g,
  /\bxai-[A-Za-z0-9_-]{6,}\b/g,
  /\bphc_[A-Za-z0-9_-]{6,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]+\b/gi,
  /data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/=]+/g,
  /\b[A-Za-z0-9+/]{80,}={0,2}\b/g,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
];

let settings: TelemetrySettings = { ...DEFAULT_SETTINGS };
let events: TelemetryEvent[] = [];
let spans: TelemetrySpanRecord[] = [];
let errors: TelemetryErrorRecord[] = [];
let metricSamples: Record<string, TelemetryMetricSample[]> = {};
let remoteQueue: TelemetryEvent[] = [];
let suppressedCount = 0;
let droppedUnknownEventCount = 0;
let droppedUnknownPropertyCount = 0;
let redactedValueCount = 0;
let droppedRemoteCount = 0;
let nativeStoreStatus: TelemetryNativeStoreStatus = "unavailable";
let nativeRecordCount = 0;
let remoteStatus: TelemetryRemoteStatus = "disabled";
let lastFlushAt: string | undefined;
let lastFlushError: string | undefined;
let globalHandlersInstalled = false;
let posthogLoadStarted = false;
let hydrated = false;
let onlineFlushInstalled = false;
let remoteRetryAttempts = 0;
let remoteRetryTimer: ReturnType<typeof setTimeout> | null = null;
const runtimeSessionId = createHexId(16);

interface PersistedTelemetryState {
  telemetrySchemaVersion?: string;
  events: TelemetryEvent[];
  spans: TelemetrySpanRecord[];
  errors: TelemetryErrorRecord[];
  metricSamples: Record<string, TelemetryMetricSample[] | number[]>;
  remoteQueue?: TelemetryEvent[];
  suppressedCount: number;
  droppedUnknownEventCount?: number;
  droppedUnknownPropertyCount?: number;
  redactedValueCount?: number;
  droppedRemoteCount?: number;
  lastFlushAt?: string;
  lastFlushError?: string;
}

declare global {
  interface Window {
    posthog?: PostHogLike;
  }
}

interface PostHogLike {
  [method: string]: unknown;
  init?: (key: string, options: Record<string, unknown>, name?: string) => void;
  capture?: (event: string, properties?: TelemetryProperties) => void;
  opt_in_capturing?: () => void;
  opt_out_capturing?: () => void;
  __DANTE_QUEUE?: true;
}

interface PostHogQueue extends PostHogLike {
  _i: Array<[string, Record<string, unknown>, string | undefined]>;
  __SV: number;
  people: Record<string, unknown>;
  push: (item: unknown) => number;
}

export function configureTelemetry(next: Partial<TelemetrySettings>): TelemetrySettings {
  const wasLocalEnabled = settings.localEnabled;
  const wasIncognito = settings.incognito;
  settings = {
    ...settings,
    ...next,
    maxEvents: Math.max(1, next.maxEvents ?? settings.maxEvents),
    maxSpans: Math.max(1, next.maxSpans ?? settings.maxSpans),
    sampleRate: Math.min(1, Math.max(0, next.sampleRate ?? settings.sampleRate)),
  };

  if (!wasIncognito && settings.incognito) {
    clearTelemetryBuffer();
    clearRemoteQueue();
  } else if (wasLocalEnabled && !settings.localEnabled) {
    clearTelemetryBuffer();
  } else if (settings.localEnabled) {
    hydrateTelemetryState();
  }

  if (!settings.remoteEnabled || settings.incognito) {
    clearRemoteQueue();
  }
  updateRemoteStatus();
  flushTelemetryRemoteQueue();
  return { ...settings };
}

export function installGlobalTelemetryHandlers(): void {
  if (globalHandlersInstalled || typeof window === "undefined") return;
  globalHandlersInstalled = true;

  window.addEventListener("error", (event) => {
    captureTelemetryError(event.error ?? event.message, {
      source: "window.error",
      filename: event.filename,
      line: event.lineno,
      column: event.colno,
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    captureTelemetryError(event.reason, { source: "unhandledrejection" });
  });
}

export function createTelemetryContext(parentContext?: TelemetryContext): TelemetryContext {
  const traceId = parentContext?.traceId ?? createHexId(16);
  const spanId = createHexId(8);
  return {
    runtimeSessionId: parentContext?.runtimeSessionId ?? runtimeSessionId,
    traceId,
    spanId,
    parentSpanId: parentContext?.spanId,
    traceparent: `00-${traceId}-${spanId}-01`,
  };
}

export function recordTelemetryEvent(
  name: string,
  properties: TelemetryProperties = {},
  context?: TelemetryContext
): TelemetryEvent | null {
  if (!shouldRecord()) return null;
  if (!getTelemetryCatalogEntry("event", name)) {
    droppedUnknownEventCount++;
    persistTelemetryState();
    return null;
  }
  if (!passesSampleRate()) return null;

  const filteredProperties = prepareTelemetryProperties("event", name, properties);
  const telemetryContext = context ?? createTelemetryContext();
  const event: TelemetryEvent = {
    id: createId(),
    name,
    timestamp: new Date().toISOString(),
    ...telemetryContext,
    properties: filteredProperties,
  };

  if (settings.localEnabled) {
    hydrateTelemetryState();
    events = boundedAppend(events, event, settings.maxEvents);
    persistTelemetryState();
    appendNativeRecord("event", name, event.timestamp, telemetryContext, filteredProperties);
  }
  captureRemote(event);
  return event;
}

export function recordTelemetryMetric(
  name: string,
  value: number,
  properties: TelemetryProperties = {},
  context?: TelemetryContext
): void {
  if (!Number.isFinite(value)) return;
  if (!shouldRecord()) return;
  if (!getTelemetryCatalogEntry("metric", name)) {
    droppedUnknownEventCount++;
    persistTelemetryState();
    return;
  }

  const telemetryContext = context ?? createTelemetryContext();
  const filteredProperties = prepareTelemetryProperties("metric", name, properties);
  const sample: TelemetryMetricSample = {
    ...telemetryContext,
    value,
    timestamp: new Date().toISOString(),
    properties: filteredProperties,
  };
  const key = normalizeMetricKey(name);

  if (settings.localEnabled) {
    hydrateTelemetryState();
    const existing = metricSamples[key] ?? [];
    metricSamples = {
      ...metricSamples,
      [key]: boundedAppend(existing, sample, settings.maxEvents),
    };
    persistTelemetryState();
    appendNativeRecord("metric", name, sample.timestamp, telemetryContext, {
      ...filteredProperties,
      value,
    });
  }
  captureRemote({
    id: createId(),
    name: `metric.${name}`,
    timestamp: sample.timestamp,
    ...telemetryContext,
    properties: { ...filteredProperties, value },
  });
}

export function startTelemetrySpan(
  name: string,
  attributes: TelemetryProperties = {},
  parentContext?: TelemetryContext
): {
  id: string;
  context: TelemetryContext;
  end: (attributes?: TelemetryProperties) => TelemetrySpanRecord | null;
  fail: (error: unknown, attributes?: TelemetryProperties) => TelemetrySpanRecord | null;
} {
  const context = createTelemetryContext(parentContext);
  const startedAtMs = nowMs();
  const startedAt = new Date().toISOString();
  const startAttributes = prepareTelemetryProperties("span", name, attributes, true);
  const knownSpan = Boolean(getTelemetryCatalogEntry("span", name));
  if (!knownSpan) {
    droppedUnknownEventCount++;
  }
  let closed = false;

  const finish = (
    status: "ok" | "error",
    endAttributes: TelemetryProperties = {}
  ): TelemetrySpanRecord | null => {
    if (closed) return null;
    closed = true;
    if (!knownSpan || !shouldRecord()) return null;

    const endedAtMs = nowMs();
    const endedAt = new Date().toISOString();
    const attributesForRecord = {
      ...startAttributes,
      ...prepareTelemetryProperties("span", name, endAttributes),
    };
    const record: TelemetrySpanRecord = {
      id: context.spanId,
      name,
      startedAt,
      endedAt,
      durationMs: Math.max(0, Math.round(endedAtMs - startedAtMs)),
      status,
      ...context,
      attributes: attributesForRecord,
    };

    if (settings.localEnabled) {
      hydrateTelemetryState();
      spans = boundedAppend(spans, record, settings.maxSpans);
      persistTelemetryState();
      appendNativeRecord("span", name, record.endedAt, context, {
        ...record.attributes,
        durationMs: record.durationMs,
        status,
      });
    }
    recordTelemetryMetric(`${name}.duration_ms`, record.durationMs, { status }, context);
    captureRemote({
      id: createId(),
      name: `span.${name}`,
      timestamp: record.endedAt,
      ...context,
      properties: {
        ...record.attributes,
        durationMs: record.durationMs,
        status,
      },
    });
    return record;
  };

  return {
    id: context.spanId,
    context,
    end: (endAttributes = {}) => finish("ok", endAttributes),
    fail: (error, endAttributes = {}) => {
      captureTelemetryError(error, { span: name }, context);
      return finish("error", endAttributes);
    },
  };
}

export function captureTelemetryError(
  error: unknown,
  context: TelemetryProperties = {},
  telemetryContext?: TelemetryContext
): TelemetryErrorRecord | null {
  if (!shouldRecord()) return null;

  const traceContext = telemetryContext ?? createTelemetryContext();
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  const filteredContext = prepareTelemetryProperties("error", "error.captured", context);
  const record: TelemetryErrorRecord = {
    id: createId(),
    timestamp: new Date().toISOString(),
    ...traceContext,
    message: redactText(message).slice(0, MAX_STRING_LENGTH),
    stack: stack ? redactText(stack).slice(0, 1_500) : undefined,
    context: filteredContext,
  };

  if (settings.localEnabled) {
    hydrateTelemetryState();
    errors = boundedAppend(errors, record, settings.maxEvents);
    persistTelemetryState();
    appendNativeRecord("error", "error.captured", record.timestamp, traceContext, {
      message: record.message,
      ...record.context,
    });
  }
  captureRemote({
    id: createId(),
    name: "error.captured",
    timestamp: record.timestamp,
    ...traceContext,
    properties: {
      message: record.message,
      ...record.context,
    },
  });
  return record;
}

export function sanitizeTelemetryProperties(
  input: TelemetryProperties
): TelemetryProperties {
  return sanitizeObject(input, 0);
}

export function getTelemetrySnapshot(): TelemetrySnapshot {
  hydrateTelemetryState();
  updateRemoteStatus();
  return {
    generatedAt: new Date().toISOString(),
    catalogVersion: TELEMETRY_SCHEMA_VERSION,
    catalog: getTelemetryCatalogSummary(),
    settings: { ...settings },
    remoteStatus,
    nativeStoreStatus,
    nativeRecordCount,
    queuedRemoteCount: remoteQueue.length,
    droppedRemoteCount,
    lastFlushAt,
    lastFlushError,
    suppressedCount,
    droppedUnknownEventCount,
    droppedUnknownPropertyCount,
    redactedValueCount,
    events: events.map((event) => ({ ...event, properties: { ...event.properties } })),
    spans: spans.map((span) => ({ ...span, attributes: { ...span.attributes } })),
    errors: errors.map((error) => ({ ...error, context: { ...error.context } })),
    metrics: summarizeMetrics(),
    metricSamples: cloneMetricSamples(),
  };
}

export function exportTelemetryJson(): string {
  return JSON.stringify(getTelemetrySnapshot(), null, 2);
}

export async function exportTelemetryBundleJson(): Promise<string> {
  const webviewTelemetry = getTelemetrySnapshot();
  const nativeDiagnostics = await readNativeDiagnosticsSnapshot(500);
  const bundle = {
    generatedAt: new Date().toISOString(),
    appVersion: "0.1.0",
    catalogVersion: TELEMETRY_SCHEMA_VERSION,
    webviewTelemetry,
    nativeDiagnostics,
    nativeLogSummary: {
      status: nativeStoreStatus,
      note: "Persistent rotating logs are written by the Tauri log plugin in the app log directory.",
    },
    crashSummary: {
      status: nativeDiagnostics?.crash_markers ? "available" : "unavailable",
      markers: nativeDiagnostics?.crash_markers ?? [],
    },
  };
  return JSON.stringify(bundle, null, 2);
}

export function clearTelemetryBuffer(): void {
  events = [];
  spans = [];
  errors = [];
  metricSamples = {};
  nativeRecordCount = 0;
  persistTelemetryState();
}

export function flushTelemetryRemoteQueue(): void {
  if (settings.incognito || !settings.remoteEnabled || !settings.remoteProjectKey.trim()) {
    clearRemoteQueue();
    updateRemoteStatus();
    return;
  }

  updateRemoteStatus();
  if (remoteQueue.length === 0) return;
  if (!isRealPostHogReady()) return;

  const remaining = [...remoteQueue];
  const failed: TelemetryEvent[] = [];
  while (remaining.length > 0) {
    const event = remaining.shift();
    if (!event) break;
    try {
      window.posthog?.capture?.(event.name, remotePropertiesForEvent(event));
    } catch (err) {
      failed.push(event, ...remaining);
      remoteStatus = "error";
      lastFlushError = err instanceof Error ? err.message : String(err);
      remoteQueue = failed.slice(0, MAX_REMOTE_QUEUE);
      scheduleRemoteRetry();
      persistTelemetryState();
      return;
    }
  }

  remoteQueue = [];
  remoteRetryAttempts = 0;
  lastFlushAt = new Date().toISOString();
  lastFlushError = undefined;
  remoteStatus = "ready";
  persistTelemetryState();
}

export function resetTelemetryForTests(): void {
  settings = { ...DEFAULT_SETTINGS };
  events = [];
  spans = [];
  errors = [];
  metricSamples = {};
  remoteQueue = [];
  suppressedCount = 0;
  droppedUnknownEventCount = 0;
  droppedUnknownPropertyCount = 0;
  redactedValueCount = 0;
  droppedRemoteCount = 0;
  nativeStoreStatus = "unavailable";
  nativeRecordCount = 0;
  remoteStatus = "disabled";
  lastFlushAt = undefined;
  lastFlushError = undefined;
  globalHandlersInstalled = false;
  posthogLoadStarted = false;
  hydrated = false;
  remoteRetryAttempts = 0;
  if (remoteRetryTimer) {
    clearTimeout(remoteRetryTimer);
    remoteRetryTimer = null;
  }
  removePersistedTelemetryState();
}

export { getTelemetryCatalogSummary };

function shouldRecord(): boolean {
  updateRemoteStatus();
  if (settings.incognito) {
    suppressedCount++;
    return false;
  }
  if (!settings.localEnabled && !settings.remoteEnabled) {
    return false;
  }
  return true;
}

function passesSampleRate(): boolean {
  if (settings.sampleRate >= 1) return true;
  if (settings.sampleRate <= 0) return false;
  return Math.random() <= settings.sampleRate;
}

function prepareTelemetryProperties(
  kind: TelemetryRecordKind,
  name: string,
  properties: TelemetryProperties,
  allowUnknownSpanStart = false
): TelemetryProperties {
  const sanitized = sanitizeTelemetryProperties(properties);
  if (allowUnknownSpanStart && !getTelemetryCatalogEntry(kind, name)) return {};
  const filtered = filterTelemetryProperties(kind, name, sanitized);
  droppedUnknownPropertyCount += filtered.droppedUnknownPropertyCount;
  return filtered.properties;
}

function updateRemoteStatus(): void {
  if (settings.incognito) {
    remoteStatus = "privacy-paused";
    clearRemoteQueue();
    return;
  }
  if (!settings.remoteEnabled) {
    remoteStatus = "disabled";
    clearRemoteQueue();
    if (typeof window !== "undefined") window.posthog?.opt_out_capturing?.();
    return;
  }
  if (!settings.remoteProjectKey.trim()) {
    remoteStatus = "not-configured";
    return;
  }
  installOnlineFlushHandler();
  if (typeof window === "undefined" || typeof document === "undefined") {
    remoteStatus = "ready";
    return;
  }
  if (isRealPostHogReady()) {
    remoteStatus = "ready";
    window.posthog?.opt_in_capturing?.();
    return;
  }
  loadPostHog();
}

function loadPostHog(): void {
  if (posthogLoadStarted) {
    remoteStatus = remoteStatus === "error" ? "error" : "loading";
    return;
  }
  posthogLoadStarted = true;
  remoteStatus = "loading";
  const posthog = ensurePostHogQueue();
  posthog.init?.(settings.remoteProjectKey, {
    api_host: settings.remoteHost,
    defaults: "2026-01-30",
    person_profiles: "identified_only",
    capture_pageview: false,
    autocapture: false,
    disable_session_recording: true,
    opt_out_capturing_by_default: true,
  });
  posthog.opt_in_capturing?.();
}

function ensurePostHogQueue(): PostHogLike {
  if (typeof window === "undefined") return {};
  if (isRealPostHogReady()) return window.posthog ?? {};
  if (window.posthog?.__DANTE_QUEUE) return window.posthog;

  const queue = [] as unknown as PostHogQueue;
  queue._i = [];
  queue.__SV = 1;
  queue.__DANTE_QUEUE = true;
  queue.people = {};

  const queueMethod = (target: Record<string, unknown>, method: string) => {
    target[method] = (...args: unknown[]) => {
      queue.push([method, ...args]);
    };
  };

  for (const method of [
    "capture",
    "identify",
    "reset",
    "opt_in_capturing",
    "opt_out_capturing",
    "has_opted_out_capturing",
    "set_config",
  ]) {
    queueMethod(queue, method);
  }

  queue.init = (key, options, name) => {
    queue._i.push([key, options, name]);
    const script = document.createElement("script");
    script.async = true;
    script.crossOrigin = "anonymous";
    const host = String(options.api_host ?? settings.remoteHost);
    script.src = `${host.replace(".i.posthog.com", "-assets.i.posthog.com")}/static/array.js`;
    script.onload = () => {
      remoteStatus = isRealPostHogReady() ? "ready" : "error";
      window.posthog?.opt_in_capturing?.();
      flushTelemetryRemoteQueue();
    };
    script.onerror = () => {
      remoteStatus = "error";
      lastFlushError = "PostHog script failed to load";
      scheduleRemoteRetry();
    };
    document.head.appendChild(script);
  };

  window.posthog = queue;
  return queue;
}

function captureRemote(event: TelemetryEvent): void {
  if (settings.incognito || !settings.remoteEnabled || !settings.remoteProjectKey.trim()) return;
  hydrateTelemetryState();
  updateRemoteStatus();
  if (!isRealPostHogReady()) {
    enqueueRemote(event);
    return;
  }
  if (remoteQueue.length > 0) {
    enqueueRemote(event);
    flushTelemetryRemoteQueue();
    return;
  }
  try {
    window.posthog?.capture?.(event.name, remotePropertiesForEvent(event));
    lastFlushAt = new Date().toISOString();
    lastFlushError = undefined;
    persistTelemetryState();
  } catch (err) {
    lastFlushError = err instanceof Error ? err.message : String(err);
    remoteStatus = "error";
    enqueueRemote(event);
    scheduleRemoteRetry();
  }
}

function remotePropertiesForEvent(event: TelemetryEvent): TelemetryProperties {
  return {
    ...event.properties,
    runtimeSessionId: event.runtimeSessionId ?? runtimeSessionId,
    traceId: event.traceId ?? "",
    spanId: event.spanId ?? "",
    parentSpanId: event.parentSpanId ?? "",
    traceparent: event.traceparent ?? "",
    catalogVersion: TELEMETRY_SCHEMA_VERSION,
  };
}

function enqueueRemote(event: TelemetryEvent): void {
  const next = [...remoteQueue, { ...event, properties: { ...event.properties } }];
  if (next.length > MAX_REMOTE_QUEUE) {
    droppedRemoteCount += next.length - MAX_REMOTE_QUEUE;
    remoteQueue = next.slice(next.length - MAX_REMOTE_QUEUE);
  } else {
    remoteQueue = next;
  }
  persistTelemetryState();
}

function clearRemoteQueue(): void {
  if (remoteQueue.length === 0 && !lastFlushError) return;
  remoteQueue = [];
  lastFlushError = undefined;
  persistTelemetryState();
}

function scheduleRemoteRetry(): void {
  if (typeof window === "undefined" || typeof setTimeout === "undefined") return;
  if (remoteRetryTimer) return;
  const delay = Math.min(
    REMOTE_RETRY_MAX_MS,
    REMOTE_RETRY_BASE_MS * 2 ** Math.min(remoteRetryAttempts, 5)
  );
  remoteRetryAttempts++;
  remoteRetryTimer = setTimeout(() => {
    remoteRetryTimer = null;
    flushTelemetryRemoteQueue();
  }, delay);
}

function installOnlineFlushHandler(): void {
  if (onlineFlushInstalled || typeof window === "undefined") return;
  onlineFlushInstalled = true;
  window.addEventListener("online", () => flushTelemetryRemoteQueue());
}

function isRealPostHogReady(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.posthog?.capture === "function" &&
    window.posthog.__DANTE_QUEUE !== true
  );
}

function sanitizeObject(input: TelemetryProperties, depth: number): TelemetryProperties {
  if (depth > 4) return {};
  const output: TelemetryProperties = {};
  for (const [key, value] of Object.entries(input)) {
    output[key] = sanitizeValue(key, value, depth);
  }
  return output;
}

function sanitizeValue(key: string, value: TelemetryValue, depth: number): TelemetryValue {
  if (SENSITIVE_KEY_PATTERN.test(key)) {
    redactedValueCount++;
    return "[redacted]";
  }
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return boundString(redactText(value));
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => sanitizeValue(key, item, depth + 1));
  }
  return sanitizeObject(value, depth + 1);
}

function redactText(input: string): string {
  let text = input;
  for (const pattern of SECRET_VALUE_PATTERNS) {
    let replaced = false;
    text = text.replace(pattern, () => {
      replaced = true;
      return "[redacted]";
    });
    if (replaced) redactedValueCount++;
  }
  return text;
}

function boundString(input: string): string {
  if (input.length <= MAX_STRING_LENGTH) return input;
  return `${input.slice(0, MAX_STRING_LENGTH)}...`;
}

function boundedAppend<T>(items: T[], item: T, limit: number): T[] {
  const next = [...items, item];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

function summarizeMetrics(): Record<string, TelemetryMetricSummary> {
  return Object.fromEntries(
    Object.entries(metricSamples).map(([key, samples]) => {
      const sorted = samples.map((sample) => sample.value).sort((a, b) => a - b);
      const sum = sorted.reduce((total, value) => total + value, 0);
      return [
        key,
        {
          count: sorted.length,
          min: sorted[0] ?? 0,
          max: sorted.at(-1) ?? 0,
          avg: sorted.length ? Math.round(sum / sorted.length) : 0,
          p95: percentile(sorted, 0.95),
        },
      ];
    })
  );
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1));
  return sorted[index] ?? 0;
}

function cloneMetricSamples(): Record<string, TelemetryMetricSample[]> {
  return Object.fromEntries(
    Object.entries(metricSamples).map(([key, samples]) => [
      key,
      samples.map((sample) => ({
        ...sample,
        properties: { ...sample.properties },
      })),
    ])
  );
}

function normalizeMetricKey(name: string): string {
  return name.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function hydrateTelemetryState(): void {
  const storage = getTelemetryStorage();
  if (hydrated || !storage) return;
  hydrated = true;

  try {
    const raw = storage.getItem(TELEMETRY_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<PersistedTelemetryState>;
    events = Array.isArray(parsed.events)
      ? parsed.events.slice(-settings.maxEvents).map(normalizePersistedEvent).filter(isPresent)
      : [];
    spans = Array.isArray(parsed.spans)
      ? parsed.spans.slice(-settings.maxSpans).map(normalizePersistedSpan).filter(isPresent)
      : [];
    errors = Array.isArray(parsed.errors)
      ? parsed.errors.slice(-settings.maxEvents).map(normalizePersistedError).filter(isPresent)
      : [];
    metricSamples = normalizePersistedMetrics(parsed.metricSamples);
    remoteQueue = Array.isArray(parsed.remoteQueue)
      ? parsed.remoteQueue.slice(-MAX_REMOTE_QUEUE).map(normalizePersistedRemoteEvent).filter(isPresent)
      : [];
    suppressedCount = finiteNumber(parsed.suppressedCount, suppressedCount);
    droppedUnknownEventCount = finiteNumber(parsed.droppedUnknownEventCount, droppedUnknownEventCount);
    droppedUnknownPropertyCount = finiteNumber(parsed.droppedUnknownPropertyCount, droppedUnknownPropertyCount);
    redactedValueCount = finiteNumber(parsed.redactedValueCount, redactedValueCount);
    droppedRemoteCount = finiteNumber(parsed.droppedRemoteCount, droppedRemoteCount);
    lastFlushAt = typeof parsed.lastFlushAt === "string" ? parsed.lastFlushAt : lastFlushAt;
    lastFlushError = typeof parsed.lastFlushError === "string" ? parsed.lastFlushError : lastFlushError;
  } catch {
    removePersistedTelemetryState();
  }
}

function persistTelemetryState(): void {
  const storage = getTelemetryStorage();
  if (settings.incognito || !storage) {
    return;
  }

  if (!settings.localEnabled && remoteQueue.length === 0) {
    removePersistedTelemetryState();
    return;
  }

  const persisted: PersistedTelemetryState = {
    telemetrySchemaVersion: TELEMETRY_SCHEMA_VERSION,
    events,
    spans,
    errors,
    metricSamples,
    remoteQueue,
    suppressedCount,
    droppedUnknownEventCount,
    droppedUnknownPropertyCount,
    redactedValueCount,
    droppedRemoteCount,
    lastFlushAt,
    lastFlushError,
  };

  try {
    storage.setItem(TELEMETRY_STORAGE_KEY, JSON.stringify(persisted));
  } catch {
    // Storage can be unavailable or full. Diagnostics remain available in memory.
  }
}

function removePersistedTelemetryState(): void {
  const storage = getTelemetryStorage();
  if (!storage) return;
  try {
    storage.removeItem(TELEMETRY_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures; callers have already cleared memory.
  }
}

function getTelemetryStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function normalizePersistedEvent(input: TelemetryEvent): TelemetryEvent | null {
  if (!getTelemetryCatalogEntry("event", String(input.name ?? ""))) return null;
  const context = normalizeContext(input);
  const properties = prepareTelemetryProperties(
    "event",
    String(input.name),
    (input.properties ?? {}) as TelemetryProperties
  );
  return {
    id: String(input.id ?? createId()),
    name: String(input.name),
    timestamp: String(input.timestamp ?? new Date().toISOString()),
    ...context,
    properties,
  };
}

function normalizePersistedRemoteEvent(input: TelemetryEvent): TelemetryEvent | null {
  const name = String(input.name ?? "");
  const properties = sanitizeTelemetryProperties((input.properties ?? {}) as TelemetryProperties);
  return {
    id: String(input.id ?? createId()),
    name,
    timestamp: String(input.timestamp ?? new Date().toISOString()),
    ...normalizeContext(input),
    properties,
  };
}

function normalizePersistedSpan(input: TelemetrySpanRecord): TelemetrySpanRecord | null {
  if (!getTelemetryCatalogEntry("span", String(input.name ?? ""))) return null;
  const context = normalizeContext(input);
  return {
    id: String(input.id ?? context.spanId),
    name: String(input.name),
    startedAt: String(input.startedAt ?? new Date().toISOString()),
    endedAt: String(input.endedAt ?? new Date().toISOString()),
    durationMs: Number.isFinite(input.durationMs) ? Number(input.durationMs) : 0,
    status: input.status === "error" ? "error" : "ok",
    ...context,
    attributes: prepareTelemetryProperties(
      "span",
      String(input.name),
      (input.attributes ?? {}) as TelemetryProperties
    ),
  };
}

function normalizePersistedError(input: TelemetryErrorRecord): TelemetryErrorRecord | null {
  const context = normalizeContext(input);
  return {
    id: String(input.id ?? createId()),
    timestamp: String(input.timestamp ?? new Date().toISOString()),
    ...context,
    message: redactText(String(input.message ?? "Unknown error")).slice(0, MAX_STRING_LENGTH),
    stack: input.stack ? redactText(String(input.stack)).slice(0, 1_500) : undefined,
    context: prepareTelemetryProperties(
      "error",
      "error.captured",
      (input.context ?? {}) as TelemetryProperties
    ),
  };
}

function normalizePersistedMetrics(input: unknown): Record<string, TelemetryMetricSample[]> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const output: Record<string, TelemetryMetricSample[]> = {};
  for (const [key, values] of Object.entries(input)) {
    if (!Array.isArray(values)) continue;
    const metricName = key.replace(/_/g, ".");
    const normalizedKey = normalizeMetricKey(key);
    const samples = values
      .map((value): TelemetryMetricSample | null => {
        if (typeof value === "number" && Number.isFinite(value)) {
          return {
            ...createTelemetryContext(),
            value,
            timestamp: new Date().toISOString(),
            properties: {},
          };
        }
        if (!value || typeof value !== "object") return null;
        const raw = value as Partial<TelemetryMetricSample>;
        if (!Number.isFinite(raw.value)) return null;
        return {
          ...normalizeContext(raw),
          value: Number(raw.value),
          timestamp: String(raw.timestamp ?? new Date().toISOString()),
          properties: sanitizeTelemetryProperties((raw.properties ?? {}) as TelemetryProperties),
        };
      })
      .filter(isPresent)
      .slice(-settings.maxEvents);
    if (samples.length > 0 && (getTelemetryCatalogEntry("metric", metricName) || getTelemetryCatalogEntry("metric", key))) {
      output[normalizedKey] = samples;
    }
  }
  return output;
}

function normalizeContext(input: Partial<TelemetryContext>): TelemetryContext {
  const fallback = createTelemetryContext();
  const traceId = isTraceId(input.traceId) ? String(input.traceId) : fallback.traceId;
  const spanId = isSpanId(input.spanId) ? String(input.spanId) : fallback.spanId;
  const parentSpanId = isSpanId(input.parentSpanId) ? String(input.parentSpanId) : undefined;
  return {
    runtimeSessionId: String(input.runtimeSessionId ?? runtimeSessionId),
    traceId,
    spanId,
    parentSpanId,
    traceparent: `00-${traceId}-${spanId}-01`,
  };
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function isTraceId(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value);
}

function isSpanId(value: unknown): boolean {
  return typeof value === "string" && /^[0-9a-f]{16}$/.test(value);
}

function appendNativeRecord(
  kind: TelemetryRecordKind,
  name: string,
  timestamp: string,
  context: TelemetryContext,
  payload: TelemetryProperties
): void {
  const record: NativeObservabilityRecord = {
    kind,
    name,
    timestamp,
    runtime_session_id: context.runtimeSessionId,
    trace_id: context.traceId,
    span_id: context.spanId,
    parent_span_id: context.parentSpanId,
    payload,
  };
  void invokeTauri<void>("observability_append", { record })
    .then(() => {
      nativeStoreStatus = "ready";
      nativeRecordCount++;
    })
    .catch(() => {
      nativeStoreStatus = "unavailable";
    });
}

async function readNativeDiagnosticsSnapshot(limit: number): Promise<NativeObservabilitySnapshot | null> {
  try {
    const snapshot = await invokeTauri<NativeObservabilitySnapshot>("observability_snapshot", { limit });
    nativeStoreStatus = snapshot.status ?? "ready";
    nativeRecordCount = Number(snapshot.record_count ?? nativeRecordCount);
    return snapshot;
  } catch {
    nativeStoreStatus = "unavailable";
    return null;
  }
}

async function invokeTauri<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const tauri = await import("@tauri-apps/api/core");
  return tauri.invoke<T>(command, args);
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function createHexId(bytes: number): string {
  const array = new Uint8Array(bytes);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(array)
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function nowMs(): number {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}
