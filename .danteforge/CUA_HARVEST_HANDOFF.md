# Wave 6 cua Harvest — Phase 1+2 Handoff for /party

> Status: Phases 0a/0b/0c landed on `master` (uncommitted). Phase 1 + Phase 2 worktrees are ready to dispatch.
> Plan: `C:/Users/richa/.claude/plans/foamy-foraging-lynx.md`
> Stable foundation seam: [src/lib/agentCallbacks.ts](../src/lib/agentCallbacks.ts)

---

## What's already landed (don't redo)

| Phase | Files | Tests |
|-------|-------|-------|
| 0a — metadata | `oss-registry.json`, `OSS_REPORT.md`, `COMPETE_MATRIX.md`, `50_DIMENSION_COMPETITIVE_MATRIX.md`, `STATE.yaml`, auto-memory `MEMORY.md` + `project_cua_harvest.md` | — |
| 0b — foundation types | `src/lib/agentCallbacks.ts`, `src/lib/callbacks/operatorNormalizer.ts` | `src/__tests__/agentCallbacks.test.ts` (8), `src/__tests__/operatorNormalizer.test.ts` (25) |
| 0c — loop wiring | `src/lib/openAIComputerLoop.ts` (added `callbacks?`, `runContext?`, `model?` params; dispatches `onRunStart/End`, `onSafetyDecision`, `onComputerCall{Start,End}`, `onScreenshot`, `onApi{Start,End}`) | `src/__tests__/openAIComputerLoop.callbacks.test.ts` (4) |

**Verification gate passed:** all 397 tests pass (32 files); `npx tsc --noEmit` clean.

---

## The seam (what every Phase 1+2 worktree consumes)

```ts
// src/lib/agentCallbacks.ts
export interface AgentCallbackHandler {
  readonly name: string;
  onRunStart?(ctx): void | Promise<void>;
  onRunEnd?(ctx, result): void | Promise<void>;
  onComputerCallStart?(ctx, action): void | Promise<void>;
  onComputerCallEnd?(ctx, action, success, error?): void | Promise<void>;
  onSafetyDecision?(ctx, action, decision): void | Promise<void>;
  onScreenshot?(ctx, info): void | Promise<void>;
  onApiStart?(ctx, request): void | Promise<void>;
  onApiEnd?(ctx, request, response): void | Promise<void>;
  onUsage?(ctx, usage): void | Promise<void>;
  onText?(ctx, text): void | Promise<void>;
  onFunctionCallStart?(ctx, name, args): void | Promise<void>;
  onFunctionCallEnd?(ctx, name, result, error?): void | Promise<void>;
}
```

Each Phase 1 worktree implements one of these as a `class XxxCallback implements AgentCallbackHandler`. Each Phase 2 worktree either implements a callback OR refactors a larger system that the callback chain plugs into.

**Currently NOT in the chain (deferred):**
- `onLlmStart` / `onLlmEnd` (mutating message-stream hooks) — defer until Phase 2 `wt-cua-grounded`, where they're actually needed.
- `onRunContinue` (cancellation-via-callback) — out of scope for v1.

---

## Phase 1 — parallel worktrees (dispatch via `/party`)

All three branch from `master` AFTER Phase 0c lands. Each is a single callback class + tests. Estimated 80–250 LOC each. **Independent** — no inter-dependencies.

### wt-cua-pii — `feat/cua-pii-callback`

**Files to create:**
- `src/lib/callbacks/piiAnonymization.ts` (~120 LOC)
- `src/__tests__/piiAnonymization.test.ts`

**Pattern source:** `/tmp/oss-research-cua/libs/python/agent/cua_agent/callbacks/pii_anonymization.py` (99 LOC)

**Implementation notes:**
- Implement `class PIIAnonymizationCallback implements AgentCallbackHandler`.
- **DO NOT duplicate regex set** — call into `redactText` from `src/lib/telemetry.ts` (line 855). Wrap and extend, don't re-implement.
- Symmetric anonymize/deanonymize pattern: emit a reversible map `{ token: realValue }` in `onComputerCallStart` (preserving real values for action execution); apply mapping over outgoing prompt text in a future `onLlmStart` (deferred Phase 2).
- For v1, focus on: text anonymization on `onText`, image redaction on `onScreenshot`. Image redaction = canvas overlay using same patterns from `agentLoop.ts:97-101` (PROMPT_INJECTION_PATTERN, SECRET_TOKEN_PATTERN).
- Reuse `src/lib/somAnnotator.ts` Canvas pipeline for image overlays.

**Dim target:** 36 Privacy 9.3 → 9.6.

**Verification:** `npx tsc --noEmit`, `npm test src/__tests__/piiAnonymization.test.ts`, ≥6 tests covering: text-only, image-only, mixed, mapping reversibility, no-op for empty input, error containment.

---

### wt-cua-budget — `feat/cua-budget-callback`

**Files to create:**
- `src/lib/callbacks/budgetManager.ts` (~80 LOC)
- `src/__tests__/budgetManager.test.ts`

**Pattern source:** `/tmp/oss-research-cua/libs/python/agent/cua_agent/callbacks/budget_manager.py` (56 LOC)

**Implementation notes:**
- Implement `class BudgetManagerCallback implements AgentCallbackHandler`.
- Constructor: `{ maxBudgetUsd: number, resetEachRun?: boolean, raiseOnExceed?: boolean, pricing?: PricingTable }`.
- Hook `onRunStart` to reset cost; hook `onUsage` to accumulate `responseCostUsd` from `AgentUsage`.
- Throw `BudgetExceededError` when threshold crossed (only if `raiseOnExceed`); otherwise just emit telemetry event.
- Pricing table per model: hardcoded for Claude (Sonnet 4.6 / Opus 4.7), GPT-4o / GPT-4o-mini, Grok-2. Allow override via constructor.
- Telemetry events to add to `src/lib/telemetrySchema.ts`: `agent.budget.tick`, `agent.budget.exceeded` — both with `{ runId, totalCostUsd, maxBudgetUsd }`.
- Add a `Per-run budget USD` setting to `CompanionPanel` (default $5). Settings live in `src/state/companionStore.ts`.

**Dim target:** Cost/observability — new surface, contributes to Dim 45.

**Verification:** ≥7 tests covering: under-budget continue, over-budget throw, over-budget no-throw, reset-each-run, pricing table lookup, missing pricing fallback, telemetry emission count.

---

### wt-cua-retention — `feat/cua-retention-callback`

**Files to create:**
- `src/lib/callbacks/imageRetention.ts` (~110 LOC)
- `src/__tests__/imageRetention.test.ts`

**Pattern source:** `/tmp/oss-research-cua/libs/python/agent/cua_agent/callbacks/image_retention.py` (95 LOC)

**Implementation notes:**
- Implement `class ImageRetentionCallback implements AgentCallbackHandler`.
- Constructor: `{ onlyNMostRecentImages?: number }`. Default 6 (matches existing `DEFAULT_RECENT_TURN_COUNT` in `contextCompression.ts`).
- Port the orphan-pair removal logic from cua: when trimming a `computer_call_output` with image_url, also remove the matching `computer_call` (via `call_id` match) and the immediately preceding `reasoning` item.
- Operates on the OpenAI Responses-format message array (input to `createResponse` in the loop).
- **Coexists with `contextCompression.ts`** — retention runs FIRST (per-image), compression runs SECOND (per-turn). Don't replace.
- For v1, expose as `applyImageRetention(messages, n)` pure function + class wrapper. Wiring into the loop's `createResponse` body construction is a Phase 2 follow-on.

**Dim target:** 23 Context Compression 9.0 → 9.3.

**Verification:** ≥8 tests covering: no-trim under threshold, trim oldest, orphan pair removal (`computer_call` + `computer_call_output`), preceding-reasoning removal, no-op when N is null, multiple non-image messages preserved, idempotency.

---

## Phase 2 — sequential worktrees (after Phase 1 merges)

Order matters: **registry** → **grounded** → others can interleave. Each is larger (200–500 LOC).

### wt-cua-registry — `feat/cua-agent-registry`

**Files:**
- `src/lib/agents/registry.ts` (~150 LOC) — `registerAgent({ modelRegex, priority, toolType, adapter })`, `findAgentForModel(modelId)`
- `src/lib/agents/asyncAgentConfig.ts` — TS port of `cua_agent/loops/base.py` `AsyncAgentConfig` protocol
- Refactor `src/providers/chat.ts` to delegate provider routing through registry instead of hardcoded `if (provider === "claude")`
- 3 vendor adapters: `src/lib/agents/adapters/{claude,openai,gemini}.ts`

**Pattern source:** `cua_agent/decorators.py`, `cua_agent/loops/base.py`, `cua_agent/loops/anthropic.py`, `cua_agent/loops/openai.py`, `cua_agent/loops/gemini.py`

**Dim target:** 49 Model Coverage ~7→8.5, 50 Extensibility ~6→9.0.

---

### wt-cua-grounded — `feat/cua-composed-grounded` (depends on registry)

**Files:**
- `src/lib/grounded/composedGroundedLoop.ts` (~300 LOC)
- `src/lib/grounded/groundingAdapter.ts` — interface; primary impl uses `somAnnotator.ts` (UIAutomation), fallback `moondream.rs` `point_query`

**Pattern source:** `cua_agent/loops/composed_grounded.py` (316 LOC) — especially `GROUNDED_COMPUTER_TOOL_SCHEMA` and the two-stage `predict_step` flow.

**This is where `onLlmStart`/`onLlmEnd` mutating hooks finally land** — the grounded loop converts between `(x,y)` action shape and `element_description` shape across the LLM boundary, which is exactly what mutation hooks are for.

**Dim target:** 27 Agentic Loops 9.0 → 9.6.

---

### wt-cua-trajectory — `feat/cua-trajectory-callback`

**Files:**
- `src/lib/callbacks/trajectorySaver.ts` (~250 LOC)
- New SQLite migration in `src-tauri/src/observability.rs`: table `agent_trajectories(run_id, step_idx, ts, action_json, screenshot_path, usage_json)`
- Port `sanitize_image_urls` recursive helper from `cua_agent/callbacks/trajectory_saver.py` (660 LOC)
- Tauri command: `observability_export_trajectory(runId)` → JSONL file

**Dim target:** 28 Safety 9.0 → 9.4, 45 Observability 9.2 → 9.7.

---

### wt-cua-mcp — `feat/cua-mcp-session-manager`

**Files:**
- Refactor `src-tauri/src/mcp_server.rs` from `Arc<Mutex<HashMap<String, broadcast::Sender>>>` to explicit `SessionManager` struct
- New `src-tauri/src/mcp_session.rs` — `SessionManager` + `ComputerPool` ports
- Idle-cleanup background task; `max_concurrent_sessions` config
- **Wire-protocol compatibility required** — only internal abstractions change.

**Pattern source:** `/tmp/oss-research-cua/libs/python/mcp-server/mcp_server/session_manager.py` (330 LOC)

**Dim target:** integration_mcp sustained at 8.0 (multi-tenant readiness as foundation).

---

### wt-cua-human — `feat/cua-human-in-the-loop`

**Files:**
- `src-tauri/src/human_tool.rs` — local websocket server for ambient approvals
- `src/components/HumanApprovalSurface.tsx` — overlay UI extending existing `PendingActionCard`
- Refactor `agentLoop.ts:386` `isComputerActionConfirmation` → async approval flow

**Pattern source:** `cua_agent/human_tool/server.py`

**Dim target:** 38 Ambient UX 7 → 8.5 (biggest single-dim gain).

---

## Cross-cutting rules for all worktrees

1. **Never copy code verbatim.** Read the cua source for the pattern; implement fresh in DanteClicky's TS+Rust style.
2. **Reuse existing infra.** `redactText`, `contextCompression.ts`, `telemetry.ts`, `somAnnotator.ts`, `moondream.rs`, `observability.rs` are battle-tested. Wrap, don't replace.
3. **Tests first or alongside.** Every new callback class needs ≥5 unit tests. Use `vitest` (already configured), test file under `src/__tests__/`.
4. **Verification gate per worktree before merge:**
   - `npx tsc --noEmit --pretty false`
   - `npm test -- --reporter=dot` (no regressions; new tests pass)
   - `npm run build` (note: pre-existing build errors in `bench/stt/run.ts` and `useVoice.ts` are NOT introduced by callback work — leave alone unless directly relevant)
   - `cargo test --manifest-path src-tauri/Cargo.toml --lib --quiet` (Phase 2 worktrees touching Rust)
5. **Update `STATE.yaml` audit log** on completion of each worktree.
6. **License compliance:** trycua/cua is MIT (verified `LICENSE.md` at clone root). NOT importing OmniParser (CC-BY-4.0), Lume/Lumier (macOS-only), Swift cua-driver, Presidio (not Windows-friendly).

---

## After all worktrees merge — Phase 3 verification

1. `/verify` end-to-end on `dante-clicky-windows`
2. `/score` harshly across all 50 dimensions
3. `/adversarial-score` on Dim 27, 28, 36, 45 (most-claimed deltas)
4. Update `OSS_REPORT.md` Wave 6 section with **actual** deltas
5. Update `50_DIMENSION_PROGRESS.md`
6. `/retro` capturing lessons (especially streaming-vs-callback semantics — recurring theme)
7. `/lessons add` for the streaming-buffer pattern
8. `rm -rf C:/Users/richa/AppData/Local/Temp/oss-research-cua`

**Target:** composite **7.81 → 8.5/10**. If actual gain is < 0.5, run `/respec` to identify which patterns underperformed.
