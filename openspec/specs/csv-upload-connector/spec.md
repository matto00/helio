## Purpose
Defines the CSV upload data-source connector: multipart file upload, schema inference, source refresh, row preview, and file-lifecycle cleanup on delete, all enforced with size and encoding limits.

## Requirements

### Requirement: POST /api/data-sources accepts a CSV file upload
The endpoint SHALL accept `multipart/form-data` with a `file` part (the CSV) and a `name` part (the source name). It SHALL parse the file, infer a schema, store the file via the `FileSystem` abstraction, create a `DataSource` record with `discriminator `type = "csv"`` and `config = {"path": "<relative-path>"}`, update the source's `inferred_schema`, and return 201 with the created `DataSource`.

A CSV source MAY additionally be created from an HTTPS `sourceUrl` instead of an uploaded file or inline content, in
which case the stored config carries `sourceUrl` alongside `path` (see the `csv-url-ingestion` capability). A source
created by upload or inline content SHALL continue to store `config` with no `sourceUrl`, and SHALL behave exactly as
before; absence of `sourceUrl` in an existing stored config SHALL decode successfully with no migration.

#### Scenario: Valid CSV upload creates DataSource and DataType
- **WHEN** `POST /api/data-sources` is called with a valid CSV file and a name
- **THEN** the response is 201 with the created DataSource including `id`, `name`, `type: "csv"`, and `config.path`
- **AND** an inferred schema record linked to the new source is registered and retrievable via `GET /api/types (removed by this ticket)`

#### Scenario: Upload with no file part returns 400
- **WHEN** `POST /api/data-sources` is called without a `file` part
- **THEN** the response is 400 Bad Request

#### Scenario: Upload with blank name returns 400
- **WHEN** `POST /api/data-sources` is called with an empty or whitespace-only `name` field
- **THEN** the response is 400 Bad Request

#### Scenario: A pre-existing CSV config without sourceUrl still decodes
- **WHEN** a CSV source row stored before this change (config containing only `path`) is read
- **THEN** it decodes successfully with `sourceUrl` absent, and refresh and pipeline runs behave exactly as before

### Requirement: File size is enforced
The upload endpoint SHALL reject files exceeding the configured maximum size. The limit is read from the `CSV_MAX_FILE_SIZE_BYTES` environment variable, defaulting to 52428800 (50 MB).

#### Scenario: Oversized file is rejected
- **WHEN** `POST /api/data-sources` is called with a file whose size exceeds `CSV_MAX_FILE_SIZE_BYTES`
- **THEN** the response is 413 Request Entity Too Large with a descriptive error message

#### Scenario: File within the limit is accepted
- **WHEN** `POST /api/data-sources` is called with a file smaller than `CSV_MAX_FILE_SIZE_BYTES`
- **THEN** the upload proceeds normally

### Requirement: UTF-8 encoding is enforced
The upload endpoint SHALL reject CSV files that are not valid UTF-8.

#### Scenario: Non-UTF-8 file is rejected
- **WHEN** `POST /api/data-sources` is called with a file containing non-UTF-8 bytes
- **THEN** the response is 400 Bad Request with a message indicating the encoding requirement

### Requirement: POST /api/data-sources/:id/refresh re-parses the stored file
The endpoint SHALL read the stored CSV file for the given source via `FileSystem`, re-run schema inference, and update the source's inferred schema's fields. It SHALL return 200 with the updated `DataSource`.

#### Scenario: Refresh updates DataType fields
- **WHEN** `POST /api/data-sources/:id/refresh` is called for a valid csv source
- **THEN** the response is 200 with the DataSource
- **AND** the linked inferred schema reflects the re-inferred schema

#### Scenario: Refresh on non-existent source returns 404
- **WHEN** `POST /api/data-sources/:id/refresh` is called with an unknown id
- **THEN** the response is 404 Not Found

#### Scenario: Refresh on non-csv source returns 400
- **WHEN** `POST /api/data-sources/:id/refresh` is called for a source whose `type` is not `csv`
- **THEN** the response is 400 Bad Request

### Requirement: GET /api/data-sources/:id/preview returns first 10 rows
The endpoint SHALL read the stored CSV file, parse up to 10 data rows, and return them as JSON with `headers` and `rows` fields. It SHALL have no side effects.

#### Scenario: Preview returns headers and rows
- **WHEN** `GET /api/data-sources/:id/preview` is called for a valid csv source
- **THEN** the response is 200 with `{"headers": [...], "rows": [[...], ...]}`
- **AND** at most 10 data rows are returned

#### Scenario: Preview on source with fewer than 10 rows returns all rows
- **WHEN** the stored CSV has fewer than 10 data rows
- **THEN** all data rows are included in the preview response

#### Scenario: Preview on non-existent source returns 404
- **WHEN** `GET /api/data-sources/:id/preview` is called with an unknown id
- **THEN** the response is 404 Not Found

### Requirement: DELETE /api/data-sources/:id removes the stored file for csv sources
When deleting a data source with `discriminator `type = "csv"``, the backend SHALL call `FileSystem.delete` with the path from `config.path` in addition to removing the database record.

#### Scenario: Deleting a csv source removes the stored file
- **WHEN** `DELETE /api/data-sources/:id` is called for a source with `discriminator `type = "csv"``
- **THEN** the data source record is removed
- **AND** the stored file is deleted from the FileSystem

#### Scenario: File deletion failure does not fail the HTTP response
- **WHEN** `FileSystem.delete` fails for a csv source being deleted
- **THEN** the response is still 204 No Content and the database record is removed

### Requirement: CSV uploads are bounded by byte, row and cell limits
The CSV upload routes (`POST /api/data-sources/infer`, `POST /api/data-sources` multipart) SHALL accept request bodies up to the CSV byte limit plus multipart overhead, and SHALL reject a CSV exceeding the byte limit, the row limit, or the cell limit with 413 and an `ErrorResponse` whose message names the limits. No such request SHALL produce a 500. The default limits are 15 MiB, 50,000 rows and 300,000 cells (rows x columns); this deliberately narrows the ticket's "up to 50 MiB succeeds" acceptance criterion to "up to 15 MiB AND within 50,000 rows / 300,000 cells", because the run path holds the whole file in memory and larger files exhaust a 1 GiB instance (see design.md measurements). The limits SHALL also be enforced on URL import, refresh, and when a stored CSV is previewed, run or used by the first-run builder, failing with the same clear error instead of exhausting memory.

#### Scenario: Upload between 8 MiB and the byte limit succeeds
- **WHEN** a CSV of 12 MiB within the row and cell limits is uploaded to infer and then create
- **THEN** both return success

#### Scenario: Upload over the byte limit returns 413
- **WHEN** a CSV larger than the byte limit plus margin is uploaded
- **THEN** the response is 413 with an `ErrorResponse` naming the byte limit

#### Scenario: Upload over the row or cell limit returns 413
- **WHEN** a CSV within the byte limit but over the row or cell limit is uploaded, imported by URL, or refreshed
- **THEN** the response is 413 naming the row and cell limits

#### Scenario: Stored oversize CSV fails clearly at run time
- **WHEN** a pipeline run, preview or first-run build reads a stored CSV over the limits
- **THEN** it fails with the limits error and does not exhaust memory

### Requirement: The CSV limits are exposed by the backend
`GET /api/data-sources/csv-limits` SHALL return `{maxBytes, maxRows, maxCells}` for an authenticated caller and clients SHALL derive their pre-checks from it.

#### Scenario: Limits endpoint
- **WHEN** an authenticated user calls `GET /api/data-sources/csv-limits`
- **THEN** the response is 200 with the three limits

### Requirement: Concurrent CSV uploads are capped
The backend SHALL bound concurrent CSV upload requests per instance and respond 429 with `Retry-After` when the cap is reached.

#### Scenario: Cap reached
- **WHEN** more CSV uploads are in flight than the cap
- **THEN** the extra request receives 429 with a `Retry-After` header

### Requirement: Schema inference and preview read only a head prefix
Schema inference and row preview SHALL NOT materialize every line of the file.

#### Scenario: Large file inference
- **WHEN** inference runs on a file within the limits
- **THEN** only the sampled head lines are split
