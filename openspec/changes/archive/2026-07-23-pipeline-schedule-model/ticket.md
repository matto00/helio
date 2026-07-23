# HEL-414: Scheduled runs: schedule model + persistence (per-pipeline cron/interval)

## Context

Pipelines can only be run manually (via the app, `run_pipeline` MCP, or an external caller). To keep DataTypes fresh automatically, a pipeline needs a persisted schedule. This ticket adds the data model + CRUD only; the runtime that fires schedules is a sibling ticket. Pipeline persistence lives under `backend/src/main/scala/com/helio/infrastructure/PipelineRepository.scala`; migrations under `backend/src/main/resources/db/migration/` (main is at V59 as of ticket authoring; verified V61 at scheduling time — this change uses V62).

## Scope

Backend:

* Flyway migration — a schedule model, either a `pipeline_schedules` table (pipeline_id FK, `kind` cron|interval, `expression` cron string or interval, `enabled` bool, `timezone`, `next_run_at`, `last_run_at`, timestamps) or columns on `pipelines`. Prefer a dedicated table for clarity. Use the next available VNN, assigned at scheduling time (main at V59; three v1.6 lanes may contend). Respect the existing RLS conventions (owner-scoped, mirror `pipelines`/`V35` policies).
* Domain model + repository for the schedule; a service; CRUD routes (`GET/PUT/DELETE /api/pipelines/:id/schedule`) under `backend/src/main/scala/com/helio/api/routes/`, wired into `ApiRoutes.scala`. Protocol/JSON formats under `backend/src/main/scala/com/helio/api/protocols/`. Validate cron/interval expressions at write time. No inline fully-qualified names.
* Update `schemas/` + `openspec/` for the schedule contract.

## Acceptance criteria

- [ ] A per-pipeline schedule (cron OR interval, with enable/disable + timezone) can be created, read, updated, and deleted via authenticated routes; owner-scoped like other pipeline resources.
- [ ] Invalid cron/interval expressions are rejected at write time with a clear error.
- [ ] Flyway migration applies cleanly on fresh + existing DBs; RLS matches existing pipeline policies.
- [ ] `schemas/` + `openspec/` updated.
- [ ] Tests: schedule CRUD + validation; RLS/ownership scoping.
- [ ] Backward compatible: additive; pipelines without a schedule behave exactly as today.

## Out of scope

* The scheduler runtime that actually fires runs (sibling ticket, HEL-415).
* Schedule config UI (sibling ticket, HEL-416).
* Run provenance labeling (sibling ticket, HEL-417).

## Dependencies

* None. Blocks the scheduler runtime (HEL-415) and the schedule config UI (HEL-416).

## Batch context (orchestrator-provided, not part of the original ticket)

This is ticket 1 of 4 in the strictly sequential HEL-340 scheduled-runs epic chain
(HEL-414 schedule model → HEL-415 scheduler runtime → HEL-416 config UI → HEL-417
run provenance). Each ticket merges to main before the next starts.

Main is at 0969fa66 (the just-merged alerts chain: HEL-447/455/466 shipped
`alert_rules` V60, `alert_events` V61, and `AlertEvaluationService` hooked into
`PipelineRunService.onRunSuccess`). Verified next available Flyway version is
**V62** (V61 is the latest on disk as of this ticket's start).

Relevant seam for the chain (context for planning, scope strictly per the ticket
above): the sibling runtime ticket HEL-415 will fire runs through the same
`PipelineRunService` path so scheduled runs get alert evaluation for free — this
ticket (414) is model + persistence + CRUD only, no runtime.
