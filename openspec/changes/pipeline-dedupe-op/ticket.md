# HEL-382: Pipeline op: dedupe / distinct (by key set, keep first/last)

## Context

There is no way to drop duplicate rows. Users need "distinct rows" and "one row per key, keep first/last". Existing ops live in `backend/src/main/scala/com/helio/domain/steps/`; study `LimitStep.scala` (pure row filter, no schema change) and `SortStep.scala` as templates.

## Scope

Backend:

* New `backend/src/main/scala/com/helio/domain/steps/DedupeStep.scala` — `DedupeConfig(keys: Vector[String], keep: String)` + tolerant `decode` + `DedupeStep.evaluate` + `companion`. Semantics: if `keys` is empty, dedupe on the whole row; else on the `keys` tuple. `keep` = `first` (default) or `last` in incoming row order. Preserve overall order (stable). No inline fully-qualified names.
* `PipelineStep.scala` — register + `PipelineStepKind.Dedupe`.
* `PipelineStepProtocol.scala` — `DedupeStepResponse` + format + `jsonFormat6` + union arms + `fromDomain`.
* `PipelineStepConfigCodec.scala` — `encodeConfig` + `extractConfig` arms.
* `PipelineAnalyzeService.scala` — dispatch case: output schema == input schema unchanged (add `'dedupe'` to the passthrough group alongside `filter`/`limit`/`sort`).
* `PipelineAnalyzeProtocol.scala` — `DedupeAnalyzeStepResponse` + union arms.
* Flyway migration — extend `pipeline_steps_op_check` to add `'dedupe'` (drop/re-add per `V50__add_splittext_op.sql`). Next available VNN, assigned at scheduling time. **MERGE HAZARD**: worktree base already has V67 (`add_unpivot_op.sql`, HEL-380/PR #282). Re-confirm the current max migration number immediately before writing the migration AND again right before the delivery push — other v1.6 lanes may be contending for the same V-number.

Frontend:

* `types/pipelineStep.ts` — `DedupeConfig` wire type.
* `state/stepNarrowing.ts` — `OP_TYPES` entry (label + icon), `defaultConfigFor` case, `dedupeConfigOf` helper.
* New `ui/DedupeConfig.tsx` editor (keys multi-select, keep first/last toggle); wire into `StepCard.tsx` + `useStepCardState.ts`.

MCP:

* `helio-mcp/src/tools/write.ts` — add `dedupe` to `add_pipeline_step` + config shape. Note: `type` param on `add_pipeline_step` is free-text `z.string()`, NOT an enum — document the new op in the tool description string.

## Design guidance (from orchestrator brief)

Dedupe is the simplest op class so far — a pure ROW FILTER that does NOT change the schema (output schema == input schema, exactly like `LimitStep`). `inferDedupe`/analyze passthrough is therefore identity on the input schema. The design must pin down:

- **Keep semantics**: first vs last occurrence, determined by original input row order (not re-sorted).
- **Empty/all-columns keys**: empty `keys` vector means whole-row distinct (compare entire row tuple).
- **Null-key handling**: nulls participate in key-tuple equality like any other value (null == null for dedupe-key purposes).
- **Stable ordering**: preserve the original relative order of the kept rows (do not reorder by key). Study `LimitStep` for the schema-passthrough infer pattern and `SortStep` for stable-ordering precedent.

## Acceptance criteria

- [ ] `dedupe` removes duplicates by key set (or whole row when keys empty), honoring keep first/last, stable order.
- [ ] `analyze_pipeline` returns the input schema unchanged (identity passthrough).
- [ ] `pipeline_steps` op CHECK accepts `'dedupe'`; migration applies cleanly.
- [ ] Frontend StepCard renders a working editor; config PATCHes round-trip.
- [ ] MCP `add_pipeline_step` lists `dedupe` + config shape.
- [ ] Tests: round-trip execution (whole-row + key-set, first + last) in `InProcessPipelineEngineSpec.scala`; analyze passthrough test; codec round-trip; `PipelineStepSpec.scala` kind-parity updated.
- [ ] Backward compatible: additive; existing pipelines/rows unaffected.

## Out of scope

* DAG/branching — chains linearly.

## Dependencies

* None.

## Consumers to update (exhaustive-match sites — grep an existing op like `sort`/`limit`/`unpivot` to find current instances)

* `backend/src/main/scala/com/helio/domain/package.scala`
* `PipelineStepRepository.rowToDomain`
* `PipelineService.toAnalyzeStepResponse`
* `frontend/src/**/stepNarrowing.ts`
