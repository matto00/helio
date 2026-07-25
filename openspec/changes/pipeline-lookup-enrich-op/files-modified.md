## Backend

- `backend/src/main/scala/com/helio/domain/steps/LookupStep.scala` — new: `LookupConfig` + tolerant `decode`, `LookupStep.evaluate` (async single-key left-join against a reference `DataSource`, first-match-wins, null-fill on no-match, reference-value-wins on collision), `LookupStep.companion`.
- `backend/src/main/scala/com/helio/domain/PipelineStep.scala` — register `LookupStep.Kind -> LookupStep.companion` in the registry and `PipelineStepKind.Lookup` constant.
- `backend/src/main/scala/com/helio/domain/package.scala` — `LookupStep`/`LookupConfig` type + val aliases re-exported into `com.helio.domain`.
- `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala` — `rowToDomain` gains the `LookupConfig -> LookupStep` case.
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala` — `LookupStepResponse` + `jsonFormat6` + `lookupConfigFormat` + write/read discriminated-union arms + `fromDomain` case.
- `backend/src/main/scala/com/helio/api/protocols/PipelineStepConfigCodec.scala` — `encodeConfig`/`extractConfig` arms for `LookupConfig`/`LookupStep`.
- `backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala` — `inferLookup` dispatch case: appends each `columns` entry typed `string`, collision-safe (`filterNot` + `:+` per column); dedicated dispatch case (not identity-passthrough, not unknown-op fallback).
- `backend/src/main/scala/com/helio/api/protocols/PipelineAnalyzeProtocol.scala` — `LookupAnalyzeStepResponse` + write/read union-arm dispatch.
- `backend/src/main/scala/com/helio/services/PipelineService.scala` — `toAnalyzeStepResponse` gains the `LookupConfig` arm; `addStep` and `updateStep` each gain a `lookupCheckF` pre-flight ACL check (`findByIdOwned` on `LookupConfig.referenceDataSourceId`), chained after `unionCheckF`, mirroring the `join`/`union` cross-tenant ACL pattern.
- `backend/src/main/resources/db/migration/V72__add_lookup_op.sql` — new: extends `pipeline_steps_op_check` to accept `'lookup'` (drop/re-add pattern, V72 confirmed free both at scheduling and delivery time).

## Backend tests

- `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala` — `makeStep` gains the `LookupConfig` case; new `lookup op:` test block covering match/no-match/first-match-wins/collision/only-named-columns/missing-and-unresolvable-reference-source scenarios.
- `backend/src/test/scala/com/helio/domain/PipelineAnalyzeServiceSpec.scala` — new `lookup —` tests: additive typed-string append, replace-in-place collision, empty-columns no-op.
- `backend/src/test/scala/com/helio/api/protocols/PipelineStepConfigCodecSpec.scala` — new `lookup` round-trip, tolerant-decode({}), and encode/decode cross-cases.
- `backend/src/test/scala/com/helio/domain/PipelineStepSpec.scala` — kind-parity assertions (`PipelineStepKind.All`, per-subtype `kind`, exhaustive pattern match) updated to include `lookup`.
- `backend/src/test/scala/com/helio/api/PipelineStepRoutesSpec.scala` — `lookupReq` fixture; new POST cross-user-404 / POST own-source-201 / PATCH cross-user-404-config-unchanged tests mirroring the join/union ACL test pairs.

## Frontend

- `frontend/src/features/pipelines/types/pipelineStep.ts` — `LookupConfig`/`LookupStep`/`LookupAnalyzeStep` wire types, added to `PipelineStep`/`PipelineStepConfig`/`AnalyzeStepResult` discriminated unions.
- `frontend/src/features/pipelines/state/stepNarrowing.ts` — `lookup` added to `OP_TYPES` (picker), `defaultConfigFor("lookup")` case, `lookupConfigOf` narrowing helper.
- `frontend/src/features/pipelines/ui/LookupConfig.tsx` — new: reference-source picker (redux `sources` slice), `sourceKey` `Select` sourced from `analyzeSchema`, free-text `lookupKey` `TextField`, free-text `columns` add/remove row list.
- `frontend/src/features/pipelines/ui/StepCard.tsx` — wires `LookupConfig` in for `step.opType.id === "lookup"`.
- `frontend/src/features/pipelines/hooks/useStepCardState.ts` — `lookupConfig` state + `onLookupChange` handler, PATCH-on-change via `persist`.

## Frontend tests

- `frontend/src/features/pipelines/ui/LookupConfig.test.tsx` — new: reference-source picker population/selection, sourceKey selection, lookupKey text input, columns add/edit/remove row behavior.
- `frontend/src/features/pipelines/state/stepNarrowing.test.ts` — new `stepNarrowing — lookup` describe block mirroring the existing union coverage (picker inclusion, default config, `lookupConfigOf` narrowing + fallback).

## MCP

- `helio-mcp/src/tools/write.ts` — `add_pipeline_step` tool description documents `lookup` + its config shape (`referenceDataSourceId`, `sourceKey`, `lookupKey`, `columns`), match/no-match/multi-match/collision semantics, and the additive best-effort-string analyze-schema behavior.

## OpenSpec

- `openspec/changes/pipeline-lookup-enrich-op/tasks.md` — all 25 tasks marked complete.
- `openspec/changes/pipeline-lookup-enrich-op/files-modified.md` — this file.

## Cycle 2 — evaluation-1.md change requests

**Bug fix (change requests 1+2): creation-time ACL check 404s the picker's own empty-default `lookup` config.**

- **Root cause** (failing layer: backend service pre-flight ACL, `PipelineService.addStep`/`updateStep`): `lookupCheckF`'s `case lc: LookupConfig =>` arm called `dataSourceRepo.findByIdOwned(DataSourceId(lc.referenceDataSourceId), user)` unconditionally, including when `referenceDataSourceId` is the empty-string default the "+ Add transformation step" picker sends (`defaultConfigFor("lookup")` in `stepNarrowing.ts`); `findByIdOwned("")` always resolves `None` → `404`, so a lookup step could never be created via the primary UI flow.
- **Probe**: read `PipelineService.scala:294-301` (pre-fix) and traced `defaultConfigFor("lookup")` in `stepNarrowing.ts:194-200` against the `lookupCheckF` match arm — confirmed no guard on `referenceDataSourceId` non-emptiness, unlike the `case _ => Right(())` fallback every other config type falls through to. Independently reproduced via the new `PipelineStepRoutesSpec` test *before* the fix: `POST` with the picker's exact empty-default config returned `404 Not Found` (matching the evaluator's live browser repro).
- **Probe output (before fix)**: new test `"POST with lookup type and the picker's exact empty-default config succeeds (201), reference source unset"` failed with `404 != 201` when run against the unguarded `lookupCheckF`.
- **Fix**: guarded both `addStep`'s and `updateStep`'s `lookupCheckF` arms to `case lc: LookupConfig if lc.referenceDataSourceId.nonEmpty => ...`, falling through to `case _ => Future.successful(Right(()))` when empty — `backend/src/main/scala/com/helio/services/PipelineService.scala` (~line 294-301 `addStep`, ~line 405-412 `updateStep`).
- **Probe output (after fix)**: the same test now passes (`201 Created`, `referenceDataSourceId` unset `""`); all pre-existing non-empty cross-user-404/own-source-201/PATCH-404 lookup ACL tests still pass unchanged (fresh `sbt test`: 1924/1924, 0 failed — see gate output in final summary).

**Files touched in cycle 2:**

- `backend/src/main/scala/com/helio/services/PipelineService.scala` — guarded `lookupCheckF`'s `LookupConfig` arm in both `addStep` and `updateStep` with `if lc.referenceDataSourceId.nonEmpty`. `unionCheckF` (identical pre-existing defect, HEL-384) deliberately left untouched — out of scope per the coordinator's instructions; spinoff HEL-620 owns it.
- `backend/src/test/scala/com/helio/api/PipelineStepRoutesSpec.scala` — new `lookupDefaultReq()` fixture (mirrors the picker's exact `defaultConfigFor("lookup")` payload); new regression tests `"POST with lookup type and the picker's exact empty-default config succeeds (201), reference source unset"` and `"PATCH lookup step config to an empty referenceDataSourceId stays allowed (200)"`.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.tsx` — `handleAddStep`'s bare `catch {}` now pushes a `useToast()` error toast (`Failed to add <op label> step: <message>`) instead of silently keeping an unpersisted temp step with no feedback. Scoped to error surfacing only — the add-step flow itself (temp-step-then-replace) is unchanged.
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — added `toasts: toastsReducer` to the test store; new regression test `"a failed add-step POST pushes an error toast"` asserting an error-variant toast is dispatched when `createPipelineStep` rejects.
