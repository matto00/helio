## ADDED Requirements

### Requirement: POST /api/data-sources accepts an image file upload
The endpoint SHALL accept `multipart/form-data` with a `type` part equal to `"image"`, a `file` part
(the image file), and a `name` part. It SHALL validate the file's extension, store the raw bytes via
the `FileSystem` abstraction, create a `DataSource` record with discriminator `type = "image"` and
`config = {"path": "<relative-path>"}`, register a linked `DataType` with fields `content`
(`binary-ref`), `filename` (`string`), `sizeBytes` (`integer`), `mimeType` (`string`), `width`
(`integer`), and `height` (`integer`), and return 201 with the created `DataSource`.

#### Scenario: Valid PNG upload creates DataSource and DataType
- **WHEN** `POST /api/data-sources` is called with `type=image`, a valid `.png` file, and a name
- **THEN** the response is 201 with the created DataSource including `id`, `name`, `type: "image"`,
  and `config.path`
- **AND** a `DataType` linked to the new source is registered with fields `content` (`binary-ref`),
  `filename` (`string`), `sizeBytes` (`integer`), `mimeType` (`string`), `width` (`integer`), and
  `height` (`integer`)

#### Scenario: Valid JPEG upload creates DataSource and DataType
- **WHEN** `POST /api/data-sources` is called with `type=image` and a valid `.jpg`/`.jpeg` file
- **THEN** the response is 201 with the created DataSource, `type: "image"`

#### Scenario: Upload with unsupported extension is rejected
- **WHEN** `POST /api/data-sources` is called with `type=image` and a file whose extension is not
  one of the supported image extensions
- **THEN** the response is 400 Bad Request with a message indicating the supported extensions

#### Scenario: Upload with unreadable image bytes is rejected
- **WHEN** `POST /api/data-sources` is called with `type=image` and a file with a supported
  extension whose bytes cannot be decoded as an image
- **THEN** the response is 400 Bad Request indicating the image could not be read

#### Scenario: Upload with no file part returns 400
- **WHEN** `POST /api/data-sources` is called with `type=image` and no `file` part
- **THEN** the response is 400 Bad Request

#### Scenario: Upload with blank name returns 400
- **WHEN** `POST /api/data-sources` is called with `type=image` and an empty or whitespace-only
  `name`
- **THEN** the response is 400 Bad Request

#### Scenario: Existing CSV and text uploads are unaffected
- **WHEN** `POST /api/data-sources` is called with multipart form data whose `type` part is absent,
  `csv`, or `text`
- **THEN** the request is handled by the existing CSV/text creation paths, unchanged

### Requirement: POST /api/data-sources accepts URL-based image ingestion
The endpoint SHALL accept a JSON body `{"name": string, "type": "image", "config": {"url": string}}`.
It SHALL fetch the URL's content via the guarded `ContentSourceSupport.fetchUrl`, validate the
resolved filename's extension, store the fetched bytes via `FileSystem` (same as an upload), create
a `DataSource` with `config = {"path": "<relative-path>", "sourceUrl": "<url>"}`, register the linked
`DataType`, and return 201.

#### Scenario: Valid URL ingestion creates DataSource and DataType
- **WHEN** `POST /api/data-sources` is called with `type: "image"` and `config.url` pointing to a
  reachable image resource
- **THEN** the response is 201 with the created DataSource, `type: "image"`, and `config.sourceUrl`
  set to the given URL
- **AND** a `DataType` linked to the source is registered with fields `content`, `filename`,
  `sizeBytes`, `mimeType`, `width`, `height`

#### Scenario: Unreachable URL returns 502
- **WHEN** `POST /api/data-sources` is called with `type: "image"` and `config.url` that cannot be
  fetched
- **THEN** the response is 502 Bad Gateway with a descriptive error; no DataSource is created

#### Scenario: URL resolving to an unsupported extension is rejected
- **WHEN** `POST /api/data-sources` is called with `type: "image"` and a URL whose resolved filename
  does not end in a supported image extension
- **THEN** the response is 400 Bad Request

#### Scenario: URL ingestion reuses the guarded fetch helper
- **WHEN** `POST /api/data-sources` is called with `type: "image"` and `config.url` resolving to a
  disallowed address (loopback/link-local/private/etc.)
- **THEN** the response is 400 Bad Request (or 502, per the existing guard's error mapping) and no
  request is ever issued to the disallowed address — identical behavior to `TextSource`'s URL
  ingestion, since both call the same `ContentSourceSupport.fetchUrl`/`validateUrl`

### Requirement: File size is enforced for image sources
The backend SHALL reject image uploads and URL fetches exceeding the configured maximum size, read
from `IMAGE_MAX_FILE_SIZE_BYTES`, defaulting to 20971520 (20 MB).

#### Scenario: Oversized upload is rejected
- **WHEN** `POST /api/data-sources` is called with `type=image` and a file exceeding
  `IMAGE_MAX_FILE_SIZE_BYTES`
- **THEN** the response is 413 Request Entity Too Large

#### Scenario: Oversized URL fetch is rejected
- **WHEN** `POST /api/data-sources` is called with `type: "image"` and `config.url` resolves to
  content exceeding `IMAGE_MAX_FILE_SIZE_BYTES`
- **THEN** the response is 413 Request Entity Too Large; no DataSource is created

### Requirement: Image sources are pipeline-bindable via the in-process engine
`InProcessPipelineEngine.loadRows` SHALL support `ImageSource`, producing exactly one row with keys
`content` (a `binary-ref` map: `storageKey`, `mimeType`, `filename`, `sizeBytes`), `filename`,
`sizeBytes`, `mimeType`, `width`, and `height`.

#### Scenario: Pipeline run over an image source yields one row
- **WHEN** a pipeline whose source is an `ImageSource` is run
- **THEN** the resulting rows contain exactly one row with `content`, `filename`, `sizeBytes`,
  `mimeType`, `width`, and `height` keys
- **AND** the `content` value carries `storageKey`, `mimeType`, `filename`, and `sizeBytes`

#### Scenario: Pipeline step preview over an image source succeeds
- **WHEN** `POST /api/pipelines/:id/steps/:stepId/preview` (or equivalent) is called for a pipeline
  bound to an `ImageSource`
- **THEN** the response includes the single source row, not a 422 "unsupported source type" error

### Requirement: A successful pipeline run indexes binary-ref row values into binary_refs
`PipelineRunService.onRunSuccess` SHALL, whenever it writes a pipeline's output rows via
`DataTypeRowRepository.overwriteRows`, also extract every `binary-ref`-shaped field value present
in those rows and write the corresponding `BinaryRef` records via
`BinaryRefRepository.overwriteForDataType` in the same operation, keyed by the output `DataType`'s
id, each row's index, and the field name.

#### Scenario: Running a pipeline bound to an image source populates binary_refs
- **WHEN** a pipeline bound to an `ImageSource` is run successfully
- **THEN** `binary_refs` contains one row for the output DataType's `content` field, matching the
  `storageKey`/`mimeType`/`filename`/`sizeBytes` written to `data_type_rows`

#### Scenario: Re-running the pipeline replaces the prior binary_refs snapshot
- **WHEN** a pipeline bound to an `ImageSource` is run a second time
- **THEN** the previous run's `binary_refs` rows for that DataType are replaced, not accumulated
  (mirrors `overwriteRows`' delete-then-insert semantics)

#### Scenario: Running a pipeline with no binary-ref fields writes no binary_refs rows
- **WHEN** a pipeline bound to a `CsvSource` or `StaticSource` (no `binary-ref` field values) is run
- **THEN** no rows are written to `binary_refs` for that DataType

### Requirement: POST /api/data-sources/:id/refresh re-reads or re-fetches image sources
For an upload-created image source (`config.sourceUrl` absent), refresh SHALL re-read the stored
file via `FileSystem`. For a URL-created image source (`config.sourceUrl` present), refresh SHALL
re-fetch the URL and overwrite the stored file. Both SHALL re-derive `width`/`height`/`mimeType` from
the (re-read or re-fetched) bytes.

#### Scenario: Refresh on non-existent source returns 404
- **WHEN** `POST /api/data-sources/:id/refresh` is called with an unknown id
- **THEN** the response is 404 Not Found

#### Scenario: Refresh on a URL-created image source re-fetches the URL
- **WHEN** `POST /api/data-sources/:id/refresh` is called for an image source created via URL
  ingestion
- **THEN** the backend re-fetches `config.sourceUrl` and overwrites the stored file bytes

### Requirement: DELETE /api/data-sources/:id removes the stored file for image sources
When deleting a data source with discriminator `type = "image"`, the backend SHALL call
`FileSystem.delete` with the path from `config.path` in addition to removing the database record.

#### Scenario: Deleting an image source removes the stored file
- **WHEN** `DELETE /api/data-sources/:id` is called for a source with `type = "image"`
- **THEN** the data source record is removed and the stored file is deleted from the FileSystem
