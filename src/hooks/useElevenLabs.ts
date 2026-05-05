import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useCompanionStore } from "../state/companionStore";

// Port of ElevenLabsTTSClient.swift
// Fetches MP3 audio via Rust (bypasses CORS) and plays via Web Audio API.
// New: sentence-queue mode — prefetches each sentence in parallel and plays
// them back-to-back, so audio starts as soon as the first sentence is ready.
// Dimension 4: when ttsMode === "local", tries Kokoro ONNX first, falls back to cloud.

const VOICE_ID = "21m00Tcm4TlvDq8ikWAM";

export function useElevenLabs(elevenLabsKey: string) {
  const audioCtxRef = useRef<AudioContext | null>(null);
  // Queue of prefetch promises; each resolves to an AudioBuffer (or null on error)
  const queueRef = useRef<Promise<AudioBuffer | null>[]>([]);
  const playingRef = useRef(false);
  const stoppedRef = useRef(false);

  const warmUp = useCallback((): void => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
      if (audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume().catch(() => {});
      }
    }
    stoppedRef.current = false;
  }, []);

  function getCtx(): AudioContext {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
    }
    return audioCtxRef.current;
  }

  async function fetchAudio(text: string): Promise<AudioBuffer | null> {
    if (!text.trim()) return null;

    const { ttsMode } = useCompanionStore.getState();

    // Dimension 4: try local Kokoro TTS first when in local mode
    if (ttsMode === "local") {
      try {
        const audioBytes = await invoke<number[]>("kokoro_tts", { text });
        const ctx = getCtx();
        return await ctx.decodeAudioData(new Uint8Array(audioBytes).buffer);
      } catch (e) {
        console.warn("[TTS] Local Kokoro failed, falling back to cloud:", e);
        // Fall through to ElevenLabs cloud
      }
    }

    if (!elevenLabsKey) return null;
    try {
      const bytes = await invoke<number[]>("elevenlabs_tts", {
        apiKey: elevenLabsKey,
        text,
        voiceId: VOICE_ID,
      });
      const ctx = getCtx();
      return await ctx.decodeAudioData(new Uint8Array(bytes).buffer);
    } catch (err) {
      console.error("[ElevenLabs] fetchAudio failed:", err);
      return null;
    }
  }

  // Drain the queue: play each buffer in order, prefetch happens in parallel.
  async function drainQueue() {
    if (playingRef.current) return;
    playingRef.current = true;
    while (queueRef.current.length > 0 && !stoppedRef.current) {
      const bufferPromise = queueRef.current.shift()!;
      const buffer = await bufferPromise;
      if (!buffer || stoppedRef.current) continue;
      await new Promise<void>((resolve) => {
        const ctx = getCtx();
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => resolve();
        source.start(0);
      });
    }
    playingRef.current = false;
  }

  // Queue one sentence for playback. Starts prefetching immediately.
  // Call drainQueue() once to kick off playback if not already running.
  const queueSentence = useCallback(
    (text: string): void => {
      if (!elevenLabsKey || !text.trim()) return;
      queueRef.current.push(fetchAudio(text));
      // drainQueue is idempotent — safe to call on every sentence
      drainQueue();
    },
    [elevenLabsKey]
  );

  // Convenience: split full text into sentences and queue all of them.
  const speak = useCallback(
    (text: string): void => {
      if (!elevenLabsKey || !text.trim()) return;
      stoppedRef.current = false;
      const sentences = splitSentences(text);
      for (const s of sentences) {
        queueRef.current.push(fetchAudio(s));
      }
      drainQueue();
    },
    [elevenLabsKey]
  );

  const stop = useCallback(() => {
    stoppedRef.current = true;
    queueRef.current = [];
    playingRef.current = false;
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
  }, []);

  return { speak, stop, warmUp, queueSentence };
}

// Split text into natural TTS sentences at `.`, `!`, `?` boundaries.
// Keeps the punctuation with its sentence. Skips empty fragments.
function splitSentences(text: string): string[] {
  const raw = text.split(/(?<=[.!?])\s+/);
  return raw.map((s) => s.trim()).filter((s) => s.length > 0);
}
