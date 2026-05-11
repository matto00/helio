# Files Modified — last-run-stats-views

## Backend

- `backend/src/main/resources/db/migration/V30__pipeline_last_run_row_count.sql` — Flyway migration adding `last_run_row_count BIGINT` column to `pipelines` table
- `backend/src/main/scala/com/helio/infrastructure/PipelineRepository.scala` — Added `lastRunRowCount` to `PipelineRow`, `PipelineTable`, `PipelineSummary` DTO; updated `updateLastRun` signature; propagated field through `create`, `findSummaryById`, and `listSummaries` mappings
- `backend/src/main/scala/com/helio/api/routes/PipelineRoutes.scala` — Propagated `lastRunRowCount` into all four `PipelineSummaryResponse` construction sites
- `backend/src/main/scala/com/helio/api/routes/PipelineRunRoutes.scala` — Updated both `updateLastRun` call sites to pass row count (succeeded: `resultRows.size.toLong`; failed: `None`)
- `backend/src/main/scala/com/helio/api/JsonProtocols.scala` — Added `lastRunRowCount: Option[Long]` to `PipelineSummaryResponse`; updated `jsonFormat7` → `jsonFormat8`
- `backend/src/test/scala/com/helio/infrastructure/PipelineRepositorySpec.scala` — Added three new test cases: persists row count on `updateLastRun`, returns `None` when no row count, returns `None` for pipeline with no runs

## Frontend

- `frontend/src/types/models.ts` — Added `lastRunRowCount: number | null` to `PipelineSummary` interface
- `frontend/src/utils/formatRelativeTime.ts` — New utility implementing `formatRelativeTime(iso)` with no third-party dependencies
- `frontend/src/components/PipelineListTable.tsx` — Added "Rows Written" column; reformatted "Last Run At" via `formatRelativeTime`; "Never run" label when `lastRunStatus` is null; fixed loose-equality guard (`!= null`) to handle both `null` and `undefined` safely
- `frontend/src/components/PipelineDetailPage.tsx` — Added `pipeline-detail-page__meta-bar` section; fixed loose-equality guard (`!= null`) to handle both `null` and `undefined` safely (prevents crash on old Redux state)
- `frontend/src/components/PipelineDetailPage.css` — Added CSS for `pipeline-detail-page__meta-bar` and its child elements

## Tests

- `frontend/src/components/PipelinesPage.test.tsx` — Added `lastRunRowCount` to fixtures; added assertions for "Rows Written" column value and `—` for null
- `frontend/src/components/PipelineDetailPage.test.tsx` — Added `lastRunRowCount` to all `PipelineSummary` fixtures; added meta-bar visibility/content assertions; added `undefined` regression test (loose-equality guard)
- `frontend/src/features/pipelines/pipelinesSlice.test.ts` — Added `lastRunRowCount` to `testPipeline` and `newPipeline` fixtures
- `frontend/src/components/CreatePipelineModal.test.tsx` — Added `lastRunRowCount` to `newPipeline` fixture
- `frontend/src/components/PanelList.test.tsx` — Added `lastRunRowCount` to pipeline fixture in `dataTypeStoreAdditions`
- `frontend/src/components/PanelCreationModal.test.tsx` — Added `lastRunRowCount` to pipeline fixture in store additions

## OpenSpec / Spec files modified (Cycle 2 — spec corrections)

- `openspec/changes/last-run-stats-views/proposal.md` — Non-goals: expanded AC #4 (panel "data as of" indicator) deferral note to be explicit that it is scoped out and should be a future ticket
- `openspec/changes/last-run-stats-views/design.md` — Non-goals: expanded AC #4 deferral note; Planner Notes: added AC #5 denormalization clarification (field stored on `pipelines` table, not joined from `pipeline_runs`)
- `openspec/changes/last-run-stats-views/specs/pipeline-last-run-row-count/spec.md` — Failed-run scenario updated: `last_run_row_count` is `NULL` on failure (not "non-null"); matches implementation behaviour where `rowCount = None` is passed to `updateLastRun` on failure
