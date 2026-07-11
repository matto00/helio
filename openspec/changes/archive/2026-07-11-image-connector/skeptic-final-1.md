## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

1. **`PipelineRowJson.anyToJsValue` nested-Map fix** — read
   `backend/src/main/scala/com/helio/domain/PipelineRowJson.scala:47`: the
   `case m: Map[String, Any] @unchecked => JsObject(m.map { case (k, v) => k -> anyToJsValue(v) })`
   case is present, placed before the catch-all, recurses correctly. Confirmed live (not just
   unit-tested) by running an actual image pipeline end-to-end (`POST /api/pipelines/:id/run`):
   the `content` field came back as a real nested JSON object
   (`{"storageKey":...,"mimeType":...,"filename":...,"sizeBytes":...}`), and `GET
   /api/types/:id/rows` shows the same structure round-tripped through
   `data_type_rows.data` — not a stringified `Map(...)`. Regression test present at
   `backend/src/test/scala/com/helio/domain/PipelineRowJsonSpec.scala` (58 new lines).

2. **Closed-match completeness across the shared HEL-214/HEL-216 seam** — grepped every file
   named in the brief (`DataSourceRepository`, `DataSourceService`, `DataSourceProtocol`,
   `DataSourceConfigCodec`, `DataSourceRoutes`, `InProcessPipelineEngine`, `DataSource.scala`
   (`DataSourceKind.All`), `package.scala`, plus the frontend `dataSourceService.ts` /
   `AddSourceModal.tsx`). Both `pdf` and `image` cases are present everywhere; `DataSourceKind.All
   = Set(Csv, RestApi, Sql, Static, Text, Pdf, Image)` includes both. No dropped or duplicated
   case found.

3. **Migration V49** — read `V49__add_image_source_type.sql`: additive
   (`DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT ... IN ('rest_api','csv','static','sql','text',
   'pdf','image')`), correctly built on top of the merged `V48__add_pdf_source_type.sql`'s
   6-value set. Fresh `sbt test` run migrated cleanly through v49 with no Flyway errors.

4. **IIOException fix** — read `ImageSourceSupport.scala:52-64`: `ImageIO.read` wrapped in
   `try { ... Option(...) match { None => Left(corrupt); Some(img) => Right(...) } } catch { case
   _: IOException => Left(corrupt) }`. Traced the `Left` through
   `DataSourceService.ingestImage`/`finishImageRefresh` → `ServiceError.BadRequest` →
   `ServiceResponse.completeError` → HTTP 400. **Reproduced live myself** (not trusting the
   evaluator's report): built a real PNG via a Python encoder, truncated it
   (`data[:-30]`), uploaded both via `curl` directly against the running dev backend:
   - Valid PNG upload → `201 Created`.
   - Truncated PNG upload → `400 {"message":"Unable to read image dimensions from
     'skeptic_truncated.png': the file is corrupt or the image codec is unsupported"}` — graceful,
     not a raw 500.
   Confirms the fix is real and reaches the HTTP layer as claimed.

5. **URL ingestion / SSRF guard** — confirmed `DataSourceService.createImageUrl` (line 361-367)
   calls `ContentSourceSupport.fetchUrl(url, resolveHost, isBlocked)` exclusively; grepped the
   full diff (`git diff 8935b2e...HEAD`) for `http`/`URL(` — no bespoke HTTP client anywhere in
   the image connector's code.

6. **Full gate suite re-run fresh by me:**
   - `sbt test`: **1167/1167 passed**, clean Flyway migrate to v49.
   - `npm --prefix frontend test`: **814/814 passed**.
   - `npm run lint`: clean (0 warnings).
   - `npm run format:check`: clean.
   - `npm run check:schemas`: clean (10 checked across 16 protocol files).
   - `npm run check:scala-quality`: clean (0 hard violations, 40 pre-existing soft file-size
     warnings, none new).

7. **Live functional verification (backend 8296, frontend 5389):**
   - Logged into the running dev frontend, navigated to Data Sources, opened "Add source" →
     Image type — form renders, both `Upload file` / `From URL` sub-modes present.
   - Via `curl` (multipart, `type=image`): created a data source, confirmed `DataType` schema
     is exactly `{content: binary-ref, filename: string, sizeBytes: integer, width: integer,
     height: integer, mimeType: string}`, all `nullable: false` — matches the ticket AC and an
     existing pre-created `LiveTestValid3` source visible in the sidebar shows the identical
     schema.
   - Created a pipeline bound to the new image source, ran it (`POST
     /api/pipelines/:id/run`): `200`, 1 row, correct `width=16 height=16 mimeType=image/png`,
     `content` a real nested object.
   - Queried Postgres directly (`select * from binary_refs`): confirmed
     `BinaryRefRepository.overwriteForDataType` was actually called and wrote a row keyed to the
     pipeline's `outputDataTypeId`, `rowIndex=0`, `fieldName=content` — the HEL-217 write-contract
     wiring works end-to-end, not just in unit tests.
   - Zero console errors; one pre-existing, unrelated `selectPipelineOutputDataTypes` memoization
     warning (confirmed untouched by this diff).

8. **Task/AC completeness** — `tasks.md`: 32/32 marked done, 0 open.

### Verdict: REFUTE

The backend implementation is sound, well-tested, and the multi-cycle history (rebase, IIOException
fix) left no dropped cases or regressions — I could not find fault with items 1-8 above. However, a
concrete, reproducible UI defect in this ticket's own delivered code fails the design-standard bar:

### Change Requests

1. **`ImageSourceForm`'s "Cancel" / "Create source" buttons render with zero visual button
   chrome** (no border, no background, plain text) in both dark and light themes — verified via
   screenshot (`image-form-buttons-zoom.png`, `image-form-light.png`) and confirmed via
   `getComputedStyle`: `background-color: transparent`, `border: 0px none`, i.e. the browser's
   unstyled reset, not an intentional flat/text-button style. Root cause: `ImageSourceForm.tsx`
   (and the sibling forms it mirrors, `TextSourceForm.tsx`/`PdfSourceForm.tsx`/
   `StaticSourceForm.tsx`) render their own footer using classes `add-source-modal__btn`,
   `add-source-modal__btn--primary`, `add-source-modal__btn--secondary`, and
   `add-source-modal__actions` — **none of which are defined anywhere in the CSS** (confirmed:
   `grep -rn "add-source-modal__btn" --include="*.css" .` returns nothing, on this branch *and*
   on `origin/main`). Meanwhile a proper, token-based button system already exists and is used by
   the REST/CSV/SQL forms via the shared `Modal` component's `footer` prop:
   `frontend/src/shared/ui/Modal.css:142-181` (`.ui-modal-btn`, `--primary`, `--secondary`).
   This is exactly the "reinvented one-off vs. shared component" anti-pattern DESIGN.md warns
   against, and it makes the two primary actions in this ticket's own new form (and its two
   already-merged siblings) visually indistinguishable from plain text — an experienced reviewer
   would reject this. **Fix, scoped to this ticket's own file**: add the missing CSS rules for
   `.add-source-modal__btn` / `--primary` / `--secondary` / `.add-source-modal__actions` to
   `frontend/src/features/sources/ui/AddSourceModal.css` (mirroring `Modal.css`'s existing
   `--app-*`/`--space-*`/`--text-*` token values), which will fix `ImageSourceForm` and, as a
   side effect, restore the sibling `Text`/`Pdf`/`Static` forms' buttons for free since they share
   the exact same class names — no changes needed to the already-merged `.tsx` files themselves,
   keeping the fix additive-only and in scope.

### Non-blocking notes

- The `selectPipelineOutputDataTypes` memoization warning and the 40 pre-existing Scala
  file-size soft-budget warnings are unrelated to this diff — good candidates for separate
  follow-up tickets, not blockers here.
- `start-servers.sh`'s stale-process reuse (noted in evaluation-2.md) did not recur in my
  session — the running backend process (started 15:26:35) postdated the latest commit
  (15:22:05), so I did not need to restart it.
