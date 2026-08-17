# Tasks — haiku-propose-worked-examples (HEL-700)

## 1. Worked examples

### Backend

- [x] 1.1 Add a top-level `examples` JSON-Schema array (one fully-formed input, authored as a parsed string literal per design D2) to `DashboardProposalSchema` in `AssistantProposalToolSchemas.scala`, with placeholder ids per design D3
- [x] 1.2 Add an `examples` array to `PipelineProposalSchema` (inline-source example showing source-branch exclusivity)
- [x] 1.3 Add an `examples` array to `CombinedProposalSchema` whose dashboard panel binds via the literal `"$pipelineOutput"` sentinel
- [x] 1.4 Add an `examples` array to `PatchSetSchema` showing `target`/`op`/`patch` with `target.id` present for an update edit
- [x] 1.5 Append a compact "Worked examples / shaping guidance" section to `AssistantSystemPrompt.text` per design D1/D3 (sentinel, patch-set shape, source exclusivity, placeholder-id statement)

## 2. Telemetry counters

### Backend

- [x] 2.1 Add `proposeAttempts`/`proposeDecodeFailures`/`proposeValidationFailures` `AtomicInteger` counters to `AssistantToolExecutor`, incremented only in the four `propose_*` dispatch paths (design D4; `executeFind`/`executeGetResource` untouched)
- [x] 2.2 Add the three flat `Int` fields to `AssistantTurnResult` (`AssistantProtocol.scala`) and populate them in `AssistantService.toTurnResult` from the executor (both `FinalResponse` and `HopBudgetExhausted` outcomes)
- [x] 2.3 Extend `AssistantTelemetry.emitToolLoopOutcome` with the three counter fields (integers only — no payload/error text, design D7)
- [x] 2.4 Thread the counters from `result` into the `emitToolLoopOutcome` call in `AssistantConversationRoutes.converseFlow`

## 3. Tests

### Tests

- [x] 3.1 Decode-pin tests: each `propose_*` schema's every `examples` entry decodes via the tool's real spray-json target type; combined example asserts the `"$pipelineOutput"` sentinel binding survives decode
- [x] 3.2 System-prompt tests: `AssistantSystemPrompt.text` contains the shaping section and the placeholder-id statement (string-presence assertions, mirroring existing prompt-text test style if present)
- [x] 3.3 `AssistantToolExecutorSpec`: counters — decode failure increments `proposeDecodeFailures` + `proposeAttempts` only; validation-`Left` increments `proposeValidationFailures` (not decode); success increments attempts only; find/get_resource calls never touch the counters
- [x] 3.4 `AssistantServiceSpec`: `AssistantTurnResult` carries the executor's counters for both `FinalResponse` and `HopBudgetExhausted` outcomes
- [x] 3.5 `AssistantTelemetrySpec`: emitted `assistant_tool_loop_outcome` line carries the three new fields; no field carries tool-input payload or deserialization error text
- [x] 3.6 Run full gates: backend `sbt test`, `node scripts/check-schema-drift.mjs`, frontend lint/tests unaffected

## 4. Delivery documentation

- [x] 4.1 Draft the PR-body sections required by the ticket's AC: the manual before/after comparison protocol (design D6) and the explicit "Sonnet fallback considered" decision paragraph — recorded in `files-modified.md` notes for the orchestrator to fold into the PR
