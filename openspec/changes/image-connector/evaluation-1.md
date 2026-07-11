## Evaluation Report — Cycle 1

(Re-run post-rebase. Original evaluation-1.md, written before the HEL-214 merge/rebase, recorded
Phases 1-2 PASS and Phase 3 BLOCKER on a cross-worktree Flyway migration collision. That collision
is now resolved — HEL-214 merged to origin/main, this branch rebased and renumbered its migration
to V49. This report supersedes the prior content of this file with a full fresh re-evaluation of
the rebased code, including a completed live Phase 3.)

### Phase 1: Spec Review — PASS
Issues: none.

Re-confirmed against the rebased tip (f69fbb9, base 481d97b):
- All 8 ticket acceptance criteria still addressed explicitly post-rebase; nothing was
  reinterpreted or dropped during conflict resolution.
- `tasks.md`'s 32 items still match the diff 1:1.
- No scope creep introduced by the rebase itself — the only rebase-driven additions are the
  migration renumber (V48→V49, additive CHECK constraint widening) and the conflict-resolution
  edits to the 16 closed-match files listed in `files-modified.md`, all of which are structurally
  necessary for the two connectors to coexist (not unrelated refactors).
- No regressions: independently re-ran the full backend (1164/1164) and frontend (814/814) suites
  myself (see Phase 2 gates below) — includes HEL-214's own suite post-merge.
- API contract: migration + protocol + codec updated together; `check:schemas` passes clean.
- Planning artifacts (`workflow-state.md`) accurately describe the rebase resolution.

### Phase 2: Code Review — FAIL
Issues:

1. **`ImageSourceSupport.dimensionsAndMime` does not catch the exception `ImageIO.read` throws
   for partially-valid/corrupt image bytes — only its documented `null` return is handled**
   (`backend/src/main/scala/com/helio/services/ImageSourceSupport.scala:44`,
   `Option(ImageIO.read(new ByteArrayInputStream(bytes)))` with no surrounding `try/catch`). The
   docstring at lines 25-34 claims "`ImageIO.read` returns `null`... covers both corrupt bytes and
   codecs the JVM build doesn't support," but this is only true when no reader recognizes the
   stream's magic bytes at all. When a reader **is** found (valid PNG/JPEG header) but the pixel
   data itself is truncated or corrupt — the realistic real-world failure mode for interrupted
   uploads or partially-fetched URLs — `ImageIO.read` throws `javax.imageio.IIOException`
   (wrapping `java.io.EOFException`/`java.util.zip.ZipException`), which is **uncaught** and
   propagates through `DataSourceService.ingestImage`
   (`backend/src/main/scala/com/helio/services/DataSourceService.scala:393`) and
   `DataSourceService.finishImageRefresh` (same file, refresh path reuses `dimensionsAndMime`) all
   the way to Pekko's default exception handler, producing a raw, unstructured
   **500 Internal Server Error** (`"There was an internal server error."`) instead of the intended
   graceful `400 BadRequest`.
   - **Live-reproduced, not theoretical**: confirmed via direct multipart upload against the
     running dev backend (bypassing the frontend) — a valid PNG uploads cleanly (`201 Created`),
     the identical file truncated by 30 bytes (simulating an interrupted upload) returns
     `500`/`"There was an internal server error."` Also independently reproduced in isolation with
     a standalone `ImageIO.read` JVM harness on the same truncated file — confirmed `IIOException`
     is thrown, not `null` returned.
   - **Contradicts the established sibling-connector pattern this ticket is explicitly modeled
     on**: `PdfTextSupport.validate` (HEL-214) correctly wraps `Loader.loadPDF` in a
     `try { ... } catch { case e: IOException => Left(...) }`
     (`backend/src/main/scala/com/helio/services/PdfTextSupport.scala:35-47`) specifically because
     "non-PDF bytes" throw `IOException` rather than returning a sentinel — the same category of
     JDK-parser behavior `ImageSourceSupport` needed to mirror and didn't.
   - **Systematic test gap across all three test layers masked this**: `ImageSourceSupportSpec`
     (`"return Left for corrupt/unreadable bytes"`, line 47), `DataSourceServiceSpec` (line 641),
     and `DataSourceRoutesSpec` (line 553) all use the identical fixture —
     `Array[Byte](0x00, 0x01, 0x02, 0x03)` / `Array[Byte](0x00, 0x01, 0x02)` — total garbage with no
     recognizable image magic number, which correctly exercises only the `null`-return branch.
     None of the three exercises a truncated-but-header-valid image, so the exception branch has
     zero test coverage anywhere in the suite despite all 1164 backend tests passing.
   - This is a genuine, plausible production failure mode (network-interrupted upload, partially
     downloaded URL fetch) that will 500 on end users instead of surfacing the actionable message
     the codebase's own design intends, and pollutes server logs with unhandled-exception stack
     traces for a foreseeable user-input error rather than handling it at the boundary
     (CONTRIBUTING.md error-handling expectation).

All other Phase 2 items re-confirmed clean on the rebased code (independently, not from the
executor's prior claims):
- Every closed match the rebase touched (`DataSourceRepository.rowToDomain`/`domainToRow`/`update`,
  `DataSourceService.update`/`delete`/`refresh`'s pattern matches, `DataSourceProtocol`'s
  discriminated union read/write, `DataSourceConfigCodec`, `DataSourceRoutes`'s URL + multipart
  branches, `InProcessPipelineEngine.loadRows`, `DataSource.scala`'s `DataSourceKind.All`, and the
  frontend `dataSource.ts`/`AddSourceModal.tsx`/`SourceTypeToggle.tsx`/`BoundSourceBar.tsx`/
  `SourceDetailPanel.tsx`/`dataSourceService.ts`) verified to genuinely carry both the `pdf` and
  `image` cases — no case dropped or duplicated by the conflict resolution (grepped each file
  directly, not sampled).
- Migration correctness: `V49__add_image_source_type.sql` is additive on top of the merged
  `V48__add_pdf_source_type.sql`, widening the `CHECK` constraint to
  `('rest_api', 'csv', 'static', 'sql', 'text', 'pdf', 'image')` — confirmed by reading both files
  directly and by the fresh `sbt test` run's Flyway log showing a clean migrate to v49 with no
  checksum conflicts.
- SSRF guard reconfirmed by direct code inspection: `createImageUrl`/`refreshImage` call
  exclusively `ContentSourceSupport.fetchUrl(url, resolveHost, isBlocked)` — grepped the full
  post-rebase diff for `HttpClient`/`java.net.http`/`Socket(`/`URLConnection`/`okhttp` and found
  zero matches; no bespoke HTTP client was introduced or resurrected by the merge.
- Gates re-run fresh by me (not trusted from the executor's report):
  - `sbt test`: **1164/1164 passed** (fresh run, embedded Postgres, clean migrate through v49).
  - `npm --prefix frontend test`: **814/814 passed**.
  - `npm run lint`: clean (0 warnings).
  - `npm run format:check`: clean.
  - `npm run check:schemas`: clean ("schemas in sync... 10 checked across 16 protocol files").
  - `npm run check:scala-quality`: clean (0 hard violations; 40 pre-existing soft file-size
    warnings, none newly introduced by this ticket).

### Phase 3: UI Review — FAIL
Issues: same root cause as Phase 2 issue #1, observed live.

Servers started cleanly this time via `scripts/concertino/start-servers.sh` (backend 8296,
frontend 5389) — the prior cross-worktree Flyway collision is fully resolved; no environmental
blocker.

- **Happy path — PASS**: logged in, navigated to Data Sources → Add source → Image. Both ingestion
  modes work end-to-end:
  - URL mode: created a source from `https://placehold.co/100x100.png`; appeared in the sidebar
    immediately with type badge "Image"; inferred schema correctly shows
    `content: binary-ref`, `filename: string`, `sizeBytes: integer`, `width: integer`,
    `height: integer`, `mimeType: string`, all non-nullable.
  - Upload mode: verified via a direct multipart upload against the running backend with a
    genuine valid PNG — `201 Created`, correct schema, visible in the UI with the same fields.
  - Preview correctly shows "Preview is not supported for Image sources" (an explicit, in-scope
    non-goal per the ticket, not a defect).
- **Unhappy path — FAIL**: uploading (or, by code-path analysis, URL-fetching) a corrupt-but-
  recognizable image (e.g. a truncated PNG) does **not** fail gracefully. The UI itself degrades
  reasonably (the `AddSourceModal` catches the failed request and shows an inline
  "Failed to create image source." alert — no blank screen, no unhandled JS exception, console
  shows the network failure but no client-side crash), but the underlying API contract is broken:
  the server returns an unstructured 500 with a generic body instead of the `400 BadRequest` with
  an actionable message that every other validation failure in this connector (and its PDF/text
  siblings) produces. This is the same defect as Phase 2 issue #1, just confirmed live rather than
  only by direct API/JVM reproduction.
- Also unrelated to this ticket, confirmed pre-existing and not a regression: one console warning
  ("`selectPipelineOutputDataTypes` returned a different result...") on initial dashboard load —
  traced to `frontend/src/features/dataTypes/state/dataTypesSlice.ts`, a file untouched by this
  diff. Not in scope for this ticket; noted as a non-blocking pre-existing issue, not a regression.
- Breakpoints (1440/1100/768/375) checked on both an Image source and a pre-existing CSV source
  for comparison — the sidebar-list/detail-panel overlap visible at 768px and below is identical
  across both, confirming it's a pre-existing generic layout characteristic of the
  sources page, not something introduced by this ticket's diff (no new CSS was added — confirmed
  via `git diff --stat`, zero `.css` files touched).
- Accessible names/keyboard: the "Image" toggle button, "Upload file"/"From URL" sub-mode toggle,
  and the file `<input>` (labelled via `id="source-image-file"` + associated `<label>`) all expose
  correct accessible names in the a11y tree; no issues found.
- No console errors during the happy-path flows (URL create, upload create via direct API,
  navigation, breakpoint resizing). The only console errors observed were the expected network
  failures during the corrupt-image reproduction above (502/500), which are the bug being
  reported, not a separate finding.

### Overall: FAIL

Phase 1 passed clean. Phase 2 and Phase 3 both fail on the same underlying defect: image ingestion
(both upload and URL paths, and the refresh path) crashes with an unhandled 500 instead of a
graceful 400 when given a corrupt-but-header-valid image — a realistic real-world scenario (network-
interrupted upload, partial URL fetch) that the codebase's own design intent and sibling PDF
connector both handle correctly, but that shipped with zero test coverage across all three test
layers due to every "corrupt image" fixture using total garbage bytes rather than a
truncated-but-recognizable image.

### Change Requests

1. **`backend/src/main/scala/com/helio/services/ImageSourceSupport.scala:35-51`** — wrap the
   `ImageIO.read(...)` call in a `try/catch` that also catches `java.io.IOException` (which
   `javax.imageio.IIOException` extends), mapping it to the same
   `Left(s"Unable to read image dimensions from '$filename': the file is corrupt or the image
   codec is unsupported")` message already used for the `null` case. Mirror
   `backend/src/main/scala/com/helio/services/PdfTextSupport.scala:35-47`'s established
   try/catch structure for this exact class of JDK-parser failure mode.
2. **`backend/src/test/scala/com/helio/services/ImageSourceSupportSpec.scala:47-54`**,
   **`backend/src/test/scala/com/helio/services/DataSourceServiceSpec.scala:641-649`**, and
   **`backend/src/test/scala/com/helio/api/DataSourceRoutesSpec.scala:553-559`** — each currently
   only exercises the `null`-return branch (total-garbage bytes with no recognizable magic number).
   Add a second case at each layer using a genuinely truncated-but-header-valid image (e.g. a real
   PNG with its final N bytes cut off) to close the coverage gap that let issue #1 ship
   undetected through 1164 passing tests. Confirm each new test asserts the same graceful
   `BadRequest`/400 outcome as the existing garbage-bytes case, not just that *some* error occurs.
3. Re-run the full gate suite (`sbt test`, `npm test`, `lint`, `format:check`, `check:schemas`,
   `check:scala-quality`) after the fix and post the fresh numbers — do not carry forward the
   1164/814 counts from this cycle, since the fix adds tests.

### Non-blocking Suggestions
- The pre-existing `selectPipelineOutputDataTypes` memoization console warning (unrelated to this
  ticket, in `dataTypesSlice.ts`) is a good candidate for a follow-up ticket but is out of scope
  here.
- The pre-existing file-size soft-budget warnings (`DataSourceService.scala` now 781 lines,
  `DataSourceProtocol.scala` now 417 lines, etc.) remain a good candidate for a dedicated future
  decomposition ticket, unaffected in kind by this change — correctly not addressed here per
  "avoid unrelated refactors."
