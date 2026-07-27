## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `specs/workspace-context-assembly/spec.md`, `tasks.md`.
- Read current (pre-change) ground truth:
  - `backend/src/main/scala/com/helio/services/WorkspaceContextService.scala` — confirms `assemble` currently
    composes `dashboardService`, `dataSourceService`, `dataTypeRepo: DataTypeRepository`, `pipelineService`;
    no `DataTypeService` dependency exists yet.
  - `backend/src/main/scala/com/helio/infrastructure/DataTypeRowRepository.scala` — `listRows(dataTypeId)`
    has no `limit` param today; confirms D1's premise.
  - `backend/src/main/scala/com/helio/services/DataTypeService.scala` — `listRows(id, user)` calls
    `dataTypeRepo.findByIdOwned(id, user)` before touching the row repo; confirms D4's owner-scoping
    choke point is real and matches the existing `/rows` route's pattern.
  - `backend/src/main/scala/com/helio/api/routes/DataTypeRoutes.scala` — `/types/:id/rows` route confirmed,
    no pagination param today (matches "today's unbounded behavior" framing).
  - `backend/src/main/scala/com/helio/api/ApiRoutes.scala:143,212` — `dataTypeService` val already exists
    and can be threaded into `WorkspaceContextService`'s constructor; currently only `dataTypeRepo` is passed.
  - `backend/src/main/scala/com/helio/api/protocols/WorkspaceContextProtocol.scala` — confirmed current
    `jsonFormat8` for `WorkspaceContextDataType`, matching the design's jsonFormat8→9 claim.
  - `schemas/workspace-context.schema.json` — confirmed current `DataTypeEntry` shape/`additionalProperties:
    false`, and the codebase's spray-json Option-omission convention documented inline; the planned
    `sampleRows` (always-present, non-Option) correctly avoids that footgun.
  - `grep -rn overwriteRows backend/src/main/scala` — **two** call sites, not one: `PipelineRunService.scala:354`
    (the normal run-success path) and `BoundPanelService.scala:297` (compensating cleanup, clears rows for
    a just-created-then-rolled-back output DataType). Design.md D2 asserts `overwriteRows` "is called
    exactly once" — that's factually wrong, though the substantive claim (never called with a
    source-companion id) still holds after inspecting the second site.
  - `backend/src/main/scala/com/helio/domain/model.scala:453-501` — `DataFieldType` includes `StringBodyType`
    ("plain JSON string, e.g. extracted document text") and `BinaryRefType` ("small JSON object referencing
    a binary"), with an explicit `FieldTypeCategory.Structured`/`Content` split and a `category()` function.
  - `backend/src/main/scala/com/helio/services/ContentSourceSupport.scala` + `DataSourceRoutes.scala:40` —
    confirmed content connectors (HEL-215 text, HEL-214 PDF, HEL-216 image) register a `content` field typed
    `StringBodyType`/`BinaryRefType`, with `TEXT_MAX_FILE_SIZE_BYTES` defaulting to **10,485,760 bytes (10 MB)**.
  - `backend/src/main/scala/com/helio/services/PipelineRunService.scala:307-354` — `jsRows` (the exact
    payload written via `overwriteRows` into `data_type_rows`, i.e. what sample rows will read) is built
    directly from `resultRows`/pipeline step output — so a pipeline whose output schema still carries a
    passed-through `content` field (`StringBodyType`) stores the **full extracted text** (up to the 10 MB
    connector cap) in the row snapshot JSONB blob, not just a reference.
  - `helio-mcp/src/context.ts`, `helio-mcp/src/helioApi.ts` (`getDataTypeRows`, no `limit` param today) —
    confirms D6's "no shared runtime" claim (trivially true, different languages) and that `context.ts`
    needs the parallel additions tasks.md 3.1–3.3 describe.

### Bounding and cost — NOT actually bounded by construction (design-gate attention #1)

Design.md D1/D3 claim the row/column/cell caps make the sample-rows cost "bounded by construction, not by
hope," and specifically frame the SQL `LIMIT` as the mechanism that avoids "a DataType with a 100k-row
snapshot ... a full table scan just to show 5 rows." That defends row **count**. It does not defend row
**byte size**, and the codebase already has a concrete, non-hypothetical field type that breaks the claim:

`StringBodyType` fields (content connectors, HEL-215/214/216) store up to `TEXT_MAX_FILE_SIZE_BYTES`
(10 MB by default) of raw extracted text **directly in the `data_type_rows` JSONB blob** written by
`PipelineRunService.persistRunResults` → `overwriteRows`. Because content DataTypes have very few fields
(`content`/`filename`/`sizeBytes` — see `ContentSourceSupport.metadataFields`), the `content` field is
essentially guaranteed to survive the design's 40-column cap. `SELECT data::text FROM data_type_rows WHERE
data_type_id = $id ORDER BY row_index ASC LIMIT 5` will pull up to **5 × 10 MB = 50 MB** across the wire
from Postgres into the app before the 200-char-per-cell sanitizer ever runs, for a single content-based
pipeline output DataType, on every `GET /api/workspace/context` call. A workspace with several content
pipelines multiplies this. This is exactly the risk the ticket's carried finding #3 says must be "bounded
by construction, not by hope," and design.md's own cost estimate ("Worst case per DataType: 5 × 40 × ~210
bytes ≈ 42 KB") is the *post-sanitization output size*, not the pre-sanitization fetch/memory cost — the
design never mentions `StringBodyType`/`BinaryRefType`/content fields at all.

The codebase already has the hook to fix this cleanly: `DataFieldType.category(t)` returns
`FieldTypeCategory.Structured` vs. `Content` (`model.scala:497`). Design.md needs to explicitly decide (and
tasks.md needs to task) one of: (a) exclude `Content`-category fields from `sampleRows` entirely — which
also better matches the ticket's own stated intent ("tell a boolean flag from a category, an ISO timestamp
from epoch millis," i.e. structured-value preview, not document dumps), or (b) add a real byte-size guard
at the SQL/fetch tier. Silently truncating in Scala after the full blob is already fetched does not satisfy
"bounded by construction."

### Sample-row truncation semantics are underspecified for non-string cells

Given the above, this isn't hypothetical: a cell can legitimately be a `JsObject` (`BinaryRefType`) or a
very large `JsString` (`StringBodyType`). Design.md D3 / tasks.md 2.1 only say "truncate any cell whose
`compactPrint` exceeds 200 chars ... with a marker" — the exact marker text and, critically, what the
*resulting JSON shape* of a truncated non-string cell is (does a `JsObject` become a `JsString` of its
truncated `compactPrint`? does that change the field's apparent type across rows?) are not pinned down.
Since the backend (Scala) and MCP (TS) sanitizers are independently implemented and must match for the
ticket's own "same `sampleRows` shape" acceptance criterion, and since tasks 4.2/4.7 only test the
oversized-*string* case, this ambiguity risks the two implementations silently diverging — the same class
of "underspecified but seemingly obvious" gap that cost a full eval cycle on HEL-371 (spray-json Option
lesson). Needs a concrete, explicit algorithm in design.md plus a test case for a non-string oversized cell.

### RLS / owner-scoping — sound, verified against ground truth

D4's claim holds up: `dataTypeService.listRows(id, user, limit)` (once added) still runs `findByIdOwned`
first, exactly like the existing `/rows` route; `DataTypeRowRepository` itself has no RLS/ownership logic
of its own (`ctx.withSystemContext`), so ownership is enforced solely by the `findByIdOwned` check
upstream — same shape the current unbounded endpoint already relies on. The new `?limit=` query param
cannot be used to manipulate `id`/`user`, so it introduces no new cross-tenant surface. No gap found here.

### Sensitive-data exposure (D5) — reasoning holds, but its scope changes given the finding above

D5's argument ("every read stays owner-scoped, so this is a user's own data reaching their own already-PAT
-gated agent call") is sound as far as it goes, and is arguably *stronger* than stated: a user can already
pull the full unbounded row snapshot today via `GET /api/types/:id/rows` directly, so aggregating a bounded
slice into `/workspace/context` isn't a new capability, just added convenience. However, the bounding gap
above means the *practical* content of what's exposed is different from what D5 appears to assume — full
extracted document text landing in every workspace-context call (and therefore every LLM prompt built from
it) for content-based pipelines is a materially different sensitivity/cost profile than "a boolean flag vs.
a category" scalar preview. I'm not requiring redaction/opt-out (out of scope per the ticket, and D5's
core reasoning is fine) — but resolving the Content-category exclusion above also resolves this concern for
free, and design.md should say so explicitly rather than leaving D5 written as if scalar values were the
only case in play.

### Other checks

- Schema/spray-json: `sampleRows` is correctly designed as always-present (never `Option`), matching the
  codebase's documented Option-omission lesson — confirmed against the existing schema's own inline
  descriptions for `sourceId`/`tag`/`stepsError`, which all use the pattern this ticket correctly avoids.
- `tasks.md` vs. `design.md`: D1–D6 are each covered by at least one task, including the RLS regression test
  (4.4) and MCP parity test (4.7). The one implicit gap: no task explicitly calls for adding a
  `dataTypeService: DataTypeService` constructor param to `WorkspaceContextService` and updating the
  `ApiRoutes.scala:212` wiring site — minor, an obvious corollary of task 2.2, but worth a line given how
  granular the rest of tasks.md is.
- Extension seam for HEL-373 (column stats): the `dt.sourceId.isEmpty` branch plus the optional `limit` on
  `DataTypeService.listRows`/`DataTypeRowRepository.listRows` (defaulting to unbounded) gives HEL-373 a
  clean, independent path to request a different row set for aggregation without touching this ticket's
  `sampleRows` field or sanitizer. No seam concern.

### Verdict: REFUTE

### Change Requests

1. **Fix the bounding/cost claim for Content-category fields.** Design.md must explicitly account for
   `DataFieldType.category == Content` (`StringBodyType`/`BinaryRefType`) fields, which can carry up to
   `TEXT_MAX_FILE_SIZE_BYTES` (10 MB default) of raw text directly in the `data_type_rows` snapshot that
   `sampleRows` reads from — the current `LIMIT 5` bounds row count only, not bytes fetched. Decide and
   document one of: (a) exclude `Content`-category fields from `sanitizeSampleRows`'s column projection
   entirely (preferred — matches the ticket's stated "tell a flag from a category" intent, and is a small
   addition to the existing 40-column-cap projection using the already-available `DataFieldType.category`
   hook), or (b) add a real fetch-tier byte guard. Update D3's worst-case cost estimate once decided, and
   add a task + test exercising a pipeline-output DataType with a `Content`-category field.
2. **Pin down the truncation-marker algorithm for non-string cells.** Design.md D3/tasks.md 2.1 need to
   state precisely what happens when a non-`JsString` cell's `compactPrint` exceeds 200 chars (exact marker
   text; whether/how the cell's JSON type changes on truncation), so the independently-implemented Scala and
   TS sanitizers can't silently diverge and violate the ticket's "same `sampleRows` shape" acceptance
   criterion. Add a test case for an oversized non-string cell to tasks 4.2 and 4.7 (currently only the
   oversized-string case is tested).
3. **Correct design.md D2's factual claim.** `overwriteRows` is called from two sites, not one:
   `PipelineRunService.scala:354` (run success) and `BoundPanelService.scala:297` (compensating cleanup,
   clears rows on a just-created-then-rolled-back output DataType). The substantive point (never called
   with a source-companion id) still holds after checking the second site, but "called exactly once" should
   be corrected to avoid an inaccurate ground-truth claim standing in the design record.
4. **Minor tasks.md gap.** Add an explicit task item for threading a new `dataTypeService: DataTypeService`
   constructor dependency into `WorkspaceContextService` and updating the `new WorkspaceContextService(...)`
   call site in `ApiRoutes.scala:212` (the `dataTypeService` val already exists there and is trivially
   reusable) — implicit in task 2.2 today but worth making explicit given the granularity of the rest of the
   task list.

### Non-blocking notes

- Once Change Request 1 is resolved, D5's redaction rationale should be updated to note that excluding
  Content-category fields also narrows the sensitive-data-exposure surface for free — strengthens rather
  than weakens the existing "no redaction affordance needed" argument.
- Consider whether `GET /api/types/:id/rows`'s `rowCount` field should report the pre- or post-`limit`
  count when `?limit=` is passed (currently `rows.size`, which becomes the truncated count) — not required
  by the ticket, but worth a one-line decision in design.md so the executor doesn't have to guess.
