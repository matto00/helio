# HEL-197 — Dry-run mode: preview output without writing

## Title
Dry-run mode: preview output without writing

## Description
Dry-run executes all pipeline steps and returns a preview of the output rows without writing to the Type Registry. Displays row count, schema, and a sample of results. Useful for validating a pipeline before committing.

## Acceptance Criteria
- `POST /api/pipelines/:id/run` accepts a `dryRun` body field (or retains the existing `?dry=true` query param) and does NOT write to the DataType target on dry runs.
- Dry-run executions ARE recorded in `pipeline_runs` with a distinct `status = "dry_run"` (completed immediately; no "queued" → "succeeded" transition needed).
- Frontend: "Dry run" secondary button next to the existing "Run pipeline" button on the pipeline detail page.
- Dispatches the same `submitPipelineRun` thunk (or a new `submitDryRun` thunk) with `dryRun: true`.
- Run history panel shows dry-run rows with a "Dry run" badge, visually distinct from succeeded/failed rows.
- Backend unit tests assert that dry-run path skips the DataType write but records a `dry_run` row.
- Frontend tests for the dry-run toggle button and the history badge.

## Context from product discussion
- Ship dry-run as a thin "run without write" toggle now, to lock in the dry vs commit contract before HEL-198 (overwrite mode).
- HEL-196 added the persistence layer for runs; dry-run rows should be queryable in run history but distinguishable from real runs.
- The backend already supports `?dry=true` query param — it skips DataType write but currently inserts NO row. We need to add the dry_run row insertion.
- The `status` field in `pipeline_runs` needs to accommodate `"dry_run"` as a valid value.
- Out of scope: step preview alignment, Spark integration, overwrite mode.

## Investigation findings
- `PipelineRunRoutes.scala` line 80: preExec only runs `insertRun` when `!isDry` — dry runs record nothing.
- `PipelineRunRepository`: only supports "queued"/"running"/"succeeded"/"failed" statuses (via `insertRun` + `updateRunTerminal`).
- Frontend `submitPipelineRun` thunk: parameter is `string` (pipelineId only) — no dryRun flag.
- `runPipeline` service function: POSTs with no query param.
- `PipelineRunRecord.status` type: `"queued" | "running" | "succeeded" | "failed"` — needs `"dry_run"` added.
- `StatusBadge` component: CSS class uses status directly — needs `dry_run` CSS entry.
- No "Dry run" button exists anywhere in the UI.
