import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

// Port of ElevenLabsTTSClient.swift
// Fetches MP3 audio via Rust (bypasses CORS) and plays via Web Audio API

export function useElevenLabs(elevenLabsKey: string) {
  const audioCtxRef = useRef<AudioContext | null>(null);

  const warmUp = useCallback((): void => {
    if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
      audioCtxRef.current = new AudioContext();
      // Browsers require a user gesture to resume AudioContext
      // Touching it during the hotkey press qualifies
      if (audioCtxRef.current.state === "suspended") {
        audioCtxRef.current.resume().catch(() => {});
      }
    }
  }, []);

  const speak = useCallback(
    async (text: string): Promise<void> => {
      if (!elevenLabsKey || !text.trim()) return;
      try {
        const bytes = await invoke<number[]>("elevenlabs_tts", {
          apiKey: elevenLabsKey,
          text,
          voiceId: "21m00Tcm4TlvDq8ikWAM",
        });
        const arrayBuffer = new Uint8Array(bytes).buffer;
        if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
          audioCtxRef.current = new AudioContext();
        }
        const ctx = audioCtxRef.current;
        const decoded = await ctx.decodeAudioData(arrayBuffer);
        const source = ctx.createBufferSource();
        source.buffer = decoded;
        source.connect(ctx.destination);
        source.start(0);
      } catch (err) {
        console.error("[ElevenLabs] speak failed:", err);
      }
    },
    [elevenLabsKey]
  );

  const stop = useCallback(() => {
    audioCtxRef.current?.close();
    audioCtxRef.current = null;
  }, []);

  return { speak, stop, warmUp };
}
