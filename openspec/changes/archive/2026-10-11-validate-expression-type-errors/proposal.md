## Why

`POST /api/pipelines/:id/validate-expression` says `valid: true` for compute expressions that analyze rejects as type errors: mixed-type `coalesce`, and since HEL-1070 a number-vs-text comparison or mismatched `if()` branches. An API or MCP caller that trusts the endpoint saves a step that analyze then flags. Separately, the pipeline page's `step-config-invalid` notice says the pipeline "can't run until that step is fixed". That is false for the schema-derived analyze errors the notice is also shown for, because manual, scheduled and dataset-write runs all still run.

## What Changes

- validate-expression reports the same expression type errors analyze reports for a compute step, against the same node schema. It answers `valid: false` with analyze's message verbatim, and the response shape `{valid, error?}` is unchanged. Owner ruling (HEL-1437 escalation Q1 = `error`).
  - `valid: false` keeps its existing meaning: analyze would flag this expression. It does not mean save rejects it. `Unknown field` already works this way, because compute save is parse-only.
- The endpoint calls ONE engine function that is analyze's own compute-step check, so the two cannot drift again.
- The `step-config-invalid` copy becomes a sentence that is true for every class of error it is shown for: "A step in this pipeline has a problem, so its results may be wrong or missing until that step is fixed."
  - This is a copy-only change. No run gate, analyze verdict, `canRun` or `autoRunnable` behaviour changes. Owner ruling (Q2 = `copy-only`).
- Docs (`docs/compute-expression-grammar.md`) updated to match.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-validate-expression-api`: the endpoint's verdict covers expression type errors (analyze parity), not just syntax and field names.
- `run-to-update-affordance`: the `step-config-invalid` copy no longer claims the pipeline cannot run.

## Impact

- Backend:
  - `PipelineNodeReads.validateExpression`.
  - `PipelineAnalyzeService` (a new function reproducing analyze's own enabled compute-step check; `inferCompute` itself is unchanged).
  - `NodeCapabilitiesProtocol` doc comment.
- Frontend:
  - `denyReasonCopy.ts` and its tests.
  - `PipelineDetailFooter.stepConfigInvalid.test.tsx`.
  - `outputService.ts` (unchanged shape, plus a seam test).
- Tests: a backend route spec plus a committed response fixture shared with a frontend seam test.
- No migration, no wire-shape change, no new endpoint. Not touched: `RunConfigGate`, `AutoRunTriggerService`, `PipelineSchedulerService` or `PipelineRunService`. Lanes HEL-1504 (auto-run) and HEL-1476 (step configs) stay unaffected.
