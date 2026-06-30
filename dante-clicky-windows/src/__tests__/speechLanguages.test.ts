import { describe, expect, it } from "vitest";
import {
  ASSEMBLYAI_U3_PRO_NATIVE_LANGUAGE_CODES,
  buildAssemblyAIStreamingUrl,
  buildSpeechLanguagePrompt,
  buildSpeechLanguageStatus,
  getSpeechLanguageSupport,
  normalizeSpeechLanguageCode,
  speechLanguageOptionForCode,
} from "../lib/speechLanguages";

describe("speech language settings", () => {
  it("normalizes unknown, empty, and supported language codes", () => {
    expect(normalizeSpeechLanguageCode("")).toBe("auto");
    expect(normalizeSpeechLanguageCode("ES")).toBe("es");
    expect(normalizeSpeechLanguageCode("zh-CN")).toBe("zh");
    expect(normalizeSpeechLanguageCode("not-a-language")).toBe("auto");
  });

  it("returns display metadata for selected languages", () => {
    expect(speechLanguageOptionForCode("es")).toMatchObject({
      code: "es",
      label: "Spanish",
      localWhisperModel: "multilingual",
    });
    expect(speechLanguageOptionForCode("en")).toMatchObject({
      code: "en",
      label: "English",
      localWhisperModel: "english",
    });
  });

  it("builds assistant prompt guidance for auto language mode", () => {
    const prompt = buildSpeechLanguagePrompt("auto");
    expect(prompt).toContain("# Language");
    expect(prompt).toContain("auto-detect");
    expect(prompt).toContain("reply in that language");
  });

  it("builds assistant prompt guidance for explicit language mode", () => {
    const prompt = buildSpeechLanguagePrompt("fr");
    expect(prompt).toContain("# Language");
    expect(prompt).toContain("Always reply in French");
    expect(prompt).toContain("## Cultural Conventions");
  });

  it("adds language detection and prompt hints to AssemblyAI streaming URLs", () => {
    const url = buildAssemblyAIStreamingUrl({
      token: "test-token",
      sampleRate: 44_100,
      languageCode: "it",
    });

    expect(url).toContain("speech_model=u3-rt-pro");
    expect(url).toContain("sample_rate=44100");
    expect(url).toContain("encoding=pcm_s16le");
    expect(url).toContain("language_detection=true");
    expect(decodeURIComponent(url)).toContain("The user is speaking Italian");
  });

  it("tracks the native AssemblyAI U3 Pro streaming language tier", () => {
    expect(ASSEMBLYAI_U3_PRO_NATIVE_LANGUAGE_CODES).toEqual([
      "en",
      "es",
      "fr",
      "de",
      "it",
      "pt",
    ]);
    expect(getSpeechLanguageSupport("es")).toMatchObject({
      cloudTier: "native",
      localTier: "multilingual",
      recommendedMode: "Cloud",
    });
    expect(getSpeechLanguageSupport("ja")).toMatchObject({
      cloudTier: "local-recommended",
      localTier: "multilingual",
      recommendedMode: "Local",
    });
  });

  it("sends language prompts for all 19 languages (both native and non-native cloud)", () => {
    const japaneseUrl = buildAssemblyAIStreamingUrl({
      token: "test-token",
      sampleRate: 44_100,
      languageCode: "ja",
    });
    const spanishUrl = buildAssemblyAIStreamingUrl({
      token: "test-token",
      sampleRate: 44_100,
      languageCode: "es",
    });
    const hindiUrl = buildAssemblyAIStreamingUrl({
      token: "test-token",
      sampleRate: 44_100,
      languageCode: "hi",
    });

    // All languages now get prompts (Phase 2: buildAssemblyAILanguagePrompt covers all 19)
    expect(decodeURIComponent(japaneseUrl)).toContain("Japanese");
    expect(decodeURIComponent(japaneseUrl)).toContain("prompt=");
    expect(decodeURIComponent(spanishUrl)).toContain("Spanish");
    expect(decodeURIComponent(hindiUrl)).toContain("Hindi");
  });

  it("encodes keyterms_prompt and format_text on the AssemblyAI URL when supplied", () => {
    const url = buildAssemblyAIStreamingUrl({
      token: "test-token",
      sampleRate: 16_000,
      languageCode: "en",
      keyterms: ["Anthropic", "DanteClicky", "Tauri"],
      formatText: true,
    });
    expect(url).toContain("format_text=true");
    expect(decodeURIComponent(url)).toContain("keyterms_prompt=Anthropic,DanteClicky,Tauri");
  });

  it("omits keyterms_prompt when the supplied list is empty", () => {
    const url = buildAssemblyAIStreamingUrl({
      token: "test-token",
      sampleRate: 16_000,
      languageCode: "en",
      keyterms: [],
    });
    expect(url).not.toContain("keyterms_prompt");
  });

  it("opts the model into preserving disfluencies only when explicitly requested", () => {
    const polished = buildAssemblyAIStreamingUrl({
      token: "test-token",
      sampleRate: 16_000,
      languageCode: "en",
    });
    expect(polished).not.toContain("disfluencies=true");

    const raw = buildAssemblyAIStreamingUrl({
      token: "test-token",
      sampleRate: 16_000,
      languageCode: "en",
      preserveDisfluencies: true,
    });
    expect(raw).toContain("disfluencies=true");
  });

  it("builds user-facing language status with confidence and fallback guidance", () => {
    expect(buildSpeechLanguageStatus("auto", "Cloud")).toMatchObject({
      tone: "info",
      confidenceLabel: "provider auto-detect",
      recommendedMode: "Cloud",
    });

    const japaneseCloud = buildSpeechLanguageStatus("ja", "Cloud");
    expect(japaneseCloud).toMatchObject({
      tone: "warning",
      confidenceLabel: "selected language, cloud not native",
      recommendedMode: "Local",
    });
    expect(japaneseCloud.message).toContain("Local Whisper");

    expect(buildSpeechLanguageStatus("ja", "Local")).toMatchObject({
      tone: "success",
      confidenceLabel: "selected language",
      recommendedMode: "Local",
    });
  });
});
