## 1. Backend

- [x] 1.1 Add `PanelQueryExecutor` class in `backend/src/main/scala/com/helio/spark/PanelQueryExecutor.scala` with `execute(dataSource: DataSource, query: PanelQuery): Future[Seq[Map[String, Any]]]`
- [x] 1.2 Implement field projection in `PanelQueryExecutor`: select `query.selectedFields` columns from loaded DataFrame (return all columns when `selectedFields` is empty)
- [x] 1.3 Add `PanelExecuteResponse` case class (wrapping `rows: Seq[Map[String, JsValue]]`) and `panelExecuteResponseFormat` in `JsonProtocols.scala`
- [x] 1.4 Add `POST /api/panels/:id/execute` route inside `PanelRoutes` by injecting `PanelQueryExecutor` and `DataSourceRepository` as optional constructor params
- [x] 1.5 Wire the new route in `ApiRoutes.scala`: pass `dataSourceRepo` and a `PanelQueryExecutor` instance to `PanelRoutes`

## 2. Tests

- [x] 2.1 Add `PanelQueryExecutorSpec` in `backend/src/test/scala/com/helio/spark/` covering: static source returns projected rows, empty selectedFields returns all columns
- [x] 2.2 Add route tests for `POST /api/panels/:id/execute` in `ApiRoutesSpec.scala` (or a dedicated spec): bound panel 200, unbound panel 404, missing panel 404, unsupported source type 422
