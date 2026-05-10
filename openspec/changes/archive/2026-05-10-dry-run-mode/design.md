## Context

`PipelineRunRoutes.scala` already toggles on `?dry=true` (query param). On a dry run it skips
`insertRun`, skips `upsertFieldsFromRows`, and skips `updateLastRun`. The in-process engine runs
identically. The only thing missing is a persistence record and a UI affordance.

`PipelineRunRepository` has `insertRun` (inserts "queued") and `updateRunTerminal` (sets terminal
status). Neither fits a one-shot dry-run record because dry runs complete synchronously — there is
no queued → terminal transition.

Frontend: `submitPipelineRun` takes a bare `pipelineId: string`. `runPipeline` in the service
layer POSTs with no query param. The type `PipelineRunRecord.status` is a four-literal union that
does not include `"dry_run"`.

## Goals / Non-Goals

**Goals:**
- Record dry-run executions in `pipeline_runs` with `status = "dry_run"` (queryable, distinguishable)
- Surface a "Dry run" button in the pipeline detail page footer
- Show dry-run rows in run history with a visual badge
- Keep the wire format (`?dry=true` query param) unchanged

**Non-Goals:**
- No migration needed — `pipeline_runs.status` is a plain VARCHAR with no DB constraint
- No Spark path changes
- No step-preview alignment

## Decisions

**D1 — One-shot dry-run record via new `insertDryRun` method**
Rather than reuse `insertRun` (status "queued") + `updateRunTerminal`, add
`PipelineRunRepository.insertDryRun(runId, pipelineId, startedAt, rowCount)` that inserts a
single completed row with `status = "dry_run"`, `completed_at = startedAt`, and `row_count`.
This avoids a two-phase update for an operation that is already synchronous and produces less
orphan-record risk on failure.
Alternative: reuse insertRun + updateRunTerminal — rejected because it creates a transient
"queued" row visible to concurrent history fetches.

**D2 — `submitPipelineRun` arg becomes `{ pipelineId: string; dryRun?: boolean }`**
The thunk is used in exactly one place (handleRunPipeline). Changing the arg type is low-risk and
avoids a parallel thunk. The existing `clearRunState` / status selectors work for both modes.
Alternative: separate `submitDryRun` thunk — rejected because it duplicates state management.

**D3 — `runStatus` state used for dry runs too**
The existing `runStatus` ("queued" | "running" | "succeeded" | "failed") covers the UI spinner
and result feedback. We keep it as-is for the in-flight state; `"dry_run"` only appears in
`PipelineRunRecord.status` (history panel), not in the transient `runStatus` state.

**D4 — Dry-run button as secondary sibling of the Run button**
The footer already has a "Run pipeline" primary button. A "Dry run" secondary button (same row,
to the left) matches the existing pattern for sibling actions (Save/Cancel). No modal or toggle
needed at this scope.

## Risks / Trade-offs

- [Schema drift] `pipeline_runs.status` has no DB CHECK constraint, so any string is valid. The
  dry_run value integrates cleanly. Future work can add a constraint.
- [History retention] `deleteOldRuns` runs on non-dry runs only, keeping up to 10. Dry-run rows
  accumulate without a cap. Acceptable for now; a combined-retention policy is follow-up work.

## Planner Notes

Self-approved. No new external dependencies. Change is additive on the backend (new method,
new branch in existing route) and backward-compatible on the frontend (new optional param, new
literal in a discriminated union). No migration required.
