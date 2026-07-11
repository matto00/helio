## Backend

- `backend/build.sbt` — added `org.apache.pdfbox:pdfbox:3.0.3` dependency.
- `backend/src/main/resources/db/migration/V48__add_pdf_source_type.sql` (new) — extends `data_sources_source_type_check` to include `'pdf'`.
- `backend/src/main/scala/com/helio/domain/DataSource.scala` — added `PdfSourceConfig`/`PdfSource` case classes and `DataSourceKind.Pdf`.
- `backend/src/main/scala/com/helio/api/protocols/DataSourceConfigCodec.scala` — added `decodePdf`/`encodePdf` (mirrors `decodeText`/`encodeText`).
- `backend/src/main/scala/com/helio/api/protocols/DataSourceProtocol.scala` — added `PdfSourceResponse`/`PdfSourceConfigPayload`/`PdfSourceUrlConfigPayload`/`PdfSourceUrlRequest`, wired into the `DataSourceResponse` discriminated-union format.
- `backend/src/main/scala/com/helio/api/package.scala` — re-exported the new PDF protocol types under `com.helio.api` (mirrors existing Text re-exports).
- `backend/src/main/scala/com/helio/infrastructure/DataSourceRepository.scala` — wired `PdfSource` into `rowToDomain`/`domainToRow`/`update`'s three closed matches.
- `backend/src/main/scala/com/helio/services/ContentSourceSupport.scala` — added `PdfExtensions: Set[String] = Set("pdf")` (one-line addition only; `metadataFields`'s signature untouched).
- `backend/src/main/scala/com/helio/services/PdfTextSupport.scala` (new) — `validate` (ingest-time, cheap open/close via `Loader.loadPDF`, catches `InvalidPasswordException`/`IOException`) and `extractPages` (single-pass per-page extraction via a `PDFTextStripper` subclass overriding `writeString`/`endPage`, avoiding the O(n²) `setStartPage/setEndPage` loop anti-pattern).
- `backend/src/main/scala/com/helio/services/DataSourceService.scala` — added `createPdfUpload`/`createPdfUrl`/private `ingestPdf`/`pdfFields`, a `PdfSource` case in `update`'s separate closed match (the exact miss HEL-215's design doc flagged), `refreshPdf`/`finishPdfRefresh`, and a `PdfSource` case in `delete`.
- `backend/src/main/scala/com/helio/api/routes/DataSourceRoutes.scala` — added the `pdf` branch in `createMultipartUploadRoute` (route-layer size check) and `createStaticRoute`'s JSON discriminator dispatch (URL ingestion).
- `backend/src/main/scala/com/helio/domain/InProcessPipelineEngine.scala` — added a `PdfSource` case to `loadRows` producing one row per page (`content`, `filename`, `sizeBytes`, `pageNumber`, `pageCount`, `characterCount`); extraction failures fail loudly via `IllegalArgumentException`, not a silent empty result.

## Backend tests

- `backend/src/test/scala/com/helio/testutil/PdfFixtures.scala` (new) — shared in-memory PDF fixture builder (multi-page, encrypted, corrupt-bytes) used by all PDF specs below.
- `backend/src/test/scala/com/helio/services/PdfTextSupportSpec.scala` (new) — `validate`/`extractPages` unit coverage.
- `backend/src/test/scala/com/helio/services/DataSourceServiceSpec.scala` — added `createPdfUpload`/`createPdfUrl`/`refresh`/`delete`/`update` PDF coverage, plus PDF URL-ingestion test-server routes.
- `backend/src/test/scala/com/helio/api/DataSourceRoutesSpec.scala` — added multipart `type=pdf` upload and JSON URL-ingestion route coverage, plus PDF test-server routes and a `pdfMultipartUpload` helper.
- `backend/src/test/scala/com/helio/domain/InProcessPipelineEngineSpec.scala` — added `PdfSource` `loadRows` coverage (multi-page fixture, missing-path diagnostic).
- `backend/src/test/scala/com/helio/domain/DataSourceSpec.scala` — extended the ADT's exhaustive-match test and `DataSourceKind.parseKind` round-trip coverage to include `PdfSource`/`"pdf"`.

## Frontend

- `frontend/src/features/sources/types/dataSource.ts` — added `PdfSourceConfig`/`PdfSource`/`isPdfSource`, extended `DataSourceKind`/`DataSource`.
- `frontend/src/features/sources/ui/PdfSourceForm.tsx` (new) — file-picker + URL-entry sub-modes, mirrors `TextSourceForm.tsx`.
- `frontend/src/features/sources/ui/PdfSourceForm.test.tsx` (new) — component tests for both sub-modes.
- `frontend/src/features/sources/ui/SourceTypeToggle.tsx` — added the "PDF" toggle entry.
- `frontend/src/features/sources/ui/AddSourceModal.tsx` — wired the `"pdf"` source type (self-contained form + footer, same as `"text"`/`"static"`).
- `frontend/src/features/sources/ui/AddSourceModal.test.tsx` — added PDF upload/URL-ingestion integration tests.
- `frontend/src/features/sources/services/dataSourceService.ts` — added `createPdfSourceUpload`/`createPdfSourceUrl`.
- `frontend/src/features/sources/ui/SourceDetailPanel.tsx` — added the `"pdf"` case to `labelForKind`'s exhaustive switch (required after widening `DataSourceKind`; preview already falls back to the existing "not supported" message for non-csv/static/rest_api kinds).
- `frontend/src/features/pipelines/ui/BoundSourceBar.tsx` — same `labelForKind` exhaustive-switch fix as `SourceDetailPanel.tsx`.

## OpenSpec

- `openspec/changes/pdf-data-source-connector/tasks.md` — all 28 tasks checked off.
