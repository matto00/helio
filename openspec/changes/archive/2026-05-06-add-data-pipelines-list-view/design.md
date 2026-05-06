## Context

Helio currently has a Data Sources page at `/sources` with a sidebar nav link. The app sidebar contains `NavLink` components for each section. There is no pipeline concept in the current frontend or backend. The backend uses Slick for DB queries and Pekko HTTP routes defined in `ApiRoutes.scala`. The frontend uses Redux slices with `createAsyncThunk` for all API calls.

Pipelines are a new first-class resource in v1.3 that transform data from a source into a DataType output. The data model must be established before the list view can render anything meaningful.

## Goals / Non-Goals

**Goals:**
- Add `GET /api/pipelines` backend endpoint with a minimal pipeline summary projection
- Add `/pipelines` frontend route with a list view component
- Add a sidebar nav item linking to `/pipelines`
- Introduce `pipelinesSlice` Redux state and async thunk

**Non-Goals:**
- Pipeline creation, editing, or deletion UI
- Pipeline execution / triggering
- Pagination, filtering, or sorting
- Auth/ACL enforcement on pipelines (handled in a later ticket)

## Decisions

### D1: Minimal pipeline data model

The backend will introduce a `pipelines` table via a new Flyway migration. Columns: `id`, `name`, `source_data_source_id` (FK to data_sources), `output_data_type_id` (FK to data_types), `last_run_status` (nullable enum: succeeded/failed), `last_run_at` (nullable timestamp), plus `created_at`/`updated_at`.

Rationale: This is the minimal shape to satisfy the list view requirements. Richer pipeline config (transform logic, schedule) belongs in a later ticket.

### D2: Joined summary query for the list endpoint

`GET /api/pipelines` returns a flat projection joining pipeline with data source name and data type name. No separate child-fetch round-trips on the frontend. Response shape:

```json
[{
  "id": "...",
  "name": "...",
  "sourceDataSourceName": "...",
  "outputDataTypeName": "...",
  "lastRunStatus": "succeeded" | "failed" | null,
  "lastRunAt": "2024-01-01T00:00:00Z" | null
}]
```

### D3: Follow existing nav pattern

The existing sidebar uses `NavLink` with `aria-label="Main navigation"` and a `/sources` link. The new `/pipelines` link follows the same pattern. The `frontend-data-sources-page` spec requirement that enumerates nav links must be updated to include Pipelines.

### D4: pipelinesSlice mirrors dataSourcesSlice

New `pipelinesSlice.ts` follows the same `createAsyncThunk` + `createSlice` pattern as `dataSourcesSlice`. State shape: `{ items: PipelineSummary[]; status: 'idle' | 'loading' | 'succeeded' | 'failed'; error: string | null }`.

## Risks / Trade-offs

- [Empty table on first render] No demo data seeded → users see empty state immediately. Mitigation: empty state is explicitly part of the spec; no demo pipelines needed for this ticket.
- [Schema evolution] Minimal pipeline table may require additive migrations as pipeline config grows. Mitigation: additive-only migrations are standard practice in this codebase.

## Planner Notes

- Self-approved: additive backend table + endpoint, new frontend route and slice, nav item addition. No breaking changes, no new external dependencies.
- The `frontend-data-sources-page` spec change is minimal: one MODIFIED requirement noting the nav now includes a Pipelines link. Existing nav behavior is unchanged.
