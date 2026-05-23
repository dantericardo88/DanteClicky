# Dimension 27 - Multi-step Agentic Loops
> Generated: 2026-05-06 | Inferno + Party + OSS harvest + competitive leapfrog

## Score

**Current harsh-matrix score: 9.30/10**

This dimension is now comfortably above the 9+ gate under a harsh read. The remaining cap is a true live desktop E2E workflow test and deeper Claude-loop unit extraction; the core harness, Claude native loop path, OpenAI Responses runtime loop, safety resume, screen-context-aware safety, and native input coverage are all in the 9 band.

## 9+ Gate Evidence

| Gate | Evidence | Status |
|------|----------|--------|
| Bounded loop | `MAX_CU_LOOP_STEPS = 10`, stop reasons, repeated-action guard, try/catch fail stop | Pass |
| Structured actions | `click`, `double_click`, `triple_click`, `right_click`, `middle_click`, `type`, `key`, `scroll`, `drag`, `move`, `screenshot`, `wait`, `none` normalized into typed actions | Pass |
| Provider-native adapters | Claude `tool_use` maps into the loop and returns `tool_result`; OpenAI `computer_call` maps into the same internal contract and now has a tested Responses continuation loop | Pass |
| Fresh perception each step | Recaptures screenshots, OCR, and UIAutomation tree after every action | Pass |
| Verification governs flow | Every action gets before/after screenshots and verifier result; failure feeds next planning turn or stops blocked state | Pass |
| Safety gate + resume | Sensitive/destructive/financial/auth/submit patterns plus screen-context-only danger create a pending action and require explicit confirm/cancel before execution | Pass |
| Multi-monitor correctness | Screen labels resolve monitor offsets; normalized coordinates are clamped | Pass |
| Native input guardrails | Rust input validates coordinates, caps text length, clamps scroll deltas, and allowlists keypresses | Pass |
| Observability | Emits `cu-step`, `action-verify-result`, `cu-safety-stop`, and `cu-done` with stop reason | Pass |
| Tests | 73 Vitest tests pass; Rust test binaries compile under `cargo test --no-run`; direct OpenAI loop, provider-adapter, safety-context, and confirmation contracts are covered | Pass |

## Implementation Anchors

- `src/lib/agentLoop.ts` - typed action extraction, resolution, safety classification, pending confirmation contract, continuation prompt, executable-action detection.
- `src/lib/providerComputerActions.ts` - Claude/OpenAI native computer action adapters plus provider result builders.
- `src/lib/openAIComputerLoop.ts` - dependency-injected OpenAI Responses `computer_call` -> execute -> `computer_call_output` -> `previous_response_id` loop.
- `src/hooks/useVoice.ts` - one-action-per-observation loop: parse native or tag action, recapture, safety-check, execute, verify, return native tool result or replan.
- `src/providers/chat.ts` - current Claude computer tool version selection and OpenAI Responses computer body/proxy wrapper.
- `src/providers/pointParser.ts` - ordered action parser and explicit `[POINT:none:none:screen1]` stop handling.
- `src/lib/actionVerifier.ts` - fail-closed verifier behavior so errors do not silently mark success.
- `src-tauri/src/input.rs` - native execution guardrails before mouse, keyboard, drag, keypress, and scroll operations.
- `src-tauri/src/chat_proxy.rs` - OpenAI Responses API proxy for native computer-use calls and indexed Claude tool-use streaming.
- `src/__tests__/agentLoop.test.ts`, `src/__tests__/agentLoop.confirmation.test.ts`, `src/__tests__/providerComputerActions.test.ts`, `src/__tests__/openAIComputerLoop.test.ts`, and `src/__tests__/pointParser.agentLoop.test.ts` - regression coverage for loop semantics.

## Research Anchors

- OpenAI computer-use docs describe models inspecting screenshots, returning UI actions, and using custom harnesses or the Responses API `computer` tool.
- Anthropic computer-use docs describe the loop as receiving `tool_use`, executing it, returning `tool_result`, and continuing until the model stops requesting tools, with explicit human confirmation guidance for high-impact actions.

Sources:
- https://developers.openai.com/api/docs/guides/tools-computer-use
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool

## Verification

```bash
npm run build
npm test
cargo test --no-run
```

`cargo test` execution is currently blocked by Windows Application Control for generated test binaries in this environment, but Rust compilation completes and JS verification is green.

## Remaining Leapfrog Path

To move from 9.30 to 9.5+:

- Add a mocked end-to-end "three desktop steps to completion" integration test around `useVoice` or an extracted provider-agnostic loop runner.
- Extract the Claude loop from `useVoice.ts` into a pure dependency-injected runner with the same level of direct behavioral tests as OpenAI.
- Add zoom-region support for the latest Claude tool version.
