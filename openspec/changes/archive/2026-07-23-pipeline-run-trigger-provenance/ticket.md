# HEL-417: Scheduled runs: run provenance (mark runs manual vs scheduled in Run History)

## Context

Once runs can be triggered by a scheduler (and by external hooks, HEL-369), users need to tell in Run History whether a run was manual, scheduled, or externally triggered. Today `pipeline_runs` (`V24__pipeline_runs.sql`) has no trigger-source column, and `PipelineRunService.executeRun` inserts runs without provenance. Run history is served by `PipelineRunHistoryRoutes` / `PipelineRunService.history` and rendered in the frontend pipeline run history UI.

## Scope

Backend:

* Flyway migration — add a `pipeline_runs.trigger_source TEXT` (values e.g. `manual` | `scheduled` | `external`, default `manual`) with a CHECK constraint (mirror the drop/re-add pattern used for the status constraint in `V28`). Use the next available VNN, assigned at scheduling time (main at V59; three v1.6 lanes may contend). **Verify next available VNN in this worktree — main has since advanced to include V62 (HEL-414 pipeline_schedules); expected next is V63.**
* Thread the trigger source through `PipelineRunService.submit`/`executeRun` (the manual path passes `manual`; the scheduler passes `scheduled`; if the external hook from HEL-369 routes through here it passes `external`) and `PipelineRunRepository.insertRun`. Surface it on the `PipelineRunRecord` response.
* Update `schemas/` + `openspec/` for the run history response.

Frontend:

* Show the provenance (manual/scheduled/external) on each row in the pipeline run history view.

## Acceptance criteria

- [ ] Each persisted run records its trigger source; manual runs record `manual`, scheduled runs `scheduled` (and external `external` where applicable).
- [ ] Run History (API + UI) shows the provenance per run.
- [ ] Flyway migration applies cleanly on fresh + existing DBs; existing rows default to `manual`.
- [ ] `schemas/` + `openspec/` updated; tests cover the persisted value + response field + UI rendering.
- [ ] Backward compatible: additive column defaulting to `manual`; existing run history unaffected; response field additive.

## Out of scope

* The scheduler runtime and schedule model (sibling tickets) — this ticket only labels provenance; it coordinates with the scheduler ticket for the `scheduled` value.

## Dependencies

* Coordinates with the scheduler runtime ticket (supplies the `scheduled` source) and relates to HEL-369 (the `external` source). Can land independently with `manual` as the only initial value.

## Batch context (from orchestrator instructions)

This is ticket 4 of 4 — the FINAL ticket — in the strictly sequential HEL-340 scheduled-runs epic chain (HEL-414 schedule model → HEL-415 scheduler runtime → HEL-416 config UI → HEL-417 run provenance). All three predecessors are MERGED to main:

- HEL-414 (PR #269, d908eb35): `pipeline_schedules` (V62) + `GET/PUT/DELETE /api/pipelines/:id/schedule`
- HEL-415 (PR #270, 25783a32): in-process scheduler runtime (`PipelineSchedulerService.tick()` fires due schedules through `PipelineRunService.submit` as the pipeline owner; `PipelineSchedulerActor` in `Main.scala`)
- HEL-416 (PR #271, 3a020749): schedule config UI in the pipeline editor (`PipelineScheduleBar`/`Dialog`, Redux thunks)

Worktree is branched from current main (3a020749). The HEL-415 scheduler callsite should mark its runs `scheduled`; manual API runs `manual`.

Known wire gotcha relevant to this ticket: spray-json omits `Option = None` fields on the wire (not `null`) — normalize at the frontend service boundary and test with fields absent (this exact bug class hit HEL-416 cycle 1). The new `triggerSource` field should likely be non-optional (always present, defaulting server-side to `manual`) to sidestep this class entirely — but verify against the existing `PipelineRunRecord` wire shape and confirm during planning.
