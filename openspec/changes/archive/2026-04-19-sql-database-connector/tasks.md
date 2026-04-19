## 1. Backend: Dependencies and Domain Model

- [x] 1.1 Add MySQL JDBC driver (`com.mysql:mysql-connector-j`) to `backend/build.sbt`
- [x] 1.2 Add `sql` to the `SourceType` enum in the domain model
- [x] 1.3 Define `SqlSourceConfig` case class with fields: `dialect`, `host`, `port`, `database`, `user`, `password`, `query`
- [x] 1.4 Define `SqlSourceConfigResponse` case class identical to `SqlSourceConfig` but with `password` always `"***"`
- [x] 1.5 Add Spray JSON formatters for `SqlSourceConfig` and `SqlSourceConfigResponse` in `JsonProtocols.scala`

## 2. Backend: SqlConnector

- [x] 2.1 Create `SqlConnector.scala` with a DDL/DML keyword regex check returning `Left[String]` on match
- [x] 2.2 Implement `connect(config: SqlSourceConfig): Connection` building the correct JDBC URL for postgresql/mysql dialect
- [x] 2.3 Implement `execute(config, maxRows): Future[Seq[Map[String, JsValue]]]` using `scala.concurrent.blocking`, `setQueryTimeout(30)`, and `setMaxRows(maxRows)`
- [x] 2.4 Map `ResultSet` columns to `JsValue` (String→JsString, Int/Long→JsNumber, Double→JsNumber, Boolean→JsBoolean, null→JsNull)
- [x] 2.5 Convert the row sequence to `JsArray` and call `SchemaInferenceEngine.fromJson` for schema inference

## 3. Backend: Routes

- [x] 3.1 Add `POST /api/sources` handler for `source_type: sql` — DDL check, execute (100 rows), infer, insert DataSource + DataType
- [x] 3.2 Add `POST /api/sources/infer` handler for `source_type: sql` — DDL check, execute (100 rows), infer, return `InferredSchemaResponse`
- [x] 3.3 Add `GET /api/sources/:id/preview` route — load DataSource, execute with `setMaxRows(10)`, return `{"rows": [...]}`
- [x] 3.4 Add `POST /api/sources/:id/refresh` route — load DataSource, execute (100 rows), re-infer, update or create DataType
- [x] 3.5 Register the new SQL routes in `ApiRoutes.scala`
- [x] 3.6 Ensure all SQL DataSource responses use `SqlSourceConfigResponse` (password masked)

## 4. Frontend: SQL Tab Component

- [x] 4.1 Create `SqlTab.tsx` with controlled form state: dialect, host, port, database, username, password, query
- [x] 4.2 Implement dialect-driven port default (5432 for PostgreSQL, 3306 for MySQL) on dialect change
- [x] 4.3 Add "Test connection" button that dispatches `inferSqlSource` thunk and displays inferred fields
- [x] 4.4 Display inline error messages on 4xx/5xx responses from infer endpoint
- [x] 4.5 Add the SQL Database tab to `AddSourceModal` alongside existing tabs

## 5. Frontend: Redux / Service Layer

- [x] 5.1 Add `inferSqlSource` async thunk in the data sources slice calling `POST /api/sources/infer` with `source_type: "sql"`
- [x] 5.2 Add `createSqlSource` async thunk calling `POST /api/sources` with `source_type: "sql"`
- [x] 5.3 Wire `createSqlSource` to the modal's save/submit action for the SQL tab

## 6. Tests

- [x] 6.1 Unit test `SqlConnector` DDL/DML keyword rejection for all seven keywords (case-insensitive, word-boundary)
- [x] 6.2 Unit test that `SELECT` with embedded keyword substring (e.g. `updated_at`) is not rejected
- [x] 6.3 Unit test JDBC URL construction for postgresql and mysql dialects
- [x] 6.4 Jest test for `SqlTab`: port defaults to 5432 on PostgreSQL, 3306 on MySQL
- [x] 6.5 Jest test for `SqlTab`: "Test connection" shows inferred fields on success, inline error on failure
