# Files Modified — HEL-860

- `backend/src/main/scala/com/helio/domain/model/PipelineStep.scala` — added the defaulted `Companion.validateRawConfig(raw: String): Option[String] = None` seam (Decision 1).
- `backend/src/main/scala/com/helio/domain/steps/StepCodecUtil.scala` — added the shared `requireStringMap` write-path check used by `cast`/`rename`.
- `backend/src/main/scala/com/helio/domain/steps/CastStep.scala` — overrode `validateRawConfig` for `casts`; `CastConfig.decode` left byte-for-byte unchanged.
- `backend/src/main/scala/com/helio/domain/steps/RenameStep.scala` — overrode `validateRawConfig` for `renames`; `RenameConfig.decode` left byte-for-byte unchanged.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — wired `validateRawConfig` into `addStep` and `updateStep`, mapped to `ServiceError.UnprocessableEntity` (422), before the existing tolerant `PipelineStepConfigCodec.decode` call.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeRoutesSpec.scala` — HEL-859 coverage debt (task 1: `aggregate`/`groupby`/`pivot`/`union`/`join` validator failure paths + the multi-failure join) and task 2.1a's negative test (raw `sqlu` insert of a mistyped stored `cast` config, proving `GET /pipelines/:id/analyze` cannot report it).
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAnalyzeProposalRoutesSpec.scala` — task 2.1's positive test proving the raw-config contract holds on `POST /pipelines/analyze-proposal`.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineStepRoutesSpec.scala` — task 4 rejection-path tests (AC1, AC2, AC5) plus the correctly-shaped-config and legacy-read-path regression tests (AC3).
