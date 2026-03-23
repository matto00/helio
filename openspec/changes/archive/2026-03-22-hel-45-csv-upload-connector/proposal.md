## Why

The TypeRegistry can register DataTypes and panels can bind to them, but there is no way to ingest real data yet. The CSV upload connector is the first concrete data source — it lets users attach a file to create a typed, named DataType with an inferred schema, closing the loop from raw data to panel binding.

## What Changes

- `POST /api/data-sources` — accepts `multipart/form-data` with a CSV file and a name field; parses, infers schema, stores the file via `FileSystem`, registers a `DataSource` + linked `DataType`, returns the created DataSource
- `POST /api/data-sources/:id/refresh` — re-uploads or re-parses the stored CSV file for a source, updates the linked DataType's fields
- `GET /api/data-sources/:id/preview` — returns first 10 rows of the stored CSV as JSON without side effects
- `DELETE /api/data-sources/:id` — already partially wired; extended to delete the stored file from `FileSystem` when `sourceType` is `csv`
- Fix `SchemaInferenceEngine.fromCsv` to use a proper RFC 4180 parser (quoted fields, escaped commas, CRLF) instead of the current naive `split(",")`
- Max file size enforcement: configurable via `CSV_MAX_FILE_SIZE_BYTES` env var (default 50 MB); reject oversized uploads with 413
- UTF-8 enforcement: reject non-UTF-8 files with a clear 400 error

## Capabilities

### New Capabilities
- `csv-upload-connector`: POST/refresh/preview routes for CSV data sources, file storage via FileSystem, size and encoding validation

### Modified Capabilities
- `data-source-persistence`: existing spec covers `GET /api/data-sources` only; now extends to include POST, refresh, preview, and delete-with-cleanup requirements
- `schema-inference`: RFC 4180 CSV parsing requirement (quoted fields, CRLF) is a behavioral change to `SchemaInferenceEngine.fromCsv`

## Impact

- **Backend routes**: `ApiRoutes.scala` — new multipart route, refresh route, preview route; delete extended
- **Domain**: no new models; `DataSource.config` stores `{"path": "..."}` for csv sources
- **Infrastructure**: `DataTypeRepository.insert` used to register the inferred DataType; `DataSourceRepository.insert/delete` already exist
- **Schema inference**: `SchemaInferenceEngine.fromCsv` — replace naive row parser with RFC 4180 implementation
- **No frontend changes**: data sources page (HEL-47) is a separate ticket
- **No new library dependencies**: Akka HTTP multipart is built-in
