# Context Depth Verification

Dimension 13 is scored at 9.0 only with code and fixture proof. Keep it capped
below 9.4 until this live smoke is attached for a real two-monitor desktop.

## Automated Gate

Run:

```powershell
npm run bench:context-depth
npx vitest run src/__tests__/contextDepth.test.ts src/__tests__/screenCapture.test.ts src/__tests__/temporalContext.test.ts src/lib/__tests__/videoSchemas.test.ts --reporter=dot
```

Expected:

- `bench/context-depth/results.json` has `passed: true`.
- At least 25 fixtures and at least 10 multi-monitor fixtures.
- `private_leak_count` and `base64_leak_count` are both 0.
- `top1_window_accuracy >= 0.90`.
- `top3_ocr_recall >= 0.85`.
- `p95_render_ms <= 50`.
- `max_context_chars <= 1200`.

## Manual Smoke

Record a dated note under `docs/context-depth-smoke/`.

Required evidence:

- Two monitors are connected and both are captured.
- The monitor containing the cursor is ordered as `screen1`.
- The prompt context-depth block lists `screen1` and `screen2` with size, origin, and role.
- OCR text from both monitors appears in separate `[ocr:screenN ...]` blocks.
- UIAutomation elements on both monitors produce `[POINT:...:screenN]` tags.
- A temporal question such as "what was I working on five minutes ago" includes recent keyframe labels without leaking private/incognito windows.
- Prompt text contains no `data:image` or raw `base64` payload strings.

## Remaining Cap

The next score lift needs live dual-monitor evidence, ambient snapshots persisted
per monitor, and semantic retrieval over keyframe OCR/captions.
