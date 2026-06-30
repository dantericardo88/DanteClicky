import { useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

// Port of AssemblyAIStreamingTranscriptionProvider.swift
// WebSocket protocol: binary PCM audio → JSON transcript messages

const WS_BASE = "wss://streaming.assemblyai.com/v3/ws";

interface AssemblyMessage {
  message_type:
    | "SessionBegins"
    | "PartialTranscript"
    | "FinalTranscript"
    | "SessionTerminated"
    | "Error";
  text?: string;
  session_id?: string;
}

export function useAssemblyAI(assemblyAiKey: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const partialRef = useRef<string>("");
  const finalRef = useRef<string>("");

  const connect = useCallback(
    async (sampleRate: number): Promise<void> => {
      // Fetch short-lived token via Rust (bypasses CORS)
      const token = await invoke<string>("get_assemblyai_token", { apiKey: assemblyAiKey });

      const url = `${WS_BASE}?token=${token}&sample_rate=${sampleRate}&encoding=pcm_s16le`;
      const ws = new WebSocket(url);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;
      partialRef.current = "";
      finalRef.current = "";

      ws.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        try {
          const msg: AssemblyMessage = JSON.parse(event.data);
          if (msg.message_type === "PartialTranscript" && msg.text) {
            partialRef.current = msg.text;
          } else if (msg.message_type === "FinalTranscript" && msg.text) {
            finalRef.current += (finalRef.current ? " " : "") + msg.text;
            partialRef.current = "";
          }
        } catch (e) {
          console.error("[AssemblyAI] parse error:", e);
        }
      };

      ws.onerror = (e) => console.error("[AssemblyAI] WebSocket error:", e);

      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = (e) => reject(e);
        setTimeout(() => reject(new Error("AssemblyAI connect timeout")), 8000);
      });
    },
    [assemblyAiKey]
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
    const transcript = [finalRef.current, partialRef.current]
      .filter(Boolean)
      .join(" ")
      .trim();
    partialRef.current = "";
    finalRef.current = "";
    return transcript;
  }, []);

  return { connect, sendChunk, disconnect };
}
