import { describe, expect, it } from "vitest";
import {
  assemblyAILiveWords,
  assemblyAITranscriptText,
  createAssemblyAITranscriptState,
  reduceAssemblyAIStreamingMessage,
} from "../lib/assemblyAIStreaming";

describe("AssemblyAI streaming message reducer", () => {
  it("reads current v3 Turn transcript language metadata", () => {
    const state = reduceAssemblyAIStreamingMessage(
      createAssemblyAITranscriptState(),
      JSON.stringify({
        type: "Turn",
        turn_order: 0,
        end_of_turn: true,
        transcript: "Buenos dias",
        utterance: "Buenos dias.",
        language_code: "es",
        language_confidence: 0.997,
      })
    );

    expect(assemblyAITranscriptText(state)).toBe("Buenos dias");
    expect(state.detectedLanguageCode).toBe("es");
    expect(state.languageConfidence).toBeCloseTo(0.997);
  });

  it("keeps compatibility with legacy partial and final transcript payloads", () => {
    const partial = reduceAssemblyAIStreamingMessage(
      createAssemblyAITranscriptState(),
      JSON.stringify({ message_type: "PartialTranscript", text: "hello" })
    );
    const final = reduceAssemblyAIStreamingMessage(
      partial,
      JSON.stringify({ message_type: "FinalTranscript", text: "hello world" })
    );

    expect(assemblyAITranscriptText(partial)).toBe("hello");
    expect(assemblyAITranscriptText(final)).toBe("hello world");
  });

  it("captures word-level confidence from in-progress Turn messages", () => {
    const partial = reduceAssemblyAIStreamingMessage(
      createAssemblyAITranscriptState(),
      JSON.stringify({
        type: "Turn",
        turn_order: 0,
        end_of_turn: false,
        transcript: "open the file",
        words: [
          { text: "open", confidence: 0.97, word_is_final: false },
          { text: "the", confidence: 0.92, word_is_final: false },
          { text: "file", confidence: 0.45, word_is_final: false },
        ],
      })
    );
    const live = assemblyAILiveWords(partial);
    expect(live).toHaveLength(3);
    expect(live[0]).toEqual({ text: "open", confidence: 0.97, isFinal: false });
    expect(live[2].confidence).toBeCloseTo(0.45);
  });

  it("appends finalized words to committedWords on end_of_turn", () => {
    const turnA = reduceAssemblyAIStreamingMessage(
      createAssemblyAITranscriptState(),
      JSON.stringify({
        type: "Turn",
        turn_order: 0,
        end_of_turn: true,
        transcript: "hello world",
        words: [
          { text: "hello", confidence: 0.95, word_is_final: true },
          { text: "world", confidence: 0.88, word_is_final: true },
        ],
      })
    );
    expect(turnA.committedWords).toHaveLength(2);
    expect(turnA.committedWords[0].isFinal).toBe(true);
    expect(turnA.liveWords).toEqual([]);

    const turnB = reduceAssemblyAIStreamingMessage(
      turnA,
      JSON.stringify({
        type: "Turn",
        turn_order: 1,
        end_of_turn: false,
        transcript: "again",
        words: [{ text: "again", confidence: 0.6, word_is_final: false }],
      })
    );
    const live = assemblyAILiveWords(turnB);
    // 2 committed + 1 live = 3
    expect(live).toHaveLength(3);
    expect(live[2]).toEqual({ text: "again", confidence: 0.6, isFinal: false });
  });

  it("clamps invalid confidences into the [0, 1] interval", () => {
    const state = reduceAssemblyAIStreamingMessage(
      createAssemblyAITranscriptState(),
      JSON.stringify({
        type: "Turn",
        end_of_turn: false,
        transcript: "x y",
        words: [
          { text: "x", confidence: 1.7 },
          { text: "y", confidence: -0.3 },
        ],
      })
    );
    expect(state.liveWords[0].confidence).toBe(1);
    expect(state.liveWords[1].confidence).toBe(0);
  });

  it("synthesizes word entries when the API omits the words array", () => {
    const state = reduceAssemblyAIStreamingMessage(
      createAssemblyAITranscriptState(),
      JSON.stringify({
        type: "Turn",
        end_of_turn: false,
        transcript: "no words array",
      })
    );
    expect(state.liveWords).toHaveLength(3);
    expect(state.liveWords[0]).toEqual({ text: "no", confidence: null, isFinal: false });
  });
});
