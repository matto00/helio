# HEL-196 — Pipeline run button in editor/detail view

## Description

Run button in the pipeline editor and detail view. Triggers a full pipeline execution against the source. Disabled while a run is already in progress. Separate buttons or a dropdown for Run vs. Dry-Run.

## Acceptance Criteria

1. A "Run pipeline" button exists in the pipeline detail/editor page footer.
2. Clicking "Run pipeline" triggers a full pipeline execution via `POST /api/pipelines/:id/run` (no `?dry=true`).
3. The button is disabled while a run is in progress (`runStatus === "queued" || runStatus === "running"`).
4. Run status is displayed in the footer (queued / running / succeeded / failed with error).
5. After a successful run, the run history panel is refreshed so the new run appears.
6. The `POST /api/pipelines/:id/run` endpoint persists a row to the `pipeline_runs` table (insert + terminal update) via `PipelineRunRepository`, enabling the run history panel.
7. Tests cover: backend run persists a `pipeline_runs` row, frontend Run button dispatches `submitPipelineRun` and refetches history.

## Context

- Backend route `POST /api/pipelines/:id/run` already exists in `PipelineRunRoutes.scala` with synchronous in-process execution.
- The `pipeline_runs` table exists (V24 migration). `PipelineRunRepository` has `insertRun` / `updateRunTerminal` / `deleteOldRuns`.
- The run route currently calls `pipelineRepo.updateLastRun` but does NOT insert a row into `pipeline_runs`. This is the backend gap to close.
- Frontend: `submitPipelineRun` thunk, run status display, and the run history panel all exist. The "Run pipeline" button is already in `PipelineDetailPage.tsx` footer.
- The `PipelinesListTable` already shows `lastRunStatus` and `lastRunAt` from pipeline summary — these are populated by the existing `updateLastRun` call, so no list-page changes are needed for the run itself.
- Do NOT add dry-run button (HEL-197) or overwrite mode (HEL-198) — those are separate tickets.
- Keep scope tight: persist run records on each full run, ensure run history panel shows them.

## Key Files

- `backend/src/main/scala/com/helio/api/routes/PipelineRunRoutes.scala` — needs `pipelineRunRepo` writes
- `backend/src/main/resources/db/migration/V24__pipeline_runs.sql` — schema already exists
- `backend/src/main/scala/com/helio/infrastructure/PipelineRunRepository.scala` — insertRun / updateRunTerminal / deleteOldRuns
- `backend/src/test/scala/com/helio/api/routes/PipelineRunRoutesSpec.scala` — add test for run record persistence
- `frontend/src/components/PipelineDetailPage.tsx` — run button already exists; verify handleRunPipeline flow
- `frontend/src/features/pipelines/pipelinesSlice.ts` — submitPipelineRun already exists
- `frontend/src/services/pipelineService.ts` — runPipeline already exists
- `frontend/src/components/PipelineDetailPage.test.tsx` — add test for button behavior
