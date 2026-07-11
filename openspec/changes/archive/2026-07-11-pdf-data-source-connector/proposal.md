## Why

HEL-146 (v1.4 Unstructured Data) needs its second content connector. HEL-215 (merged) established the
reusable connector seam — `ContentSourceSupport` (metadata-field builder + guarded URL fetch) and the
per-connector `DataSource` ADT/route/service/pipeline wiring pattern — for `.txt`/`.md` files. HEL-214
extends that seam to `.pdf` files: extracted per-page text, registered as `StringBodyType` content
(HEL-217), with page number/character count as row-level metadata and filename/size/page count as
document-level metadata.

## What Changes

- New `PdfSource` DataSource kind (`"pdf"`) supporting `.pdf` files via **file upload** (multipart,
  mirrors `TextSource`'s upload path) and **URL-based ingestion** (fetch-and-store via
  `ContentSourceSupport.fetchUrl`/`validateUrl` — no bespoke HTTP client).
- Raw PDF bytes are stored via `FileSystem` at `pdf/<sourceId>.pdf` (mirrors CSV/Text's
  store-then-extract-at-run-time convention) so refresh/preview stay uniform and text extraction is
  deferred to pipeline-run time, consistent with the pipeline-only-bindings invariant (source →
  pipeline → type → panel; values materialize only when a pipeline runs).
- New `PdfTextSupport` service object (PDF-specific extraction, not shared — mirrors HEL-215's design
  note that per-connector `loadRows` extraction logic is deliberately not generalized): a single-pass
  page-by-page text extractor built on **Apache PDFBox** (dependency choice — see design.md), plus an
  ingest-time `validate` call that opens the document once to catch corrupt/encrypted PDFs early
  (mirrors CSV/Text's UTF-8 decode-at-ingest validation) and report the page count.
- `InProcessPipelineEngine.loadRows` gets a `PdfSource` case producing **one row per page** —
  `{content: <page text>, filename, sizeBytes, pageNumber, pageCount, characterCount}` — reusing
  `ContentSourceSupport.metadataFields(StringBodyType, ...)` for the `{content, filename, sizeBytes}`
  triple and appending the three PDF-specific fields (`pageNumber`, `pageCount`, `characterCount`) at
  the connector layer, so the shared helper's signature is untouched (reduces merge-conflict surface
  with the concurrently-in-flight HEL-216 image connector, which also extends `ContentSourceSupport`).
- Flyway migration extending `data_sources_source_type_check` to include `'pdf'`.
- Frontend: a new source-type option in `AddSourceModal`/`SourceTypeToggle` supporting both file
  upload and URL entry, following `TextSourceForm`'s pattern.

## Capabilities

### New Capabilities

- `pdf-connector`: Data Source connector for `.pdf` files — file upload and URL-based ingestion,
  per-page text extraction via Apache PDFBox, content as `StringBodyType`, `filename`/`sizeBytes`/
  `pageCount` document metadata plus `pageNumber`/`characterCount` per-row metadata, in-process
  pipeline row-loading (one row per page).

### Modified Capabilities

(none — `type-registry-content-fields` and `text-file-connector` already define the primitives this
change consumes; `ContentSourceSupport`'s public signatures are unchanged)

## Non-goals

- A user-selectable "extract as a single full-document string" mode. The ticket's phrasing allows
  either shape; per-page rows are the literal, testable requirement ("registers page number and
  character count as metadata fields"), and a full-document view is trivially obtained downstream by
  concatenating a pipeline's per-page rows. Adding a second extraction mode now would be premature
  generalization on a single data point — matches HEL-215's own non-goal precedent.
- Image/OCR extraction from scanned (non-text) PDFs — this connector extracts embedded text layers
  only, same limitation as any PDFBox-based text extractor.
- Spark-path row-loading — PDF page counts are expected to be modest (this is a document connector,
  not a bulk-data connector); the in-process engine is sufficient, same as CSV/Static/Text.
- Changes to `ContentSourceSupport.metadataFields`'s signature — PDF's extra fields are appended at
  the connector layer (see What Changes), not threaded through the shared helper.

## Impact

- Backend: `domain/DataSource.scala`, `domain/InProcessPipelineEngine.scala`,
  `infrastructure/DataSourceRepository.scala`, `services/DataSourceService.scala`, new
  `services/PdfTextSupport.scala`, `services/ContentSourceSupport.scala` (add `PdfExtensions` constant
  only), `api/protocols/{DataSourceProtocol,DataSourceConfigCodec}.scala`,
  `api/routes/DataSourceRoutes.scala`, new Flyway migration, `build.sbt` (new PDFBox dependency).
- Frontend: `features/sources/ui/{AddSourceModal,SourceTypeToggle}.tsx`, new `PdfSourceForm.tsx`
  component, `features/sources/services/dataSourceService.ts`, `features/sources/types/dataSource.ts`.
