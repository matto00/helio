# HEL-59: Static/manual data entry connector

## Context

`SourceType.Static` already exists in the backend enum but has no handler or UI. Users should be able to manually enter tabular data — like a mini spreadsheet — as a data source, without needing to upload a file or call an external API. This is useful for reference tables, lookup data, and demo content.

## What changes

### Backend

* Handle `source_type: static` in `DataSourceRoutes`. Accept a JSON payload of rows (`{ columns: [{ name, type }], rows: [[...]] }`) on `POST /api/data-sources`.
* Store the rows payload in the `data_sources.config` JSONB column.
* Run schema inference on the provided rows and register a DataType.
* `POST /api/data-sources/:id/refresh` replaces the stored rows with a new payload and re-infers the schema.
* Cap accepted payload at 500 rows; return 400 for oversized payloads.

### Frontend

* In `AddSourceModal`, add a **Manual / Static** tab.
* Step 1: Define columns — name and type (string / integer / float / boolean).
* Step 2: Add rows inline; each cell is an editable input matching the column type.
* On save: POST to `/api/data-sources` with `source_type: static` and the rows payload.

## Out of scope

* Spreadsheet-style paste from clipboard
* Formula or expression support (see computed fields ticket)
* Datasets larger than 500 rows

## Acceptance criteria

- [ ] User can define column names and types, enter rows in the modal, and save as a static data source
- [ ] Schema is inferred from the entered data and a DataType is registered
- [ ] `GET /api/data-sources/:id/preview` returns the entered rows
- [ ] Refresh (re-submit rows) replaces the existing data and updates the DataType
- [ ] Static sources appear in `DataSourceList` with a "Static" source type badge
- [ ] Payloads exceeding 500 rows are rejected with a 400 error
