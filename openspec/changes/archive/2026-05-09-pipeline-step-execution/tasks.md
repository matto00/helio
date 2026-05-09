## 1. Backend — In-Process Execution Engine

- [x] 1.1 Create `InProcessPipelineEngine` in `com.helio.domain` with `execute(rows, steps, dataSourceRepo): Future[Seq[Map[String, Any]]]`
- [x] 1.2 Implement `rename` op: apply all `from→to` mappings to every row
- [x] 1.3 Implement `filter` op: delegate to `ExpressionEvaluator` to evaluate boolean expression per row
- [x] 1.4 Implement `compute` op: delegate to `ExpressionEvaluator` to evaluate expression and add/replace column per row
- [x] 1.5 Implement `groupby` op: group rows by keys, apply `sum` or `count` aggregation, name output column `<fn>_<col>`
- [x] 1.6 Implement `cast` op: coerce column values to target type (`string`, `integer`, `long`, `double`, `boolean`); use null on failure
- [x] 1.7 Implement `join` op: load right-hand DataSource rows, perform inner or left join on `joinKey`

## 2. Backend — Data Loading

- [x] 2.1 Add `loadRows(ds: DataSource): Future[Seq[Map[String, Any]]]` helper in `InProcessPipelineEngine` (handles static and csv sources)

## 3. Backend — Run Route Updates

- [x] 3.1 Add `?dry=true` query parameter extraction in `PipelineRunRoutes`
- [x] 3.2 For non-dry runs: call `InProcessPipelineEngine.execute`, update `last_run_status` / `last_run_at`, write schema snapshot to Type Registry, return `200 OK` with `{ rows, rowCount }`
- [x] 3.3 For dry runs: call `InProcessPipelineEngine.execute`, skip registry write and status update, return `200 OK` with `{ rows, rowCount }`
- [x] 3.4 On execution failure: set `last_run_status` to `"failed"` and return `422 Unprocessable Entity` with error message (non-dry only)

## 4. Backend — Type Registry Write-Back

- [x] 4.1 Add `upsertFieldsFromRows(id: DataTypeId, rows: Seq[Map[String, Any]]): Future[Unit]` (or inline logic) to `DataTypeRepository` / route handler that infers field names from row keys, sets all types to `"string"`, calls `DataTypeRepository.update`

## 5. Backend — JSON Response

- [x] 5.1 Add or reuse `RunResultResponse(rows: Seq[JsObject], rowCount: Int)` case class and JSON format in `JsonProtocols`

## 6. Tests

- [x] 6.1 `InProcessPipelineEngineSpec`: unit test each of the 6 op types with small in-memory row sets
- [x] 6.2 `InProcessPipelineEngineSpec`: test multi-step pipeline applies steps in order
- [x] 6.3 `PipelineRunRoutesSpec`: test dry-run returns rows without modifying `last_run_status`
- [x] 6.4 `PipelineRunRoutesSpec`: test non-dry run updates `last_run_status` to `"succeeded"` and writes to Type Registry
- [x] 6.5 `PipelineRunRoutesSpec`: test non-dry run failure sets `last_run_status` to `"failed"` and returns 422
