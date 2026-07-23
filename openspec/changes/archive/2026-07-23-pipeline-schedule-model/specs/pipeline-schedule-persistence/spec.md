## ADDED Requirements

### Requirement: PipelineSchedule domain model and schema
The system SHALL define a `PipelineSchedule` domain model with `id: PipelineScheduleId`,
`pipelineId: PipelineId`, `kind` (one of `cron`/`interval`), `expression: String`,
`enabled: Boolean`, `timezone: String`, `nextRunAt: Option[Instant]`, `lastRunAt: Option[Instant]`,
`createdAt`, and `updatedAt`. A Flyway migration SHALL create a `pipeline_schedules` table with a
`UNIQUE` constraint on `pipeline_id` (one schedule per pipeline) and a `pipeline_id` FK to
`pipelines(id) ON DELETE CASCADE`.

#### Scenario: Migration creates the table
- **WHEN** Flyway applies the pipeline-schedules migration to a fresh database
- **THEN** a `pipeline_schedules` table exists with columns for pipeline id, kind, expression,
  enabled, timezone, next_run_at, last_run_at, created_at, and updated_at, and a unique
  constraint on pipeline_id

#### Scenario: Deleting a pipeline cascades its schedule
- **WHEN** a pipeline with a schedule is deleted
- **THEN** the associated `pipeline_schedules` row is also deleted

### Requirement: RLS owner scoping via parent pipeline
The `pipeline_schedules` table SHALL have `ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY`
enabled, with a single `pipeline_schedules_owner` USING policy restricting access to rows whose
parent pipeline's `owner_id` matches `current_setting('app.current_user_id')::uuid`, consistent
with the indirect-owner pattern used for `pipeline_steps` and `pipeline_runs` (no `owner_id`
column of its own).

#### Scenario: Owner can read their pipeline's schedule
- **WHEN** a query runs inside `withUserContext(ownerId)` for a schedule on a pipeline owned by
  `ownerId`
- **THEN** the schedule is returned

#### Scenario: Non-owner cannot read another user's pipeline schedule
- **WHEN** a query runs inside `withUserContext(otherUserId)` for a schedule on a pipeline owned
  by a different user
- **THEN** the schedule is not returned (empty result, not an error)

### Requirement: Owner-scoped repository CRUD keyed by pipeline
`PipelineScheduleRepository` SHALL expose owner-scoped `findByPipelineId(pipelineId, user)`,
`upsert(schedule, user)`, and `delete(pipelineId, user)` operations that run through
`withUserContext` and are subject to RLS.

#### Scenario: findByPipelineId excludes non-owned pipelines
- **WHEN** `findByPipelineId(pipelineOwnedByUserB, userA)` is called
- **THEN** the result is empty/not found, not the other user's schedule

#### Scenario: upsert replaces an existing schedule for the same pipeline
- **WHEN** `upsert` is called twice for the same `pipelineId` with different `expression` values
- **THEN** exactly one `pipeline_schedules` row exists for that pipeline, holding the
  second call's values

### Requirement: next_run_at and last_run_at are not computed by this ticket
`PipelineScheduleRepository`/`PipelineScheduleService` SHALL persist `next_run_at` and
`last_run_at` as nullable, caller-supplied fields but SHALL NOT derive `next_run_at` from
`kind`/`expression` themselves — that computation belongs to the scheduler runtime (a sibling
ticket).

#### Scenario: Creating a schedule leaves next_run_at unset
- **WHEN** a schedule is created via the repository without an explicit `nextRunAt`
- **THEN** the persisted row's `next_run_at` is `NULL`
