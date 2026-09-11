# Files modified — dataset-row-grid-ui (HEL-1080 / HEL-1122)

## Backend (HEL-1122 declared-schema route)

- `backend/src/main/scala/com/helio/api/protocols/sources/DataSourceProtocol.scala`
- `backend/src/main/scala/com/helio/api/routes/sources/DataSourceRoutes.scala`
- `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala`
- `backend/src/main/scala/com/helio/services/sources/DataSourceService.scala`
- `backend/src/test/scala/com/helio/api/routes/sources/DataSourceRoutesSpec.scala`
- `backend/src/test/scala/com/helio/infrastructure/persistence/RlsOwnerTablesSpec.scala`
- `schemas/sources/dataset-field-response.schema.json`
- `schemas/sources/dataset-schema-response.schema.json`

## Frontend contract (HEL-1122 task 1.4)

- `frontend/src/features/sources/types/dataSource.ts`
- `frontend/src/features/sources/services/dataSourceService.ts`

## `DataGrid` extension (design.md Decision 0, standing constraint C1)

- `frontend/src/shared/ui/DataGrid.tsx`
- `frontend/src/shared/ui/DataGrid.test.tsx`
- `frontend/src/shared/ui/DataGridConsumerRegression.test.tsx`

## Frontend data layer (HEL-1080 tasks 3.x)

- `frontend/src/features/sources/state/datasetRowsSlice.ts`
- `frontend/src/features/sources/state/datasetRowsSlice.test.ts`
- `frontend/src/features/sources/hooks/useDatasetFieldEditor.ts`
- `frontend/src/features/sources/hooks/useDatasetFieldEditor.test.ts`
- `frontend/src/features/sources/utils/parseDatasetRowValidationError.ts`
- `frontend/src/features/sources/utils/parseDatasetRowValidationError.test.ts`
- `frontend/src/store/store.ts`
- `frontend/src/test/renderWithStore.tsx`

## Frontend UI (HEL-1080 tasks 4.x)

- `frontend/src/features/sources/ui/DatasetRowGrid.tsx`
- `frontend/src/features/sources/ui/DatasetRowGrid.css`
- `frontend/src/features/sources/ui/DatasetRowGrid.test.tsx`
- `frontend/src/features/sources/ui/DatasetRowGridAnnouncement.test.tsx`
- `frontend/src/features/sources/ui/DatasetRowGridFocusAndConflict.test.tsx`
- `frontend/src/features/sources/ui/DatasetRowGridKeyboardMatrix.test.tsx`
- `frontend/src/features/sources/ui/DatasetRowGridLargeDataset.test.tsx`
- `frontend/src/features/sources/ui/DatasetRowGridPagerAndFocusPaths.test.tsx`
- `frontend/src/features/sources/ui/SourceDetailPanel.tsx`
- `frontend/src/features/sources/ui/SourceDetailPanel.css`
- `frontend/src/theme/motionTokenGuard.css.test.ts`
- `frontend/src/theme/elevationTokenGuard.css.test.ts`

## e2e / tooling

- `e2e/focus-presence-guard.spec.ts`
- `e2e/hel1080-dataset-row-grid-live.spec.ts`
- `eslint.config.cjs`

## Summary of changes

**Backend (HEL-1122):** new additive `GET /api/data-sources/:id/schema` route returning a
dataset source's declared field schema (name/type/required/default), reusing existing
ACL/HEL-1002 not-found conventions; spray-json format leaves `default` absent (not `null`) when
unset and always writes `required`. Tests cover the happy path, non-dataset-kind 400,
not-found/not-owned 404, the absent-`default` round-trip, and a regression that the existing
`GET /api/data-sources/:id` response shape is unchanged. A non-superuser RLS regression test
confirms the new read path behaves identically to sibling row routes.

**`DataGrid` extension (Decision 0, standing constraint C1):** new default-off `gridMode`/
`activeCell`/`onActiveCellChange`/`rowId` props adding `role="grid"/"row"/"gridcell"` and
roving-tabindex keyboard navigation, active only when explicitly supplied. A regression test
covers the 4 real existing consumers (`TableRenderer`, `SourceDetailPanel`'s own Preview usage,
`SqlTab`, `StepCard` — `ConnectorsPage` was confirmed via `git grep` not to be a real consumer,
correcting a stale premise in an earlier design draft) rendering unchanged with the new props
omitted.

**Frontend grid (HEL-1080):** `DatasetRowGrid` — an editable, paged (`DATASET_GRID_PAGE_SIZE =
100`, cursor-stack-based pager), keyboard-operable (W3C APG Grid pattern; Enter/F2 edit,
Enter/Tab/blur commit with a double-commit guard, Escape cancel, Delete/Backspace gated on
not-editing) grid over a dataset source's rows, mounted on `/sources/:id` in place of that
panel's read-only Preview grid for `dataset`-kind sources. Schema-driven cell editors and
validation (required/type, with a default-aware "can this field be emptied" rule sending JSON
`null`, never `""`). Stale-edit recovery re-fetches on conflict (409) with per-field retry/
discard, and separately distinguishes a genuinely-deleted row (404) from a deleted/missing data
source (404, different message) rather than conflating them. A real Playwright e2e suite
(`e2e/hel1080-dataset-row-grid-live.spec.ts`) runs 4 tests against the actual running dev
backend (no mocks): concurrent-delete recovery, add-row on a required-no-default schema, pager
state after append, and add-row focus landing correctly under injected network latency —
demonstrated failable by reverting each underlying fix and observing red, per commit history.

This change went through 5 design-gate rounds (4 REFUTE, 1 CONFIRM) and 5 final-gate rounds/
scoped checks (4 REFUTE, 1 CONFIRM) — full reports at
`openspec/changes/dataset-row-grid-ui/skeptic-{design,final}-*.md`, persisted evidence copies
under `.concertino/runs/HEL-1080/evidence/`. Two owner escalations during the final gate
extended its round budget from 2 to 5 total rounds as real defects were found and fixed each
round; the final round CONFIRMed with no remaining blocking issues.
