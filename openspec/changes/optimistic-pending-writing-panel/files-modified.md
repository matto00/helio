# Files modified — HEL-1095 optimistic pending/reconcile writing-panel counter

## Backend

- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala` — new `aggregateField(id, fieldIndex, user)`: `SUM((data ->> fieldIndex)::numeric)` over `dataset_rows`, under `ctx.withUserContext`.
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala` — new `getFieldAggregate(id, field, op, user)`: op/ACL/kind/field-declared/numeric validation, delegates to the repository.
- `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala` — new `FieldAggregateResponse(field, op, value)` case class + spray-json format.
- `backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala` — new `GET /api/data-sources/:id/rows/aggregate` route, wired ahead of the sibling `rows/:rowId` route (path-matching order).
- `backend/src/test/scala/com/helio/infrastructure/persistence/sources/DataSourceRepositorySpec.scala` — `aggregateField` repository tests (multi-row sum, zero-row source).
- `backend/src/test/scala/com/helio/api/routes/sources/DataSourceRoutesSpec.scala` — route tests for the new endpoint's success shape, live-write reflection, and every rejection branch (`400` unsupported op/non-numeric/undeclared/non-dataset, `404` non-owner/nonexistent).

## Schemas

- `schemas/sources/field-aggregate-response.schema.json` — new schema for `FieldAggregateResponse` (schema-drift gate).

## Frontend

- `frontend/src/features/sources/services/dataSourceService.ts` — new `fetchFieldAggregate(sourceId, field)` service function (`GET .../rows/aggregate?field=&op=sum`).
- `frontend/src/features/sources/services/dataSourceService.test.ts` — unit test for `fetchFieldAggregate`'s request/response shape.
- `frontend/src/features/panels/ui/form/useFormPanelValues.ts` — new `adjustNumericValue(sourceField, delta)`: a relative, functional-setState-based adjustment (never a stale-closure read), used by both the optimistic advance and the relative rollback.
- `frontend/src/features/panels/ui/form/FormPanelView.tsx` — `handleImmediateStep` rewritten per design.md D9: per-click `pendingDeltasRef` map replacing the old single-value `submitState === "pending"` guard, `reconcileGenerationRef` bumped on every settle, quiesce-gated reconciliation fetch dispatch, and generation+map-empty guarded fetch-resolution application; `pendingCount` state drives `aria-busy`.
- `frontend/src/features/panels/ui/form/CounterControl.tsx` — new `ariaBusy` prop, rendered as `aria-busy="true"` on the `role="spinbutton"` element.
- `frontend/src/features/panels/ui/form/FormFieldControl.tsx` — new `busy` prop, plumbed through to `CounterControl` only when `immediate` (compact counter path).
- `frontend/src/features/panels/ui/form/FormFieldControl.test.tsx` — new tests for the `busy`/`aria-busy` plumbing (immediate vs non-immediate).
- `frontend/src/features/panels/ui/form/FormPanelView.test.tsx` — new tests for tasks 2.2/2.5/3.1/3.2/3.3/3.4/3.7 (per-click concurrency, aria-busy, reconciliation, rollback, ten-rapid-clicks, stale-fetch races, mixed-outcome race), each confirmed red-then-green via a targeted `git stash` of the implementation files before this commit.

## E2E

- `e2e/hel1095-optimistic-pending-writing-panel-a11y.spec.ts` — new Playwright spec: `aria-busy` pending state and rollback-error announcement, against the running app in both light and dark themes (task 3.5).

## OpenSpec change bookkeeping

- `openspec/changes/optimistic-pending-writing-panel/tasks.md` — tasks checked off as implemented/verified.
