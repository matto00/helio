## Why

The pipeline detail page has a "Run pipeline" button and run history panel in the UI, but
`POST /api/pipelines/:id/run` does not write a record to `pipeline_runs`, so the history panel
always shows empty. The button UX also needs test coverage to establish a stable contract for
the HEL-142 sub-tickets (dry-run, overwrite mode, status indicator) that follow.

## What Changes

- Backend: `POST /api/pipelines/:id/run` (non-dry) now inserts a row into `pipeline_runs` at
  run start (status `queued`) and updates it to `succeeded`/`failed` at completion, enforcing
  the 10-run retention policy via `deleteOldRuns`.
- Backend test: add a spec case asserting that a non-dry run inserts a `pipeline_runs` row with
  the correct final status and row count.
- Frontend: the "Run pipeline" button and post-run history refresh are already wired; add a Jest
  test covering the disabled-while-running state and the dispatch/refetch sequence.

## Capabilities

### New Capabilities

_(none — all UI and route surface already exists)_

### Modified Capabilities

- `pipeline-run-execution`: add requirement that non-dry runs persist a `pipeline_runs` record
  (insert on start, terminal update on completion) with `rowCount` and `errorLog`.

## Impact

- `PipelineRunRoutes.scala` — insert/update `pipeline_runs` in the non-dry code path.
- `PipelineRunRoutesSpec.scala` — new test for run record persistence.
- `PipelineDetailPage.test.tsx` — new test for Run button disabled state + dispatch behavior.
- No schema migrations needed (`pipeline_runs` table and `PipelineRunRepository` already exist).
- No API contract changes — response shape unchanged.

## Non-goals

- Dry-run button (HEL-197)
- Overwrite mode (HEL-198)
- Real-time status polling / async run model (HEL-199)
- Last-run row-count display in list view (HEL-200)
- Run button on `PipelinesListPage` (not in this ticket's scope per AC)
