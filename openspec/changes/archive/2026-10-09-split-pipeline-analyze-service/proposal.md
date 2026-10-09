## Why

`backend/src/main/scala/com/helio/domain/engine/PipelineAnalyzeService.scala` is 1201 lines at origin/main ecaa1a53,
nearly 5x CONTRIBUTING.md's ~250-line budget. It mixes four concerns: the `SchemaField` type, step-config validation
(`validateStepConfig`, the body behind `stepConfigProblem`), per-op schema inference (`inferOutputSchema` and 22
`infer*` helpers), and the analyze/analyzeNodes DAG walk. Every new op or validation rule lands in the same file.

## What Changes

- Move `SchemaField`, step-config validation, and per-op schema inference out of `PipelineAnalyzeService.scala` into
  focused files in the same package (`com.helio.domain.engine`), bodies byte-identical.
- `PipelineAnalyzeService` keeps every public and `private[engine]` member with an unchanged signature;
  `stepConfigProblem` stays there as the single shared entry point that analyze, dataset-write auto-run
  (`AutoRunTriggerService`) and the fire-time gate (`RunConfigGate`) all go through.
- HEL-1279 nits: sort `AutoRunTriggerServiceSpec.scala` imports; reflow the over-long comment lines at
  `PipelineAnalyzeProtocol.scala:237` and `AutoRunTriggerService.scala:122` (was :116 when filed).
- No behaviour change, no wire change, no test-source change beyond the import sort.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Pure structural refactor; `.openspec.yaml` sets `skip_specs: true`.

## Non-goals

- The ticket's "cost/canRun classification" seam: no such logic lives in this file (it is in `PipelineService`,
  `PipelineCostEstimator`, `RunConfigGate`), so there is nothing to split out.
- Fixing defects or oddities found while moving code. They become follow-up tickets.
- Reflowing any other over-long line in the touched files.
- Changing any caller (`PipelineService`, `RunConfigGate`, `AutoRunTriggerService`, protocols, specs).

## Impact

- Backend only: `domain/engine/` gains new files; `PipelineAnalyzeService.scala` shrinks to about 300 lines.
- `domain/engine/README.md` Holds list updated.
- Concurrent lane HEL-1393 (`PipelineRunService` tidy) touches no file in this change.
