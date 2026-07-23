# pipeline-schedule-crud-api Specification

## Purpose
REST CRUD contract for a pipeline's schedule (`/api/pipelines/:id/schedule`), including
request/response shapes, owner-scoping via the parent pipeline, and cron/interval/timezone
validation behavior.
## Requirements
### Requirement: Get pipeline schedule
The backend SHALL expose `GET /api/pipelines/:id/schedule` returning the schedule for the given
pipeline if the pipeline is owned by the caller.

#### Scenario: Found and owned
- **WHEN** `GET /api/pipelines/:id/schedule` is called for a pipeline owned by the caller that
  has a schedule
- **THEN** the response is 200 with the full schedule

#### Scenario: Owned pipeline with no schedule
- **WHEN** `GET /api/pipelines/:id/schedule` is called for a pipeline owned by the caller that
  has no schedule
- **THEN** the response is 404

#### Scenario: Pipeline not found or not owned
- **WHEN** `GET /api/pipelines/:id/schedule` is called with an unknown `:id`, or a pipeline
  owned by a different user
- **THEN** the response is 404 (existence not leaked)

### Requirement: Create or replace pipeline schedule
The backend SHALL expose `PUT /api/pipelines/:id/schedule` accepting `{ kind, expression,
enabled, timezone }`, creating a schedule if none exists for the pipeline or replacing the
existing one, owner-scoped to the pipeline. When replacing an existing schedule, `next_run_at`
SHALL be reset to unset if `kind`, `expression`, or `timezone` differs from the existing row's
value (so the scheduler runtime recomputes it from the new cadence on its next tick, without
firing an extra run purely because of the edit); if none of those three fields changed, the
existing `next_run_at` SHALL be preserved.

#### Scenario: Successful create
- **WHEN** `PUT /api/pipelines/:id/schedule` is called for a pipeline owned by the caller with a
  valid body
- **THEN** the response is 200 or 201 with the created schedule, and a subsequent `GET` returns
  the same `kind`, `expression`, `enabled`, and `timezone`

#### Scenario: Successful replace
- **WHEN** `PUT /api/pipelines/:id/schedule` is called twice for the same pipeline with different
  `expression` values
- **THEN** the second call's response reflects the new `expression`, and exactly one schedule
  exists for that pipeline

#### Scenario: Absent optional fields normalize at the boundary
- **WHEN** `PUT /api/pipelines/:id/schedule` is called with `enabled` omitted from the request body
- **THEN** the service normalizes the absent field to `true` rather than erroring

#### Scenario: Invalid cron expression is rejected
- **WHEN** `PUT /api/pipelines/:id/schedule` is called with `kind: "cron"` and a malformed
  `expression` (wrong field count, out-of-range value, or non-numeric/non-wildcard token)
- **THEN** the response is 400 with a message identifying the invalid expression

#### Scenario: Invalid interval expression is rejected
- **WHEN** `PUT /api/pipelines/:id/schedule` is called with `kind: "interval"` and a malformed
  `expression` (not a positive `<n><unit>` token)
- **THEN** the response is 400 with a message identifying the invalid expression

#### Scenario: Invalid timezone is rejected
- **WHEN** `PUT /api/pipelines/:id/schedule` is called with a `timezone` that is not a valid IANA
  zone id
- **THEN** the response is 400 with a message identifying the invalid timezone

#### Scenario: Pipeline not found or not owned
- **WHEN** `PUT /api/pipelines/:id/schedule` is called with an unknown `:id`, or a pipeline owned
  by a different user
- **THEN** the response is 404 and no schedule is created

#### Scenario: Cadence change resets next_run_at
- **WHEN** `PUT /api/pipelines/:id/schedule` is called for a pipeline that already has a schedule,
  and the request's `kind`, `expression`, or `timezone` differs from the existing schedule's value
- **THEN** the replaced schedule's `next_run_at` is unset (not the stale, pre-edit value), so the
  scheduler runtime recomputes it from the new cadence on its next tick

#### Scenario: Unrelated edit preserves next_run_at
- **WHEN** `PUT /api/pipelines/:id/schedule` is called for a pipeline that already has a schedule
  with a computed `next_run_at`, and the request's `kind`, `expression`, and `timezone` all match
  the existing schedule's values (e.g. only `enabled` differs)
- **THEN** the replaced schedule's `next_run_at` is unchanged from its prior value

### Requirement: Delete pipeline schedule
The backend SHALL expose `DELETE /api/pipelines/:id/schedule`, owner-scoped to the pipeline.

#### Scenario: Successful delete
- **WHEN** `DELETE /api/pipelines/:id/schedule` is called for a pipeline owned by the caller that
  has a schedule
- **THEN** the response is 204 and the schedule no longer exists

#### Scenario: Delete when no schedule exists
- **WHEN** `DELETE /api/pipelines/:id/schedule` is called for a pipeline owned by the caller that
  has no schedule
- **THEN** the response is 404

#### Scenario: Pipeline not found or not owned
- **WHEN** `DELETE /api/pipelines/:id/schedule` is called with an unknown `:id`, or a pipeline
  owned by a different user
- **THEN** the response is 404 and no schedule is deleted

### Requirement: Backward compatibility
Pipelines without a schedule SHALL behave exactly as they do today — schedule absence has no
effect on existing pipeline CRUD, run, or analyze behavior.

#### Scenario: Existing pipeline endpoints unaffected
- **WHEN** a pipeline has no schedule and its existing endpoints (`GET/POST/PATCH/DELETE
  /api/pipelines/:id`, run, analyze) are exercised
- **THEN** their behavior and response shapes are unchanged from before this change

