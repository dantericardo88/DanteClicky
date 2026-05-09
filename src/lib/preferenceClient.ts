import { invoke } from "@tauri-apps/api/core";

export type PreferenceLearningGates = {
  memoryEnabled: boolean;
  preferenceLearningEnabled: boolean;
  incognitoMode: boolean;
};

export type PreferenceFeedbackEvent = {
  signal: string;
  reason?: string;
  rawText?: string;
  idempotencyKey?: string;
};

export type PreferenceTurnRef = {
  id?: number;
  clientTurnId?: string;
};

export type RecordPreferenceEventInput = {
  turnId: number;
  signal: string;
  reason?: string;
  rawText?: string;
  idempotencyKey?: string;
};

export type PreferenceFeedbackRecorder = {
  record: (input: RecordPreferenceEventInput) => Promise<number | void>;
};

export function shouldUsePreferenceLearning(gates: PreferenceLearningGates): boolean {
  return gates.memoryEnabled && gates.preferenceLearningEnabled && !gates.incognitoMode;
}

export function createClientTurnId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `turn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultRecordPreferenceEvent(input: RecordPreferenceEventInput): Promise<number> {
  return invoke<number>("record_preference_event", {
    turnId: input.turnId,
    signal: input.signal,
    reason: input.reason ?? null,
    rawText: input.rawText ?? null,
    idempotencyKey: input.idempotencyKey ?? null,
  });
}

export function createPreferenceFeedbackQueue(opts: PreferenceFeedbackRecorder = { record: defaultRecordPreferenceEvent }) {
  const record = opts.record ?? defaultRecordPreferenceEvent;
  const pending = new Map<string, PreferenceFeedbackEvent[]>();

  async function recordForTurn(
    turn: PreferenceTurnRef,
    event: PreferenceFeedbackEvent,
    gates: PreferenceLearningGates
  ): Promise<void> {
    if (!shouldUsePreferenceLearning(gates)) return;
    if (turn.id) {
      await record({
        turnId: turn.id,
        ...event,
        idempotencyKey: event.idempotencyKey ?? buildIdempotencyKey(turn.clientTurnId ?? `db-${turn.id}`, event),
      });
      return;
    }
    if (!turn.clientTurnId) return;
    const queued = pending.get(turn.clientTurnId) ?? [];
    queued.push(event);
    pending.set(turn.clientTurnId, queued);
  }

  async function flushTurnId(
    clientTurnId: string,
    turnId: number,
    gates?: PreferenceLearningGates
  ): Promise<void> {
    const queued = pending.get(clientTurnId);
    if (!queued?.length) return;
    pending.delete(clientTurnId);
    if (gates && !shouldUsePreferenceLearning(gates)) return;
    for (const event of queued) {
      await record({
        turnId,
        ...event,
        idempotencyKey: event.idempotencyKey ?? buildIdempotencyKey(clientTurnId, event),
      });
    }
  }

  function clear(clientTurnId?: string) {
    if (clientTurnId) pending.delete(clientTurnId);
    else pending.clear();
  }

  return { recordForTurn, flushTurnId, clear };
}

export const preferenceFeedbackQueue = createPreferenceFeedbackQueue();

function buildIdempotencyKey(clientTurnId: string, event: PreferenceFeedbackEvent): string {
  const raw = `${clientTurnId}:${event.signal}:${event.reason ?? ""}:${event.rawText ?? ""}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) {
    hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return `${clientTurnId}:${event.signal}:${hash.toString(16)}`;
}
