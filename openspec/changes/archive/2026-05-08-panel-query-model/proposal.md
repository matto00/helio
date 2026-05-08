## Why

Helio panels currently fetch full DataType snapshots for preview, with no structured way to express what data a panel actually needs (fields, filters, sort, limit). As panels move toward Spark-backed execution, a structured, serializable query model is required so the execution layer can process precisely what each panel requests rather than returning raw snapshots.

## What Changes

- Introduce a `PanelQuery` domain model (Scala backend) with fields: `selectedFields`, `filters`, `sort`, `limit`
- Add a `panelQuery` field to the Panel domain model (derived from `fieldMapping` at query-build time)
- Expose `GET /api/panels/:id/query` endpoint that returns the panel's current structured query
- `PanelQuery` is serializable to/from JSON (Spray JSON protocol)
- The query is built from the panel's `fieldMapping` and panel-level config — no full DataType snapshot fetch required for query construction

## Capabilities

### New Capabilities

- `panel-query-model`: Defines the `PanelQuery` data structure, serialization, and derivation rules from a panel's field mapping. Covers the backend domain model, JSON protocol, and the query-build endpoint.

### Modified Capabilities

- `panel-bound-data-fetch`: Requirement change — the data fetch path shifts from full DataType snapshot to using the structured query as the input to the execution layer. The frontend does not yet call Spark directly (that is a future step), but the query endpoint is now the canonical way to express what data a panel needs.

## Impact

- Backend: new `PanelQuery` case class, new JSON formats in `JsonProtocols`, new route in `ApiRoutes` / `PanelRoutes`
- Schemas: new JSON Schema for `PanelQuery` under `schemas/`
- OpenAPI: new path `GET /api/panels/:id/query`
- Frontend: no UI changes in this ticket; query construction remains backend-side
- No breaking changes to existing panel PATCH/GET endpoints

## Non-goals

- Spark execution integration (future ticket)
- Frontend UI for editing query parameters directly
- Persisting `PanelQuery` to the database (derived on-the-fly from `fieldMapping`)
