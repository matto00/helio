## 1. Backend — Migration & Repository

- [x] 1.1 Write Flyway V29 migration creating `data_type_rows` table (`id BIGSERIAL PK`, `data_type_id TEXT NOT NULL`, `row_index INT NOT NULL`, `data JSONB NOT NULL`, unique on `(data_type_id, row_index)`, index on `data_type_id`)
- [x] 1.2 Create `DataTypeRowRepository` with `overwriteRows(dataTypeId, rows)` (transactional DELETE + bulk INSERT) and `listRows(dataTypeId)` returning rows in `row_index` order
- [x] 1.3 Improve `upsertFieldsFromRows` in `PipelineRunRoutes` to infer `"integer"`, `"double"`, `"boolean"` types from first-row values instead of always `"string"`
- [x] 1.4 Wire `DataTypeRowRepository` into `PipelineRunRoutes`; call `overwriteRows` in the non-dry success path (after schema update, before marking run succeeded)
- [x] 1.5 Add `GET /api/data-types/:id/rows` route to `DataTypeRoutes` (or a new sub-router); return `{ rows: [...], rowCount: N }` from `DataTypeRowRepository.listRows`; return 404 if DataType not found
- [x] 1.6 Inject `DataTypeRowRepository` in `ApiRoutes` and wire to both `PipelineRunRoutes` and the new rows endpoint
- [x] 1.7 Add `DataTypeRowsResponse` case class and JSON format to `JsonProtocols`

## 2. Frontend

- [x] 2.1 Update run success message in `PipelineDetailPage` to say "Snapshot replaced: N rows" for non-dry runs (and keep "Preview: N rows" for dry runs)

## 3. Tests

- [x] 3.1 `DataTypeRowRepositorySpec`: test `overwriteRows` inserts rows; second call replaces all; zero-row call clears snapshot
- [x] 3.2 `PipelineRunRoutesSpec`: test non-dry run stores rows in `data_type_rows` after success; dry run does not modify `data_type_rows`
- [x] 3.3 `PipelineRunRoutesSpec`: test improved type inference — numeric column inferred as `integer`, float as `double`
- [x] 3.4 `DataTypeRoutesSpec` (or `PipelineRunRoutesSpec`): test `GET /api/data-types/:id/rows` returns stored rows; empty for no snapshot; 404 for unknown DataType
- [x] 3.5 `PipelineDetailPage.test.tsx`: assert success toast says "Snapshot replaced: N rows" for non-dry run result
