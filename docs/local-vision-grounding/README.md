# Dim 29 Local Vision Grounding Gate

This folder holds the evidence for Dimension 29, Local vision model to UI-TARS
parity.

The harsh rule is simple: **Dim 29 stays 8.0 until this gate is green**.

Run order:

```powershell
npm run bench:dim29-grounding
npm run check:dim29-local-vision -- --failOnBlocked
```

Required input:

- `bench/local-vision/dim29-grounding-fixtures.json` - 50 canonical GUI targets.
- `bench/local-vision/dim29-grounding-predictions.jsonl` - one real local model
  prediction per fixture.
- `dim29-production-telemetry-sample-YYYY-MM-DD.json` - app-path evidence that
  the local vision fallback emitted a `[POINT:x,y]` hint.

Generated artifacts:

- `dim29-grounding-results.json` - parser/evaluator output for the 50-fixture
  benchmark.
- `dim29-readiness.json` - final score gate for matrix updates.

Score bands:

- **8.0**: real local caption/inference exists, but no reliable 50-fixture
  coordinate grounding proof.
- **8.5**: 50+ fixture benchmark completes at 50-70% pass rate within 50px.
- **9.0**: 50+ fixture benchmark passes at >=70% within 50px, with p95 latency,
  model identity, and production point-hint telemetry.

Do not update the matrix to 9+ from anecdotal screenshots, skipped tests, wider
tolerances, caption-only output, or synthetic parser tests.
