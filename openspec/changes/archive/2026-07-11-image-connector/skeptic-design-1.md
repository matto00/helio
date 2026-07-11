## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `specs/image-file-connector/spec.md`, `tasks.md`.
- Read the two prior-art archived changes for context:
  - `openspec/changes/archive/2026-07-11-plain-text-markdown-connector/{proposal,design}.md`
  - `openspec/changes/archive/2026-07-11-content-field-types/design.md` (HEL-217's write-contract
    intent for `BinaryRefRepository.overwriteForDataType`).
- Confirmed `overwriteRows` (the row-write call site the design hooks) is called in exactly one
  place in the whole backend: `PipelineRunService.scala:307`
  (`grep -rn "overwriteRows" backend/src/main/scala` — only the repository definition and this one
  call site). This validates the design's central claim and its choice to wire
  `overwriteForDataType` generically into `onRunSuccess` rather than adding a connector-specific
  hook — `DataSourceService` genuinely never writes rows itself, matching `TextSource`'s existing
  behavior.
- Read `backend/src/main/scala/com/helio/services/PipelineRunService.scala` in full — confirmed
  `resultRows: Seq[Map[String, Any]]` (pre-JSON, raw Scala values) is available in `onRunSuccess`
  before the `jsRows` conversion, so the design's plan to scan `resultRows` for `BinaryRef`-shaped
  `Map` values (rather than the JSON-serialized `jsRows`) is structurally sound for building
  `BinaryRef` records.
- Read `backend/src/main/scala/com/helio/domain/PipelineRowJson.scala` — **found the defect below**.
- Read `backend/src/main/scala/com/helio/domain/InProcessPipelineEngine.scala` — confirmed
  `loadRows`'s per-connector dispatch precedent (comment at lines 89-92 explicitly anticipates
  HEL-216 adding its own `case`, matching the design's plan) and that `TextSource`'s existing row
  (`Map("content" -> content, ...)`) never nests a `Map` value — there is no existing precedent of a
  nested-object row value flowing through this pipeline.
- Read `backend/src/main/scala/com/helio/infrastructure/{DataTypeRowRepository,BinaryRefRepository}.scala`
  — confirmed `overwriteRows(dataTypeId, rows: Seq[JsObject])` does `row.compactPrint` (needs a
  genuine `JsObject`, not a stringified Scala `Map`), and `BinaryRefRepository.overwriteForDataType`
  matches the delete-then-bulk-insert semantics the design describes.
- Read `backend/src/main/scala/com/helio/services/ContentSourceSupport.scala` in full — confirmed
  `fetchUrl`/`validateUrl` (SSRF guard: scheme allowlist, `isBlockedAddress` denylist incl.
  169.254.0.0/16 + unique-local IPv6, DNS-rebinding pinned transport, no auto-redirect-follow, no
  upstream body leak on non-2xx) and `validateExtension`/`filenameFromUrl`/`TextExtensions` exist
  exactly as the design claims, with no new HTTP client planned. The design's reuse mandate is
  followed as designed.
- Read `backend/src/main/scala/com/helio/domain/DataSource.scala` — confirmed `TextSource`/
  `TextSourceConfig`/`DataSourceKind.{Text,All}` match the design's claimed template exactly
  (`ImageSourceConfig(path, sourceUrl: Option[String])` mirrors `TextSourceConfig` 1:1).
- Read `backend/src/main/scala/com/helio/infrastructure/DataSourceRepository.scala` — confirmed the
  "3 closed matches" claim (`rowToDomain`, `domainToRow`, and `update` — the last verified via grep)
  are the actual closed matches needing an `ImageSource` case.
- Read `backend/src/main/scala/com/helio/services/DataSourceService.scala` (grep for
  `TextSource`/`TEXT_MAX_FILE_SIZE_BYTES`/`PayloadTooLarge`) — confirmed `createTextUpload`/
  `createTextUrl`/`update`/`delete`/`refresh`/`refreshText` all exist with the shape the design's
  `ingestImage` plan mirrors, including `ServiceError.PayloadTooLarge` as an existing variant (no
  new `ServiceError` case needed, as claimed).
- Read `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — confirmed no `BinaryRefRepository`
  is constructed today, and `PipelineRunService` is constructed with 9 positional args (matches the
  design's plan to append a 10th, defaulted, nullable `binaryRefRepo` param — no ambiguity from
  named-vs-positional call sites since Scala allows trailing defaulted params in a positional call).
- Read `backend/src/main/resources/db/migration/V47__add_text_source_type.sql` and confirmed it is
  the latest migration (`ls ... | sort -t V -k2 -n | tail`) — the design's planned
  drop/recreate-CHECK-constraint migration for `'image'` mirrors this file's exact pattern and will
  work.
- Checked `frontend/src/features/sources/ui/` — `AddSourceModal.tsx`, `SourceTypeToggle.tsx`,
  `TextSourceForm.tsx`, `SourceDetailPanel.tsx` all exist as the design/tasks claim.
- Checked `openspec/specs/data-source-persistence/spec.md` — noted (non-blocking, see below) that
  its `source_type` enum documentation (`rest_api | csv | static | sql`) was never updated when
  HEL-215 added `'text'` either; this ticket doesn't fix that pre-existing drift, but neither did
  the accepted prior-art change, so it isn't a regression unique to this design.

### Verdict: REFUTE

### Change Requests

1. **[Blocking] The design's core write path silently corrupts the `content` field instead of
   storing the `BinaryRefType` object the ticket requires.** `design.md`'s "Decisions" section
   plans for `InProcessPipelineEngine.loadRows`'s new `case i: ImageSource` to build a row where
   `content` is *"the `BinaryRef` map"* — i.e., a nested `Map[String, Any]` (or equivalent) value
   inside the `Row = Map[String, Any]`. That row flows, unmodified in this respect, into
   `PipelineRunService.executeRun`'s `jsRows = resultRows.map { rowMap => JsObject(rowMap.map { case
   (k, v) => k -> PipelineRowJson.anyToJsValue(v) }) }` (`PipelineRunService.scala:263-265`), which
   is what actually gets persisted via `dataTypeRowRepo.overwriteRows(...).compactPrint`
   (`DataTypeRowRepository.scala:24-28`) into `data_type_rows.data` — the sole row-read path per
   HEL-217's design ("this inline JSONB value is the sole read path for row data").

   `PipelineRowJson.anyToJsValue` (`backend/src/main/scala/com/helio/domain/PipelineRowJson.scala:26-37`)
   has **no case for a nested `Map`** (or any nested object/`JsValue`). Its exhaustive-looking match
   only handles `null`/`Boolean`/`Int`/`Long`/`Float`/`Double`/`BigDecimal`/`java.math.BigDecimal`/
   `String`; everything else falls to the catch-all `case _ => JsString(v.toString)`. For a Scala
   `Map[String, Any]` value, `.toString` produces something like
   `"Map(storageKey -> image/abc.png, mimeType -> image/png, filename -> abc.png, sizeBytes -> 12345)"`
   — a garbage **string**, not the `{"storageKey": "...", "mimeType": "...", "filename": "...",
   "sizeBytes": 12345}` JSON **object** the ticket, `spec.md`, and HEL-217's `BinaryRefType` contract
   require.

   This is not a hypothetical edge case — it is the *only* row value this whole ticket introduces,
   and it is guaranteed to hit the broken catch-all on every single image-source pipeline run,
   regardless of pipeline steps. It directly falsifies:
   - `spec.md`'s "Pipeline run over an image source yields one row" scenario ("the `content` value
     carries `storageKey`, `mimeType`, `filename`, and `sizeBytes`" — it will instead carry a
     stringified Scala `Map`).
   - `spec.md`'s "Running a pipeline bound to an image source populates binary_refs" scenario,
     specifically the assertion that `binary_refs` "match[es] the storageKey/mimeType/filename/
     sizeBytes written to `data_type_rows`" — the *extraction* (scanning raw pre-serialization
     `resultRows`, per the design) will actually succeed and produce correct `binary_refs` rows, but
     `data_type_rows.data.content` will be the broken string, so the two will *not* match, and any
     consumer reading rows via `GET /api/types/:id/rows` (the row read path) gets unusable data.

   **Required revision**: `design.md`/`tasks.md` must add an explicit task to fix
   `PipelineRowJson.anyToJsValue` to recursively convert nested `Map[String, Any]` values into
   `JsObject` (e.g., a case ordered before the catch-all:
   `case m: Map[String, Any] @unchecked => JsObject(m.map { case (k, v) => k -> anyToJsValue(v) })`)
   before any image-source row can be correctly persisted, plus a regression test (per the
   Debugging Iron Law: this is a probe-confirmed root cause, not a guess) asserting that a pipeline
   run over an `ImageSource` writes a genuine JSON object — not a stringified Scala `Map` — into
   `data_type_rows.data`'s `content` field, and that it round-trips correctly through
   `GET /api/types/:id/rows`. This is a shared helper (also used by `previewStep`'s row projection
   and `status`'s cached-run projection at `PipelineRunService.scala:135-137,157-159`), so the fix
   is small and localized, but it is currently entirely unaddressed in `design.md`'s Decisions/Risks
   and absent from every task in `tasks.md` (I grepped for `anyToJsValue`/`PipelineRowJson`/nested
   `JsObject` handling across all planning artifacts and found zero mentions beyond one passing
   reference to "nested `content` map" in task 7.3's test description, which does not identify the
   serialization gap).

### Non-blocking notes

- `openspec/specs/data-source-persistence/spec.md` still documents `source_type` as constrained to
  `rest_api | csv | static | sql` (line 8-9) — it was never updated with a `MODIFIED Requirements`
  delta when HEL-215 added `'text'`, and this design doesn't propose one for `'image'` either. This
  mirrors accepted prior-art precedent (HEL-215 also skipped it) rather than being a regression
  introduced here, so I'm not blocking on it, but the drift is now compounding across two
  connectors and worth a follow-up spec-sync ticket.
- Everything else checked out cleanly against ground truth: the reuse mandates (`ContentSourceSupport.fetchUrl`/`validateUrl`/`metadataFields`/`validateExtension`, `BinaryRefRepository`/`binary_refs`, no new HTTP client, no new storage plumbing), the `DataSourceKind`/`DataSourceRepository`/`DataSourceService` closed-match wiring, the Flyway migration approach, and the frontend component names all match the current codebase shape exactly, with no scope creep beyond the ticket (image transformation/thumbnails/previews correctly excluded as non-goals).
