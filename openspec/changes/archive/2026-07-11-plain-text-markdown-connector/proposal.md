## Why

HEL-146 (v1.4 Unstructured Data) needs its first content connector. `.txt`/`.md` files are the
simplest content shape — a single text blob plus filename/size metadata — so this connector ships
first to establish the connector→content-type wiring (ADT, route dispatch, pipeline row-loading,
metadata-field construction) that HEL-214 (PDF) and HEL-216 (image) will extend rather than
reinvent.

## What Changes

- New `TextSource` DataSource kind (`"text"`) supporting `.txt`/`.md` files via **file upload**
  (multipart, mirrors the CSV upload route) and **URL-based ingestion** (fetch-and-store, mirrors
  the REST connector's fetch path but persists the fetched bytes like CSV so refresh/preview stay
  uniform).
- Ingested content is stored as one `content` field using `StringBodyType` (HEL-217). `filename`
  (`StringType`) and `sizeBytes` (`IntegerType`) are registered as metadata fields on the same
  `DataType`, producing a single-row schema: `{content, filename, sizeBytes}`.
- Wires `TextSource` into the in-process pipeline engine's row-loading dispatch
  (`InProcessPipelineEngine.loadRows`) so pipelines can bind to it end-to-end
  (source → pipeline → type → panel), matching CSV/Static, not REST/SQL (which are Spark-only
  today).
- A shared, connector-agnostic **metadata-field builder** (content field + `filename` +
  `sizeBytes`) that HEL-214/HEL-216 reuse by supplying their own content `DataFieldType`
  (`BinaryRefType` for PDF/image) instead of duplicating the field-construction logic.
- Flyway migration extending the `data_sources_source_type_check` CHECK constraint to include
  `'text'`.
- Frontend: a new source-type option in `AddSourceModal`/`SourceTypeToggle` supporting both file
  upload and URL entry, following the existing CSV/REST form patterns.

## Capabilities

### New Capabilities

- `text-file-connector`: Data Source connector for `.txt`/`.md` files — file upload and
  URL-based ingestion, content as `StringBodyType`, `filename`/`sizeBytes` metadata, in-process
  pipeline row-loading.

### Modified Capabilities

(none — `type-registry-content-fields` already defines `StringBodyType`; this change only
consumes it)

## Non-goals

- PDF/image connectors (HEL-214/HEL-216) — this change only establishes the seam they extend.
- Spark-path row-loading for text sources (in-process is sufficient; text content is a single row).
- Content extraction beyond raw UTF-8 text (no Markdown rendering/parsing).

## Impact

- Backend: `domain/DataSource.scala`, `domain/InProcessPipelineEngine.scala`,
  `infrastructure/DataSourceRepository.scala`, `services/DataSourceService.scala`,
  `api/protocols/{DataSourceProtocol,DataSourceConfigCodec}.scala`,
  `api/routes/DataSourceRoutes.scala`, new Flyway migration.
- Frontend: `features/sources/ui/{AddSourceModal,SourceTypeToggle}.tsx`, new text-source form
  component, `features/sources/services/dataSourceService.ts`.
