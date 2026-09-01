## MODIFIED Requirements

_Companion DataTypes are retired (HEL-903 decision 4/11); a source's schema now lives directly on `data_sources.inferred_schema`, written by `upsertInferredSchema` in place of the old `upsertSourceDataType`/second-upsert path. Scenario titles are preserved verbatim from the live spec even where they still say "DataType" (they describe the same test case) — only the body text below each is updated to the new mechanism._

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
