## Context

The pipelines feature has its foundational layers: database tables (`pipelines`, `pipeline_steps`, `pipeline_runs`),
`PipelineRepository`, `PipelineStepRepository`, list/create API routes, `pipelinesSlice`, `CreatePipelineModal`, and
`PipelineDetailPage`. However the detail page is still a local-state scaffold — steps are ephemeral, there is no
`GET /api/pipelines/:id` or `PATCH /api/pipelines/:id` backend endpoint, and the frontend lacks save/cancel and
dirty-state tracking.

## Goals / Non-Goals

**Goals:**
- Add `GET /api/pipelines/:id` and `PATCH /api/pipelines/:id` to `PipelineRoutes`
- Wire `PipelineDetailPage` to load the pipeline and its steps from the API on mount
- Implement save (PATCH name) and cancel with dirty-state detection
- `beforeunload` guard when navigating away with unsaved changes
- Unit tests for new thunks, the dirty-state hook, and extended components

**Non-Goals:**
- Step persistence from the editor (steps are still added locally; PATCH covers name only for now)
- Run pipeline execution (placeholder only, per existing spec)
- Drag-and-drop step reordering

## Decisions

**GET/PATCH go into PipelineRoutes directly** — the existing `PipelineRoutes` class owns the `pathPrefix("pipelines")`
block; adding `pathPrefix(Segment)` children there is consistent and requires no new route class.

**`PipelineSummary` reused as GET /:id response** — the existing `PipelineSummaryResponse` already carries id, name,
sourceDataSourceName, outputDataTypeName, lastRunStatus, lastRunAt. No new domain type is needed.

**Dirty-state via a custom hook** (`useDirtyState`) — encapsulates original-vs-current comparison, returns `isDirty`
boolean. Used by `PipelineDetailPage` for the cancel guard and the `beforeunload` effect. Keeps the page component
presentational.

**Steps loaded via new `fetchPipelineSteps` thunk** — extends `pipelinesSlice` with a `steps` map keyed by pipeline
id and a `stepsStatus` map. Follows the same pattern as `runHistory`.

**PATCH payload is name-only for this ticket** — the spec requires saving pipeline metadata; step mutations are
deferred. PATCH accepts `{ name }`.

**Cancel confirmation via `window.confirm`** — matches existing patterns in the codebase (no custom dialog needed
for this flow); can be upgraded later.

## Risks / Trade-offs

- [Local step state is lost on cancel] → Acceptable for now; steps are not yet persisted from the editor.
- [PATCH is name-only] → Clearly scoped; step save will be its own ticket.
- [`window.confirm` blocks the thread] → Consistent with existing codebase patterns; acceptable short-term.

## Planner Notes

- `CreatePipelineModal` already implements the full create flow (POST, navigate, refresh list). No changes needed.
- `fetchSources` in `sourcesSlice` is already called in `PipelineDetailPage`. The `fetchDataSources` alias
  in the spec maps to the same thunk.
- Backend `PipelineRepository` already has `create` and `listSummaries`; we add `findById` and `updateName`.
