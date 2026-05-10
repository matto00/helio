## Context

`POST /api/pipelines/:id/run` in `PipelineRunRoutes.scala` already executes the pipeline
synchronously via `InProcessPipelineEngine`, calls `pipelineRepo.updateLastRun` on
success/failure, and returns `RunResultResponse`. The `pipeline_runs` table (V24) and
`PipelineRunRepository` (insertRun / updateRunTerminal / deleteOldRuns) exist but are not called
from the run route. `pipelineRunRepo` is already wired into `PipelineRunRoutes` as a nullable
parameter (defaulting to null) — `ApiRoutes` passes it.

The frontend `PipelineDetailPage` already has: Run button, `handleRunPipeline` calling
`submitPipelineRun` thunk, run status display, `RunHistoryPanel`, and post-run
`fetchPipelineRunHistory` dispatch. The Redux slice already handles `submitPipelineRun` states.

## Goals / Non-Goals

**Goals:**
- Non-dry runs write a `pipeline_runs` row (insert on start, terminal update on completion).
- Enforce 10-run retention via `deleteOldRuns` immediately after insert.
- Backend test coverage for run record persistence.
- Frontend test coverage for button disabled state and dispatch sequence.

**Non-Goals:**
- Dry-run UX, overwrite mode, real-time status polling, list-page run button.

## Decisions

**1. Generate run ID server-side using `UUID.randomUUID().toString`.**
Consistent with how `PipelineRunRepository.insertRun` is used in tests. No client-side ID needed.

**2. `pipelineRunRepo` null-guard: only persist if `pipelineRunRepo != null`.**
The nullable default is an existing pattern in `PipelineRunRoutes` (same pattern used for
`dataTypeRepo`). This keeps the route testable without a DB.

**3. Persist run record only on non-dry path.**
Dry runs must have zero side effects per the `pipeline-run-execution` spec. Run record
persistence is a side effect.

**4. Insert run record before execution; update to terminal state after.**
Ensures a run record exists even if the process crashes mid-execution (status remains `queued`).
`deleteOldRuns(pipelineId, keepN = 10)` is called immediately after insert to cap retention.

**5. Frontend test uses `renderWithStore` + mocked `pipelineService.runPipeline`.**
Matches the pattern used in `PipelineDetailPage.test.tsx` already. No new test infrastructure.

## Risks / Trade-offs

- [Risk] If `insertRun` fails, the run still executes but no record is created.
  → Mitigation: wrap in a `recoverWith` that falls through to execution (run must not fail just
  because history logging failed).
- [Risk] `pipelineRunRepo` is null in some test setups.
  → Mitigation: null-guard already in place; test that exercises persistence passes it explicitly.

## Planner Notes

Self-approved. No new external dependencies, no schema migrations, no breaking API changes.
The existing `pipelineRunRepo` nullable pattern in the route is intentional and should be
preserved rather than refactored to Option (out of scope).
