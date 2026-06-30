# NEXT 4 PRIORITY DIMENSIONS — DanteClicky 7.94/10 → 8.06/10

## STATUS: Sessions 14–16 COMPLETED ✅
- ✅ Dim 38 (Ambient UX): 3→9
- ✅ Dim 8 (Multilingual): 3→7
- ✅ Dim 50 (OSS/Licensing): 5→8
- Dims 19, 20, 31, 32, 42 (8→9): all shipped Session 16

**Current composite: 7.94/10**  
**After next 4 dims: 8.06/10** (conservative estimate)

---

## PRIORITY 1️⃣ — Dimension 29: LOCAL VISION MODEL

**What:** On-device vision understanding (no API calls, low latency)

**Current score:** 0/10  
**Target score:** 5/10  
**Lift:** +5 points (HIGHEST single-dimension impact available)  
**Composite impact:** +0.10  
**Effort:** 2–3 dev days

### Why 0 Currently
- No local vision integration (DC uses GUI grounding + OCR as workaround)
- Competitors: UI-TARS 9 (reference impl), Screenpipe 5 (API only), Cluely 0

### Gap Analysis
| Capability | DC | UI-TARS | Screenpipe | Closes? |
|-----------|----|---------|-----------:|---------|
| Moondream2 (1.8B) | ❌ | ✅ (native) | ❌ | +3 points |
| Llama 7B (local) | ❌ | ✅ | ❌ | +4 points |
| ONNX quantization | ❌ | ✅ | ❌ | UX polish |
| Latency <500ms | ❌ | ✅ | ❌ | Performance |

### Implementation Plan: 2–3 Days

**Day 1: Foundation**
1. Add `moondream2-2b-int4.gguf` (Apache-2.0) to assets
2. Integrate `candle` crate (Rust inference engine)
3. Create `vision.rs` module: `describe_screenshot(buf) -> String`
4. Test on sample screenshots (50 fast, 200 accurate?)

**Day 2: Integration**
1. Wire into `runComputerUseAgentLoop` — call before building system prompt
2. Inject `[VISION] {description}` block into context (complements OCR)
3. Add toggle in Settings: "Local vision" (on by default, off if perf poor)
4. Memory: save vision summaries (dim 34 semantic search benefits)

**Day 3: Polish + Tests**
1. Benchmark latency on target hardware (aim <1s)
2. Test on 20 diverse UIs (browser, forms, images, tables)
3. Compare to UI-TARS predictions (if similar, 5 is justified)
4. Fallback to OCR if model inference fails

### Score Justification: 5/10
- **5 = Local model working, latency acceptable, UI understanding > OCR baseline**
- Equals Screenpipe (API-based) + beats Cluely (0)
- Below UI-TARS 9 because: no fine-tuning, no per-app optimization, smaller model

### Blockers
None — moondream2 is open-source, candle is ready, no licensing issues.

### Tests to Write
```rust
#[test]
fn test_moondream_describe_screenshot_returns_text() {
  let screenshot = load_sample_png("tests/fixtures/chrome_form.png");
  let desc = describe_screenshot(&screenshot);
  assert!(!desc.is_empty());
  assert!(desc.len() > 20); // Not a trivial response
}

#[test]
fn test_moondream_latency_under_2s() {
  let screenshot = load_sample_png("tests/fixtures/desktop.png");
  let start = Instant::now();
  let _ = describe_screenshot(&screenshot);
  assert!(start.elapsed() < Duration::from_secs(2));
}

#[test]
fn test_vision_disabled_in_settings_skips_inference() {
  set_vision_enabled(false);
  let screenshot = load_sample_png(...);
  let system_prompt = build_system_prompt(&screenshot);
  assert!(!system_prompt.contains("[VISION]"));
}
```

---

## PRIORITY 2️⃣ — Dimension 46: STARTUP TIME

**What:** Time from user launches app to first input ready

**Current score:** 6/10  
**Target score:** 7/10  
**Lift:** +1 point  
**Composite impact:** +0.02  
**Effort:** 1 dev day

### Why 6 Currently
- Tauri cold start + WGC capture init overhead (observed: ~2–3s)
- Competitors: Raycast 9 (native), Screenpipe 5, Cluely 7

### Gaps
- App visible but mic/vision not ready for 1–2s
- No user feedback during startup (spinning wheel? progress?)

### Implementation Plan: 1 Day

**Strategy: Parallel initialization + UI feedback**
1. Move heavy initialization to background (WGC, Whisper, SQLite open)
2. Show splash screen immediately (500ms faster perceived)
3. Display "Loading..." → "Ready ✓" state transition
4. Profile startup with `cargo flamegraph` (find hotspots)

**Code changes:**
- `main.rs`: Spawn init tasks in parallel instead of sequentially
- `CompanionPanel.tsx`: Show loading spinner (no chat input) until backend ready
- Add Tauri event: `"app-ready"` fired when all systems initialized
- Move `whiper.load()` + `db.open()` to async background

### Tests
```rust
#[test]
fn test_app_init_completes_under_3s() {
  // Measure startup from main() to first Tauri command callable
  let _app = build_app_for_test();
  // Assertion: all init tasks completed
}
```

### Score Justification: 7/10
- 7 = ~1.5s startup (vs 2–3s now)
- Still slower than Raycast 9 (native code)
- Acceptable for Tauri cross-platform tradeoff

---

## PRIORITY 3️⃣ — Dimension 2: STT CLOUD ACCURACY

**What:** Speech-to-text accuracy on cloud API (Deepgram/OpenAI)

**Current score:** 7/10  
**Target score:** 8/10  
**Lift:** +1 point  
**Composite impact:** +0.02  
**Effort:** 1–2 days

### Why 7 Currently
- Using Deepgram Nova-2 (solid, industry standard)
- Competitors: Wispr 9 (optimized for voice UI), Screenpipe 6, Raycast 6

### Gaps
- No multi-language model switching (fixed after dim 8 shipping)
- No confidence scoring feedback to user
- No retry on partial results

### Implementation Plan: 1–2 Days

**Strategy: Model selection + confidence feedback**
1. Deepgram Nova-2 (current) + Nova-2-Conversational (for dialogue)
   - Swap based on context: "last N turns are dialogue" → Conversational
2. Inject confidence % into UI: show gray text if <70%, amber if 70–85%, green if 85%+
3. Add "Repeat?" button on low-confidence results (manual retry)
4. Upstream whisper_model_repository_for_language() to Deepgram lang param

**Code changes:**
- `useVoice.ts`: Detect dialogue context → select model
- `deepgramService.ts`: Add model parameter + confidence extraction
- `ChatBubble.tsx`: Confidence badge (gray/amber/green)

### Tests
```typescript
test('selects Conversational model after 3 dialogue turns', () => {
  const context = buildContext(3, 3); // user turns, assistant turns
  const model = selectSttModel(context);
  expect(model).toBe('nova-2-conversational');
});

test('shows amber badge for 75% confidence', () => {
  const confidence = 0.75;
  const badge = getConfidenceBadge(confidence);
  expect(badge.color).toBe('amber');
});
```

### Score Justification: 8/10
- 8 = Deepgram model selection + confidence feedback
- Still below Wispr 9 (proprietary tuning, closed-source optimization)
- Exceeds Screenpipe 6 (API quality + UX)

---

## PRIORITY 4️⃣ — Dimension 1: MIC / PTT UX (POLISH)

**What:** Push-to-talk ergonomics, mic indicator, feedback

**Current score:** 8/10  
**Target score:** 8.5–9/10  
**Lift:** +0.5–1 point  
**Composite impact:** +0.01–0.02  
**Effort:** 1 dev day

### Why 8 Currently
- Hotkey working + visual indicator (waveform)
- Competitors: Wispr 9, Cluely 7, DC 8

### Gaps
- No "holding to record" visual (just waveform, no text feedback)
- Release-to-send takes 200–500ms (feels sluggish)
- No confirmation audio (beep on start/stop)

### Implementation Plan: 1 Day

**Micro-interactions:**
1. Add text "Listening..." badge (pulse animation) while holding
2. Release → text transitions "Processing..." (1s)
3. Beep sound on mic start (80Hz sine, 100ms)
4. Haptic feedback on Windows (TextInputScope vibration API)
5. Shorten STT timeout from 3s → 2s (faster release-to-response)

### Tests
```typescript
test('shows "Listening..." while mic active', () => {
  fireEvent.mouseDown(micButton);
  expect(screen.getByText('Listening...')).toBeInTheDocument();
  fireEvent.mouseUp(micButton);
  expect(screen.getByText('Processing...')).toBeInTheDocument();
});

test('emits mic-start beep on hotkey press', () => {
  const beepSpy = jest.spyOn(audioModule, 'playBeep');
  fireEvent.keyDown(new KeyboardEvent('keydown', { code: 'AltLeft' }));
  expect(beepSpy).toHaveBeenCalledWith(80); // 80Hz
});
```

### Score Justification: 8.5/10
- 8.5 = Responsive PTT UX with feedback
- Falls short of Wispr 9 (noise cancellation, context awareness)
- Exceeds Cluely 7 (no feedback)

---

## EXECUTION ROADMAP

```
Week 1 (Parallel, 2–3 agents):
┌─ Agent 1: Dim 29 (Local Vision) — 2–3 days
├─ Agent 2: Dim 46 (Startup) — 1 day
├─ Agent 3: Dim 2 (STT Cloud) — 1–2 days
└─ Agent 1 (after Dim 29): Dim 1 (PTT UX) — 1 day

Week 2:
- Integration tests across all four dims
- Composite rescore: 7.94 → 8.06/10
```

## PROJECTED FINAL STATE

| Domain | Dims | Current | After P1–P4 | Leader | DC Lead |
|--------|------|---------|------------|--------|---------|
| Voice | 1–10 | 7.60 | 7.65 | Wispr 7.0 | +0.65 ✅ |
| Screen | 11–20 | 7.54 | 7.54 | Screenpipe 7.4 | +0.14 |
| Compute | 21–30 | 7.90 | 8.00 | UI-TARS 7.8 | +0.2 ✅ |
| Memory | 31–36 | 9.12 | 9.12 | Screenpipe 7.67 | +1.45 ✅ |
| UX | 37–44 | 8.75 | 8.75 | Raycast 7.75 | +1.0 ✅ |
| Platform | 45–50 | 6.83 | 6.85 | Screenpipe 7.0 | -0.17 |
| **OVERALL** | | **7.94** | **8.06** | Screenpipe 5.6 | **+2.46** 🏆 |

---

## COMPETITIVE REACTION ANTICIPATED

**Screenpipe** (5.60 → 5.70 if they ship local vision):
- No threat — base too low to catch DanteClicky

**UI-TARS** (5.30 → 5.50):
- Potential threat: strong on vision + SoM
- DC response: Dim 29 closes this gap

**Raycast AI** (5.00):
- macOS-only; not a threat to Windows DanteClicky

---

## GO/NO-GO CHECKLIST

- ✅ **Dim 29:** Moondream2 (Apache-2.0), candle ready, no blockers
- ✅ **Dim 46:** Profiling tools available, Tauri async patterns known
- ✅ **Dim 2:** Deepgram model selection available, no API cost increase
- ✅ **Dim 1:** Beep + haptic = 1-hour implementation, low risk

**Decision:** GO — Execute all 4 in parallel.

---

**Document date:** 2026-05-09  
**Next update:** After Dim 29 ships (EST 2026-05-11)
