## Context

`DataSource` is a closed sealed trait (`CsvSource | RestSource | SqlSource | StaticSource | TextSource`,
`backend/src/main/scala/com/helio/domain/DataSource.scala`) with a `kind` discriminator persisted in
`data_sources.source_type` under a Postgres CHECK constraint (`V47__add_text_source_type.sql`). Adding a
source kind touches four closed `match`es: `DataSourceRepository.rowToDomain`/`domainToRow`/`update`, plus
`DataSourceService.update`'s own separate exhaustive match (HEL-215's design.md flagged this exact spot as
easy to miss — a missing case throws an uncaught `MatchError` on rename). Also touches
`DataSourceConfigCodec`, `DataSourceProtocol`, `DataSourceRoutes`, and a new Flyway migration.

HEL-215 shipped `ContentSourceSupport` (`services/ContentSourceSupport.scala`): `metadataFields` (the
`{content, filename, sizeBytes}` triple, parameterized by content `DataFieldType`), a guarded
`fetchUrl`/`validateUrl` (SSRF-hardened, DNS-rebinding-pinned), and `validateExtension`/`filenameFromUrl`.
This is the first consumer beyond text; per HEL-215's design doc, `loadRows` extraction logic is
deliberately connector-specific, not shared.

Per the ticket, PDF extraction is per-page with page number + character count as metadata, unlike
`TextSource`'s single-row shape — this is the first multi-row content connector. HEL-216 (image) is being
built in parallel and also extends `ContentSourceSupport`/`DataSourceService`; both changes are additive
(new `case` branches, new constants) so conflicts are expected to be mechanical rebases, not logical ones.

## Goals / Non-Goals

**Goals:**
- `.pdf` file upload and URL-based ingestion, producing one row per page:
  `{content: StringBodyType, filename: StringType, sizeBytes: IntegerType, pageNumber: IntegerType,
  pageCount: IntegerType, characterCount: IntegerType}`.
- Pipeline-bindable via the in-process engine.
- Ingest-time validation that the file is a well-formed, non-encrypted PDF (mirrors CSV/Text's
  decode-at-ingest checks), without doing full text extraction at ingest time (extraction is deferred to
  pipeline-run time, per the pipeline-only-bindings invariant).
- Reuse `ContentSourceSupport.fetchUrl`/`validateExtension`/`filenameFromUrl` unchanged.

**Non-Goals:**
- A configurable "single full-document string" extraction mode (see proposal's Non-goals).
- OCR / scanned-image text recovery.
- Changing `ContentSourceSupport.metadataFields`'s signature.

## Decisions

**New `PdfSource` kind, config `PdfSourceConfig(path: String, sourceUrl: Option[String])`** — identical
shape to `TextSourceConfig`. `path` always populated (uploaded bytes or fetched-and-stored URL content).

**Dependency: Apache PDFBox (`org.apache.pdfbox:pdfbox:3.0.3`).** Mature, widely-used, Apache-2.0-licensed
JVM PDF library; no existing PDF dependency in `build.sbt`. Chosen over iText (AGPL/commercial dual-license
— licensing risk for a permissively-licensed codebase) and over shelling out to `pdftotext` (external
process dependency, no existing precedent in this Scala/JVM codebase). Pure-Java, no native bindings —
consistent with the existing dependency set (Slick, Flyway, Spark all pure-JVM).

**New `services/PdfTextSupport.scala`** (PDF-specific, not folded into `ContentSourceSupport` — mirrors
HEL-215's "loadRows extraction stays per-connector" precedent):
- `validate(bytes): Either[String, Int]` — opens the doc once via `PDDocument.load`, returns
  `Right(pageCount)` or `Left(message)` for `InvalidPasswordException` (encrypted) / generic `IOException`
  (corrupt/non-PDF), always closing the document. Used at ingest time only, to fail fast with a 400
  instead of deferring to the first pipeline run.
- `extractPages(bytes): Try[Vector[String]]` — a **single-pass** extraction: subclasses
  `PDFTextStripper`, accumulates text per page by overriding `writeString` (append to a per-page
  `StringBuilder`) and `endPage` (push the accumulated page's text into the result vector, reset the
  builder), then calls `getText(document)` once. This avoids the O(n²) anti-pattern of calling
  `setStartPage(i)/setEndPage(i)/getText(doc)` in a loop over pages (each such call re-walks the document
  from page 1), which would be a real performance problem on large PDFs — CLAUDE.md's "optimize for
  performance by default" rule applies directly here.

**Extraction deferred to pipeline-run time, not ingest time.** Ingest only calls `PdfTextSupport.validate`
(cheap: opens/closes the doc, no text walk) to catch bad files early; the DataType's field *schema* is
fixed regardless of the file's actual content (same as HEL-215's `metadataFields` — schema doesn't depend
on values). Full-page extraction (`extractPages`) happens in `InProcessPipelineEngine.loadRows`, consistent
with the pipeline-only-bindings invariant that row values only materialize when a pipeline runs.

**PDF-specific fields are appended at the connector layer, not threaded through
`ContentSourceSupport.metadataFields`.** `DataSourceService` builds
`ContentSourceSupport.metadataFields(StringBodyType, filename, sizeBytes) ++ Vector(pageNumberField,
pageCountField, characterCountField)`. Keeps the shared helper's 3-arg signature untouched — no existing
call site (HEL-215's `TextSource`, HEL-216's in-flight `ImageSource`) needs to change, minimizing the
rebase surface between the two in-flight connector tickets.

**`ContentSourceSupport` gets exactly one new line**: `val PdfExtensions: Set[String] = Set("pdf")`,
mirroring `TextExtensions`. Everything else PDF-specific lives in `PdfTextSupport`/`DataSourceService`.

**Storage convention**: `pdf/<sourceId>.pdf`, mirroring `csv/<id>.csv` / `text/<id>.<ext>`. Filename for
uploads/URL ingestion follows the same derivation as `TextSource` (upload part's filename;
`ContentSourceSupport.filenameFromUrl` for URL ingestion).

**Size limit**: new `PDF_MAX_FILE_SIZE_BYTES` env var, default `20971520` (20 MB) — larger than text's
10 MB default (PDFs are binary and typically larger) but well under CSV's 50 MB, enforced via the existing
`ServiceError.PayloadTooLarge` (HEL-215) path for both upload and URL-fetch byte counts.

**Route/protocol/repository wiring mirrors `TextSource` exactly**: multipart branch in
`createMultipartUploadRoute` (`type = "pdf"`), JSON-URL branch in `createStaticRoute`'s discriminator
dispatch (`PdfSourceUrlRequest`), `PdfSourceResponse`/`PdfSourceConfigPayload`/`PdfSourceUrlConfigPayload`
in `DataSourceProtocol`, `encodePdf`/`decodePdf` in `DataSourceConfigCodec`, and a `PdfSource` case in every
one of `DataSourceRepository`'s three matches **and** `DataSourceService.update`'s separate match (the
exact miss HEL-215's design doc called out).

## Risks / Trade-offs

- [Risk] Large PDFs (many pages / large embedded images) could make `extractPages` slow or memory-heavy
  at pipeline-run time → Mitigation: `PDF_MAX_FILE_SIZE_BYTES` bounds file size at ingest; single-pass
  extraction (not O(n²)) bounds CPU; this is a document connector, not a bulk-data connector (Non-Goal:
  Spark path).
- [Risk] Password-protected / corrupted PDFs → Mitigation: `PdfTextSupport.validate` at ingest returns a
  descriptive 400, not a 500 or a silent empty result.
- [Risk] `ContentSourceSupport`/`DataSourceService` are touched by both this change and the concurrent
  HEL-216 → Mitigation: both changes are additive (new match cases, new constants); ticket instructs
  rebasing onto `origin/main` if the PR shows CONFLICTING.
- [Risk] Scanned (image-only) PDFs yield empty-string page content, not an error → Mitigation: documented
  Non-Goal (OCR out of scope); empty `content` is valid per the field's `nullable = false` but
  zero-length string, not null.

## Planner Notes

- Self-approved: PDFBox 3.0.3 (current stable major line) over 2.0.x legacy — no existing PDFBox
  dependency to stay compatible with.
- Self-approved: `PDF_MAX_FILE_SIZE_BYTES` default of 20 MB, per the text/CSV precedent's env-var pattern.
- Self-approved: one row per page (no full-document mode) — see proposal's Non-goals for rationale.
