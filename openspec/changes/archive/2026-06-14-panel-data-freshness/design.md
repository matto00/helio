## Context

`PanelResponse` (in `PanelProtocol.scala`) is an 8-field case class currently formatted with
`jsonFormat8`. The `pipelines` table already stores `last_run_at` (an `Option[Instant]`). The
query chain Panel → typeId → DataType → Pipeline exists in data but lacks a repository method.
`PipelineRepository` uses Slick with owner-scoped RLS; there is also `withSystemContext` for
privileged reads. `PanelRepository.findAllByDashboardId` and related methods return `Panel` domain
objects; the route layer converts them to `PanelResponse` via `PanelResponse.fromDomain`.

## Goals / Non-Goals

**Goals:**
- Add `dataAsOf: Option[String]` to `PanelResponse` (ISO-8601 string or `null`).
- New `PipelineRepository.findLastRunAtByOutputDataTypeId(id: DataTypeId): Future[Option[Instant]]`
  — system-context query (owner-bypassing, like `findByIdInternal`) since panels are owned by a
  different user context than the pipeline at query time.
- `PublicDashboardRoutes` (the handler for `GET /api/dashboards/:id/panels`) looks up `dataAsOf`
  in parallel for each returned panel before building the response. No `GET /api/panels/:id` exists.
- `schemas/panel.schema.json` gains `"dataAsOf": { "type": ["string", "null"] }` in `properties`
  (additive; not in `required`). Required because `additionalProperties: false` is set.
- `PanelBase` in `panel.ts` gains `dataAsOf: string | null`.
- `PanelCard` renders `"Data as of <formatRelativeTime(dataAsOf)>"` below the title when
  `dataAsOf` is non-null, using the existing `formatRelativeTime` utility.

**Non-Goals:**
- Changing the Panel domain model (`Panel.scala`) — `dataAsOf` is a computed decoration, not
  a persisted field.
- New Flyway migration (no schema changes).
- Real-time push updates to the freshness label (it refreshes on the normal panel poll cycle).

## Decisions

**D1: Compute `dataAsOf` server-side, not client-side.**
Server-side is simpler: one lookup per panel at response time, no extra client round-trips or
Redux state for pipeline data. Consistent with HEL-200's pattern for `lastRunAt` in
`PipelineSummary`. Alternative (client joins pipelines list in Redux) was rejected: it requires
the client to fetch all pipelines when loading a dashboard, which adds latency and couples
unrelated slices.

**D2: Use `withSystemContext` for the pipeline lookup.**
Panels are owned by user A; the pipeline writing their DataType may also be owned by user A but
the lookup happens at response-assembly time where we only have the `DataTypeId`, not the pipeline
owner. Using `withSystemContext` (as `findByIdInternal` does) is the established pattern for
privileged infrastructure reads. The ACL is enforced at the panel layer (only panels the caller
can read reach this path).

**D3: New method `findLastRunAtByOutputDataTypeId` on `PipelineRepository`.**
Returns `Option[Instant]` (the most recent `last_run_at` among pipelines with
`output_data_type_id = ?` AND `last_run_status = 'succeeded'`). The ticket explicitly states "most
recent *successful* run wins." Failed-run timestamps are excluded — a failure does not indicate
data freshness. Returns `None` when no pipeline matches, no run has ever completed successfully,
or all runs have failed.

**D3a: Binding extraction uses `panel.dataTypeId: Option[DataTypeId]`.**
The `Panel` sealed trait (in `Panel.scala`) declares `def dataTypeId: Option[DataTypeId]`
as an abstract method; each subtype implements it (metric/chart/table return `Some(id)` when
bound, text/markdown/image/divider return `None`). The route calls `panel.dataTypeId` directly
— no pattern-match dispatch or narrowing helper needed. An empty `DataTypeId("")` is treated as
`None` by the subtypes themselves (e.g. `TablePanel.dataTypeId` returns `None` when the value is
empty). The lookup is skipped when `panel.dataTypeId` is `None`.

**D4: Add `dataAsOf` as a top-level nullable field on `PanelResponse`, not inside `config`.**
The field is cross-cutting: it applies to any panel kind that has a bound DataType (metric, chart,
table). Adding it to `config` would require duplicating it in each per-subtype config shape.
Adding it at the root is consistent with `ownerId`, `dashboardId`, `appearance` — all
cross-cutting fields that are present regardless of subtype.

**D5: `PanelResponse` changes from `jsonFormat8` to a custom `RootJsonFormat` (9 fields).**
Spray JSON's `jsonFormatN` macro only goes to `jsonFormat22` but `PanelResponse` is at 8 fields
and adding `dataAsOf: Option[String]` makes it 9. `jsonFormat9` is available — no custom format
needed yet.

**D6: `PanelResponse.fromDomain` becomes a factory that also accepts `dataAsOf`.**
The route/service layer fetches `dataAsOf` from `PipelineRepository` and passes it into
`PanelResponse.fromDomain(panel, dataAsOf)`. All existing callers of `fromDomain` pass `None`.

**D7: Frontend — render indicator in `PanelCard`'s title area, below the title.**
`PanelCard` already has a `panel-grid-card__title-area` div containing the title `<h3>`. A second
`<p>` styled as a muted timestamp goes below the `<h3>` when `dataAsOf` is non-null.
The `PanelBase` interface gains `dataAsOf?: string | null` (optional so existing fixtures that
don't set it remain valid).

## Risks / Trade-offs

- [N+1 query per panel] → Mitigated by a single indexed lookup on `output_data_type_id` per
  panel; can be batched via `IN (...)` in a follow-up if profiling shows it matters. For typical
  dashboard sizes (< 20 panels) the N individual async queries run concurrently via `Future.sequence`.
- [dataAsOf staleness] → Acceptable: the value is as fresh as the last panel fetch; polling via
  `refreshInterval` keeps it current on polling panels.

## Migration Plan

1. Backend change compiles and passes `sbt test` before frontend PR touches types.
2. `dataAsOf` is additive: existing clients ignore unknown fields; no breaking change.
3. No DB migration needed.

## Open Questions

None — all decisions above are self-approved per Phase 1 criteria.

## Planner Notes

Self-approved decisions:
- Server-side computation (D1) — no scope beyond ticket; consistent with existing pattern.
- `withSystemContext` for pipeline lookup (D2) — follows `findByIdInternal` precedent.
- `dataAsOf` at `PanelResponse` root, not in `config` (D4) — avoids per-subtype duplication.
- `jsonFormat9` (D5) — straightforward, no custom format needed.
- Frontend renders in `PanelCard` title area (D7) — minimal surface, correct placement.
