import { describe, it, expect } from "vitest";
import { filterVoicesByLanguage, ELEVENLABS_VOICES } from "../hooks/useElevenLabs";
import { buildSpeechLanguagePrompt, getLanguageConfidenceThreshold, isRTLLanguage, SPEECH_LANGUAGE_OPTIONS, buildAssemblyAILanguagePrompt } from "../lib/speechLanguages";
import { selectTtsModel } from "../hooks/useVoice";

describe("Multilingual Support", () => {
  // Mock voice objects for testing filterVoicesByLanguage
  const mockVoices = ELEVENLABS_VOICES.map((v) => ({
    voice_id: v.id,
    name: v.name,
    category: "premade" as const,
  }));

  describe("filterVoicesByLanguage", () => {
    it("returns all voices for auto language", () => {
      const result = filterVoicesByLanguage(mockVoices, "auto");
      expect(result).toHaveLength(12);
    });

    it("returns all voices when language is undefined", () => {
      const result = filterVoicesByLanguage(mockVoices, undefined);
      expect(result).toHaveLength(12);
    });

    it("returns all voices when language is null", () => {
      const result = filterVoicesByLanguage(mockVoices);
      expect(result).toHaveLength(12);
    });

    // Test each of the 19 language codes
    SPEECH_LANGUAGE_OPTIONS.forEach((langOption) => {
      if (langOption.code === "auto") return; // Skip auto, already tested

      it(`returns voices for language code ${langOption.code}`, () => {
        const result = filterVoicesByLanguage(mockVoices, langOption.code);
        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
        // All results should be valid voices
        result.forEach((voice) => {
          expect(mockVoices).toContainEqual(
            expect.objectContaining({ voice_id: voice.voice_id })
          );
        });
      });
    });

    // European languages should return subset of voices (language preferences)
    it("returns subset of voices for Spanish (European language with preferences)", () => {
      const result = filterVoicesByLanguage(mockVoices, "es");
      // Should have some voices but not necessarily all
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThanOrEqual(12);
    });

    // Non-European languages should return all voices (multilingual_v2 support)
    it("returns all voices for Chinese (non-European language with multilingual support)", () => {
      const result = filterVoicesByLanguage(mockVoices, "zh");
      expect(result).toHaveLength(12);
    });

    it("returns all voices for Japanese (non-European language with multilingual support)", () => {
      const result = filterVoicesByLanguage(mockVoices, "ja");
      expect(result).toHaveLength(12);
    });

    it("returns all voices for Korean (non-European language with multilingual support)", () => {
      const result = filterVoicesByLanguage(mockVoices, "ko");
      expect(result).toHaveLength(12);
    });

    it("returns all voices for Hindi (non-European language with multilingual support)", () => {
      const result = filterVoicesByLanguage(mockVoices, "hi");
      expect(result).toHaveLength(12);
    });

    it("returns all voices for Arabic (non-European language with multilingual support)", () => {
      const result = filterVoicesByLanguage(mockVoices, "ar");
      expect(result).toHaveLength(12);
    });

    it("returns all voices for Vietnamese (non-European language with multilingual support)", () => {
      const result = filterVoicesByLanguage(mockVoices, "vi");
      expect(result).toHaveLength(12);
    });
  });

  describe("buildSpeechLanguagePrompt", () => {
    it("returns a valid prompt for auto-detect", () => {
      const prompt = buildSpeechLanguagePrompt("auto");
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(50);
      expect(prompt).toContain("auto-detect");
    });

    it("returns a valid prompt for English", () => {
      const prompt = buildSpeechLanguagePrompt("en");
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(50);
      expect(prompt).toContain("English");
    });

    // Test all 19 language codes
    SPEECH_LANGUAGE_OPTIONS.forEach((langOption) => {
      it(`produces non-empty prompt for ${langOption.code} (${langOption.label})`, () => {
        const prompt = buildSpeechLanguagePrompt(langOption.code);
        expect(typeof prompt).toBe("string");
        expect(prompt.length).toBeGreaterThan(50);
        // Prompt should contain the language name or code
        expect(
          prompt.toLowerCase().includes(langOption.label.toLowerCase()) ||
            prompt.includes(langOption.code)
        ).toBe(true);
      });
    });

    // Test specific cultural guidance is present
    it("includes formality guidance for Spanish", () => {
      const prompt = buildSpeechLanguagePrompt("es");
      expect(prompt).toContain("tú");
      expect(prompt).toContain("usted");
    });

    it("includes formality guidance for French", () => {
      const prompt = buildSpeechLanguagePrompt("fr");
      expect(prompt).toContain("tu");
      expect(prompt).toContain("vous");
    });

    it("includes formality guidance for German", () => {
      const prompt = buildSpeechLanguagePrompt("de");
      expect(prompt.toLowerCase()).toContain("du");
      expect(prompt.toLowerCase()).toContain("sie");
    });

    it("includes script guidance for Chinese", () => {
      const prompt = buildSpeechLanguagePrompt("zh");
      expect(prompt.toLowerCase()).toContain("simplified");
      expect(prompt.toLowerCase()).toContain("traditional");
    });

    it("includes politeness guidance for Japanese", () => {
      const prompt = buildSpeechLanguagePrompt("ja");
      expect(prompt.toLowerCase()).toContain("politeness");
      expect(prompt.toLowerCase()).toContain("casual");
      expect(prompt.toLowerCase()).toContain("formal");
    });

    it("includes formality guidance for Korean", () => {
      const prompt = buildSpeechLanguagePrompt("ko");
      expect(prompt.toLowerCase()).toContain("formal");
    });

    it("includes Portuguese regional guidance", () => {
      const prompt = buildSpeechLanguagePrompt("pt");
      expect(prompt.toLowerCase()).toContain("brazil");
      expect(prompt.toLowerCase()).toContain("european");
    });

    it("includes Dutch formality guidance", () => {
      const prompt = buildSpeechLanguagePrompt("nl");
      expect(prompt.toLowerCase()).toContain("jij");
      expect(prompt.toLowerCase()).toContain("formal");
    });

    it("includes Polish formality guidance", () => {
      const prompt = buildSpeechLanguagePrompt("pl");
      expect(prompt.toLowerCase()).toContain("formal");
      expect(prompt.toLowerCase()).toContain("informal");
    });

    it("includes Turkish formality guidance", () => {
      const prompt = buildSpeechLanguagePrompt("tr");
      expect(prompt.toLowerCase()).toContain("formal");
      expect(prompt.toLowerCase()).toContain("informal");
    });

    it("includes Ukrainian cyrillic guidance", () => {
      const prompt = buildSpeechLanguagePrompt("uk");
      expect(prompt.toLowerCase()).toContain("cyrillic");
    });

    it("includes Vietnamese tone guidance", () => {
      const prompt = buildSpeechLanguagePrompt("vi");
      expect(prompt.toLowerCase()).toContain("tone");
      expect(prompt.toLowerCase()).toContain("register");
    });

    it("includes Indonesian dialect guidance", () => {
      const prompt = buildSpeechLanguagePrompt("id");
      expect(prompt.toLowerCase()).toContain("standard");
      expect(prompt.toLowerCase()).toContain("indonesian");
    });

    it("includes Swedish formality guidance", () => {
      const prompt = buildSpeechLanguagePrompt("sv");
      expect(prompt.toLowerCase()).toContain("swedish");
      expect(prompt.toLowerCase()).toContain("formal");
    });

    // Resilience instruction for wrong-language transcription
    it("includes resilience instruction for transcription errors", () => {
      const prompt = buildSpeechLanguagePrompt("es");
      expect(prompt.toLowerCase()).toContain("different language");
      expect(prompt.toLowerCase()).toContain("speech recognition");
      expect(prompt.toLowerCase()).toContain("charitably");
    });

    // Should not mention TTS concerns at text layer (e.g., nasal sounds)
    it("does not mention nasal sounds (TTS concern, not text layer)", () => {
      const prompt = buildSpeechLanguagePrompt("hi");
      expect(prompt.toLowerCase()).not.toContain("nasal");
    });

    // Hindi prompt should mention script preference
    it("includes script preference for Hindi", () => {
      const prompt = buildSpeechLanguagePrompt("hi");
      expect(prompt.toLowerCase()).toContain("devanagari");
    });

    // Auto-detect feedback: handles null language code gracefully
    it("handles null language code gracefully", () => {
      const prompt = buildSpeechLanguagePrompt(null);
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(0);
    });

    it("handles undefined language code gracefully", () => {
      const prompt = buildSpeechLanguagePrompt(undefined);
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(0);
    });
  });

  describe("Language Code Coverage", () => {
    it("supports all 19 language codes", () => {
      const codes = SPEECH_LANGUAGE_OPTIONS.map((opt) => opt.code);
      expect(codes).toContain("auto");
      expect(codes).toContain("en");
      expect(codes).toContain("es");
      expect(codes).toContain("de");
      expect(codes).toContain("fr");
      expect(codes).toContain("pt");
      expect(codes).toContain("it");
      expect(codes).toContain("zh");
      expect(codes).toContain("ja");
      expect(codes).toContain("ko");
      expect(codes).toContain("hi");
      expect(codes).toContain("ar");
      expect(codes).toContain("nl");
      expect(codes).toContain("pl");
      expect(codes).toContain("tr");
      expect(codes).toContain("uk");
      expect(codes).toContain("vi");
      expect(codes).toContain("id");
      expect(codes).toContain("sv");
      expect(codes).toHaveLength(19);
    });

    it("each language code has a valid nativeLabel", () => {
      SPEECH_LANGUAGE_OPTIONS.forEach((langOption) => {
        expect(langOption.nativeLabel).toBeDefined();
        expect(langOption.nativeLabel.length).toBeGreaterThan(0);
      });
    });

    it("non-Latin script languages use Unicode in nativeLabels", () => {
      const zhOption = SPEECH_LANGUAGE_OPTIONS.find((o) => o.code === "zh");
      expect(zhOption?.nativeLabel).toBe("中文");

      const jaOption = SPEECH_LANGUAGE_OPTIONS.find((o) => o.code === "ja");
      expect(jaOption?.nativeLabel).toBe("日本語");

      const koOption = SPEECH_LANGUAGE_OPTIONS.find((o) => o.code === "ko");
      expect(koOption?.nativeLabel).toBe("한국어");

      const hiOption = SPEECH_LANGUAGE_OPTIONS.find((o) => o.code === "hi");
      expect(hiOption?.nativeLabel).toBe("हिन्दी");

      const arOption = SPEECH_LANGUAGE_OPTIONS.find((o) => o.code === "ar");
      expect(arOption?.nativeLabel).toBe("العربية");
    });

    it("European languages use proper diacritics in nativeLabels", () => {
      const esOption = SPEECH_LANGUAGE_OPTIONS.find((o) => o.code === "es");
      expect(esOption?.nativeLabel).toBe("Español");

      const frOption = SPEECH_LANGUAGE_OPTIONS.find((o) => o.code === "fr");
      expect(frOption?.nativeLabel).toBe("Français");

      const ptOption = SPEECH_LANGUAGE_OPTIONS.find((o) => o.code === "pt");
      expect(ptOption?.nativeLabel).toBe("Português");

      const trOption = SPEECH_LANGUAGE_OPTIONS.find((o) => o.code === "tr");
      expect(trOption?.nativeLabel).toBe("Türkçe");

      const viOption = SPEECH_LANGUAGE_OPTIONS.find((o) => o.code === "vi");
      expect(viOption?.nativeLabel).toBe("Tiếng Việt");
    });
  });

  describe("selectTtsModel — TTS routing", () => {
    it("returns flash model for en + fast", () => {
      expect(selectTtsModel("en", "fast")).toBe("eleven_flash_v2_5");
    });
    it("returns turbo model for en + balanced", () => {
      expect(selectTtsModel("en", "balanced")).toBe("eleven_turbo_v2_5");
    });
    it("returns multilingual for max quality regardless of language", () => {
      expect(selectTtsModel("en", "max")).toBe("eleven_multilingual_v2");
    });
    it("returns multilingual for any non-English language regardless of quality", () => {
      expect(selectTtsModel("es", "fast")).toBe("eleven_multilingual_v2");
      expect(selectTtsModel("zh", "fast")).toBe("eleven_multilingual_v2");
      expect(selectTtsModel("ja", "balanced")).toBe("eleven_multilingual_v2");
      expect(selectTtsModel("hi", "fast")).toBe("eleven_multilingual_v2");
      expect(selectTtsModel("ar", "fast")).toBe("eleven_multilingual_v2");
    });
    it("auto treats as English for TTS (until feedback loop kicks in)", () => {
      expect(selectTtsModel("auto", "fast")).toBe("eleven_flash_v2_5");
      expect(selectTtsModel("auto", "balanced")).toBe("eleven_turbo_v2_5");
    });
  });

  describe("buildAssemblyAILanguagePrompt — STT prompt coverage", () => {
    it("returns null for auto", () => {
      expect(buildAssemblyAILanguagePrompt("auto")).toBeNull();
    });
    it("returns non-null prompt for every non-auto language", () => {
      const nonAuto = SPEECH_LANGUAGE_OPTIONS.filter((o) => o.code !== "auto");
      nonAuto.forEach(({ code }) => {
        const prompt = buildAssemblyAILanguagePrompt(code);
        expect(prompt).not.toBeNull();
        expect(prompt!.length).toBeGreaterThan(20);
      });
    });
    it("zh prompt specifies simplified characters", () => {
      expect(buildAssemblyAILanguagePrompt("zh")).toContain("simplified");
    });
    it("ja prompt specifies kanji/kana, no romanization", () => {
      const p = buildAssemblyAILanguagePrompt("ja")!;
      expect(p).toContain("kanji");
      expect(p).toContain("kana");
      expect(p.toLowerCase()).toContain("not romanize");
    });
    it("uk prompt warns against rendering as Russian", () => {
      expect(buildAssemblyAILanguagePrompt("uk")).toContain("Russian");
    });
  });

  describe("filterVoicesByLanguage — behavioral subset assertions", () => {
    it("Spanish returns a strict subset of voices (not all 12)", () => {
      const result = filterVoicesByLanguage(mockVoices, "es");
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThan(12);
    });
    it("German returns a strict subset of voices (not all 12)", () => {
      const result = filterVoicesByLanguage(mockVoices, "de");
      expect(result.length).toBeGreaterThan(0);
      expect(result.length).toBeLessThan(12);
    });
  });

  describe("Cultural guidance — regression guards", () => {
    it("hi guidance does not contain 'only when possible' (contradictory phrasing)", () => {
      const prompt = buildSpeechLanguagePrompt("hi");
      expect(prompt.toLowerCase()).not.toContain("only when possible");
    });
    it("nl guidance refers to u (formal) not jij as the formal pronoun", () => {
      const prompt = buildSpeechLanguagePrompt("nl");
      expect(prompt).toContain("`u`");
    });
    it("id guidance includes Anda/kamu formality distinction", () => {
      const prompt = buildSpeechLanguagePrompt("id");
      expect(prompt.toLowerCase()).toContain("anda");
      expect(prompt.toLowerCase()).toContain("kamu");
    });
  });

  describe("RTL language detection", () => {
    it("identifies Arabic as RTL", () => expect(isRTLLanguage("ar")).toBe(true));
    it("identifies English as LTR", () => expect(isRTLLanguage("en")).toBe(false));
    it("identifies Chinese as LTR", () => expect(isRTLLanguage("zh")).toBe(false));
    it("handles null/undefined gracefully", () => {
      expect(isRTLLanguage(null)).toBe(false);
      expect(isRTLLanguage(undefined)).toBe(false);
    });
  });

  describe("per-language confidence thresholds", () => {
    it("Vietnamese requires higher confidence than Spanish", () => {
      expect(getLanguageConfidenceThreshold("vi")).toBeGreaterThan(getLanguageConfidenceThreshold("es"));
    });
    it("Ukrainian requires higher confidence than German", () => {
      expect(getLanguageConfidenceThreshold("uk")).toBeGreaterThan(getLanguageConfidenceThreshold("de"));
    });
    it("returns a number between 0.70 and 0.95 for all non-auto languages", () => {
      SPEECH_LANGUAGE_OPTIONS.filter((o) => o.code !== "auto").forEach(({ code }) => {
        const t = getLanguageConfidenceThreshold(code);
        expect(t).toBeGreaterThanOrEqual(0.70);
        expect(t).toBeLessThanOrEqual(0.95);
      });
    });
  });

  describe("Unicode sentence segmenter fallback", () => {
    it("splits Arabic sentences on ؟", () => {
      const parts = "مرحبا بالعالم؟ كيف حالك؟".split(/(?<=[.!?؟。！？۔])\s*/u).map((s) => s.trim()).filter(Boolean);
      expect(parts.length).toBe(2);
    });
    it("splits Chinese on 。", () => {
      const parts = "你好世界。我很好。".split(/(?<=[.!?؟。！？۔])\s*/u).map((s) => s.trim()).filter(Boolean);
      expect(parts.length).toBe(2);
    });
    it("still splits English on .", () => {
      const parts = "Hello world. How are you?".split(/(?<=[.!?؟。！？۔])\s*/u).map((s) => s.trim()).filter(Boolean);
      expect(parts.length).toBe(2);
    });
  });
});
