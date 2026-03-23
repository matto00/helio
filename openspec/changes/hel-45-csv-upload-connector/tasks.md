## 1. RFC 4180 CSV parser

- [x] 1.1 Replace `parseRow` in `SchemaInferenceEngine` with an RFC 4180-compliant parser: quoted fields, escaped double-quotes (`""`), CRLF/LF normalisation
- [x] 1.2 Update `fromCsv` to normalise CRLF line endings before splitting into rows

## 2. Domain and JSON protocols

- [x] 2.1 Add `DataSourceResponse` and `DataSourcesResponse` case classes (and `fromDomain`) to `JsonProtocols.scala`
- [x] 2.2 Add `CreateDataSourceRequest` (name: String) and `CsvPreviewResponse` (headers, rows) to `JsonProtocols.scala`

## 3. Upload route — POST /api/data-sources

- [x] 3.1 Add multipart `fileUpload("file")` + `formField("name")` route in `ApiRoutes` under `pathPrefix("data-sources")`
- [x] 3.2 Enforce file size limit from `CSV_MAX_FILE_SIZE_BYTES` env var (default 50 MB); return 413 on violation
- [x] 3.3 Enforce UTF-8 encoding; return 400 with message on non-UTF-8 bytes
- [x] 3.4 Run `SchemaInferenceEngine.fromCsv`, create `DataSource` with `config = {"path": "<relative-path>"}`, store file via `FileSystem.write`, insert `DataSource` via `DataSourceRepository.insert`
- [x] 3.5 Insert linked `DataType` via `DataTypeRepository.insert` with `sourceId = Some(ds.id)` and fields from inferred schema; return 201 with `DataSourceResponse`

## 4. Refresh route — POST /api/data-sources/:id/refresh

- [x] 4.1 Add `POST /api/data-sources/:id/refresh` route: load source by id, return 404 if missing, 400 if `sourceType != csv`
- [x] 4.2 Read stored file via `FileSystem.read(config.path)`, re-run `fromCsv`, update linked DataType fields via `DataTypeRepository.update`; return 200 with `DataSourceResponse`

## 5. Preview route — GET /api/data-sources/:id/preview

- [x] 5.1 Add `GET /api/data-sources/:id/preview` route: load source by id, return 404 if missing
- [x] 5.2 Read file via `FileSystem.read`, parse up to 10 data rows, return `CsvPreviewResponse(headers, rows)`

## 6. Delete with file cleanup — DELETE /api/data-sources/:id

- [x] 6.1 Add `DELETE /api/data-sources/:id` route: load source, if `sourceType == csv` call `FileSystem.delete(config.path)` (log failure, do not propagate); delete record via `DataSourceRepository.delete`; return 204

## 7. Wire-up

- [x] 7.1 Inject `FileSystem` and `DataTypeRepository` into `ApiRoutes` constructor; update `HttpServer` and `Main` wiring accordingly

## 8. Tests

- [x] 8.1 `SchemaInferenceEngineSpec`: add RFC 4180 tests — quoted field with comma, escaped double-quote, CRLF line endings
- [x] 8.2 `DataSourceRoutesSpec` (new): POST upload happy path (valid CSV → 201 + DataType registered); oversized → 413; non-UTF-8 → 400; blank name → 400
- [x] 8.3 `DataSourceRoutesSpec`: POST refresh happy path → 200; refresh non-existent → 404; refresh non-csv → 400
- [x] 8.4 `DataSourceRoutesSpec`: GET preview happy path → 200 with headers/rows; preview non-existent → 404
- [x] 8.5 `DataSourceRoutesSpec`: DELETE csv source → 204, file deleted; DELETE non-existent → 404

## 9. Verification

- [x] 9.1 Run `sbt test` in `backend/` — all tests pass
