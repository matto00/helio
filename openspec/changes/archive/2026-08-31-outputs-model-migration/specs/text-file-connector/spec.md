## MODIFIED Requirements

_Companion DataTypes are retired (HEL-903 decision 4/11); a source's schema now lives directly on `data_sources.inferred_schema`, written by `upsertInferredSchema` in place of the old `upsertSourceDataType`/second-upsert path. Scenario titles are preserved verbatim from the live spec even where they still say "DataType" (they describe the same test case) — only the body text below each is updated to the new mechanism._

### Requirement: POST /api/data-sources accepts a .txt/.md file upload
The endpoint SHALL accept `multipart/form-data` with a `type` part equal to `"text"`, a `file` part
(the `.txt` or `.md` file), and a `name` part. It SHALL validate the file's extension, store the raw
bytes via the `FileSystem` abstraction, create a `DataSource` record with discriminator `type = "text"`
and `config = {"path": "<relative-path>"}`, update the source's `inferred_schema` with fields `content`
(`string-body`), `filename` (`string`), and `sizeBytes` (`integer`), and return 201 with the created
`DataSource`.

#### Scenario: Valid .txt upload creates DataSource and DataType
- **WHEN** `POST /api/data-sources` is called with `type=text`, a valid `.txt` file, and a name
- **THEN** the response is 201 with the created DataSource including `id`, `name`, `type: "text"`, and
  `config.path`
- **AND** an inferred schema record linked to the new source is registered with fields `content` (`string-body`),
  `filename` (`string`), and `sizeBytes` (`integer`)

#### Scenario: Valid .md upload creates DataSource and DataType
- **WHEN** `POST /api/data-sources` is called with `type=text` and a valid `.md` file
- **THEN** the response is 201 with the created DataSource, `type: "text"`

#### Scenario: Upload with unsupported extension is rejected
- **WHEN** `POST /api/data-sources` is called with `type=text` and a file whose extension is not
  `.txt` or `.md`
- **THEN** the response is 400 Bad Request with a message indicating the supported extensions

#### Scenario: Upload with no file part returns 400
- **WHEN** `POST /api/data-sources` is called with `type=text` and no `file` part
- **THEN** the response is 400 Bad Request

#### Scenario: Upload with blank name returns 400
- **WHEN** `POST /api/data-sources` is called with `type=text` and an empty or whitespace-only `name`
- **THEN** the response is 400 Bad Request

#### Scenario: Existing CSV uploads are unaffected
- **WHEN** `POST /api/data-sources` is called with multipart form data containing no `type` part (or
  `type=csv`) and a `file`/`name` part
- **THEN** the request is handled by the existing CSV creation path, unchanged

### Requirement: POST /api/data-sources accepts URL-based text ingestion
The endpoint SHALL accept a JSON body `{"name": string, "type": "text", "config": {"url": string}}`. It
SHALL fetch the URL's content, validate the resolved filename's extension, store the fetched bytes via
`FileSystem` (same as an upload), create a `DataSource` with `config = {"path": "<relative-path>",
"sourceUrl": "<url>"}`, register the source's inferred schema, and return 201.

#### Scenario: Valid URL ingestion creates DataSource and DataType
- **WHEN** `POST /api/data-sources` is called with `type: "text"` and `config.url` pointing to a
  reachable `.txt` resource
- **THEN** the response is 201 with the created DataSource, `type: "text"`, and `config.sourceUrl` set
  to the given URL
- **AND** an inferred schema record linked to the source is registered with fields `content`, `filename`,
  `sizeBytes`

#### Scenario: Unreachable URL returns 502
- **WHEN** `POST /api/data-sources` is called with `type: "text"` and `config.url` that cannot be
  fetched
- **THEN** the response is 502 Bad Gateway with a descriptive error; no DataSource is created

#### Scenario: URL resolving to an unsupported extension is rejected
- **WHEN** `POST /api/data-sources` is called with `type: "text"` and a URL whose resolved filename
  does not end in `.txt` or `.md`
- **THEN** the response is 400 Bad Request

### Requirement: POST /api/data-sources/:id/refresh re-reads or re-fetches text sources
For an upload-created text source (`config.sourceUrl` absent), refresh SHALL re-read the stored file
via `FileSystem`. For a URL-created text source (`config.sourceUrl` present), refresh SHALL re-fetch
the URL and overwrite the stored file. Both SHALL update the source's inferred schema's `sizeBytes`-bearing
row on the next pipeline run (no inferred schema field change, since fields are fixed by kind).

#### Scenario: Refresh on non-existent source returns 404
- **WHEN** `POST /api/data-sources/:id/refresh` is called with an unknown id
- **THEN** the response is 404 Not Found

#### Scenario: Refresh on a URL-created text source re-fetches the URL
- **WHEN** `POST /api/data-sources/:id/refresh` is called for a text source created via URL ingestion
- **THEN** the backend re-fetches `config.sourceUrl` and overwrites the stored file bytes

### Requirement: Content field metadata is built via a shared, reusable helper
`ContentSourceSupport.metadataFields(contentFieldType, filename, sizeBytes)` SHALL return the
`{content, filename, sizeBytes}` `DataField` triple used by all content connectors, parameterized only
by the content field's `DataFieldType`. This is the integration seam future content connectors
(HEL-214, HEL-216) reuse to keep metadata field shape consistent across connector kinds.

#### Scenario: Text connector builds fields with StringBodyType
- **WHEN** a text source's inferred schema is registered
- **THEN** its `content` field's type is `string-body`, and `filename`/`sizeBytes` are `string`/
  `integer` respectively
