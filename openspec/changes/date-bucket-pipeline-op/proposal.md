## Why

Time-series panels need a timestamp floored to a period (day/week/month/quarter/year) so rows can
be grouped for the upcoming time-series smart shape (HEL-337). No pipeline op today performs this
truncation; today's only path is `compute`, which cannot express date-flooring cleanly. This is
the first leaf ticket of the HEL-336 Pipeline Op Expansion epic.

## What Changes

- New `datebucket` pipeline op: parses `field` (ISO date/timestamp string or epoch) and floors it
  to the start of the `granularity` bucket (`day`/`week`/`month`/`quarter`/`year`), writing the
  canonical ISO date string to `outputColumn` (default: overwrite `field`).
- Unparseable input values become `null` for that row (parity with the existing `cast` op).
  Unsupported `granularity` values fail at execute time with a descriptive error.
- `analyze_pipeline` inference gains `datebucket` support: output schema = input schema with
  `outputColumn` typed `date` (append if new, replace if it collides with `field`).
- Flyway migration extends the `pipeline_steps_op_check` constraint to accept `'datebucket'`
  (additive, drop/re-add pattern).
- Frontend `StepCard` gains a `datebucket` config editor (field select, granularity dropdown,
  optional output-column input).
- `helio-mcp` `add_pipeline_step` tool lists `datebucket` and its config shape.

## Capabilities

### New Capabilities
- `pipeline-date-bucket-op`: execution semantics, config shape, analyze-inference parity, and the
  frontend step-card editor for the new `datebucket` pipeline op.

### Modified Capabilities
(none — `pipeline-analyze-api` and `mcp-*` are extended additively with a new dispatch arm, not a
behavior change to existing requirements)

## Non-goals

- Filling gaps (empty buckets) between resampled rows — left to fill-null / the time-series shape.
- Timezone configuration beyond a single documented UTC default.

## Impact

- Backend: new `DateBucketStep.scala`; edits to `PipelineStep.scala`, `PipelineStepProtocol.scala`,
  `PipelineStepConfigCodec.scala`, `PipelineAnalyzeService.scala`, `PipelineAnalyzeProtocol.scala`;
  one new Flyway migration (next free `VNN` — confirm current max at execution time; concurrent
  v1.6 lanes may also be claiming numbers).
- Frontend: `types/pipelineStep.ts`, `state/stepNarrowing.ts`, new `ui/DateBucketConfig.tsx`,
  `StepCard.tsx`, `useStepCardState.ts`.
- MCP: `helio-mcp/src/tools/write.ts`.
- Tests: `InProcessPipelineEngineSpec.scala` (execution + granularities + unparseable), analyze
  schema test, codec round-trip, `PipelineStepSpec.scala` kind-parity.
- Backward compatible; purely additive.
