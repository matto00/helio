## Context

Helio panels can be bound to a DataType whose backing DataSource is Spark-compatible (static, CSV).
`Panel.buildQuery` already derives a `PanelQuery` from a panel's `fieldMapping`, and `SparkJobSubmitter`
already loads DataFrames and applies transformations for pipeline runs. The missing piece is a route that
wires these two together for a synchronous, panel-scoped query execution.

The existing `GET /api/panels/:id/query` endpoint (panel-query-model spec) returns the `PanelQuery` JSON.
The pipeline run flow (`PipelineRunRoutes` + `SparkJobSubmitter.submit`) is async with a cache. Panel query
execution must be synchronous (single HTTP round-trip) because the frontend awaits the rows before rendering.

## Goals / Non-Goals

**Goals:**
- `POST /api/panels/:id/execute` returns rows synchronously via `SparkJobSubmitter`
- Reuse `SparkJobSubmitter.loadDataFrame` and `collectRows`; avoid duplicating Spark logic
- Backend tests cover the new route (happy path, unbound, not-found, unsupported source type)

**Non-Goals:**
- Frontend changes to call the new endpoint
- Async/polling model; caching of results
- Applying pipeline steps (those belong to `PipelineRunRoutes`); panel execution selects fields only
- Iceberg persistence (HEL-232)

## Decisions

**1. Synchronous execution with `Await` inside a blocking Future.**
Panel queries are simple column-selections against already-loaded DataFrames. Blocking via
`scala.concurrent.blocking { Await.result(...) }` inside a dedicated thread-pool Future mirrors how
`SparkJobSubmitter.submit` isolates Spark work on `sparkEc`. The route uses `onComplete` to avoid
blocking the Pekko dispatcher.

**2. New `PanelQueryExecutor` class in `com.helio.spark`.**
Placing it in the `spark` package keeps Spark logic out of the route layer, consistent with how
`SparkJobSubmitter` is structured. The executor exposes a single method:
`execute(dataSource: DataSource, query: PanelQuery): Future[Seq[Map[String, Any]]]`.
It delegates `loadDataFrame` and `collectRows` to `SparkJobSubmitter` (package-private visibility).

**3. Extend `PanelRoutes` rather than create a new routes class.**
The new endpoint is `POST /api/panels/:id/execute` — semantically a panel sub-resource action.
Adding it to `PanelRoutes` avoids a new constructor parameter in `ApiRoutes` for a single path segment,
and keeps all panel routes co-located. `SparkJobSubmitter` and `DataSourceRepository` are injected
into `PanelRoutes` via constructor (optional, nullable pattern used by `PipelineRunRoutes`).

**4. Field selection via `DataFrame.select`.**
`PanelQuery.selectedFields` maps to Spark column names. If `selectedFields` is empty, return all
columns (mirrors "no filter" semantics). Unsupported source types (RestApi, Sql) return 422.

**5. Response shape: `{ rows: [{...}, ...] }` wrapper.**
A bare array is valid JSON but a wrapper object allows adding metadata (row count, truncation flags)
in future without breaking the contract.

## Risks / Trade-offs

- [Risk] Long-running Spark jobs block the HTTP connection → Mitigation: panels are expected to query
  small DataSources (static/CSV demo data); add a configurable timeout in a follow-on if needed.
- [Risk] `loadDataFrame` is `private[spark]` in `SparkJobSubmitter` → Mitigation: `PanelQueryExecutor`
  is in the same `spark` package so it has access without visibility changes.

## Planner Notes

Self-approved. No new external dependencies; no DB migration; no breaking API changes. The new endpoint
is additive and the frontend does not call it yet.
