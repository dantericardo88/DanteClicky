# Local Vision (Moondream2) — Manual E2E Verification

This is the procedure a developer follows to prove Dimension 29 (Local Vision Model) actually works end-to-end on their machine. The integration test in `src-tauri/src/moondream.rs` is gated on the `MOONDREAM_MODEL_DIR` environment variable so CI doesn't have to ship 3.7 GB of weights, but it runs real candle inference when those weights are present.

> **Why this doc exists.** The harsh score for Dim 29 is held at 7/10 (compile + tests pass + UI ships) until a developer follows this procedure and confirms a non-stub caption. Reaching honest 8 requires this verification on at least one machine.

## Requirements

- Windows 10/11 with at least **8 GB free RAM** (F16 path) or **16 GB free RAM** (F32 fallback)
- ~4 GB free disk space
- `huggingface-cli` (`pip install huggingface_hub`) **OR** plain `curl`
- Built workspace: `cargo build --lib` clean

## Step 1 — Download model files

The runtime URL we ship in `download_moondream_model` is:

```
https://huggingface.co/vikhyatk/moondream2/resolve/main/model.safetensors  (3,854,538,968 bytes, verified 2026-05-09)
https://huggingface.co/vikhyatk/moondream2/resolve/main/tokenizer.json
```

### Option A — huggingface-cli (recommended)

```powershell
$env:MOONDREAM_MODEL_DIR = "C:\models\moondream2"
huggingface-cli download vikhyatk/moondream2 model.safetensors tokenizer.json --local-dir $env:MOONDREAM_MODEL_DIR
```

### Option B — curl

```powershell
$env:MOONDREAM_MODEL_DIR = "C:\models\moondream2"
mkdir $env:MOONDREAM_MODEL_DIR -Force | Out-Null
curl.exe -L -o "$env:MOONDREAM_MODEL_DIR\model.safetensors" `
  https://huggingface.co/vikhyatk/moondream2/resolve/main/model.safetensors
curl.exe -L -o "$env:MOONDREAM_MODEL_DIR\tokenizer.json" `
  https://huggingface.co/vikhyatk/moondream2/resolve/main/tokenizer.json
```

After download, both files should exist:

```powershell
Get-ChildItem $env:MOONDREAM_MODEL_DIR | Format-Table Name, Length
# Expected:
#   model.safetensors    3854538968
#   tokenizer.json       ~2 MB
```

## Step 2 — Run the integration test

```powershell
cd c:\Projects\DanteClicky\dante-clicky-windows\src-tauri
$env:MOONDREAM_MODEL_DIR = "C:\models\moondream2"
cargo test --lib moondream::tests::test_real_caption_integration -- --nocapture
```

### Expected output (success)

```
[moondream] loaded with dtype=f16, eos_token=50256
[real-caption] <a non-empty natural-language caption>

test result: ok. 1 passed; 0 failed
```

The test asserts:
- caption is non-empty
- caption is not the old hardcoded stub `"A scene with UI elements and content"`

### What "good" looks like

For the embedded 1×1 white-pixel JPEG fixture, the model typically produces something like:
- `"A blank white image."`
- `"A solid white background."`

Any natural-language caption that is **not** the stub string counts as success.

## Step 3 — Optional: smoke the full app path

1. Launch with `npm run tauri dev`.
2. Open Settings → Local vision card.
3. Click **Download model** (~3.7 GB; or skip if already in `app_data_dir/moondream2`).
4. Click **Load model**. Status should change to `● Loaded (f16)` (or `f32` on older hardware).
5. Toggle **Use in ambient capture** ON.
6. Wait ~60 seconds for one ambient capture cycle.
7. Open Settings → Ambient → **View recent captures**.
8. The latest snapshot row should show a `vision ✓` badge AND the OCR snippet should NOT contain the stub string.

If you see real captions reflect real screen content, **Dim 29 is honestly 8/10**.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `f16 mmap failed (...)` then `f32 fallback` | Model weights aren't representable as f16 (some ops only have f32 kernels in candle) | None needed — the load() automatically retries with f32. Expect ~7 GB resident memory. |
| `OutOfMemory` during model build | Insufficient free RAM for f32 fallback | Close other apps. F32 needs ~7 GB free. Or wait for the future quantized GGUF path. |
| `tokenizer at ...: unknown PreTokenizer type "ByteLevel"` | Old `tokenizers` crate version | Should not happen — `tokenizers = "0.20"` supports it |
| Caption is empty `""` | EOS token fired immediately (model output starts with `<\|endoftext\|>`) | Likely a prompt-format mismatch. Check the prompt string in `caption()` exactly matches `\n\nQuestion: Describe this image briefly.\n\nAnswer:` |
| `model.safetensors not found` | Wrong path in `MOONDREAM_MODEL_DIR` | Verify with `Test-Path "$env:MOONDREAM_MODEL_DIR\model.safetensors"` |

## Path to honest 9/10

Even after this verification (which moves the score 7 → 8), reaching 9 requires:

1. **GUI-grounding accuracy benchmark.** Compare `moondream_point_query` outputs against `cloud_vision_click_target` on a fixture set of 50 screenshots. Target: ≥70% within 50 pixels of ground truth.
2. **Computer-use loop integration.** Already started in Session 20 (`useVoice.ts` UIAutomation-poor fallback now calls `moondream_point_query` on click intent). Needs production traffic + telemetry to confirm it actually fires and the LLM uses the resulting `[POINT:x,y]` hint.
3. **A real cold-start latency budget.** Document p50/p95 inference latencies on representative hardware (the LocalVisionCard already surfaces them; just need a logged baseline).

## What this doc is NOT

- **Not a substitute for the integration test.** If you can't run Step 2 successfully, the implementation is broken regardless of UI.
- **Not a guarantee of accuracy.** Moondream2 is 1.86B params — much smaller than UI-TARS 7B. Captions are good; click coordinate prediction is rough. That's the dim-29 ceiling without research-grade fine-tuning.
