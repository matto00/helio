## Why

Pipelines can only be run manually today. To keep DataTypes fresh automatically, a pipeline
needs a persisted schedule the sibling runtime ticket (HEL-415) can poll and fire. This ticket
lays the data model, persistence, and CRUD contract — no runtime firing.

## What Changes

- Flyway migration (V62) adding a `pipeline_schedules` table: `pipeline_id` FK (1:1, `UNIQUE`),
  `kind` (`cron` | `interval`), `expression`, `enabled`, `timezone`, `next_run_at` (nullable —
  not computed by this ticket; owned by HEL-415), `last_run_at` (nullable), timestamps.
- RLS mirrors the indirect-owner pattern (`pipeline_steps`/`pipeline_runs`, V35): no `owner_id`
  column; the USING clause joins to `pipelines.owner_id`.
- `PipelineSchedule` domain model + `PipelineScheduleRepository` (owner-scoped CRUD via
  `withUserContext`, keyed by `pipeline_id`).
- `PipelineScheduleService`: validates `kind`/`expression`/`timezone` at write time (structural
  cron/interval syntax checks — no next-fire computation, no new external dependency).
- `GET/PUT/DELETE /api/pipelines/:id/schedule` routes, wired into `ApiRoutes.scala`. `PUT` is
  upsert (create-or-replace) since a pipeline has at most one schedule.
- `schemas/` (pipeline-schedule + put-pipeline-schedule-request) and `openspec/specs/` updated.

## Capabilities

### New Capabilities

- `pipeline-schedule-persistence`: `PipelineSchedule` domain model, Flyway schema, RLS, and
  repository access patterns.
- `pipeline-schedule-crud-api`: REST contract for `/api/pipelines/:id/schedule` (get/put/delete),
  owner-scoping, and cron/interval validation behavior.

### Modified Capabilities

(none — additive only)

## Impact

- New: `V62__pipeline_schedules.sql`, `PipelineSchedule` domain model + repository, service,
  routes, protocol formats; wired into `ApiRoutes.scala`/`Main.scala`.
- No changes to existing pipeline run/step/analyze behavior. Pipelines without a schedule behave
  exactly as today (additive, backward compatible).

## Non-goals

- Scheduler runtime that fires runs on schedule (HEL-415).
- Schedule config UI (HEL-416).
- Run provenance labeling for scheduled runs (HEL-417).
- Computing/maintaining `next_run_at` from a cron expression (owned by HEL-415's runtime, which
  needs real wall-clock polling semantics this ticket has no reason to duplicate).
