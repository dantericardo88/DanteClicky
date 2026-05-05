import { create } from "zustand";
import { persist } from "zustand/middleware";

export type VoiceState = "idle" | "listening" | "processing" | "responding";
export type ProviderType = "claude" | "openai" | "grok";

export interface ModelOption {
  provider: ProviderType;
  modelId: string;
  displayName: string;
  supportsVision: boolean;
}

export const MODEL_OPTIONS: ModelOption[] = [
  { provider: "claude", modelId: "claude-sonnet-4-6",         displayName: "Claude Sonnet 4.6", supportsVision: true },
  { provider: "claude", modelId: "claude-opus-4-7",           displayName: "Claude Opus 4.7",   supportsVision: true },
  { provider: "claude", modelId: "claude-haiku-4-5-20251001", displayName: "Claude Haiku 4.5",  supportsVision: true },
  { provider: "openai", modelId: "gpt-4o",                    displayName: "GPT-4o",            supportsVision: true },
  { provider: "openai", modelId: "o3",                        displayName: "OpenAI o3",         supportsVision: true },
  { provider: "grok",   modelId: "grok-2-vision-1212",        displayName: "Grok 2 Vision",     supportsVision: true },
  { provider: "grok",   modelId: "grok-3",                    displayName: "Grok 3",            supportsVision: false },
];

export interface ConversationTurn {
  userPrompt: string;
  assistantResponse: string;
}

interface CompanionState {
  // Runtime state (not persisted)
  voiceState: VoiceState;
  transcript: string;
  response: string;
  conversationHistory: ConversationTurn[];
  lastError: string;
  latencyMs: number | null;
  lastResponseMs: number | null;

  // User settings (persisted to localStorage)
  selectedModel: ModelOption;
  anthropicKey: string;
  openaiKey: string;
  grokKey: string;
  elevenLabsKey: string;
  assemblyAiKey: string;
  hotkeyBinding: string;
  hotkeyCombo: string;

  // TTS mode (persisted to localStorage)
  ttsMode: "cloud" | "local";

  // Memory (persisted to localStorage)
  conversationSummary: string;
  sessionNotes: string;

  // Actions
  setLatencyMs: (ms: number) => void;
  clearLatency: () => void;
  setVoiceState: (state: VoiceState) => void;
  setTtsMode: (mode: "cloud" | "local") => void;
  setSelectedModel: (model: ModelOption) => void;
  setTranscript: (text: string) => void;
  setResponse: (text: string) => void;
  appendResponse: (chunk: string) => void;
  pushConversationTurn: (turn: ConversationTurn) => void;
  clearConversation: () => void;
  trimConversationHistory: (turns: ConversationTurn[]) => void;
  setApiKey: (provider: "anthropic" | "openai" | "grok" | "elevenLabs" | "assemblyAi", key: string) => void;
  setError: (msg: string) => void;
  clearError: () => void;
  setHotkeyBinding: (binding: string) => void;
  setHotkeyCombo: (combo: string) => void;
  setConversationSummary: (summary: string) => void;
  setSessionNotes: (notes: string) => void;
}

export const useCompanionStore = create<CompanionState>()(
  persist(
    (set) => ({
      voiceState: "idle",
      transcript: "",
      response: "",
      conversationHistory: [],
      lastError: "",
      latencyMs: null,
      lastResponseMs: null,
      selectedModel: MODEL_OPTIONS[0],
      anthropicKey: "",
      openaiKey: "",
      grokKey: "",
      elevenLabsKey: "",
      assemblyAiKey: "",
      hotkeyBinding: "Ctrl+Alt+Space",
      hotkeyCombo: "ctrl+alt+space",
      ttsMode: "cloud" as const,
      conversationSummary: "",
      sessionNotes: "",

      setLatencyMs: (ms) => set({ latencyMs: ms, lastResponseMs: ms }),
      clearLatency: () => set({ latencyMs: null }),
      setVoiceState: (voiceState) => set({ voiceState }),
      setTtsMode: (ttsMode) => set({ ttsMode }),
      setSelectedModel: (selectedModel) => set({ selectedModel }),
      setTranscript: (transcript) => set({ transcript }),
      setResponse: (response) => set({ response }),
      appendResponse: (chunk) => set((s) => ({ response: s.response + chunk })),
      pushConversationTurn: (turn) =>
        set((s) => ({ conversationHistory: [...s.conversationHistory, turn] })),
      clearConversation: () =>
        set({ conversationHistory: [], transcript: "", response: "" }),
      trimConversationHistory: (turns) => set({ conversationHistory: turns }),
      setApiKey: (provider, key) => {
        const field = {
          anthropic: "anthropicKey",
          openai: "openaiKey",
          grok: "grokKey",
          elevenLabs: "elevenLabsKey",
          assemblyAi: "assemblyAiKey",
        }[provider] as keyof CompanionState;
        set({ [field]: key } as Partial<CompanionState>);
      },
      setError: (msg) => set({ lastError: msg }),
      clearError: () => set({ lastError: "" }),
      setHotkeyBinding: (binding) => set({ hotkeyBinding: binding }),
      setHotkeyCombo: (combo) => set({ hotkeyCombo: combo }),
      setConversationSummary: (conversationSummary) => set({ conversationSummary }),
      setSessionNotes: (sessionNotes) => set({ sessionNotes }),
    }),
    {
      name: "dante-clicky-settings",
      // Only persist user settings and memory, not transient voice state
      partialize: (s) => ({
        selectedModel: s.selectedModel,
        anthropicKey: s.anthropicKey,
        openaiKey: s.openaiKey,
        grokKey: s.grokKey,
        elevenLabsKey: s.elevenLabsKey,
        assemblyAiKey: s.assemblyAiKey,
        hotkeyBinding: s.hotkeyBinding,
        hotkeyCombo: s.hotkeyCombo,
        ttsMode: s.ttsMode,
        conversationSummary: s.conversationSummary,
        sessionNotes: s.sessionNotes,
      }),
    }
  )
);
