## Backend

- `backend/src/main/resources/db/migration/V66__add_window_op.sql` — new migration extending `pipeline_steps_op_check` to accept `'window'` (drop/re-add per the `V50__add_splittext_op.sql` pattern). Confirmed max migration on `origin/main` (1bb95832) was `V65__add_pivot_op.sql` immediately before writing.
- `backend/src/main/scala/com/helio/domain/steps/WindowStep.scala` — new. `WindowConfig` case class + tolerant `decode`, `WindowStep.evaluate`/`apply` implementing partition → stable-order (index-tie-broken `Ordering`, not a stability claim on `sortWith`) → per-function computation (`row_number`/`rank`/`dense_rank`/`running_sum`/`lag`/`lead`) → merge-back-by-original-index, `companion`.
- `backend/src/main/scala/com/helio/domain/PipelineStep.scala` — registered `WindowStep.Kind -> WindowStep.companion` in `PipelineStep.Registry`; added `PipelineStepKind.Window`.
- `backend/src/main/scala/com/helio/domain/package.scala` — `WindowStep`/`WindowConfig` type + value aliases (mirrors the `Pivot` aliases).
- `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala` — `rowToDomain` match arm for `WindowConfig`.
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala` — `WindowStepResponse`, `windowConfigFormat` (`WindowConfig.format`), `windowStepResponseFormat` (`jsonFormat6`), wire-union `write`/`read` arms, `fromDomain` arm.
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepConfigCodec.scala` — `encodeConfig`/`extractConfig` arms for `WindowConfig`/`WindowStep`.
- `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala` — `"window"` dispatch case + `inferWindow`: output = input schema + `outputColumn` typed per function (integer for the rank family, number for `running_sum`, same-as-`field` for `lag`/`lead`, falling back to `string` for an unrecognized `function` — mirrors `aggResultType`'s `case _ => "string"` catch-all per the design-gate skeptic's note); replace-on-collision.
- `backend/src/main/scala/com/helio/api/protocols/PipelineAnalyzeProtocol.scala` — `WindowAnalyzeStepResponse` + union `write`/`read` arms.
- `backend/src/main/scala/com/helio/services/PipelineService.scala` — `toAnalyzeStepResponse` match arm for `WindowConfig`.

## Backend tests

- `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala` — round-trip execution tests: one per function (row_number, rank/dense_rank with a **tied** orderBy fixture per the design-gate skeptic's note, running_sum incl. non-numeric coercion, lag/lead incl. partition-edge nulls and default offset), unsupported-function error, non-positive-offset error, missing-field error, outputColumn collision, empty-`partitionBy` single-partition, null-partition-key-is-valid.
- `backend/src/test/scala/com/helio/domain/PipelineAnalyzeServiceSpec.scala` — `inferWindow` tests: integer type for rank family, number for running_sum, lag/lead type sourced from `field`'s schema entry (and string fallback when `field` is absent), unrecognized-function degrades to string, collision replace, malformed-config identity fallback.
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepConfigCodecSpec.scala` — decode/encode round-trip (including `field`/`offset` present and explicit-null), `decode({})` tolerance, `encodeConfig` round-trip case added to the all-kinds table.
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepProtocolSpec.scala` — `WindowStepResponse` added to the discriminated-union round-trip subtype list.
- `backend/src/test/scala/com/helio/domain/PipelineStepSpec.scala` — `window` added to `PipelineStepKind.All`, the `allSubtypes` list, the kind-string assertions, and the exhaustive pattern-match coverage test.

## Frontend

- `frontend/src/features/pipelines/types/pipelineStep.ts` — `WindowConfig`/`WindowFunction` wire type, `WindowStep`/`WindowAnalyzeStep` interfaces, union entries in `PipelineStep`, `PipelineStepConfig`, and `AnalyzeStepResult`.
- `frontend/src/features/pipelines/state/stepNarrowing.ts` — `OP_TYPES` entry (`faRankingStar` icon), `defaultConfigFor("window")` case, `windowConfigOf` narrowing helper.
- `frontend/src/features/pipelines/ui/WindowConfig.tsx` — new config editor: partition-by rows (mirrors `PivotConfig`'s index rows), order-by (reuses `SortConfig` directly rather than reimplementing an ordered-key-list editor), function dropdown, conditional source-field dropdown (running_sum/lag/lead) and offset input (lag/lead only), output-column text field.
- `frontend/src/features/pipelines/ui/WindowConfig.test.tsx` — new co-located test (function-dropdown options, field/offset conditional visibility per function, partition add/remove/change, order-by delegation, function/field/offset/outputColumn `onChange` wiring, offset validation).
- `frontend/src/features/pipelines/ui/StepCard.tsx` — renders `WindowConfig` when `step.opType.id === "window"`.
- `frontend/src/features/pipelines/hooks/useStepCardState.ts` — `windowConfig` state + `onWindowChange` handler (omits `field`/`offset` from the persisted PATCH when the selected function doesn't use them).

## MCP

- `helio-mcp/src/tools/write.ts` — `add_pipeline_step`'s description string documents the `window` config shape (`partitionBy`, `orderBy`, `function`, `field`, `outputColumn`, `offset`) and notes it appears in `analyze_pipeline`'s output schema (unlike `pivot`'s data-dependent columns).

## OpenSpec

- `openspec/changes/pipeline-op-window-partition-order/tasks.md` — all 21 tasks marked complete.
