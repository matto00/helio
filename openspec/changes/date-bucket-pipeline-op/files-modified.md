## Backend

- `backend/src/main/scala/com/helio/domain/steps/DateBucketStep.scala` — new: `DateBucketConfig` (field/granularity/outputColumn) + tolerant `decode` + `DateBucketStep.evaluate` (UTC flooring, epoch heuristic, null-on-unparseable, failed-Future on unsupported granularity) + `companion`.
- `backend/src/main/scala/com/helio/domain/PipelineStep.scala` — registered `DateBucketStep` in `PipelineStep.Registry` and added `PipelineStepKind.DateBucket`.
- `backend/src/main/scala/com/helio/domain/package.scala` — re-exported `DateBucketStep`/`DateBucketConfig` type+val aliases (same pattern every prior step kind uses).
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala` — added `DateBucketStepResponse` + format + discriminated-union read/write arms + `fromDomain` case.
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepConfigCodec.scala` — added `encodeConfig`/`extractConfig` arms for `DateBucketConfig`/`DateBucketStep`.
- `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala` — added `"datebucket"` dispatch arm + `inferDateBucket` (filterNot + `:+` replace-or-append, typed `date`).
- `backend/src/main/scala/com/helio/api/protocols/PipelineAnalyzeProtocol.scala` — added `DateBucketAnalyzeStepResponse` + format + union arms.
- `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala` — added `DateBucketConfig` row-decode arm to `rowToDomain`.
- `backend/src/main/scala/com/helio/services/PipelineService.scala` — added `DateBucketConfig` arm to `toAnalyzeStepResponse`.
- `backend/src/main/resources/db/migration/V64__add_datebucket_op.sql` — new: extends `pipeline_steps_op_check` to accept `'datebucket'` (drop/re-add pattern, V63 was max at write time — reconfirmed, no concurrent-lane collision).

## Backend tests

- `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala` — added `makeStep` case + 9 execution tests (day/week/month/quarter/year flooring, epoch-seconds, epoch-millis, outputColumn append, unparseable→null, unsupported-granularity execute-time failure).
- `backend/src/test/scala/com/helio/domain/PipelineAnalyzeServiceSpec.scala` — added overwrite-in-place, new-outputColumn-append, and malformed-config inference tests.
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepConfigCodecSpec.scala` — added decode-preserve tests (with/without outputColumn), decode({}) tolerance test, and an encode round-trip case.
- `backend/src/test/scala/com/helio/domain/PipelineStepSpec.scala` — added `datebucket` to the kind-parity/exhaustiveness assertions (13 → 14 kinds).
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepProtocolSpec.scala` — added `DateBucketStepResponse` to the discriminated-union round-trip subtypes list.

## Frontend

- `frontend/src/features/pipelines/types/pipelineStep.ts` — added `DateBucketConfig`, `DateBucketStep`, `DateBucketAnalyzeStep` + their union-type entries.
- `frontend/src/features/pipelines/state/stepNarrowing.ts` — added `datebucket` to `OP_TYPES` (label + `faCalendarWeek` icon), `defaultConfigFor` case, and `dateBucketConfigOf` narrowing helper.
- `frontend/src/features/pipelines/ui/DateBucketConfig.tsx` — new: field select (from `analyzeColumns`, unfiltered — mirrors cast), granularity select (5 fixed options), optional output-column text input.
- `frontend/src/features/pipelines/ui/DateBucketConfig.test.tsx` — new: field-select, granularity-select, output-column-input interaction tests.
- `frontend/src/features/pipelines/hooks/useStepCardState.ts` — added `dateBucketConfig` state + `onDateBucketChange` handler (blank `outputColumn` omitted from the PATCH payload rather than persisted as `""`).
- `frontend/src/features/pipelines/ui/StepCard.tsx` — wired `DateBucketConfig` into the per-op editor switch.

## MCP

- `helio-mcp/src/tools/write.ts` — `add_pipeline_step`'s description now lists `datebucket` and documents its config shape. Note: `type` is `z.string().min(1)` (free text), not a `z.enum` — there is no enum to extend structurally; per the orchestrator's flagged caveat, the change targets the tool's descriptive text instead.

## Root cause / probe notes (systematic-debugging.md)

No bugs were hit during this change — it is new, additive functionality following an established per-op template. No fix-without-root-cause situations arose.
