import { useEffect, useCallback, useRef, useState } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useCompanionStore } from "../state/companionStore";
import { useAssemblyAI } from "./useAssemblyAI";
import { useElevenLabs } from "./useElevenLabs";
import { captureAllScreens, sortScreens } from "./useScreenCapture";
import { streamChat } from "../providers/chat";
import { parsePoints, denormalize, stripPoints } from "../providers/pointParser";
import { assembleRichContext } from "../lib/screenpipe";
import { verifyAction } from "../lib/actionVerifier";
import { summarizeOldTurns } from "../lib/memorySummarizer";

// Orchestrates the full push-to-talk pipeline:
// hotkey-down → mic on + STT → hotkey-up → screenshot → AI stream → TTS → cursor → idle
// STT backend is selected by the current sttMode:
//   Cloud → AssemblyAI WebSocket real-time
//   Local → whisper-rs offline (transcribe_local Tauri command)

export function useVoice() {
  const {
    selectedModel,
    anthropicKey,
    openaiKey,
    grokKey,
    elevenLabsKey,
    assemblyAiKey,
    setVoiceState,
    setTranscript,
    setResponse,
    appendResponse,
    pushConversationTurn,
    trimConversationHistory,
    conversationHistory,
    conversationSummary,
    sessionNotes,
    setConversationSummary,
    setError,
    clearError,
  } = useCompanionStore();

  const sampleRateRef = useRef<number>(44100);
  const assemblyAI = useAssemblyAI(assemblyAiKey);
  const elevenLabs = useElevenLabs(elevenLabsKey);

  // Track which STT backend is active; sync from Rust on mount
  const [sttMode, setSttMode] = useState<"Cloud" | "Local">("Cloud");

  useEffect(() => {
    invoke<{ mode: string }>("get_stt_mode")
      .then(({ mode }) => {
        setSttMode(mode as "Cloud" | "Local");
      })
      .catch(() => {});
  }, []);

  // Forward audio chunks to AssemblyAI only in Cloud mode
  useEffect(() => {
    const unlisten = listen<[string, number]>("audio-chunk", (event) => {
      const [base64, sr] = event.payload;
      sampleRateRef.current = sr;
      if (sttMode === "Cloud") {
        assemblyAI.sendChunk(base64);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, [assemblyAI, sttMode]);

  const handleHotkeyDown = useCallback(async () => {
    elevenLabs.warmUp(); // pre-warm AudioContext before mic starts

    // Clear any previous error at the start of each new session
    clearError();

    const apiKey =
      selectedModel.provider === "claude"
        ? anthropicKey
        : selectedModel.provider === "grok"
        ? grokKey
        : openaiKey;
    if (!apiKey) {
      setError(`No API key for ${selectedModel.provider} — open Settings ⚙`);
      return;
    }
    setVoiceState("listening");
    setTranscript("");
    setResponse("");

    try {
      // Cloud mode: open AssemblyAI WebSocket before starting mic
      if (sttMode === "Cloud") {
        await assemblyAI.connect(sampleRateRef.current);
      }
      await invoke("start_audio");
    } catch (err) {
      console.error("[useVoice] Failed to start voice pipeline:", err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("401") || msg.toLowerCase().includes("unauthorized") || msg.toLowerCase().includes("assemblyai")) {
        setError("AssemblyAI connection failed: check your AssemblyAI key");
      } else {
        setError(`Failed to start microphone: ${msg.slice(0, 100)}`);
      }
      setVoiceState("idle");
    }
  }, [
    anthropicKey,
    openaiKey,
    grokKey,
    selectedModel,
    assemblyAI,
    elevenLabs,
    sttMode,
    setVoiceState,
    setTranscript,
    setResponse,
    setError,
    clearError,
  ]);

  const handleHotkeyUp = useCallback(async () => {
    await invoke("stop_audio");

    let transcript: string;

    if (sttMode === "Cloud") {
      setVoiceState("processing");
      transcript = assemblyAI.disconnect();
    } else {
      // Local mode: run Whisper on the accumulated PCM buffer
      setVoiceState("processing");
      try {
        transcript = await invoke<string>("transcribe_local");
      } catch (err) {
        console.error("[useVoice] Local transcription failed:", err);
        const msg = err instanceof Error ? err.message : String(err);
        setResponse(`Whisper error: ${msg.slice(0, 120)}`);
        setVoiceState("responding");
        invoke("show_overlay").catch(() => {});
        setTimeout(() => {
          setVoiceState("idle");
          invoke("hide_overlay");
        }, 5000);
        return;
      }
    }

    setTranscript(transcript);

    if (!transcript.trim()) {
      setVoiceState("idle");
      return;
    }

    try {
      const screens = await captureAllScreens();
      const sorted = sortScreens(screens);
      const primaryScreen = sorted[0];
      const images = sorted.map((s) => s.data);

      setVoiceState("responding");
      await invoke("show_overlay");

      // Enrich the system prompt with Screenpipe screen memory.
      // Silently ignored if Screenpipe is not running.
      let memoryContext = "";
      try {
        memoryContext = await assembleRichContext(transcript, images);
      } catch {
        // Screenpipe unavailable — continue without memory context
      }

      let fullResponse = "";
      // Sentence-pipelining: flush TTS as each sentence arrives rather than waiting
      // for the full response. Sentence boundaries: [.!?] followed by whitespace.
      let sentenceBuffer = "";
      const SENTENCE_END = /[.!?]\s/;

      function flushSentence(text: string) {
        const clean = stripPoints(text).trim();
        if (clean) elevenLabs.queueSentence(clean);
      }

      await streamChat({
        provider: selectedModel.provider,
        modelId: selectedModel.modelId,
        systemPrompt: buildSystemPrompt({ memoryContext, conversationSummary, sessionNotes }),
        messages: [
          ...conversationHistory.flatMap((t) => [
            { role: "user" as const, content: t.userPrompt },
            { role: "assistant" as const, content: t.assistantResponse },
          ]),
          { role: "user", content: transcript },
        ],
        images: selectedModel.supportsVision ? images : [],
        onChunk: (chunk) => {
          appendResponse(chunk);
          fullResponse += chunk;
          sentenceBuffer += chunk;
          // Drain all complete sentences from the buffer
          let idx = sentenceBuffer.search(SENTENCE_END);
          while (idx !== -1) {
            flushSentence(sentenceBuffer.slice(0, idx + 1));
            sentenceBuffer = sentenceBuffer.slice(idx + 2);
            idx = sentenceBuffer.search(SENTENCE_END);
          }
        },
      });

      // Store clean text in history (no [POINT:] tags)
      pushConversationTurn({
        userPrompt: transcript,
        assistantResponse: stripPoints(fullResponse),
      });

      // Auto-summarize if history is getting long
      if (conversationHistory.length >= 10) {
        const toSummarize = conversationHistory.slice(0, 7);
        const remaining = conversationHistory.slice(7);
        // Background summarization — non-blocking
        summarizeOldTurns(toSummarize, !!anthropicKey).then((summary) => {
          if (summary) {
            setConversationSummary(
              (conversationSummary ? conversationSummary + "\n\n" : "") + summary
            );
            trimConversationHistory(remaining);
          }
        });
      }

      // Animate cursor to the first annotated UI element, then click and verify
      if (primaryScreen) {
        const points = parsePoints(fullResponse);
        if (points.length > 0) {
          const { px, py } = denormalize(points[0], primaryScreen.width, primaryScreen.height);

          if (selectedModel.provider === "claude" && anthropicKey) {
            // Action verification loop: capture before → animate → click → capture after → ask AI
            try {
              const beforeShot = await invoke<string>("capture_primary");
              await invoke("animate_cursor_to", { x: px, y: py });
              // Let the cursor animation settle before clicking
              await new Promise<void>((r) => setTimeout(r, 600));
              await invoke("computer_use_click", { x: px, y: py });
              // Brief pause for UI to react before the after-shot
              await new Promise<void>((r) => setTimeout(r, 400));
              const afterShot = await invoke<string>("capture_primary");

              const result = await verifyAction(
                beforeShot,
                afterShot,
                `Click at (${px}, ${py}) — ${points[0].label}`
              );

              await emit("action-verify-result", {
                success: result.success,
                label: points[0].label,
                explanation: result.explanation,
              });
            } catch {
              // Verification is best-effort — never block the user
            }
          } else {
            // Non-Claude provider: just animate, no verification
            invoke("animate_cursor_to", { x: px, y: py }).catch(() => {});
          }
        }
      }

      // Flush any remaining text that didn't end at a sentence boundary
      flushSentence(sentenceBuffer);
    } catch (err) {
      console.error("[useVoice] AI pipeline error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg || "AI request failed");
      setVoiceState("idle");
      return;
    }
    setVoiceState("idle");
    setTimeout(() => invoke("hide_overlay"), 8000);
  }, [
    assemblyAI,
    elevenLabs,
    selectedModel,
    anthropicKey,
    openaiKey,
    grokKey,
    sttMode,
    conversationHistory,
    conversationSummary,
    sessionNotes,
    setVoiceState,
    setTranscript,
    setResponse,
    appendResponse,
    pushConversationTurn,
    trimConversationHistory,
    setConversationSummary,
    setError,
  ]);

  useEffect(() => {
    const unlistenDown = listen("hotkey-pressed", handleHotkeyDown);
    const unlistenUp = listen("hotkey-released", handleHotkeyUp);
    return () => {
      unlistenDown.then((fn) => fn());
      unlistenUp.then((fn) => fn());
    };
  }, [handleHotkeyDown, handleHotkeyUp]);
}

function buildSystemPrompt(opts: {
  memoryContext?: string;
  conversationSummary?: string;
  sessionNotes?: string;
}): string {
  // Voice-first prompt — all responses are spoken aloud via TTS.
  // Ported from the original Clicky macOS companion prompt and adapted for Windows.
  const base = `you're dante clicky, a friendly always-on ai companion that lives in the windows system tray. the user just spoke to you via push-to-talk and you can see their screen(s). your reply will be spoken aloud via text-to-speech, so write the way you'd actually talk. this is an ongoing conversation — you have context from previous exchanges.

rules:
- default to one or two sentences. be direct and dense. BUT if the user asks you to explain more, go deeper, or elaborate, then go all out — give a thorough, detailed explanation with no length limit.
- all lowercase, casual, warm. no emojis.
- write for the ear, not the eye. short sentences. no lists, bullet points, markdown, or formatting — just natural speech.
- don't use abbreviations or symbols that sound weird read aloud. write "for example" not "e.g.", spell out small numbers.
- if the user's question relates to what's on their screen, reference specific things you see.
- if the screenshot doesn't seem relevant to their question, just answer the question directly.
- you can help with anything — coding, writing, general knowledge, brainstorming, computer control.
- never say "simply" or "just".
- don't read out code verbatim. describe what the code does or what needs to change conversationally.
- don't end with dead-end yes/no questions like "want me to explain more?" or "should i show you?".
- instead, when it fits naturally, end by planting a seed — mention something bigger or more ambitious they could try, a related concept that goes deeper, or a next-level technique. it's okay to not end with anything extra if the answer is complete on its own.
- if you receive multiple screen images, the one labeled "primary" is where the cursor is — prioritize it but reference others if relevant.

element pointing:
you have a small animated blue dot that can appear at any location on screen. use it whenever pointing would genuinely help — if the user is asking how to do something, looking for a menu, trying to find a button, or needs help navigating an app. err on the side of pointing rather than not pointing, because it makes your help way more useful and concrete.

don't point when the question is purely conceptual or unrelated to what's on screen, or if you'd just be pointing at something obvious they're already looking at.

when you point, append a coordinate tag at the very end of your response, AFTER your spoken text. use 0–1024 normalized coordinates where (0,0) is top-left and (1024,1024) is bottom-right of the monitor.

format: [POINT:x,y:label:screen1] for the primary monitor. for a second monitor use :screen2, and so on.

if pointing wouldn't help, append [POINT:none:none:screen1].

computer use:
when the user asks you to DO something (click, open an app, type text, navigate somewhere), point at the target element and the system will automatically click there after the cursor animation. be clear about the action: "i'll click the search bar for you" or "i'm opening settings now". always describe what you're about to do before the tag.`;

  let prompt = base;

  if (opts.sessionNotes?.trim()) {
    prompt += `\n\n[things to always remember about this user]\n${opts.sessionNotes.trim()}\n[/things to always remember]`;
  }
  if (opts.conversationSummary?.trim()) {
    prompt += `\n\n[earlier in this conversation]\n${opts.conversationSummary.trim()}\n[/earlier in this conversation]`;
  }
  if (opts.memoryContext?.trim()) {
    prompt += `\n\n[screen memory — what was recently on screen]\n${opts.memoryContext.trim()}\n[/screen memory]`;
  }

  return prompt;
}
