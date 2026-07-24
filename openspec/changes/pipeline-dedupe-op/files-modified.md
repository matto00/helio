## Backend — domain step + op-surface wiring

- `backend/src/main/scala/com/helio/domain/steps/DedupeStep.scala` — new. `DedupeConfig(keys, keep)`, tolerant `decode` (normalizes any non-`"last"` value, including malformed/missing, to `"first"`), `DedupeStep.evaluate`/`apply` (single-pass seen-set for `keep=first`, lookahead last-index pass for `keep=last`, sorted-by-field-name whole-row key when `keys` is empty), and `companion`.
- `backend/src/main/resources/db/migration/V68__add_dedupe_op.sql` — new. Extends `pipeline_steps_op_check` to accept `'dedupe'` (drop/re-add pattern). Re-confirmed V68 is still the max migration number immediately before this delivery (no concurrent-lane collision).
- `backend/src/main/scala/com/helio/domain/PipelineStep.scala` — registers `DedupeStep` in `PipelineStep.Registry` and adds `PipelineStepKind.Dedupe`.
- `backend/src/main/scala/com/helio/domain/package.scala` — re-exports `DedupeStep`/`DedupeConfig` from `com.helio.domain.steps` into `com.helio.domain`.
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala` — `DedupeStepResponse` case class, `dedupeConfigFormat`/`dedupeStepResponseFormat` (`jsonFormat6`), union read/write arms, `fromDomain` arm.
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepConfigCodec.scala` — `encodeConfig`/`extractConfig` match arms for `DedupeConfig`/`DedupeStep`.
- `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala` — adds `"dedupe"` to the `filter`/`limit`/`sort` identity-passthrough dispatch group (`outputSchema == inputSchema`, no validation error).
- `backend/src/main/scala/com/helio/api/protocols/PipelineAnalyzeProtocol.scala` — `DedupeAnalyzeStepResponse` case class, format, union read/write arms.
- `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala` — `rowToDomain` match arm for `DedupeConfig` → `DedupeStep`.
- `backend/src/main/scala/com/helio/services/PipelineService.scala` — `toAnalyzeStepResponse` match arm for `DedupeConfig` → `DedupeAnalyzeStepResponse`, plus the corresponding imports.

## Backend — tests

- `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala` — six new `dedupe:` engine round-trip tests (whole-row distinct, key-set keep=first, key-set keep=last, null-key collapse, missing-keep defaults to first, stable-order preservation), plus a `DedupeConfig` arm in the shared `makeStep` helper.
- `backend/src/test/scala/com/helio/domain/PipelineAnalyzeServiceSpec.scala` — `dedupe — identity: outputSchema equals inputSchema` test alongside the existing `filter`/`limit`/`sort` identity tests.
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepConfigCodecSpec.scala` — preserve/tolerance/round-trip coverage for `DedupeConfig`, including the malformed-`keep`-falls-back-to-`first` regression case.
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepProtocolSpec.scala` — `DedupeStepResponse` added to the discriminated-union round-trip subtype list.
- `backend/src/test/scala/com/helio/domain/PipelineStepSpec.scala` — `dedupe` added to the kind-parity (`PipelineStepKind.All`), per-subtype `kind` check, and exhaustive pattern-match coverage test.

## Frontend

- `frontend/src/features/pipelines/types/pipelineStep.ts` — `DedupeConfig`, `DedupeStep`, `DedupeAnalyzeStep` wire types; wired into the `PipelineStep`/`PipelineStepConfig`/`AnalyzeStepResult` discriminated unions.
- `frontend/src/features/pipelines/state/stepNarrowing.ts` — `OP_TYPES` entry ("Dedupe rows", `faClone`), `defaultConfigFor("dedupe")` seed (`{keys: [], keep: "first"}`), `dedupeConfigOf` narrowing helper.
- `frontend/src/features/pipelines/ui/DedupeConfig.tsx` — new. Key-fields checklist (reuses `SelectFieldsConfig`'s checkbox-list markup/classes — the correct sibling pattern for a flat `Vector[String]` field set, as opposed to the add-row `Select` pattern `PivotConfig`/`UnpivotConfig` use for ordered field lists) + first/last toggle (reuses the filter-combinator toggle-button recipe).
- `frontend/src/features/pipelines/ui/DedupeConfig.test.tsx` — new. Covers key selection/deselection, empty-keys whole-row-distinct initial state, empty-columns rendering, and first/last toggle `onChange` behavior including `aria-pressed`.
- `frontend/src/features/pipelines/ui/StepCard.tsx` — imports `DedupeConfig`, renders it when `step.opType.id === "dedupe"`.
- `frontend/src/features/pipelines/hooks/useStepCardState.ts` — `dedupeConfig` state + `onDedupeChange` handler, following the same during-render sync + PATCH-on-change pattern as the other op kinds.

## MCP

- `helio-mcp/src/tools/write.ts` — `add_pipeline_step`'s `type` enumeration and description string document `dedupe` and its `{keys, keep}` config shape (no schema change — `type` is free-text `z.string()`).
