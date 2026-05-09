import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  assemblyAILanguageDetection,
  assemblyAILiveWords,
  assemblyAITranscriptText,
  createAssemblyAITranscriptState,
  reduceAssemblyAIStreamingMessage,
  type AssemblyAILanguageDetection,
  type AssemblyAITranscriptState,
  type AssemblyAIWord,
} from "../lib/assemblyAIStreaming";
import { buildAssemblyAIStreamingUrl, type SpeechLanguageCode } from "../lib/speechLanguages";
import { captureTelemetryError, recordTelemetryEvent, startTelemetrySpan } from "../lib/telemetry";

// Port of AssemblyAIStreamingTranscriptionProvider.swift
// WebSocket protocol: binary PCM audio → JSON transcript messages

export interface AssemblyAIConnectOptions {
  /** Hotwords / domain vocabulary biasing recognition. Up to 1,000 terms. */
  keyterms?: readonly string[] | null;
  /** AssemblyAI smart formatting. Default true. */
  formatText?: boolean;
  /** Preserve disfluencies. Default false (cleaned for dictation). */
  preserveDisfluencies?: boolean;
}

export function useAssemblyAI(assemblyAiKey: string, languageCode: SpeechLanguageCode = "auto") {
  const wsRef = useRef<WebSocket | null>(null);
  const transcriptStateRef = useRef<AssemblyAITranscriptState>(createAssemblyAITranscriptState());
  const lastLanguageDetectionRef = useRef<AssemblyAILanguageDetection | null>(null);
  const preWarmSampleRateRef = useRef<number>(44100);
  const preWarmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKeytermsRef = useRef<readonly string[] | null>(null);

  // TOKEN_TTL_MS: AssemblyAI tokens expire in 480s. Refresh 60s early to always
  // have a live socket ready when the user presses PTT.
  const TOKEN_TTL_MS = (480 - 60) * 1000;

  const preWarm = useCallback(
    async (sampleRate = 44100): Promise<void> => {
      if (!assemblyAiKey) return;
      preWarmSampleRateRef.current = sampleRate;

      // Tear down any existing socket and scheduled refresh before opening a fresh one
      if (preWarmTimerRef.current) {
        clearTimeout(preWarmTimerRef.current);
        preWarmTimerRef.current = null;
      }
      if (wsRef.current && wsRef.current.readyState !== WebSocket.CLOSED) {
        wsRef.current.close();
        wsRef.current = null;
      }

      try {
        const token = await invoke<string>("get_assemblyai_token", { apiKey: assemblyAiKey });
        const url = buildAssemblyAIStreamingUrl({
          token,
          sampleRate,
          languageCode,
          keyterms: lastKeytermsRef.current,
          formatText: true,
        });
        const ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";
        transcriptStateRef.current = createAssemblyAITranscriptState();
        lastLanguageDetectionRef.current = null;
        ws.onmessage = (event) => {
          if (typeof event.data !== "string") return;
          transcriptStateRef.current = reduceAssemblyAIStreamingMessage(transcriptStateRef.current, event.data);
        };
        ws.onerror = () => { wsRef.current = null; };
        wsRef.current = ws;

        // Schedule a token refresh before it expires so PTT is always instant
        preWarmTimerRef.current = setTimeout(() => {
          preWarm(preWarmSampleRateRef.current).catch(() => {});
        }, TOKEN_TTL_MS);
      } catch { /* silently ignore pre-warm failures — connect() will open fresh */ }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [assemblyAiKey, languageCode]
  );

  const setKeyterms = useCallback((keyterms: readonly string[] | null): void => {
    lastKeytermsRef.current = keyterms ?? null;
  }, []);

  const connect = useCallback(
    async (sampleRate: number, options?: AssemblyAIConnectOptions): Promise<void> => {
      const requestedKeyterms = options?.keyterms ?? lastKeytermsRef.current ?? null;
      if (options?.keyterms !== undefined) {
        lastKeytermsRef.current = options.keyterms ?? null;
      }
      const keytermsChanged =
        keytermsListEquals(requestedKeyterms, lastKeytermsRef.current) === false;

      // Reuse pre-warmed connection if sample rate matches and socket is live
      // AND the keyterms list has not changed since the pre-warm (otherwise the
      // pre-warmed URL no longer reflects the current vocabulary).
      if (
        wsRef.current &&
        wsRef.current.readyState === WebSocket.OPEN &&
        preWarmSampleRateRef.current === sampleRate &&
        !keytermsChanged
      ) {
        transcriptStateRef.current = createAssemblyAITranscriptState();
        lastLanguageDetectionRef.current = null;
        recordTelemetryEvent("stt.assemblyai.reused_prewarm", { languageCode, sampleRate });
        return;
      }

      const span = startTelemetrySpan("stt.assemblyai_connect", { languageCode, sampleRate });
      try {
        // Fetch short-lived token via Rust (bypasses CORS)
        const token = await invoke<string>("get_assemblyai_token", { apiKey: assemblyAiKey });

        const url = buildAssemblyAIStreamingUrl({
          token,
          sampleRate,
          languageCode,
          keyterms: requestedKeyterms,
          formatText: options?.formatText !== false,
          preserveDisfluencies: options?.preserveDisfluencies === true,
        });
        const ws = new WebSocket(url);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;
        transcriptStateRef.current = createAssemblyAITranscriptState();
        lastLanguageDetectionRef.current = null;

        ws.onmessage = (event) => {
          if (typeof event.data !== "string") return;
          transcriptStateRef.current = reduceAssemblyAIStreamingMessage(transcriptStateRef.current, event.data);
        };

        ws.onerror = (e) => console.error("[AssemblyAI] WebSocket error:", e);

        await new Promise<void>((resolve, reject) => {
          ws.onopen = () => resolve();
          ws.onerror = (e) => reject(e);
          setTimeout(() => reject(new Error("AssemblyAI connect timeout")), 8000);
        });
        span.end();
      } catch (err) {
        captureTelemetryError(err, { route: "assemblyai.connect", languageCode });
        span.fail(err);
        throw err;
      }
    },
    [assemblyAiKey, languageCode]
  );

  // Send raw PCM16LE bytes decoded from Tauri's base64 event payload
  const sendChunk = useCallback((base64Pcm: string): void => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const binary = atob(base64Pcm);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    ws.send(bytes.buffer);
  }, []);

  const disconnect = useCallback((): string => {
    wsRef.current?.close();
    wsRef.current = null;
    const transcript = assemblyAITranscriptText(transcriptStateRef.current);
    lastLanguageDetectionRef.current = assemblyAILanguageDetection(transcriptStateRef.current);
    recordTelemetryEvent("stt.assemblyai.disconnected", {
      transcriptLengthBucket: transcript.length < 100 ? "<100" : transcript.length < 1_000 ? "100-1k" : "1k+",
      detectedLanguage: lastLanguageDetectionRef.current?.languageCode ?? "unknown",
      hasConfidence: typeof lastLanguageDetectionRef.current?.confidence === "number",
    });
    transcriptStateRef.current = createAssemblyAITranscriptState();
    return transcript;
  }, []);

  const getLastLanguageDetection = useCallback(
    (): AssemblyAILanguageDetection | null => lastLanguageDetectionRef.current,
    []
  );

  /// Snapshot of the live words for the current utterance, including
  /// already-finalized words from earlier turns in this session. Returns an
  /// empty array when no socket is open. Confidence-styled UI consumes this.
  const getLiveWords = useCallback((): AssemblyAIWord[] => {
    return assemblyAILiveWords(transcriptStateRef.current);
  }, []);

  return {
    connect,
    sendChunk,
    disconnect,
    preWarm,
    getLastLanguageDetection,
    setKeyterms,
    getLiveWords,
  };
}

function keytermsListEquals(
  a: readonly string[] | null,
  b: readonly string[] | null,
): boolean {
  if (a === b) return true;
  if (!a || !b) return !a && !b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
