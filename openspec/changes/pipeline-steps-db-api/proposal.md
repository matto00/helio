## Why

Pipeline transformation steps need to be persisted so the pipeline editor (HEL-180) can save, load,
reorder, and delete them. Without a backend, the editor has no durable state and steps are lost
on page refresh.

## What Changes

- Add Flyway migration V23 creating the `pipeline_steps` table with id, pipeline_id (FK → pipelines),
  position, op (enum-checked), config (JSON blob), and timestamps
- Expose four new REST endpoints: GET/POST on `/api/pipelines/:id/steps` and PATCH/DELETE on
  `/api/pipeline-steps/:id`
- Add `PipelineStepRepository` for all DB access
- Add `PipelineStep` domain model and JSON protocol entries
- Wire routes into `ApiRoutes`

## Capabilities

### New Capabilities

- `pipeline-steps-persistence`: DB schema, repository, and CRUD API for pipeline transformation steps

### Modified Capabilities

<!-- No existing spec-level requirements change -->

## Impact

- **Backend**: new migration file, new repository, new route handlers in ApiRoutes, new domain types
  in JsonProtocols
- **Frontend**: no changes in this ticket — editor wiring is deferred to HEL-180
- **No breaking changes** to existing endpoints

## Non-goals

- Frontend pipeline editor wiring (HEL-180)
- Step execution / pipeline run logic
- Step validation beyond the op CHECK constraint
