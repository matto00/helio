# HEL-378: Pipeline op: date-bucket / resample (truncate a timestamp to day/week/month/quarter/year)

## Context

Time-series panels need a timestamp floored to a period so rows can be grouped by day/week/month/quarter/year. There is no such op today, which blocks the time-series smart shape (HEL-337, Epic: Smart Pipeline Shapes). Existing ops live in `backend/src/main/scala/com/helio/domain/steps/`; study `CastStep.scala` (per-field transform + codec) and `ComputeStep.scala` (appended column) as references.

## Scope

Backend:

* New `backend/src/main/scala/com/helio/domain/steps/DateBucketStep.scala` — `DateBucketConfig(field: String, granularity: String, outputColumn: Option[String])` + tolerant `decode` + `DateBucketStep.evaluate` + `companion`. Semantics: parse `field` (ISO date/timestamp string or epoch) and floor to the start of the `granularity` bucket (`day`/`week`/`month`/`quarter`/`year`); write the bucket start (canonical ISO date string) to `outputColumn` (default: overwrite `field`). Unparseable values → `null` for that row (parity with `CastStep`). Unsupported `granularity` fails at execute time with a descriptive error. No inline fully-qualified names.
* `PipelineStep.scala` — register + `PipelineStepKind.DateBucket`.
* `PipelineStepProtocol.scala` — `DateBucketStepResponse` + format + `jsonFormat6` + union arms + `fromDomain`.
* `PipelineStepConfigCodec.scala` — `encodeConfig` + `extractConfig` arms.
* `PipelineAnalyzeService.scala` — dispatch case + `inferDateBucket`: output = input schema with `outputColumn` typed `date` (append if new, replace if it collides with `field`).
* `PipelineAnalyzeProtocol.scala` — `DateBucketAnalyzeStepResponse` + union arms.
* Flyway migration — extend `pipeline_steps_op_check` to add `'datebucket'` (drop/re-add per `V50__add_splittext_op.sql`). Next available VNN, assigned at scheduling time (main at V59; three v1.6 lanes may contend).

Frontend:

* `types/pipelineStep.ts` — `DateBucketConfig` wire type.
* `state/stepNarrowing.ts` — `OP_TYPES` entry (label + icon), `defaultConfigFor` case, `dateBucketConfigOf` helper.
* New `ui/DateBucketConfig.tsx` editor (field select, granularity dropdown, optional outputColumn); wire into `StepCard.tsx` + `useStepCardState.ts`.

MCP:

* `helio-mcp/src/tools/write.ts` — add `datebucket` to `add_pipeline_step` + config shape.

## Acceptance criteria

- [ ] `datebucket` floors each supported granularity correctly (week boundary policy documented); unparseable → null; unsupported granularity fails with a descriptive error.
- [ ] `analyze_pipeline` yields `outputColumn` typed `date` (apply/infer parity for the appended/overwritten column).
- [ ] `pipeline_steps` op CHECK accepts `'datebucket'`; migration applies cleanly.
- [ ] Frontend StepCard renders a working editor; config PATCHes round-trip.
- [ ] MCP `add_pipeline_step` lists `datebucket` + config shape.
- [ ] Tests: round-trip execution (each granularity + unparseable) in `InProcessPipelineEngineSpec.scala`; analyze-schema test; codec round-trip; `PipelineStepSpec.scala` kind-parity updated.
- [ ] Backward compatible: additive; existing pipelines/rows unaffected.

## Out of scope

* Filling gaps (empty buckets) — resample here only floors; gap-filling is left to fill-null / the time-series shape.
* Timezone configuration beyond a single documented default (UTC).

## Dependencies

* None. Unblocks the time-series smart shape in HEL-337.

## Delivery notes (from orchestrator brief)

* MERGE HAZARD: this op adds a value to the `pipeline_steps_op_check` DB constraint (V50 pattern). Flyway V-numbers are NOT hardcoded across branches — assign the next free V-number at delivery/scheduling time and check main's current max first (ticket says main at V59 as of ticket authoring; verify against the actual worktree before writing the migration, since three v1.6 lanes may contend for the next number).
