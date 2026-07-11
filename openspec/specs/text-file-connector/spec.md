# text-file-connector Specification

## Purpose
Data Source connector for `.txt`/`.md` files (file upload and URL-based ingestion), storing content
as a `string-body` field with `filename`/`sizeBytes` metadata and a reusable connector seam for
future content connectors.
## Requirements
### Requirement: POST /api/data-sources accepts a .txt/.md file upload
The endpoint SHALL accept `multipart/form-data` with a `type` part equal to `"text"`, a `file` part
(the `.txt` or `.md` file), and a `name` part. It SHALL validate the file's extension, store the raw
bytes via the `FileSystem` abstraction, create a `DataSource` record with discriminator `type = "text"`
and `config = {"path": "<relative-path>"}`, register a linked `DataType` with fields `content`
(`string-body`), `filename` (`string`), and `sizeBytes` (`integer`), and return 201 with the created
`DataSource`.

#### Scenario: Valid .txt upload creates DataSource and DataType
- **WHEN** `POST /api/data-sources` is called with `type=text`, a valid `.txt` file, and a name
- **THEN** the response is 201 with the created DataSource including `id`, `name`, `type: "text"`, and
  `config.path`
- **AND** a `DataType` linked to the new source is registered with fields `content` (`string-body`),
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
"sourceUrl": "<url>"}`, register the linked `DataType`, and return 201.

#### Scenario: Valid URL ingestion creates DataSource and DataType
- **WHEN** `POST /api/data-sources` is called with `type: "text"` and `config.url` pointing to a
  reachable `.txt` resource
- **THEN** the response is 201 with the created DataSource, `type: "text"`, and `config.sourceUrl` set
  to the given URL
- **AND** a `DataType` linked to the source is registered with fields `content`, `filename`,
  `sizeBytes`

#### Scenario: Unreachable URL returns 502
- **WHEN** `POST /api/data-sources` is called with `type: "text"` and `config.url` that cannot be
  fetched
- **THEN** the response is 502 Bad Gateway with a descriptive error; no DataSource is created

#### Scenario: URL resolving to an unsupported extension is rejected
- **WHEN** `POST /api/data-sources` is called with `type: "text"` and a URL whose resolved filename
  does not end in `.txt` or `.md`
- **THEN** the response is 400 Bad Request

### Requirement: File size is enforced for text sources
The backend SHALL reject text uploads and URL fetches exceeding the configured maximum size, read
from `TEXT_MAX_FILE_SIZE_BYTES`, defaulting to 10485760 (10 MB).

#### Scenario: Oversized upload is rejected
- **WHEN** `POST /api/data-sources` is called with `type=text` and a file exceeding
  `TEXT_MAX_FILE_SIZE_BYTES`
- **THEN** the response is 413 Request Entity Too Large

#### Scenario: Oversized URL fetch is rejected
- **WHEN** `POST /api/data-sources` is called with `type: "text"` and `config.url` resolves to content
  exceeding `TEXT_MAX_FILE_SIZE_BYTES`
- **THEN** the response is 413 Request Entity Too Large; no DataSource is created

### Requirement: UTF-8 encoding is enforced
The backend SHALL reject text sources (upload or URL) whose fetched bytes are not valid UTF-8.

#### Scenario: Non-UTF-8 upload is rejected
- **WHEN** `POST /api/data-sources` is called with `type=text` and a file containing non-UTF-8 bytes
- **THEN** the response is 400 Bad Request with a message indicating the encoding requirement

### Requirement: Text sources are pipeline-bindable via the in-process engine
`InProcessPipelineEngine.loadRows` SHALL support `TextSource`, producing exactly one row with keys
`content` (the full decoded file text), `filename`, and `sizeBytes` (byte length of the stored file).

#### Scenario: Pipeline run over a text source yields one row
- **WHEN** a pipeline whose source is a `TextSource` is run
- **THEN** the resulting rows contain exactly one row with `content`, `filename`, and `sizeBytes` keys

#### Scenario: Pipeline step preview over a text source succeeds
- **WHEN** `POST /api/pipelines/:id/steps/:stepId/preview` (or equivalent) is called for a pipeline
  bound to a `TextSource`
- **THEN** the response includes the single source row, not a 422 "unsupported source type" error

### Requirement: POST /api/data-sources/:id/refresh re-reads or re-fetches text sources
For an upload-created text source (`config.sourceUrl` absent), refresh SHALL re-read the stored file
via `FileSystem`. For a URL-created text source (`config.sourceUrl` present), refresh SHALL re-fetch
the URL and overwrite the stored file. Both SHALL update the linked `DataType`'s `sizeBytes`-bearing
row on the next pipeline run (no DataType field change, since fields are fixed by kind).

#### Scenario: Refresh on non-existent source returns 404
- **WHEN** `POST /api/data-sources/:id/refresh` is called with an unknown id
- **THEN** the response is 404 Not Found

#### Scenario: Refresh on a URL-created text source re-fetches the URL
- **WHEN** `POST /api/data-sources/:id/refresh` is called for a text source created via URL ingestion
- **THEN** the backend re-fetches `config.sourceUrl` and overwrites the stored file bytes

### Requirement: DELETE /api/data-sources/:id removes the stored file for text sources
When deleting a data source with discriminator `type = "text"`, the backend SHALL call
`FileSystem.delete` with the path from `config.path` in addition to removing the database record.

#### Scenario: Deleting a text source removes the stored file
- **WHEN** `DELETE /api/data-sources/:id` is called for a source with `type = "text"`
- **THEN** the data source record is removed and the stored file is deleted from the FileSystem

### Requirement: Content field metadata is built via a shared, reusable helper
`ContentSourceSupport.metadataFields(contentFieldType, filename, sizeBytes)` SHALL return the
`{content, filename, sizeBytes}` `DataField` triple used by all content connectors, parameterized only
by the content field's `DataFieldType`. This is the integration seam future content connectors
(HEL-214, HEL-216) reuse to keep metadata field shape consistent across connector kinds.

#### Scenario: Text connector builds fields with StringBodyType
- **WHEN** a text source's `DataType` is registered
- **THEN** its `content` field's type is `string-body`, and `filename`/`sizeBytes` are `string`/
  `integer` respectively

