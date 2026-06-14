## Why

Panels bound to a DataType have no way to communicate how fresh their data is. The pipeline that
writes to that DataType records `lastRunAt`, but the panel API never surfaced it. Users need a
"Data as of [timestamp]" indicator so they can assess data freshness at a glance without navigating
away to the pipeline list.

## What Changes

- New `PipelineRepository.findByOutputDataTypeId(id: DataTypeId)` method returning the pipeline
  whose `outputDataTypeId` matches; when multiple pipelines write to the same DataType, the one with
  the most recent `lastRunAt` wins.
- `PanelResponse` (backend DTO + Scala response case class) gains `dataAsOf: Option[String]` — an
  ISO-8601 timestamp populated server-side when a panel has a bound DataType with an associated
  pipeline that has run; `null` otherwise.
- `GET /api/dashboards/:id/panels` returns `dataAsOf` on every panel. (No `GET /api/panels/:id` route exists; AC #2 only requires the dashboard panels list endpoint.)
- Frontend `Panel` interface gains `dataAsOf: string | null`.
- A "Data as of ..." indicator renders in the panel title area (below or beside the title) using
  the existing `formatRelativeTime` utility from HEL-200. Shown only when `dataAsOf` is non-null.

## Capabilities

### New Capabilities

- `panel-data-freshness`: "Data as of [timestamp]" indicator on bound panels — API field, backend
  pipeline lookup, and frontend rendering.

### Modified Capabilities

- `panel-datatype-binding`: Panel API response now includes `dataAsOf` field alongside existing
  `typeId`/`fieldMapping`/`refreshInterval` — new field on the same endpoint.

## Impact

- Backend: `PipelineRepository.scala` (new method), `PanelRepository.scala` (join to look up
  pipeline via datatype), `PanelRoutes.scala` or `ApiRoutes.scala` (pass dataAsOf into response),
  `JsonProtocols.scala` (new field on PanelResponse), domain model `Panel.scala`.
- Frontend: `models.ts` (Panel interface), panel display component (render indicator),
  `panelsSlice` test fixtures.
- No new Flyway migration required — `last_run_at` already exists on the `pipelines` table.
- `schemas/panel.schema.json` gains `"dataAsOf": { "type": ["string", "null"] }` in `properties`
  (not in `required` — additive, optional field). `additionalProperties: false` means the property
  must be explicitly declared or the backend response will not validate. No `panel-summary.schema.json`
  exists in the codebase; `panel.schema.json` is the authoritative wire contract.

## Non-goals

- Client-side freshness lookup (server-side computation preferred per HEL-200 pattern).
- Auto-refresh or live updates of the `dataAsOf` field (panel polling covers data; this is a
  one-time label at render time, refreshed on the normal panel polling cycle).
- Surfacing pipeline run history or multiple pipeline timestamps per panel.
- Any changes to pipeline execution, scheduling, or run history tables.
