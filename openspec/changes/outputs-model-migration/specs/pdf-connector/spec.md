## MODIFIED Requirements

_Companion DataTypes are retired (HEL-903 decision 4/11); a source's schema now lives directly on `data_sources.inferred_schema`, written by `upsertInferredSchema` in place of the old `upsertSourceDataType`/second-upsert path. Scenario titles are preserved verbatim from the live spec even where they still say "DataType" (they describe the same test case) — only the body text below each is updated to the new mechanism._

### Requirement: POST /api/data-sources accepts a .pdf file upload
The endpoint SHALL accept `multipart/form-data` with a `type` part equal to `"pdf"`, a `file` part (the
`.pdf` file), and a `name` part. It SHALL validate the file's extension, validate that the bytes are a
well-formed, non-encrypted PDF, store the raw bytes via the `FileSystem` abstraction, create a
`DataSource` record with discriminator `type = "pdf"` and `config = {"path": "<relative-path>"}`, register
the source's inferred schema with fields `content` (`string-body`), `filename` (`string`), `sizeBytes` (`integer`),
`pageNumber` (`integer`), `pageCount` (`integer`), and `characterCount` (`integer`), and return 201 with
the created `DataSource`.

#### Scenario: Valid PDF upload creates DataSource and DataType
- **WHEN** `POST /api/data-sources` is called with `type=pdf`, a valid multi-page `.pdf` file, and a name
- **THEN** the response is 201 with the created DataSource including `id`, `name`, `type: "pdf"`, and
  `config.path`
- **AND** an inferred schema record linked to the new source is registered with fields `content` (`string-body`),
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
register the source's inferred schema, and return 201.

#### Scenario: Valid URL ingestion creates DataSource and DataType
- **WHEN** `POST /api/data-sources` is called with `type: "pdf"` and `config.url` pointing to a reachable
  `.pdf` resource
- **THEN** the response is 201 with the created DataSource, `type: "pdf"`, and `config.sourceUrl` set to
  the given URL
- **AND** an inferred schema record linked to the source is registered with the full PDF field set

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

### Requirement: PDF metadata fields build on the shared content-connector helper
The PDF connector's inferred schema field list SHALL be built by calling
`ContentSourceSupport.metadataFields(StringBodyType, filename, sizeBytes)` for the `{content, filename,
sizeBytes}` triple and appending `pageNumber`, `pageCount`, and `characterCount` fields at the connector
layer, without modifying `ContentSourceSupport.metadataFields`'s signature.

#### Scenario: PDF connector's content field uses StringBodyType
- **WHEN** a PDF source's inferred schema is registered
- **THEN** its `content` field's type is `string-body`, `filename` is `string`, `sizeBytes` is `integer`,
  and `pageNumber`/`pageCount`/`characterCount` are each `integer`
