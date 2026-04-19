## 1. Backend

- [ ] 1.1 Add `StaticDataPayload` and `StaticColumnPayload` case classes to `JsonProtocols.scala` with JSON formatters
- [ ] 1.2 Add `StaticDataSourceRequest` case class (name, source_type, columns, rows) with JSON formatter
- [ ] 1.3 Add JSON `post` branch in `DataSourceRoutes` for `source_type: static`, validate row count (≤500), store config, insert `DataSource` and `DataType`
- [ ] 1.4 Add static branch in `/:id/refresh` route: parse JSON body, validate row count, update `DataSource.config` via `dataSourceRepo.update`, update linked `DataType` via `dataTypeRepo.update`
- [ ] 1.5 Add static branch in `/:id/preview` route: read rows from `config` JSONB, return `CsvPreviewResponse` with column names as headers and all cell values coerced to strings

## 2. Frontend

- [ ] 2.1 Add `StaticColumn` and `StaticSourcePayload` TypeScript types to the data-sources type definitions
- [ ] 2.2 Add `createStaticSource` action/thunk in `dataSourcesSlice` that POSTs JSON to `/api/data-sources`
- [ ] 2.3 Create `StaticSourceForm` component: Step 1 column definition (name input + type selector per column, Add column button), Step 2 row entry grid (editable cells, Add row button)
- [ ] 2.4 Integrate `StaticSourceForm` as a "Manual" tab in `AddSourceModal`, wired to `createStaticSource` on submit
- [ ] 2.5 Add `"static"` → `"Static"` badge case in `DataSourceList` badge renderer

## 3. Tests

- [ ] 3.1 Backend: write `DataSourceRoutesSpec` test for static source creation (valid payload → 201, 501 rows → 400, missing name → 400)
- [ ] 3.2 Backend: write `DataSourceRoutesSpec` test for static refresh (replaces config and DataType fields)
- [ ] 3.3 Backend: write `DataSourceRoutesSpec` test for static preview (returns headers and rows as strings)
- [ ] 3.4 Frontend: write Jest test for `StaticSourceForm` column-definition step (add column, prevent Next when empty)
- [ ] 3.5 Frontend: write Jest test for `dataSourcesSlice` `createStaticSource` thunk (mocked axios, success and error paths)
