## Context

The pipeline editor already has a non-functional "Preview data" button rendered inside
each StepCard. The `InProcessPipelineEngine` is already used by the `POST /api/pipelines/:id/run`
endpoint for full pipeline execution. The analyze endpoint (`GET /api/pipelines/:id/analyze`)
handles schema inference. The missing piece is a partial-execution endpoint that stops at a
specified step and returns sample rows, plus frontend wiring to render those rows.

## Goals / Non-Goals

**Goals:**
- Add `GET /api/pipelines/:id/steps/:stepId/preview` that runs steps 0..K (inclusive) and returns
  the first 10 rows
- Wire the "Preview data" button in `StepCard` to fetch from this endpoint and render results inline
- Handle loading, error, and unsupported-source-type states gracefully

**Non-Goals:**
- Previewing unsupported source types (RestApi, Sql) — return 422 consistent with run endpoint
- Spark-backed preview
- Paginating the preview table
- Redux state for preview data (transient, component-local)

## Decisions

**Decision: New endpoint over query param on existing run**
`GET /api/pipelines/:id/steps/:stepId/preview` is cleaner and more RESTful than adding
`?upTo=stepId` to `POST /api/pipelines/:id/run`. Preview is a read-only operation — using GET
makes that clear and avoids accidentally triggering run side-effect concerns.

**Decision: stepId in path (not position/index)**
StepCard already holds the step `id` from the persisted `PipelineStep`. Using `stepId` avoids
re-ordering bugs if the frontend's displayed order diverges from DB position.

**Decision: 10 rows, no config param**
For MVP, 10 rows is sufficient. A query param for row count can be added later without breaking the contract.

**Decision: Component-local state, not Redux**
Preview rows are ephemeral and per-card. Redux would add unnecessary boilerplate (thunk, slice field,
selector) for transient UI state. React `useState` + direct service call is appropriate here.

**Decision: Reuse existing `PipelineRunRoutes` class**
The new route handler shares all the same dependencies (`pipelineRepo`, `pipelineStepRepo`,
`dataSourceRepo`, `InProcessPipelineEngine`). Adding the route to `PipelineRunRoutes` avoids a
new class and new wiring in `ApiRoutes`.

## Risks / Trade-offs

Large source datasets in static/csv data sources will be fully loaded into memory before taking
the first 10 rows. The run endpoint has the same behavior. This is acceptable given the in-process
engine is already constrained to static/csv.
→ Mitigation: none for MVP; note for future lazy-loading.

## Planner Notes

Self-approved: no new external dependencies, no DB changes, no breaking API changes.
The frontend addition is entirely additive (existing button gains a handler + a new sub-component
rendered inline). The backend addition is a new GET route on an existing path prefix.
