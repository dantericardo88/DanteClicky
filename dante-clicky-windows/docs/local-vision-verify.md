# Local Vision (Moondream2) Manual E2E Verification

This procedure proves Dimension 29, Local Vision Model, on a developer machine.
The repo already proves real local Moondream2 caption inference, so the harsh
score is **8.0/10**. It is not 9+ until the coordinate-grounding gate in this
doc is green.

## Current Harsh Status

- Current Dim 29 score: **8.0/10**
- Reason: real local Moondream2 inference has been proven, but GUI grounding is
  still brittle.
- Current blocker: prior evidence only completed 2 of 7 synthetic grounding
  fixtures before a crash, with one miss at 304px against a loose 100px
  tolerance.
- Honest 9+ bar: 50+ desktop GUI fixtures, >=70% pass rate, <=50px tolerance,
  model identity, p50/p95 latency evidence, and production proof that the
  `useVoice.ts` point-query fallback emits usable `[POINT:x,y]` hints.

## Requirements

- Windows 10/11 with at least 16 GB free RAM for the current F32 CPU path.
- About 4 GB free disk space for the pinned Moondream2 weights.
- `huggingface-cli` (`pip install huggingface_hub`) or plain `curl`.
- Built workspace: `cargo build --lib` clean from `src-tauri`.

## Step 1 - Download Model Files

The runtime downloader is pinned to the 2024-03-04 Moondream2 revision because
that revision still matches the Phi-based architecture supported by the current
Rust `candle-transformers` integration:

```text
https://huggingface.co/vikhyatk/moondream2/resolve/2024-03-04/model.safetensors
https://huggingface.co/vikhyatk/moondream2/resolve/2024-03-04/tokenizer.json
```

Option A, using Hugging Face:

```powershell
$env:MOONDREAM_MODEL_DIR = "C:\models\moondream2"
huggingface-cli download vikhyatk/moondream2 model.safetensors tokenizer.json --revision 2024-03-04 --local-dir $env:MOONDREAM_MODEL_DIR
```

Option B, using curl:

```powershell
$env:MOONDREAM_MODEL_DIR = "C:\models\moondream2"
mkdir $env:MOONDREAM_MODEL_DIR -Force | Out-Null
curl.exe -L -o "$env:MOONDREAM_MODEL_DIR\model.safetensors" `
  https://huggingface.co/vikhyatk/moondream2/resolve/2024-03-04/model.safetensors
curl.exe -L -o "$env:MOONDREAM_MODEL_DIR\tokenizer.json" `
  https://huggingface.co/vikhyatk/moondream2/resolve/2024-03-04/tokenizer.json
```

Expected files:

```powershell
Get-ChildItem $env:MOONDREAM_MODEL_DIR | Format-Table Name, Length
```

## Step 2 - Prove Real Caption Inference

```powershell
cd c:\Projects\DanteClicky\dante-clicky-windows\src-tauri
$env:MOONDREAM_MODEL_DIR = "C:\models\moondream2"
cargo test --lib moondream::tests::test_real_caption_integration -- --nocapture
```

Expected result:

```text
[moondream] loaded with dtype=f32, eos_token=50256
[real-caption] <a non-empty natural-language caption>
test result: ok. 1 passed; 0 failed
```

This proves an honest 8.0, not 9.0.

## Step 3 - Run The Dim 29 Grounding Gate

Create a prediction file at `bench/local-vision/dim29-grounding-predictions.jsonl`.
Each line must be one real local model output for the matching fixture:

```jsonl
{"id":"button-blue-top-left","rawOutput":"<point x=\"0.15\" y=\"0.18\">","latencyMs":1180,"provider":"moondream2","modelRevision":"vikhyatk/moondream2@2024-03-04","local":true}
{"id":"button-blue-top-right","rawOutput":"click(start_box='(830,155,870,205)')","latencyMs":1240,"provider":"ui-tars-local","modelRevision":"ByteDance-Seed/UI-TARS-2B-SFT","local":true}
```

Then run:

```powershell
cd c:\Projects\DanteClicky\dante-clicky-windows
npm run bench:dim29-grounding
npm run check:dim29-local-vision -- --failOnBlocked
```

The benchmark writes:

- `docs/local-vision-grounding/dim29-grounding-results.json`
- `docs/local-vision-grounding/dim29-readiness.json`

The readiness gate stays blocked until all of these are true:

- at least 50 fixtures;
- at least 50 measured predictions;
- maximum tolerance is 50px;
- pass rate is at least 70%;
- no missing predictions;
- no parse errors;
- p95 latency is recorded;
- local model provider and revision are recorded;
- production telemetry proves a `[POINT:x,y]` hint was emitted by the app path.

## Step 4 - Attach Production Point-Hint Telemetry

Add a dated telemetry sample under:

```text
docs/local-vision-grounding/dim29-production-telemetry-sample-YYYY-MM-DD.json
```

Minimal shape:

```json
{
  "events": [
    {
      "name": "vision_point_hint_emitted",
      "transcript": "click the submit button",
      "target": "submit button",
      "pointHint": "[POINT:512,690:submit button:screen1]",
      "provider": "moondream2",
      "modelRevision": "vikhyatk/moondream2@2024-03-04",
      "local": true
    }
  ]
}
```

## Full App Smoke

1. Launch with `npm run tauri dev`.
2. Open Settings > Local vision.
3. Click **Download model** or place the files in `app_data_dir/moondream2`.
4. Click **Load model**. Status should show loaded with `f32`.
5. Toggle local vision for ambient capture.
6. Speak a UI command on a low-UIA surface, such as "click the submit button."
7. Confirm the prompt/log path includes a `[POINT:x,y]` hint from local vision.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `model.safetensors not found` | Wrong `MOONDREAM_MODEL_DIR` | Verify the path and file names. |
| Out of memory during load | F32 CPU path needs about 7 GB resident memory | Close other apps or run on a larger machine. |
| Empty caption | Prompt/model mismatch or immediate EOS | Verify the pinned revision and tokenizer file. |
| Grounding benchmark is below 70% | Moondream2 captions work but coordinate grounding is weak | Use UI-TARS-class local grounding or newer Moondream coord-decoder architecture. |

## What Would Make 9+

Dim 29 can move to 9 only when `npm run check:dim29-local-vision -- --failOnBlocked`
passes against real local-model predictions and real app telemetry. Parser
coverage, fixture manifests, and docs are necessary scaffolding; they are not
the score by themselves.
