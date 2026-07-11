## 1. Backend: domain + persistence

- [x] 1.1 Add `PdfSourceConfig(path, sourceUrl: Option[String])` and `PdfSource` case class to `domain/DataSource.scala`; add `DataSourceKind.Pdf = "pdf"` to `All`.
- [x] 1.2 Add Flyway migration (next `V` after the latest applied) dropping/recreating `data_sources_source_type_check` to include `'pdf'`.
- [x] 1.3 Add `DataSourceConfigCodec.decodePdf`/`encodePdf` for `PdfSourceConfig` (path + optional sourceUrl), mirroring `decodeText`/`encodeText`.
- [x] 1.4 Wire `PdfSource` into `DataSourceRepository.rowToDomain`/`domainToRow`/`update`'s closed matches.
- [x] 1.5 Add a `PdfSource` case to `DataSourceService.update`'s separate closed match — without it, `PATCH /api/data-sources/:id` on a PDF source throws an uncaught `MatchError` (500). Same miss HEL-215's design doc flagged.

## 2. Backend: PDFBox dependency + extraction support

- [x] 2.1 Add `"org.apache.pdfbox" % "pdfbox" % "3.0.3"` to `build.sbt` `libraryDependencies`.
- [x] 2.2 Create `services/PdfTextSupport.scala` with `validate(bytes: Array[Byte]): Either[String, Int]` — opens via `PDDocument.load`, catches `InvalidPasswordException` (encrypted) and `IOException` (corrupt), always closes the document, returns page count on success.
- [x] 2.3 Add `PdfTextSupport.extractPages(bytes: Array[Byte]): Try[Vector[String]]` — single-pass extraction via a `PDFTextStripper` subclass that accumulates text per page (override `writeString`/`endPage`), avoiding the O(n²) `setStartPage/setEndPage` loop anti-pattern.
- [x] 2.4 Add `ContentSourceSupport.PdfExtensions: Set[String] = Set("pdf")`, mirroring `TextExtensions` (one-line addition only — do not touch `metadataFields`' signature).

## 3. Backend: service + wire protocol

- [x] 3.1 Add `PdfSourceConfigPayload`, `PdfSourceResponse`, `PdfSourceUrlConfigPayload`, `PdfSourceUrlRequest` (`{name, type, config: {url}}`) to `DataSourceProtocol`; extend the `DataSourceResponse` discriminated-union format for `type = "pdf"`.
- [x] 3.2 Add `DataSourceService.createPdfUpload(name, bytes, filename, user)`/`createPdfUrl(name, url, user)`, sharing a private `ingestPdf` (extension validation via `ContentSourceSupport.validateExtension(_, PdfExtensions)`, size enforcement, `PdfTextSupport.validate` for corrupt/encrypted rejection, `FileSystem` write at `pdf/<sourceId>.pdf`, `DataType` registration via `ContentSourceSupport.metadataFields(StringBodyType, ...) ++` the `pageNumber`/`pageCount`/`characterCount` fields).
- [x] 3.3 Extend `DataSourceService.refresh` with a `PdfSource` case: re-read stored file if `sourceUrl` is `None`, re-fetch + overwrite if `Some` (mirrors `refreshText`), re-validating via `PdfTextSupport.validate` on refresh too.
- [x] 3.4 Extend `DataSourceService.delete` to call `FileSystem.delete` for `PdfSource` (mirrors `CsvSource`/`TextSource`).
- [x] 3.5 Read `PDF_MAX_FILE_SIZE_BYTES` (default 20971520); enforce in `ingestPdf` for both upload-bytes and URL-fetch byte-count, returning `ServiceError.PayloadTooLarge`.

## 4. Backend: routes

- [x] 4.1 Extend `createMultipartUploadRoute`'s internal branch with a `typeStr == DataSourceKind.Pdf` case calling `createPdfUpload`, enforcing `pdfMaxBytes` at the route layer (mirrors the existing `text`/csv early-reject checks).
- [x] 4.2 Extend `createStaticRoute`'s JSON-discriminator dispatch with a `DataSourceKind.Pdf` branch converting to `PdfSourceUrlRequest` and calling `createPdfUrl`.

## 5. Backend: pipeline row-loading

- [x] 5.1 Add a `case p: PdfSource` to `InProcessPipelineEngine.loadRows`: read stored file, call `PdfTextSupport.extractPages`, and return one row per page with keys `content`, `filename`, `sizeBytes`, `pageNumber` (1-indexed), `pageCount`, `characterCount`.
- [x] 5.2 On `PdfTextSupport.extractPages` failure (corrupt file changed on disk since ingest-time validation), fail the same way CSV/Text do for a missing/invalid source file (descriptive `IllegalArgumentException`/`Future.failed`, not a silent empty result).

## 6. Frontend

- [x] 6.1 Add `"pdf"` to the `SourceType` union in `AddSourceModal.tsx`; add a toggle entry ("PDF") in `SourceTypeToggle.tsx`.
- [x] 6.2 Add `PdfSourceForm.tsx` supporting both file-picker and URL-entry sub-modes (mirrors `TextSourceForm.tsx`), with `accept=".pdf,application/pdf"` on the file input.
- [x] 6.3 Add `createPdfSourceUpload`/`createPdfSourceUrl` to `features/sources/services/dataSourceService.ts`, mirroring `createTextSourceUpload`/`createTextSourceUrl`.
- [x] 6.4 Wire the create path in `AddSourceModal.tsx` for the new `"pdf"` source type (self-contained form + footer, same as `"text"`/`"static"`).
- [x] 6.5 Add `PdfSourceConfig`/`PdfSource`/`isPdfSource` types to `features/sources/types/dataSource.ts`, extending the `DataSource` union.

## 7. Tests

- [x] 7.1 Backend: `PdfTextSupportSpec` — `validate` (valid PDF returns correct page count; corrupt bytes and encrypted PDF both return `Left`); `extractPages` (correct per-page text and page count for a known multi-page fixture PDF; single-pass behavior, e.g. via a page-count assertion on a fixture with distinct per-page content).
- [x] 7.2 Backend: `DataSourceService` tests for `createPdfUpload`/`createPdfUrl` (valid `.pdf`, unsupported extension, oversized → `PayloadTooLarge`/413, corrupt PDF → 400, encrypted PDF → 400, refresh both variants, delete, `update`/rename on `PdfSource`).
- [x] 7.3 Backend: `DataSourceRoutesSpec` — multipart `type=pdf` upload, JSON URL creation, and regressions confirming CSV/text/static creation still work unchanged.
- [x] 7.4 Backend: `InProcessPipelineEngineSpec` test for `PdfSource` — multi-page fixture yields one row per page with correct `pageNumber`/`pageCount`/`characterCount`/`content` values.
- [x] 7.5 Frontend: `AddSourceModal`/`PdfSourceForm` tests for upload and URL sub-modes.
