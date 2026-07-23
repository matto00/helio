## Context

`pipeline_runs` (`V24`) has no column recording how a run was triggered. `PipelineRunService.submit`
is called from two places today: `PipelineRunSubmitRoutes` (manual, `POST /api/pipelines/:id/run`)
and `PipelineSchedulerService.fire` (HEL-415, scheduled). Both currently funnel into the same
`executeRun` → `insertRun`/`insertDryRun` (owner-scoped) or `insertRunInternal`/`insertDryRunInternal`
(ACL-bypassing, used by `insertRun` internally after the ownership check — see
`PipelineRunRepository`). `PipelineRunRecord` (API response, `PipelineProtocol.scala`) and
`PipelineRunRow` (persistence model) both need the new field. `V28` establishes the drop/re-add
CHECK-constraint pattern this migration will mirror. Main is at `V62` (HEL-414's
`pipeline_schedules`); next available is `V63`.

## Goals / Non-Goals

**Goals:**
- Persist a `trigger_source` per run: `manual` | `scheduled` | `external`, defaulting to `manual`.
- Manual API runs record `manual`; the HEL-415 scheduler callsite records `scheduled`.
- Surface `triggerSource` on the run-history API response and Run History UI, additively.

**Non-Goals:**
- Wiring an `external` caller (HEL-369) — the enum value is reserved, not exercised.
- Backfilling historical rows with anything other than the column default (`manual`).
- Filtering/sorting Run History by trigger source.

## Decisions

**1. Model trigger source as a plain `String` at the repository/protocol boundary, not a new
domain sum type.** `PipelineRunRow`/`PipelineRunRecord` already use bare `String` for `status`
(`"queued"`/`"running"`/... ) rather than a domain enum — matching that precedent keeps the diff
proportional and avoids introducing a second enum-encoding convention in the same table.
Call sites pass the three literal values; a private object with the three constants
(`TriggerSource.Manual/Scheduled/External`) in `PipelineRunService` (mirroring no existing
precedent exactly, but analogous to how `status` literals are used inline elsewhere) gives
call-site safety without a new domain type. Alternative considered: a sealed trait `TriggerSource`
with its own JSON format — rejected as disproportionate to a 3-value column that mirrors the
existing `status` string convention.

**2. Thread `triggerSource: String` as an explicit parameter through `submit` → `executeRun` →
`insertRun`/`insertDryRun`, defaulting the public-facing `submit` parameter to `"manual"`.**
`PipelineRunSubmitRoutes` calls `submit` without a new argument (default keeps it a
non-breaking change for that one callsite); `PipelineSchedulerService.fire` passes
`triggerSource = "scheduled"` explicitly at its existing `pipelineRunService.submit(...)` call.
Alternative considered: infer trigger source from caller identity (scheduler runs as pipeline
owner, same `AuthenticatedUser` shape as a manual run) — rejected because it conflates identity
with intent and would silently misclassify a manual run submitted by the pipeline owner.

**3. Migration mirrors `V28`'s drop/re-add CHECK pattern but as a single new-column ADD (no
existing constraint to touch).** `ALTER TABLE pipeline_runs ADD COLUMN trigger_source TEXT NOT
NULL DEFAULT 'manual'` plus a `CHECK (trigger_source IN ('manual','scheduled','external'))`
constraint added in the same migration. `NOT NULL DEFAULT` backfills existing rows to `manual` in
the same statement (Postgres 11+ fast default path) — no separate `UPDATE`.

**4. New `schemas/pipeline-run-record.schema.json`, not a patch to a non-existent file.** No
schema currently documents the run-history response shape (`schemas/` has none for
`PipelineRunRecord`); the ticket's "update schemas/" is satisfied by adding the canonical schema
now, matching the sibling `pipeline-schedule.schema.json` convention (full-object schema, not a
delta).

**5. New `pipeline-run-provenance` capability plus a `pipeline-scheduler-runtime` delta**, per the
proposal — the scheduler spec gets one new scenario asserting the persisted `trigger_source` on a
scheduler-fired run; the new capability owns the column/response/UI requirements end to end.

## Risks / Trade-offs

- [Two insert paths (owner-scoped `insertRun`/`insertDryRun` vs. ACL-bypassing `*Internal`) both
  need the new parameter, easy to miss one] → both are exercised by
  `PipelineRunRepositorySpec`; add/extend a test per path asserting the persisted
  `trigger_source`.
- [`dry_run` records currently have no caller passing anything but "the current user ran this
  interactively" — dry runs are always manual today] → default dry-run's `triggerSource` to
  `"manual"` at the `onDryRunSuccess`/`insertDryRun` callsite (the scheduler never dry-runs).
- [CHECK constraint too strict if HEL-369 lands with a different literal] → `external` is already
  reserved in the constraint so HEL-369 needs no further migration, only a new callsite.

## Planner Notes

- Self-approved: representing `trigger_source` as `String` rather than a new sealed domain type
  (Decision 1) — proportional to the existing `status` string precedent, not a new pattern.
- Self-approved: `external` reserved in the CHECK constraint and TS union now, unused by any
  caller (ticket explicitly scopes this as coordination-only for HEL-369).
