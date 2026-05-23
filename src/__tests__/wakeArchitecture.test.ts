import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

function readProjectFile(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

describe("wake word / always-on architecture", () => {
  it("persists an opt-in wake mode with runtime status kept out of localStorage", () => {
    const storeSource = readProjectFile("src/state/companionStore.ts");
    const partializeStart = storeSource.indexOf("partialize: (s) => ({");
    const partializeSource = storeSource.slice(partializeStart);

    expect(storeSource).toContain('wakeModeEnabled: false');
    expect(storeSource).toContain('wakePhrase: DEFAULT_WAKE_PHRASE');
    expect(storeSource).toContain('wakeSensitivity: "balanced"');
    expect(storeSource).toContain('wakeStatus: "off"');
    expect(partializeSource).toContain("wakeModeEnabled: s.wakeModeEnabled");
    expect(partializeSource).toContain("wakePhrase: s.wakePhrase");
    expect(partializeSource).toContain("wakeSensitivity: s.wakeSensitivity");
    expect(partializeSource).not.toContain("wakeStatus: s.wakeStatus");
    expect(partializeSource).not.toContain("wakeLastTranscript: s.wakeLastTranscript");
  });

  it("keeps idle always-on audio local and only streams cloud STT during active dictation", () => {
    const voiceSource = readProjectFile("src/hooks/useVoice.ts");
    const audioForwardStart = voiceSource.indexOf("// Forward audio chunks");
    const audioForwardEnd = voiceSource.indexOf("const handleHotkeyDown", audioForwardStart);
    const audioForwardSource = voiceSource.slice(audioForwardStart, audioForwardEnd);

    expect(audioForwardSource).toContain("useCompanionStore.getState()");
    expect(audioForwardSource).toContain('voiceState === "listening"');
    expect(audioForwardSource).toContain("assemblyAI.sendChunk(base64)");
  });

  it("uses native VAD plus local transcription to detect wake phrases before opening a turn", () => {
    const voiceSource = readProjectFile("src/hooks/useVoice.ts");

    expect(voiceSource).toContain("handleWakeSegmentComplete");
    expect(voiceSource).toContain("transcriptContainsWakePhrase");
    expect(voiceSource).toContain('invoke<string>("transcribe_local"');
    expect(voiceSource).toContain('recordTelemetryEvent("wake_word.detected"');
    expect(voiceSource).toContain('recordTelemetryEvent("wake_word.rejected"');
    expect(voiceSource).toContain("startWakeMonitor");
    expect(voiceSource).toContain('voiceState === "idle"');
  });

  it("surfaces wake controls and does not promise no wake word absolutely in onboarding", () => {
    const companionSource = readProjectFile("src/windows/CompanionPanel.tsx");
    const voiceSettingsSource = readProjectFile("src/windows/companion/settings/VoiceAiSettings.tsx");
    const onboardingSource = readProjectFile("src/windows/OnboardingWindow.tsx");

    // Wake state flows through CompanionPanel to settings sub-components
    expect(companionSource).toContain("wakeModeEnabled");
    expect(companionSource).toContain("wakeStatus");
    // "Wake word" label lives in the extracted VoiceAiSettings card
    expect(voiceSettingsSource).toContain("Wake word");
    expect(onboardingSource).not.toContain("No wake word, no always-on microphone");
    expect(onboardingSource).toContain("wake word is off by default");
  });
});
