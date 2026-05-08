## Why

Panel data is currently fetched via DataType snapshot/preview endpoints, which bypass Spark and cannot
apply pipeline-style transformations. The `GET /api/panels/:id/query` endpoint already exposes a
panel's structured `PanelQuery`, but nothing submits that query to Spark for execution. This change
closes that gap by adding a synchronous `POST /api/panels/:id/execute` endpoint that loads the panel's
bound data source into Spark, applies the panel's selected fields, filters, sort, and limit, and returns
result rows directly.

## What Changes

- New endpoint `POST /api/panels/:id/execute` on the backend: derives `PanelQuery` from the panel,
  loads the data source into Spark via `SparkJobSubmitter`, applies field selection and query constraints,
  and returns a JSON array of result rows synchronously.
- New `PanelQueryExecutor` service class in `com.helio.spark` that wraps `SparkJobSubmitter` and
  accepts a `DataSource` + `PanelQuery`, executing the query against the loaded `DataFrame`.
- New `PanelExecuteRoutes` (or extended `PanelRoutes`) to handle the new endpoint.
- JSON serialization for the response (array of row objects) registered in `JsonProtocols`.
- Backend unit tests covering: successful execution, unbound panel (404), non-existent panel (404),
  and unsupported source type (422).

## Capabilities

### New Capabilities
- `panel-query-execution`: POST endpoint that submits a panel's derived query to Spark and returns rows

### Modified Capabilities
- `panel-bound-data-fetch`: The canonical data path for panels now includes the Spark execution route
  alongside the existing preview endpoints (spec update to document when each is used)

## Impact

- Backend: new route in `PanelRoutes` or new `PanelQueryExecuteRoutes`; new service in `com.helio.spark`;
  `SparkJobSubmitter` reused (not replaced) — the pipeline run path is unchanged
- `ApiRoutes.scala` must wire the new route with `SparkJobSubmitter` and `PipelineRunCache` (or a simpler
  synchronous executor)
- No frontend changes in this ticket (frontend integration is a follow-on)
- No DB migration required

## Non-goals

- Frontend UI changes to call the new endpoint (follow-on ticket)
- Replacing the existing CSV/REST preview endpoints
- Async/polling execution model (this ticket is synchronous)
- Iceberg snapshot persistence (HEL-232)
