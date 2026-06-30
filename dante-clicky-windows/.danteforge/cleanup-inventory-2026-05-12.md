# Source-Safe Cleanup Inventory - 2026-05-12

## Policy
- Preserve source-of-truth work, including dirty tracked files and untracked feature files.
- Preserve DanteForge records and caches unless explicitly cleaned by a later `/oss-clean` or archive pass.
- Do not use `git clean`, `git reset`, or checkout-based discard.

## Approved removals
- `dist/` - ignored Vite build output.
- `src-tauri/gen/` - ignored generated Tauri output.
- `src-tauri/target/` - ignored Rust/Tauri build output.
- `target/` - root build directory, removed only because it was empty at cleanup time.

## Explicitly preserved
- `node_modules/` for local dev readiness.
- `public/ort/` WASM runtime assets.
- `.danteforge/` reports, state, registry, lessons, `oss-repos/`, and `score-cache/`.
- `src/windows/companion/` and related split companion UI work.
- New tests under `src/__tests__/`.
- New feature libraries under `src/lib/`.
- `src-tauri/src/hardware.rs`.
- Local installer and benchmark scripts under `scripts/`.
- Benchmark and verification docs under `bench/` and `docs/`.

## Verification to run after cleanup
- `git status --short --ignored`
- `rg "<<<<<<<|=======|>>>>>>>" .`
- `npx tsc --noEmit --pretty false`
- `npm run test:frontend -- --run src/__tests__/startupArchitecture.test.ts src/__tests__/crossPlatformArchitecture.test.ts --reporter=dot`
- `npm run test:rust`
