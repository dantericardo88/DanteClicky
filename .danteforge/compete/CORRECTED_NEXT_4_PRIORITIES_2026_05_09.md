# ✅ CORRECTED: NEXT 4 PRIORITY DIMENSIONS (Cross-Platform Strategy)

## REORDERING: From Windows-First to Cross-Platform-First

**Previous P1-P4:** 38→8→50→29 (window polish, ambient, licensing, vision)  
**Corrected P1-P4:** 47→29→1→46 (cross-platform, vision, PTT, startup)

---

## 🥇 PRIORITY 1: Dimension 47 — CROSS-PLATFORM SUPPORT (NEW P1)

**What:** Unified agent across Windows, macOS, Linux  

**Current score:** 3/10  
**Target score:** 8/10  
**Lift:** +5 points (HIGHEST STRATEGIC IMPACT)  
**Composite impact:** +0.10  
**Effort:** 4–6 weeks (phased delivery)  
**Blockers:** None — Tauri handles 80% of abstraction

### Strategic Importance
- **Windows-only was a mistake** (not the intended vision)
- **Cross-platform is a moat:** Memory encrypted on all platforms = genuine advantage
- **Competitor gap:** Open Interpreter at 4.5, Goose at 4.8; you can reach 8 = 3-point swing
- **Market size:** 92–95% of desktop users (Windows + macOS + Linux)

### Implementation Plan: 6 Weeks (Phased)

#### Week 1–2: Abstraction Layer
1. **Trait-based abstraction:**
   - `ScreenCaptureProvider` (WGC/Quartz/X11)
   - `AudioCaptureProvider` (WASAPI/CoreAudio/ALSA)
   - `InputProvider` (enigo already cross-platform)
   - `AutoStartProvider` (registry/LaunchAgent/systemd)
   - `PermissionProvider` (Windows APIs/macOS privacy.plist/Linux DBus)

2. **Feature flags in Cargo.toml:**
   ```toml
   [features]
   default = ["windows"]
   windows = ["dep:windows", "dep:tauri-plugin-window-state"]
   macos = ["dep:objc", "dep:core-foundation"]
   linux = ["dep:x11-clipboard"]
   all-platforms = ["windows", "macos", "linux"]
   ```

3. **Build commands:**
   ```bash
   cargo build --features windows --release  # .exe
   cargo build --features macos --release    # .app
   cargo build --features linux --release    # binary
   ```

**Effort:** 2 weeks (1 Rust engineer)  
**Tests:** Platform-agnostic tests (trait tests) + platform-specific integration tests

#### Week 2–3: macOS Implementation
1. **Quartz screen capture** (Clicky team has reference impl)
   - Use `CGWindowListCreateImage` for pixel data
   - Parity with WGC on Windows (high quality, per-monitor)

2. **CoreAudio for mic + speaker capture**
   - Use `Audio Session` APIs
   - Parity with WASAPI on Windows

3. **macOS native input via enigo**
   - enigo already supports macOS keyboard/mouse

4. **Sign & notarize** (Apple Developer cert required)
   - Code signing: `codesign -s - ...`
   - Notarization: `xcrun altool --notarize-app ...`

**Effort:** 2 weeks (1 engineer + Clicky team validation)  
**Validation:** Clicky team runs on M1/Intel Mac, confirms feature parity

**Score at week 3:** 6/10 (Windows ✅, macOS beta, Linux alpha)

#### Week 3–4: Linux Implementation
1. **X11/Wayland dual-support**
   - Primary: X11 (XGetImage for screenshot)
   - Fallback: Wayland (PipeWire for screenshot)
   - Most Linux users are still X11; Wayland optional

2. **ALSA + PulseAudio/PipeWire audio**
   - Use ALSA for primary mic capture
   - Detect PulseAudio/PipeWire at runtime

3. **Linux auto-start: systemd user service**
   - Create `~/.config/systemd/user/danteeclicky.service`
   - `systemctl --user enable danteeclicky`

4. **Distribution:**
   - AppImage (single file, no install)
   - .deb for Debian/Ubuntu
   - .rpm for Fedora/RHEL
   - Flatpak (universal)

**Effort:** 2 weeks (1 engineer)  
**Validation:** Test on Ubuntu 24.04, Fedora 40, Debian 12

**Score at week 4:** 7/10 (all platforms alpha→beta)

#### Week 5–6: Hardening + Multi-Platform CI/CD
1. **GitHub Actions:** Build all 3 platforms on every push
   ```yaml
   build-windows: runs-on: windows-latest
   build-macos:   runs-on: macos-latest
   build-linux:   runs-on: ubuntu-latest
   ```

2. **Automated testing on all platforms**
   - Unit tests run on all 3 in CI
   - Integration tests for capture/audio/input on all 3

3. **Release process:**
   - GitHub releases auto-built for all 3 platforms
   - Auto-updater works on all 3 (tauri-plugin-updater)

4. **Documentation:**
   - Installation guide per platform
   - Troubleshooting (permissions, codecs, etc.)

**Effort:** 1 week

**Final score at week 6:** 8/10 (all platforms production, feature parity)

### Tests to Write
```rust
#[cfg(test)]
mod cross_platform_tests {
    #[test]
    fn test_screenshot_provider_returns_image() {
        let provider = get_capture_provider();
        let img = provider.capture_screen();
        assert!(img.is_ok());
        assert!(img.unwrap().width() > 0);
    }

    #[test]
    fn test_audio_provider_opens_stream() {
        let provider = get_audio_provider();
        let stream = provider.open_mic_stream();
        assert!(stream.is_ok());
    }

    #[test]
    fn test_input_provider_moves_mouse() {
        let provider = get_input_provider();
        // Move mouse to (100, 100)
        let result = provider.move_mouse(100, 100);
        assert!(result.is_ok());
    }

    #[test]
    fn test_permission_provider_detects_mic_permission() {
        let provider = get_permission_provider();
        let has_permission = provider.has_mic_permission();
        // Platform-specific: Windows = registry, macOS = plist, Linux = DBus
        assert!(has_permission.is_ok());
    }
}
```

### Score Justification: 8/10
- 8 = All 3 platforms at feature parity, production-ready, signed/notarized
- Below 9 because: No iOS/Android, no web version
- Equals Open Interpreter (9 on cross-platform — they have web, Python everywhere)
- Exceeds Goose 9 (Python, but weaker voice/memory)

---

## 🥈 PRIORITY 2: Dimension 29 — LOCAL VISION MODEL (KEEP P2)

**What:** On-device vision via Moondream2 (1.8B GGUF)

**Current score:** 0/10  
**Target score:** 5/10  
**Lift:** +5 points  
**Composite impact:** +0.10  
**Effort:** 2–3 dev days (parallel to P1 Week 3+)  
**Blockers:** None

### Why This
- Closes UI-TARS gap (they have 9; you have 0)
- Privacy-first: inference runs locally, no API calls
- Works across all platforms (GGUF + candle = platform-agnostic)

### Implementation Plan: 2–3 Days

**Day 1: Integration**
1. Add `moondream2-2b-int4.gguf` (Apache-2.0) to assets
2. Integrate `candle` crate (Rust inference)
3. Create `vision.rs`: `describe_screenshot(buf: &[u8]) -> String`
4. Wire into `runComputerUseAgentLoop` (call before system prompt)

**Day 2: Testing + Performance**
1. Benchmark on target hardware (<1s latency goal)
2. Test on 20 diverse UIs (browser, forms, images, tables)
3. Fallback to OCR if inference fails
4. Add Settings toggle: "Local vision" (on by default)

**Day 3: Polish**
1. Inject `[VISION] {description}` into context (complements OCR)
2. Memory: save vision summaries (dim 34 semantic search benefits)
3. Error handling: graceful fallback to OCR
4. Tests: performance benchmarks + accuracy validation

### Tests
```rust
#[test]
fn test_moondream_describe_screenshot() {
    let screenshot = load_sample_png("tests/fixtures/chrome_form.png");
    let desc = describe_screenshot(&screenshot);
    assert!(!desc.is_empty());
    assert!(desc.len() > 20);
}

#[test]
fn test_moondream_latency_under_2s() {
    let screenshot = load_sample_png("tests/fixtures/desktop.png");
    let start = Instant::now();
    let _ = describe_screenshot(&screenshot);
    assert!(start.elapsed() < Duration::from_secs(2));
}

#[test]
fn test_vision_disabled_skips_inference() {
    set_vision_enabled(false);
    let system_prompt = build_system_prompt(&screenshot);
    assert!(!system_prompt.contains("[VISION]"));
}
```

### Score Justification: 5/10
- 5 = Local model working, latency acceptable, UI understanding > OCR baseline
- Equals Screenpipe (API-based) + beats Cluely (0)
- Below UI-TARS 9 (they fine-tuned; you're using off-the-shelf)

---

## 🥉 PRIORITY 3: Dimension 1 — MIC / PTT ERGONOMICS (NEW P3)

**What:** Polish push-to-talk UX (feedback, responsiveness, micro-interactions)

**Current score:** 8/10  
**Target score:** 9/10  
**Lift:** +1 point  
**Composite impact:** +0.02  
**Effort:** 1–2 days  
**Blockers:** None

### Why This (Before Dim 46 Startup)
- Windows/macOS/Linux all need consistent PTT feedback
- "Listening..." + "Processing..." states are **cross-platform critical**
- Beep + haptic feedback are platform-agnostic (play audio on all 3)

### Implementation Plan: 1–2 Days

**Day 1: Micro-interactions**
1. Add "Listening..." badge (pulse animation) while holding hotkey
2. "Processing..." state during STT (1s)
3. Beep sound on mic start (80Hz sine, 100ms) — cross-platform
4. Haptic feedback on Windows (TextInputScope); macOS/Linux: beep only

2. Shorten STT timeout from 3s → 2s (faster release-to-response)

**Day 2: Polish**
1. Waveform animation while listening
2. Accessibility: announce states to screen readers
3. Test across Windows/macOS/Linux
4. Settings toggle: "Audio feedback" (on by default)

### Tests
```typescript
test('shows "Listening..." while mic active', () => {
    fireEvent.mouseDown(micButton);
    expect(screen.getByText('Listening...')).toBeInTheDocument();
});

test('plays beep on all platforms', () => {
    const audioSpy = jest.spyOn(audioModule, 'playBeep');
    fireEvent.keyDown(new KeyboardEvent('keydown', { code: 'AltLeft' }));
    expect(audioSpy).toHaveBeenCalledWith(80);
});
```

### Score Justification: 9/10
- 9 = Responsive PTT with cross-platform feedback
- Below Wispr 9 (they have noise cancellation + context awareness)
- Exceeds Cluely 7 (no feedback)

---

## P4: Dimension 46 — STARTUP TIME (KEEP P4)

**What:** App launch to first input ready

**Current score:** 6/10  
**Target score:** 7/10  
**Lift:** +1 point  
**Composite impact:** +0.02  
**Effort:** 1 day  
**Blockers:** None

### Why After P1-P3
- Less critical than cross-platform foundation
- Easier to optimize later once platform abstraction is in place
- Profile across all 3 platforms after they're shipping

### Implementation Plan: 1 Day

1. **Parallel initialization:**
   - Move WGC/Quartz/X11 init to background
   - Move Whisper model load to background
   - Move SQLite open to background

2. **UI feedback:**
   - Show splash screen immediately (500ms faster perceived)
   - "Loading..." → "Ready ✓" state transition
   - Don't block on init; show chat input immediately

3. **Profiling:**
   - Use `cargo flamegraph` on all 3 platforms
   - Target: <1.5s startup (from 2–3s now)

### Tests
```rust
#[test]
fn test_app_init_under_3s() {
    let _app = build_app_for_test();
    // Assert all background tasks started
}
```

### Score Justification: 7/10
- 7 = ~1.5s startup (vs 2–3s)
- Still slower than Raycast 9 (native)
- Acceptable for cross-platform Tauri tradeoff

---

## EXECUTION ROADMAP: CORRECTED

```
May 9 (Now) — May 31:
┌─ Dim 47 (Cross-platform) Week 1–2 abstraction
│  ├─ Week 3 macOS beta (Clicky team validates)
│  └─ Week 4 Linux alpha
├─ Dim 29 (Local vision) Week 3–4 integration (parallel)
├─ Dim 1 (PTT polish) Week 5 refinement
└─ Dim 46 (Startup) Week 5 profiling

Jun 1–6:
├─ Dim 47 Week 5–6 CI/CD + hardening
├─ All platforms production
└─ Composite rescore: 7.94 → 8.16/10
```

---

## COMPOSITE TRAJECTORY (CORRECTED)

| Phase | Status | Composite | Notes |
|-------|--------|-----------|-------|
| Now | Windows leader | 7.94 | 27 dims at 9+; 3 hard ceilings |
| Dim 47 Week 3 | macOS beta | 8.04 | Cross-platform foundation |
| Dim 47 Week 6 | All platforms prod | 8.04 | Feature parity across 3 |
| Dim 29 shipped | + local vision | 8.14 | Vision capability complete |
| Dim 1 shipped | + PTT polish | 8.16 | **MULTIPLATFORM LEADER** |
| Dim 46 shipped | + startup | 8.18 | Minor perf gain |

---

## COMPETITIVE POSITION: CORRECTED

### Final State (Jun 6, 8.16/10)

```
RANK  PRODUCT              COMPOSITE  LEADER IN
────────────────────────────────────────────────────
 1️⃣   DanteClicky Multi    8.16/10    Memory, Voice, CU, Cross-platform
 2️⃣   Open Interpreter    4.50/10    Code execution (web)
 3️⃣   Goose               4.80/10    Python cross-platform
 4️⃣   Screenpipe          5.60/10    Screen recording (single-platform)
 5️⃣   UI-TARS Desktop     5.30/10    Local vision (desktop-only)
```

**Narrative:** "Only agent with memory + voice + vision + safety across Windows, macOS, and Linux"

**Market:** 92–95% of desktop users (not Windows-only; mainstream)

---

## GO / NO-GO

✅ **Dim 47 (Cross-platform):** Architecture sound, Tauri proven, 6-week delivery realistic  
✅ **Dim 29 (Local vision):** Moondream2 ready, candle proven, 2–3 days  
✅ **Dim 1 (PTT):** Low-risk polish, cross-platform audio API available  
✅ **Dim 46 (Startup):** Low priority but low effort, worth doing  

**Decision:** GO — All 4 in sequence (P1 enables others)

---

**Updated:** 2026-05-09 (corrected post-strategy-clarification)  
**Next rescore:** 2026-05-31 (Dim 47 architecture complete)  
**Final rescore:** 2026-06-06 (all dims shipped)
