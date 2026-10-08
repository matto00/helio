## Why

The `aggregate` pipeline step only supports `sum`/`avg`/`min`/`max`/`count`. The helio-news CI Health
dashboard needed duration p50/p90/p95 and distinct failing-test counts, and had to compute them in
Python outside Helio (HEL-1310). Median, percentiles and distinct counts are table-stakes
aggregations for any dashboard builder.

## What Changes

- `AggregateStep.SupportedFunctions` gains `median`, `percentile` and `count_distinct`; the
  in-process engine computes them on grouped and ungrouped input with defined empty/null handling.
- `Aggregation` gains an optional numeric `p` (0–100 inclusive), required for — and only allowed on —
  `percentile`.
- Write-time validation (`AggregateStep.companion.validateRawConfig`, the path step create/update,
  proposal validate/apply, MCP and patch-set apply already use) rejects `percentile` without `p`,
  with a non-finite or out-of-range `p`, `p` on any other fn, **and — newly — an unsupported fn
  name** (previously accepted on write and only failing at analyze/run). Analyze and the auto-run
  gate (`stepConfigProblem`) report the same problem once; the engine's apply path rejects the same
  configs (`StepConfigError`) for anything already stored.
- Analyze type inference: `median`/`percentile` → `float`, `count_distinct` → `integer`, driven by
  one shared result-type table that a parity test checks against `apply` for every supported fn.
- Frontend `AggregateConfig` fn picker offers the three new functions with hints, and a `p` input
  appears only for `percentile`.
- Agent-facing docs that enumerate aggregate functions (RefinementPrompt, RefinementEditShape) are
  derived from / guarded against `SupportedFunctions` so they cannot drift.
- No new op, no Flyway migration, no change to the Output render-time `aggregation` (HEL-1313) or to
  the smart shapes' (single-row / time-series / pivot-matrix) own function lists.

## Capabilities

### New Capabilities

### Modified Capabilities
- `pipeline-aggregate-op`: adds median, percentile (with `p`) and count_distinct to the aggregate
  step's execution, validation, type inference and editor.

## Impact

- Backend: `domain/steps/AggregateStep.scala`, `domain/engine/PipelineAnalyzeService.scala`
  (`validateAggregate`, `inferAggregate`/`aggResultType` aggregate path only),
  `services/patchsets/RefinementPrompt.scala`, `RefinementEditShape.scala`; specs.
- Frontend: `features/pipelines/ui/stepConfigs/AggregateConfig.tsx`, `types/pipelineStep.ts`,
  `state/stepNarrowing.ts` if it narrows aggregation rows; tests.
- helio-mcp: no aggregate function list exists to update (verified by grep); configs pass through to
  backend validation.
- Spark path: `SparkJobSubmitter` does not compile `AggregateStep` at all (throws "not yet supported")
  — no parity obligation.
