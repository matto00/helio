## ADDED Requirements

### Requirement: POST /api/data-sources accepts a .pdf file upload
The endpoint SHALL accept `multipart/form-data` with a `type` part equal to `"pdf"`, a `file` part (the
`.pdf` file), and a `name` part. It SHALL validate the file's extension, validate that the bytes are a
well-formed, non-encrypted PDF, store the raw bytes via the `FileSystem` abstraction, create a
`DataSource` record with discriminator `type = "pdf"` and `config = {"path": "<relative-path>"}`, register
a linked `DataType` with fields `content` (`string-body`), `filename` (`string`), `sizeBytes` (`integer`),
`pageNumber` (`integer`), `pageCount` (`integer`), and `characterCount` (`integer`), and return 201 with
the created `DataSource`.

#### Scenario: Valid PDF upload creates DataSource and DataType
- **WHEN** `POST /api/data-sources` is called with `type=pdf`, a valid multi-page `.pdf` file, and a name
- **THEN** the response is 201 with the created DataSource including `id`, `name`, `type: "pdf"`, and
  `config.path`
- **AND** a `DataType` linked to the new source is registered with fields `content` (`string-body`),
  `filename` (`string`), `sizeBytes` (`integer`), `pageNumber` (`integer`), `pageCount` (`integer`), and
  `characterCount` (`integer`)

#### Scenario: Upload with unsupported extension is rejected
- **WHEN** `POST /api/data-sources` is called with `type=pdf` and a file whose extension is not `.pdf`
- **THEN** the response is 400 Bad Request with a message indicating the supported extension

#### Scenario: Upload with no file part returns 400
- **WHEN** `POST /api/data-sources` is called with `type=pdf` and no `file` part
- **THEN** the response is 400 Bad Request

#### Scenario: Upload with blank name returns 400
- **WHEN** `POST /api/data-sources` is called with `type=pdf` and an empty or whitespace-only `name`
- **THEN** the response is 400 Bad Request

#### Scenario: Existing CSV/text uploads are unaffected
- **WHEN** `POST /api/data-sources` is called with multipart form data containing no `type` part, or
  `type=csv`, or `type=text`
- **THEN** the request is handled by the existing CSV/text creation paths, unchanged

### Requirement: POST /api/data-sources accepts URL-based PDF ingestion
The endpoint SHALL accept a JSON body `{"name": string, "type": "pdf", "config": {"url": string}}`. It
SHALL fetch the URL's content via `ContentSourceSupport.fetchUrl`, validate the resolved filename's
extension and that the fetched bytes are a well-formed, non-encrypted PDF, store the fetched bytes via
`FileSystem`, create a `DataSource` with `config = {"path": "<relative-path>", "sourceUrl": "<url>"}`,
register the linked `DataType`, and return 201.

#### Scenario: Valid URL ingestion creates DataSource and DataType
- **WHEN** `POST /api/data-sources` is called with `type: "pdf"` and `config.url` pointing to a reachable
  `.pdf` resource
- **THEN** the response is 201 with the created DataSource, `type: "pdf"`, and `config.sourceUrl` set to
  the given URL
- **AND** a `DataType` linked to the source is registered with the full PDF field set

#### Scenario: Unreachable URL returns 502
- **WHEN** `POST /api/data-sources` is called with `type: "pdf"` and `config.url` that cannot be fetched
- **THEN** the response is 502 Bad Gateway with a descriptive error; no DataSource is created

#### Scenario: URL resolving to an unsupported extension is rejected
- **WHEN** `POST /api/data-sources` is called with `type: "pdf"` and a URL whose resolved filename does
  not end in `.pdf`
- **THEN** the response is 400 Bad Request

#### Scenario: URL ingestion reuses the guarded fetch helper
- **WHEN** URL-based PDF ingestion is performed
- **THEN** the fetch goes through `ContentSourceSupport.fetchUrl` (the same SSRF-guarded, DNS-rebinding-
  pinned helper HEL-215 introduced), not a separate HTTP client implementation

### Requirement: Malformed, corrupt, or encrypted PDFs are rejected at ingest
The backend SHALL validate that uploaded or fetched bytes are a well-formed, non-encrypted PDF before
creating the `DataSource`, without performing full text extraction at ingest time.

#### Scenario: Corrupt PDF upload is rejected
- **WHEN** `POST /api/data-sources` is called with `type=pdf` and a file that is not a valid PDF
- **THEN** the response is 400 Bad Request with a message indicating the file is not a valid PDF; no
  DataSource is created

#### Scenario: Password-protected PDF upload is rejected
- **WHEN** `POST /api/data-sources` is called with `type=pdf` and an encrypted/password-protected PDF
- **THEN** the response is 400 Bad Request with a message indicating encrypted PDFs are not supported; no
  DataSource is created

### Requirement: File size is enforced for PDF sources
The backend SHALL reject PDF uploads and URL fetches exceeding the configured maximum size, read from
`PDF_MAX_FILE_SIZE_BYTES`, defaulting to 20971520 (20 MB).

#### Scenario: Oversized upload is rejected
- **WHEN** `POST /api/data-sources` is called with `type=pdf` and a file exceeding
  `PDF_MAX_FILE_SIZE_BYTES`
- **THEN** the response is 413 Request Entity Too Large

#### Scenario: Oversized URL fetch is rejected
- **WHEN** `POST /api/data-sources` is called with `type: "pdf"` and `config.url` resolves to content
  exceeding `PDF_MAX_FILE_SIZE_BYTES`
- **THEN** the response is 413 Request Entity Too Large; no DataSource is created

### Requirement: PDF sources are pipeline-bindable via the in-process engine, one row per page
`InProcessPipelineEngine.loadRows` SHALL support `PdfSource`, producing exactly one row per PDF page, each
with keys `content` (that page's extracted text), `filename`, `sizeBytes`, `pageNumber` (1-indexed),
`pageCount` (total pages in the document), and `characterCount` (length of that page's extracted text).

#### Scenario: Pipeline run over a PDF source yields one row per page
- **WHEN** a pipeline whose source is a `PdfSource` pointing to a 3-page PDF is run
- **THEN** the resulting rows contain exactly 3 rows, with `pageNumber` values `1`, `2`, `3` and
  `pageCount` equal to `3` on every row

#### Scenario: Each row's characterCount matches its extracted content length
- **WHEN** a pipeline run over a `PdfSource` produces its rows
- **THEN** each row's `characterCount` value equals the length of that same row's `content` string

#### Scenario: Pipeline step preview over a PDF source succeeds
- **WHEN** a pipeline step preview endpoint is called for a pipeline bound to a `PdfSource`
- **THEN** the response includes the source's per-page rows, not a 422 "unsupported source type" error

### Requirement: POST /api/data-sources/:id/refresh re-reads or re-fetches PDF sources
For an upload-created PDF source (`config.sourceUrl` absent), refresh SHALL re-read the stored file via
`FileSystem`. For a URL-created PDF source (`config.sourceUrl` present), refresh SHALL re-fetch the URL
and overwrite the stored file.

#### Scenario: Refresh on a URL-created PDF source re-fetches the URL
- **WHEN** `POST /api/data-sources/:id/refresh` is called for a PDF source created via URL ingestion
- **THEN** the backend re-fetches `config.sourceUrl` and overwrites the stored file bytes

### Requirement: DELETE /api/data-sources/:id removes the stored file for PDF sources
When deleting a data source with discriminator `type = "pdf"`, the backend SHALL call `FileSystem.delete`
with the path from `config.path` in addition to removing the database record.

#### Scenario: Deleting a PDF source removes the stored file
- **WHEN** `DELETE /api/data-sources/:id` is called for a source with `type = "pdf"`
- **THEN** the data source record is removed and the stored file is deleted from the FileSystem

### Requirement: PDF metadata fields build on the shared content-connector helper
The PDF connector's `DataType` field list SHALL be built by calling
`ContentSourceSupport.metadataFields(StringBodyType, filename, sizeBytes)` for the `{content, filename,
sizeBytes}` triple and appending `pageNumber`, `pageCount`, and `characterCount` fields at the connector
layer, without modifying `ContentSourceSupport.metadataFields`'s signature.

#### Scenario: PDF connector's content field uses StringBodyType
- **WHEN** a PDF source's `DataType` is registered
- **THEN** its `content` field's type is `string-body`, `filename` is `string`, `sizeBytes` is `integer`,
  and `pageNumber`/`pageCount`/`characterCount` are each `integer`
