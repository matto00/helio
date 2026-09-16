## Why

`convertformat`, `analyzewithai` and `generatetext` shipped backend-only (HEL-1105/1106/1107). In the pipeline
editor all three resolve to the read-only `unsupportedOpType` fallback (`stepNarrowing.ts:285`), and none appears in
`OP_TYPES`, so a human cannot author any of them. An agent already can — `helio-mcp`'s `add_pipeline_step` documents
all three config shapes accurately. The ticket's acceptance criterion (authorable in the UI *and* by an agent,
producing identical configs) is therefore half-unmet, and the missing half is entirely frontend.

## What Changes

- Register the three ops in `OP_TYPES` and resolve them through `stepNarrowing` so a persisted or MCP-created step
  renders as a real editable card instead of the unsupported notice.
- Add the three missing frontend config types and narrowing helpers (`PipelineStepConfig`/`PipelineStep` unions
  currently end at `UpsertSourceConfig`, so `PipelineStepKind` does not admit the three).
- Add three step-card editors, one per op, wired through `StepOpEditor` and `useStepCardState`.
- Defer step creation for the two AI ops until their config is complete. Their write path rejects an incomplete
  config (`PipelineService.scala:1787` → `validateRawConfig`), so today's create-immediately-on-pick flow would
  POST an invalid seed and fail. `convertformat` keeps immediate create, but only because its seed deliberately
  OMITS `from`/`to`: its validator tolerates those keys being absent yet rejects a present-and-empty pair with a
  422, and `""` is exactly what every sibling string field seeds.
- Disclose, before a run, that an AI step calls a model once per row, never auto-runs, and draws on the shared
  daily AI budget — read from the `costVerdict` already present on `analyze` and already typed in the frontend.

**Ticket correction:** the ticket's op-wiring checklist names `allowedOps`. No such identifier exists anywhere in
the working tree; it is not a surface this change can satisfy. Apply/infer parity and `StepCard` are real and are
covered above.

## Capabilities

### New Capabilities

- `pipeline-convertformat-editor`: the step-card editor contract for `convertformat` — pair choice, content-field
  picker, and in-place-overwrite disclosure.
- `pipeline-analyzewithai-editor`: the step-card editor contract for `analyzewithai`, including the ordered
  `outputSchema` editor whose display order is the emitted array order.
- `pipeline-generatetext-editor`: the step-card editor contract for `generatetext`, including its never-defaulted
  `outputField`.
- `pipeline-ai-step-authoring`: the two cross-op AI-card contracts — deferred creation of a step whose config the
  backend rejects while incomplete, and honest pre-run cost/quota disclosure.

### Modified Capabilities

None. No existing requirement's behavior changes; the three op capabilities and `pipeline-op-picker-stability`
(which is a debounced-analyze contract, not a picker-membership one) are untouched.

## Impact

- `frontend/src/features/pipelines/state/stepNarrowing.ts`, `types/pipelineStep.ts`,
  `ui/StepOpEditor.tsx`, `hooks/useStepCardState.ts`, `hooks/usePipelineDetailPage.ts`,
  three new `ui/stepConfigs/*.tsx` + CSS, and their tests.
- No backend change, no migration (V107 already admits all four ops), no `helio-mcp` change.

## Non-goals

- The grouped/filterable step palette and any backend-owned step grouping — HEL-1136, explicitly after this ticket.
  `OpDropdown` gains three entries and no structural change; no frontend group mapping is introduced.
- Any monetary/token cost estimate. No per-step cost figure exists on any surface; inventing one is out of scope.
- Any change to AI execution, quota enforcement, or the auto-run verdict (HEL-1108 owns these).
