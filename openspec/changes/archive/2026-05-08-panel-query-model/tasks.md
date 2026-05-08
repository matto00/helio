## 1. Backend

- [ ] 1.1 Add `PanelQuery` case class to `com.helio.domain.model` with fields: `selectedFields: List[String]`, `filters: List[JsValue]`, `sort: Option[String]`, `limit: Option[Int]`
- [ ] 1.2 Add `buildQuery(panel: Panel): Option[PanelQuery]` to the `Panel` companion object (returns `None` if `typeId` is `None`; extracts `selectedFields` from `fieldMapping` values)
- [ ] 1.3 Add `panelQueryFormat` implicit `RootJsonFormat[PanelQuery]` in `JsonProtocols.scala`
- [ ] 1.4 Add `GET /api/panels/:id/query` route to `PanelRoutes` — fetches panel, derives query via `Panel.buildQuery`, returns `200 PanelQuery` or `404`

## 2. Schema

- [ ] 2.1 Create `schemas/panel-query.schema.json` — JSON Schema 2020-12 with `selectedFields` (array of string), `filters` (array of object), `sort` (nullable string), `limit` (nullable integer)

## 3. Tests

- [ ] 3.1 Add unit tests for `Panel.buildQuery` covering: bound panel with fieldMapping, null typeId, null fieldMapping, non-object fieldMapping
- [ ] 3.2 Add `PanelQueryRoutesSpec` (ScalaTest) covering: bound panel returns 200 with correct JSON, unbound panel returns 404, missing panel returns 404
