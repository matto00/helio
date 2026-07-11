## Skeptic Report — design gate (round 0)

### What I verified (with evidence)

1. **PDFBox 3.0.3 choice** — `backend/build.sbt` has no existing PDF dependency (grepped
   `libraryDependencies`); PDFBox is a mature, Apache-2.0-licensed, pure-JVM library, consistent with the
   existing pure-JVM dependency set (Slick/Flyway/Spark, no native bindings). design.md's rejection of
   iText (AGPL/dual-license) and `pdftotext` (external process, no precedent) is sound reasoning, not
   hand-waving.

2. **"One row per page" vs. `InProcessPipelineEngine.loadRows`** — read
   `backend/src/main/scala/com/helio/domain/InProcessPipelineEngine.scala:47-78`. The existing pattern
   (`StaticSource`/`CsvSource`/`TextSource` cases, each returning `Future[Seq[Row]]`, `other` case failing
   loudly with "Unsupported source type") is exactly what design.md describes, and `PipelineRowJson.Row =
   Map[String, Any]` (`PipelineRowJson.scala:16`) trivially supports a `Seq` of per-page maps with `Int`
   fields (`pageNumber`/`pageCount`/`characterCount`) — `anyToJsValue` already handles `Int`. The planned
   `case p: PdfSource` slots in cleanly beside the CSV multi-row loader.

3. **Extraction deferred to pipeline-run time / pipeline-only-bindings invariant** — confirmed by reading
   `TextSource`'s actual ingest path (`DataSourceService.scala` around line 200-220): ingest only decodes
   UTF-8 to validate, stores the file, and registers a fixed schema; the *loadRows* text-loading happens at
   `InProcessPipelineEngine.scala:94-98` (`loadTextRowFromBytes`), at pipeline-run time. PDF's plan
   (`PdfTextSupport.validate` at ingest — cheap, no text walk; `extractPages` at `loadRows` time) mirrors
   this precisely.

4. **Four "closed match" touch points** — verified directly against file contents:
   - `DataSourceRepository.rowToDomain` (lines 24-45), `domainToRow` (50-57), `update` (125-132) — three
     closed `match`es over `CsvSource | RestSource | SqlSource | StaticSource | TextSource`, confirmed.
   - `DataSourceService.update`'s own separate exhaustive match at lines 253-259 (`c: CsvSource | r:
     RestSource | s: SqlSource | s: StaticSource | t: TextSource`) — confirmed as a distinct match site
     from the repository's, exactly the "easy to miss" spot design.md calls out (a missing `PdfSource` case
     here would throw `MatchError` on rename, as claimed).

5. **Appending PDF fields at connector layer vs. changing `metadataFields`'s signature** —
   `ContentSourceSupport.metadataFields(contentFieldType, filename, sizeBytes): Vector[DataField]`
   (`ContentSourceSupport.scala:33-42`) is confirmed as a fixed 3-arg helper returning the `{content,
   filename, sizeBytes}` triple; appending `Vector(pageNumberField, pageCountField, characterCountField)`
   at the call site (as design.md proposes) requires no signature change and is exactly how a "closed
   helper, extended by convention" pattern should be used. `DataSourceKind.All` currently has 5 members
   (`Csv, RestApi, Sql, Static, Text` — `DataSource.scala:113-126`), confirming HEL-215 is the only content
   connector merged so far and PDF is genuinely the next data point, not a retrofit.

6. **SSRF/URL-fetch reuse** — `ContentSourceSupport.fetchUrl`/`validateUrl` (`ContentSourceSupport.scala:
   105-236`) is a fully-implemented SSRF-guarded, DNS-rebinding-pinned fetch helper; design.md's plan to
   call this directly (no bespoke HTTP client) is consistent with how `DataSourceRoutes.scala`/
   `DataSourceService.scala` already dispatch URL-based `TextSource` creation. No new HTTP client code is
   proposed anywhere in design.md/tasks.md.

7. **Flyway precedent** — confirmed `V47__add_text_source_type.sql` (the migration design.md cites) is the
   real, most recent migration touching `data_sources_source_type_check` (drop/recreate pattern, same as
   the older `V13__add_sql_source_type.sql`). Task 1.2's "next V after the latest applied" instruction is
   actionable, not vague, given this precedent.

8. **Frontend touch points** — confirmed `TextSourceForm.tsx` exists in
   `frontend/src/features/sources/ui/` as the pattern to mirror for `PdfSourceForm.tsx`; `AddSourceModal.tsx`
   and `SourceTypeToggle.tsx` exist as the files tasks.md says to extend.

9. **Env-var pattern precedent** — confirmed `TEXT_MAX_FILE_SIZE_BYTES` (default 10 MB,
   `DataSourceService.scala:64`) is a real existing pattern; `PDF_MAX_FILE_SIZE_BYTES` (20 MB) following the
   same `sys.env.get(...).flatMap(_.toLongOption).getOrElse(...)` convention and `ServiceError.PayloadTooLarge`
   path is consistent, not invented.

10. **Edge cases** — encrypted PDFs (`InvalidPasswordException`), corrupt/non-PDF bytes (`IOException`),
    and scanned/image-only PDFs (empty-string `content`, documented Non-Goal, `nullable=false` but
    zero-length is explicitly called out as valid) are all named with concrete mitigations, not glossed
    over. No placeholder/TBD language found anywhere across proposal.md/design.md/spec.md/tasks.md.

### Internal consistency

- proposal.md's "What Changes"/"Non-goals"/"Impact" sections, design.md's "Decisions"/"Risks", spec.md's
  requirements/scenarios, and tasks.md's checklist all describe the *same* design (one row per page, PDFBox
  3.0.3, deferred extraction, connector-layer field appending, `PDF_MAX_FILE_SIZE_BYTES` = 20 MB) with no
  contradictions between documents.
- Every AC in ticket.md traces to a task: new connector type → tasks 1.1-1.5; per-page extraction → 2.2-2.3,
  5.1; metadata fields → 3.2, spec's field-list requirement; `StringBodyType` content → spec's field-type
  scenario; file upload → 4.1; URL ingestion → 4.2, spec's URL requirement; HEL-215 parity (apply/infer n/a
  here since no ops step type, allowedOps n/a, Flyway migration, frontend parity) → tasks 1.2, 6.1-6.5.
- No scope drift found — no work proposed beyond the ticket's acceptance criteria (OCR, full-document mode,
  and Spark-path row-loading are explicitly scoped out as Non-Goals with stated rationale, matching HEL-215's
  own precedent).

### Verdict: CONFIRM

### Non-blocking notes

- Zero-page PDFs (a technically valid but empty PDF) aren't explicitly discussed — `loadRows` would presumably
  yield an empty `Seq`, mirroring CSV's header-only-file behavior. Worth a one-line mention in design.md or a
  test case in 7.4, but not a blocking gap since the existing CSV precedent already establishes "empty source
  → empty rows" as acceptable behavior.
- The design doesn't explicitly state whether `characterCount` counts Java UTF-16 code units or Unicode code
  points for multi-byte page text — almost certainly `String.length` (UTF-16 code units, consistent with how
  `sizeBytes` is computed elsewhere as `bytes.length`), but not stated explicitly. Low-risk given `.pdf` text
  extraction rarely produces surrogate-pair-heavy content, and not worth blocking design on.
