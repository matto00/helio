## Backend

- `backend/src/main/scala/com/helio/api/protocols/PipelineProtocol.scala` — new `AssertionFailureDetail`/`AssertionSummary`/`AssertionStatusResponse` case classes + JSON formats; `PipelineRunRecord` gains non-optional `assertions: AssertionSummary = AssertionSummary()`.
- `backend/src/main/scala/com/helio/api/package.scala` — re-exports for the three new protocol types (matches this file's existing `com.helio.api._` convenience-import convention for every other protocol type).
- `backend/src/main/scala/com/helio/infrastructure/PipelineRunRepository.scala` — new `findLatestRunIdByOutputDataTypeIdInternal(dataTypeId)`, joins `pipelinesTable`/`runsTable`, filters out `status == "dry_run"` (design gate's round-1 REFUTE finding).
- `backend/src/main/scala/com/helio/services/PipelineRunService.scala` — `history()` extended to compute each run's `AssertionSummary` via a bounded `Future.traverse` over `listAssertionsByRunInternal`; new `assertionStatusForDataType(dataTypeId)` composing the new repo method with `listAssertionsByRunInternal`.
- `backend/src/main/scala/com/helio/api/routes/DataTypeRoutes.scala` — new `GET /api/types/:id/assertion-status` route, ACL-gated via the existing `dataTypeService.findById(id, user)` check; constructor gains a `pipelineRunService` param.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — threads `pipelineRunService` into the `DataTypeRoutes` constructor call.

## Backend tests

- `backend/src/test/scala/com/helio/infrastructure/PipelineRunRepositorySpec.scala` — `findLatestRunIdByOutputDataTypeIdInternal` round-trip, dry-run exclusion (dedicated design-gate case), only-dry-runs case.
- `backend/src/test/scala/com/helio/services/PipelineRunServiceSpec.scala` — `history()`'s per-run `AssertionSummary` counts (mixed pass/warn/error, zero-valued for no-assert-steps run).
- `backend/src/test/scala/com/helio/api/routes/DataTypeRoutesSpec.scala` — `GET /types/:id/assertion-status`: no-run case, error-severity-failure case, warn-only case, and the dedicated dry-run-after-clean-real-run case; constructor updated for the new `pipelineRunService` param.
- `backend/src/test/scala/com/helio/api/routes/DataTypeDataSourceAclSpec.scala` — cross-user 404 test for the new route; constructor/fixture updates for the new `pipelineRunService` param.
- `backend/src/test/scala/com/helio/api/routes/ResourceTaggingSpec.scala` — constructor/fixture updates only (new `DataTypeRoutes` param), no new assertions.

## Schemas

- `schemas/pipeline-run-record.schema.json` — adds required `assertions` object (`$defs.AssertionSummary`/`AssertionFailureDetail`).
- `schemas/data-type-assertion-status.schema.json` — new schema for `AssertionStatusResponse`.

## Frontend

- `frontend/src/features/pipelines/types/pipelineStep.ts` — new `AssertionFailureDetail`/`AssertionSummary` types; `PipelineRunRecord` gains `assertions: AssertionSummary`.
- `frontend/src/features/pipelines/services/pipelineService.ts` — `normalizeRunRecord` defensively defaults `assertions` to a zero-valued summary (mirrors the existing `triggerSource` defaulting).
- `frontend/src/features/pipelines/ui/RunHistoryModal.tsx` — renders each run's pass/fail-by-severity summary (hidden when zero-valued); broadens the expand toggle to `(status === "failed" && errorLog) || assertions.failures.length > 0`; expanded body now also renders a failing-rules list.
- `frontend/src/features/pipelines/ui/RunHistoryModal.css` — styles for the new summary chip + failing-rules list, using existing `--app-error`/`--app-warning`/`--app-text-muted` tokens. **Cycle 2:** replaced three hardcoded px values in `.run-history-modal__assertion-failures`/`.run-history-modal__assertion-failure` (`margin: 8px 0 0` → `var(--space-2) 0 0`, `gap: 6px` → `var(--space-2)`, `padding: 8px 10px` → `var(--space-2) var(--space-3)`) with DESIGN.md §3 `--space-*` tokens per evaluator Change Request 1 — the pre-existing `.run-history-modal__row-error` violation nearby (lines 109-118) is unchanged, out of scope.
- `frontend/src/features/dataTypes/types/dataType.ts` — new `AssertionStatusResponse` type.
- `frontend/src/features/dataTypes/services/dataTypeService.ts` — new `fetchAssertionStatus(id)` hitting `GET /api/types/:id/assertion-status`.
- `frontend/src/features/dataTypes/state/dataTypesSlice.ts` — new `assertionStatusByDataTypeId`/`assertionStatusPendingIds` cache state, `fetchAssertionStatus` thunk (dedupes via `condition`), `selectAssertionInvalid` selector.
- `frontend/src/features/panels/ui/PanelCard.tsx` — dispatches `fetchAssertionStatus` keyed by `getDataTypeId(panel)` on mount; renders an "Invalid data" badge when the cached status is `invalid: true`.
- `frontend/src/features/panels/ui/PanelGrid.css` — new `.panel-grid-card__type-badge--invalid` modifier (`--app-error` intent), same chip recipe as the existing type badge.
- `frontend/src/test/renderWithStore.tsx` — `dataTypes` preloaded-state normalization gains the two new cache fields (load-bearing fix: any test passing `preloadedState` while rendering a bound `PanelCard` would otherwise throw reading `assertionStatusByDataTypeId` off `undefined`).

## Frontend tests

- `frontend/src/features/pipelines/ui/RunHistoryModal.test.tsx` (new) — summary rendering, zero-valued-summary hides the chip, expand toggle reveals failing rules for both a succeeded run and a blocked run, no toggle when nothing to show.
- `frontend/src/features/dataTypes/state/dataTypesSlice.test.ts` — `fetchAssertionStatus` dedup (concurrent + already-cached), independent fetches per distinct id, `selectAssertionInvalid` cases; two pre-existing `stateWithItem` fixtures updated for the new required state fields.
- `frontend/src/features/panels/ui/PanelCard.test.tsx` (new) — badge renders for `invalid: true`, absent for `invalid: false` and before the fetch resolves; fetch dispatched for a bound panel, not dispatched for an unbound one.
- `frontend/src/features/pipelines/state/pipelinesSlice.test.ts`, `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` — pre-existing `PipelineRunRecord` fixtures updated with the new required `assertions` field (compile-time fallout only, no behavior change).

## OpenSpec

- `openspec/changes/run-history-assertion-badge/tasks.md` — all 19 tasks marked complete.
