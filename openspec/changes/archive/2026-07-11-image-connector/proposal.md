## Why

HEL-146 (v1.4 Unstructured Data) needs an image connector. HEL-215 (text/Markdown) already
established the connector→content-type wiring (ADT shape, route dispatch, pipeline row-loading,
metadata-field construction, guarded URL fetch) as a reusable seam explicitly left open for this
ticket. Images are the first connector to produce `BinaryRefType` (HEL-217) row values and the
first to exercise the `binary_refs` table end-to-end.

## What Changes

- New `ImageSource` DataSource kind (`"image"`) supporting image files via **file upload**
  (multipart, mirrors `TextSource`'s upload route) and **URL-based ingestion** (via the existing
  guarded `ContentSourceSupport.fetchUrl`/`validateUrl`, no new HTTP client).
- Ingested content is stored as a `content` field using `BinaryRefType` (HEL-217):
  `{storageKey, mimeType, filename, sizeBytes}`, where `storageKey` is the same
  uploads-`FileSystem`-relative key convention `CsvSource`/`TextSource` already use
  (`image/<sourceId>.<ext>`). `filename`, `sizeBytes`, `mimeType`, `width`, and `height` are
  additionally registered as their own metadata fields on the same `DataType` (single-row
  schema), satisfying the ticket's "filename, dimensions (width x height), and MIME type" ask.
  `width`/`height` are read via `javax.imageio.ImageIO` (JDK-standard, no new dependency).
- Wires `ImageSource` into `InProcessPipelineEngine.loadRows` (in-process only, like
  `TextSource` — not Spark) so pipelines can bind to it end-to-end
  (source -> pipeline -> type -> panel).
- First real caller of `BinaryRefRepository.overwriteForDataType` (HEL-217, previously unwired):
  `PipelineRunService.onRunSuccess` extracts any `BinaryRef`-shaped row values from the output
  rows it just wrote via `overwriteRows` and writes the matching secondary-index rows in the same
  operation, generically over any source kind (not image-specific) — the write contract HEL-217's
  design mandates.
- Flyway migration extending `data_sources_source_type_check` to include `'image'`.
- Frontend: a new source-type option in `AddSourceModal`/`SourceTypeToggle` supporting both file
  upload and URL entry, mirroring `TextSourceForm`.

## Capabilities

### New Capabilities

- `image-file-connector`: Data Source connector for image files — file upload and URL-based
  ingestion, content as `BinaryRefType`, `filename`/`sizeBytes`/`mimeType`/`width`/`height`
  metadata, in-process pipeline row-loading, and the first wiring of
  `BinaryRefRepository.overwriteForDataType` into the pipeline-run write path.

### Modified Capabilities

(none — `type-registry-content-fields` already defines `BinaryRefType` and `binary_refs`; this
change is the first consumer, not a change to that contract.)

## Impact

- Backend: `domain/DataSource.scala` (`ImageSource`/`ImageSourceConfig`), `DataSourceKind`,
  `DataSourceConfigCodec`, `DataSourceRepository` (3 closed matches), `DataSourceService`
  (create/refresh/delete/update), `DataSourceProtocol`/`DataSourceRoutes`,
  `InProcessPipelineEngine.loadRows`, `PipelineRunService` (new `BinaryRefRepository` dependency
  + `onRunSuccess` extraction), `ApiRoutes` (constructs + threads `BinaryRefRepository`), new
  Flyway migration, new `ImageSourceSupport` helper (dimensions + MIME-from-extension).
- Frontend: `features/sources/{types,services,ui}` — new source-type option, form, service
  calls.
- No changes to `ContentSourceSupport`'s existing public contract (`metadataFields`, `fetchUrl`,
  `validateUrl`) beyond adding an `ImageExtensions` set alongside the existing `TextExtensions`.

## Non-goals

- Image transformation/processing (resize, thumbnails, format conversion) beyond reading
  width/height/MIME/size metadata.
- A preview affordance for image sources (`DataSourceService.preview` stays csv/static-only, same
  limitation `TextSource` already has).
- Fixing the pre-existing, source-kind-agnostic gap where a pipeline's generic post-run schema
  sync (`upsertFieldsFromRows`) re-infers structured types from row values and does not preserve
  `string-body`/`binary-ref` typing on the *pipeline output* `DataType` (this predates HEL-215 and
  applies equally there; out of scope here — the connector's own auto-inferred `DataType` and the
  new `binary_refs` index are unaffected by it).
- The HEL-214 PDF connector (parallel, separate ticket).
