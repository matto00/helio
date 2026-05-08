## Context

Panels store a `fieldMapping: Option[JsValue]` in the domain model (`model.scala`) alongside `typeId: Option[DataTypeId]`. Today, the frontend fetches full DataType snapshots using raw preview endpoints. HEL-205 introduces a formal `PanelQuery` model so the Spark execution layer (introduced in HEL-202/HEL-203) has a structured, serializable input rather than raw snapshot data. The query is derived on-the-fly from the panel's existing `fieldMapping` — no new DB column is needed.

## Goals / Non-Goals

**Goals:**
- Define `PanelQuery` case class in `com.helio.domain.model`
- Add `buildQuery(panel: Panel): Option[PanelQuery]` pure function (returns `None` for unbound panels)
- Expose `GET /api/panels/:id/query` via `PanelRoutes` — returns `PanelQuery` JSON or 404 if unbound
- Add JSON Schema `schemas/panel-query.schema.json`
- Add `JsFormat` for `PanelQuery` in `JsonProtocols.scala`

**Non-Goals:**
- Persisting `PanelQuery` to PostgreSQL
- Spark job invocation (future)
- Frontend UI for query editing

## Decisions

### 1. `PanelQuery` is derived, not stored
Rationale: `fieldMapping` is already persisted; computing the query on read avoids a redundant column and keeps the single source of truth. Alternative (storing computed query) was rejected because it would drift from `fieldMapping` on PATCH without extra triggers.

### 2. `selectedFields` derived from `fieldMapping` keys
`fieldMapping` is `Option[JsValue]` containing a JSON object of `{ slotName -> fieldName }`. `selectedFields` = the distinct set of `fieldName` values (the mapped DataType field names). This is the minimal set the panel actually needs from the DataType.

### 3. `filters`, `sort`, `limit` default to empty / None
In HEL-205 scope, the panel model does not yet carry per-panel filter/sort/limit configuration. These fields are included in the schema for forward compatibility but default to `[]`, `None`, `None`. Future tickets will populate them from panel config.

### 4. `GET /api/panels/:id/query` returns 404 for unbound panels
Consistent with how other panel sub-resources behave (e.g., attempting to preview an unbound panel yields no data). Callers can check `typeId` presence first; `buildQuery` returning `None` maps to 404.

### 5. `buildQuery` lives in `model.scala` as a method on `Panel` companion object
This keeps domain logic co-located with the domain model, consistent with existing patterns (`PanelAppearance.Default`, `PanelType.fromString`).

## Risks / Trade-offs

- [Risk] `fieldMapping` shape is `JsValue` (opaque) — parsing field names out of it requires pattern matching on `JsObject`. → Mitigation: treat non-object `fieldMapping` as producing empty `selectedFields` and log a warning.
- [Risk] API adds a new route under `/api/panels/:id` — must not conflict with existing `/:id/duplicate`. → Mitigation: route is `path(Segment / "query")`, which is already a distinct segment pattern in Pekko HTTP.

## Planner Notes

Self-approved. The change is additive (new endpoint, new model), no breaking changes to existing panel routes or DB schema. Scala/Pekko HTTP patterns followed verbatim from existing `PanelRoutes`. Schema follows JSON Schema 2020-12 as per other schemas in `schemas/`.
