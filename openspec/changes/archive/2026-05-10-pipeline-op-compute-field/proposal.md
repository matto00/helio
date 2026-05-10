## Why

The pipeline editor has no way to create derived fields — users cannot compute a new column from
existing ones (e.g. `revenue / users`, `price * quantity`). This op closes that gap.

## What Changes

- **Fix config shape divergence**: `inferCompute` currently uses `{"outputs":[{"name","type"}]}` while
  `applyCompute` uses `{"column","expression"}`. Unify both to `{"column","expression","type"}` so
  inference and execution share one config contract.
- **Backend** `PipelineAnalyzeService.inferCompute`: read unified `column`/`type` keys.
- **Backend** `InProcessPipelineEngine.applyCompute`: already correct (`column`/`expression`); no change needed
  beyond ensuring `type` is tolerated in the config (it is, since extra keys are ignored by the parser).
- **Frontend**: add `ComputeFieldConfig` React component: output field name (text) + expression
  (text) + optional available-fields hint list. Wire into `StepCard` for `op: "compute"`.
- **Initial config** when step is added: `{"column":"","expression":"","type":"number"}`.
- **Tests**: `ComputeFieldConfig.test.tsx` (frontend) + backend ScalaTest covering `applyCompute`
  and `inferCompute` with the unified shape.

## Capabilities

### New Capabilities

- `pipeline-compute-op`: compute step config UI (ComputeFieldConfig) + unified backend config shape

### Modified Capabilities

- `pipeline-analyze-api`: `inferCompute` changes its config shape expectation from `outputs[]` to
  `{"column","expression","type"}`

## Impact

- `PipelineAnalyzeService.scala` — `inferCompute` method updated
- `PipelineDetailPage.tsx` — StepCard wired for compute op
- `ComputeFieldConfig.tsx` (new), `ComputeFieldConfig.test.tsx` (new)
- Backend test: `InProcessPipelineEngineSpec` or new `ComputeOpSpec`

## Non-goals

- Multi-output compute (one expression → one new column per step)
- Expression builder / syntax highlighting UI
- Spark-path compute (only in-process engine for now)
- Aggregate functions in expressions (only arithmetic + field refs)
