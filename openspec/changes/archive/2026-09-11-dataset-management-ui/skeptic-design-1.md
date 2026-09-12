## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=feature/dataset-management-ui-schema/HEL-1079`.
- Read all five planning artifacts (`ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/dataset-management-ui/spec.md`) and the binding backend contract
  `openspec/specs/dataset-schema-api/spec.md`.
- Create path, end to end, from the actual code: `StaticSourceForm.tsx:9,15,121` →
  `AddSourceModal.tsx:187-204` (`handleCreateStatic`) → `sourcesSlice.createStaticSource` →
  `dataSourceService.ts:112-124` (`POST /api/data-sources`, body `{name,type:"dataset",columns,rows}`)
  → backend `DataSourceProtocol.scala:243-249` (`StaticColumnPayload`) →
  `DataSourceService.scala:104-140` (`createStatic`).
- Canonical type set: `types/dataSource.ts:159` (`StaticColumnType`, 4 types), `:237-244`
  (`DatasetFieldType`, 7 types); backend `model.scala:682-690`, `:705-736`
  (`canonicalizeLegacy`, `validateAndCanonicalize`, `CanonicalWireValues`).
- Schema API surface actually available to the UI: `dataSourceService.ts:381-401` — exactly two
  functions, `fetchDatasetSchema` (GET) and `updateDatasetSchema` (PATCH). No dry-run/preview
  route exists, confirming design.md's premise on that one point.
- `DatasetSchemaResponse` shape: `types/dataSource.ts:256-258` — `{ fields: DatasetFieldResponse[] }`,
  and `DatasetFieldResponse` (`:249-254`) is `name/type/required/default` only.
- Row count availability: `datasetRowsSlice.ts:40` (`total`), fed from `RowListResponse.total`
  (`types/dataSource.ts:225-229`).
- Editor-kind mapping reused by Decision 5: `useDatasetFieldEditor.ts:14-26` — `binary-ref` →
  `"readonly"`. Decision 5 is sound as written.
- Detail-view surface: `SourceDetailPage.tsx` (`/sources/:id`) → `SourceDetailPanel.tsx:275-280`
  renders `DatasetRowGrid` for `type === "dataset"`. Placing the schema-edit panel here is sound.
- Post-create navigation: `AddSourceModal.tsx:104-112` (`finishCreate`) and `SourcesPage.tsx:154`.
- e2e template exists: `e2e/hel1080-dataset-row-grid-live.spec.ts`.

### Verdict: REFUTE

Decisions 1, 2 and 5 hold up (see Non-blocking notes). The blocking problems are a direct
proposal/spec-vs-design contradiction, a drop-confirmation trigger that does not match the backend
policy, an unplanned type widening the create path structurally requires, and incomplete spec
coverage of paths this UI can actually reach.

### Change Requests

1. **Resolve the contradiction between spec.md's "preview" requirement and design.md Decision 3.**
   spec.md's requirement "Schema edit previews the declared-schema API's decision before commit"
   and its scenarios mandate a genuine pre-submit preview that *blocks submission*: "the preview
   flags this as blocked and requires the user to supply a default before it becomes submittable"
   and "the preview calls the schema API's validation path and … blocks submission until resolved".
   design.md Decision 3 mandates the opposite — no preview, submit and render the 409 inline.
   A competent implementer can read these two ways, which is exactly what this gate exists to
   catch. Additionally, "the preview calls the schema API's validation path" is not implementable:
   `dataSourceService.ts:381-401` exposes only `fetchDatasetSchema` and `updateDatasetSchema`, and
   `dataset-schema-api/spec.md` defines no dry-run route. Rewrite one artifact so both agree, and
   state per case which mechanism applies.
2. **Attempt-then-surface is over-applied; two of the four rejection cases are computable
   client-side and must be, per the ticket's "make it visible rather than failing at write time".**
   design.md concedes client-side prediction only for drop. But *add required field with no
   default to a non-empty dataset* needs nothing but the dataset row count (already in
   `datasetRowsSlice.ts:40`) — its rejection is fully determined before any request
   (`dataset-schema-api/spec.md`, "Adding a required field requires a default on a non-empty
   dataset"). Retype genuinely requires the server (per-value check) and tighten-to-required
   requires per-field null coverage across *all* pages (the grid is paged, so not reliably
   available) — attempt-then-surface is defensible for those two. Split the four cases explicitly:
   predicted-and-blocked-before-submit vs. attempt-then-surface, and say why for each.
3. **Decision 3a's drop-confirmation trigger does not match the backend policy, and rests on a
   false premise about the API.** The backend rule is *dataset has ≥ 1 row*, not *this field holds
   data*: "Dropping a declared field from a dataset with at least one existing row … unless the
   request sets `confirmDrop: true` — unconditionally, regardless of whether the field's existing
   values happen to all be null." design.md 3a triggers on a field that "has any existing dataset
   rows" and spec.md's scenario says "removes a field that has at least one existing row **with
   data in that dataset**". Implemented literally, dropping an all-null column on a non-empty
   dataset shows no confirmation and PATCHes without `confirmDrop` → an unexpected 409 in the one
   path Decision 3a claims can never 409; the worse repair is auto-setting `confirmDrop: true`,
   which is precisely the "silent flag" the ticket forbids. Restate the trigger as
   `datasetRowCount > 0`, full stop. Separately, "`fetchDatasetSchema`'s current
   row-count-bearing field list" is false — `DatasetSchemaResponse` is
   `{ fields: [{name,type,required,default}] }` (`types/dataSource.ts:249-258`) and carries no
   count; the count is `datasetRowsSlice`'s `total` (`:40`), as 3a's own parenthetical says,
   contradicting its own sentence. Fix the premise, and restate task 2.3's tests as
   non-empty-dataset vs. zero-row-dataset (not per-field-has-data).
4. **The create path cannot carry the 7 canonical types or `required`/`default` as typed today,
   and no task widens it.** Task 1.3 says carry `required`/`default` "through to
   `DatasetFieldDeclarationPayload` on submit" — but the create path never touches that type. The
   real chain is `StaticSourceForm.onSubmit(columns: StaticColumn[])`
   (`StaticSourceForm.tsx:15`) → `handleCreateStatic` (`AddSourceModal.tsx:187`) →
   `createStaticSource` (`dataSourceService.ts:112`) → `StaticColumnPayload`, and
   `StaticColumn.type` is `StaticColumnType` = `"string"|"integer"|"float"|"boolean"`
   (`types/dataSource.ts:159,164`). `timestamp`/`string-body`/`binary-ref` will not type-check.
   The backend is ready — `DataSourceService.createStatic` validates each column via
   `DataFieldType.validateAndCanonicalize` against all seven `CanonicalWireValues`
   (`DataSourceService.scala:111-121`, `model.scala:722-736`) and already builds
   `DatasetFieldDeclaration(name, type, required, default)` with `validateDefault` enforced
   (`:126-136`), and `StaticColumnPayload` already has `required`/`default`
   (`DataSourceProtocol.scala:243-248`). Add an explicit task: widen `StaticColumn.type` to
   `DatasetFieldType` (or move the create payload onto the declaration shape) and name which,
   with the wire body it produces.
5. **The HEL-891 `double` guard is scoped to the place it cannot bite.** Task 1.1's grep is
   limited to "the touched files", where a competing literal would not appear anyway. The actual
   hazard is that the backend *accepts* `double` and silently rewrites it to `float` —
   `canonicalizeLegacy` (`model.scala:705-710`) maps `"number"|"double" => "float"`, and
   `createStatic`'s own comment states "a legacy synonym like \"double\" is ACCEPTED, not
   rejected" (`DataSourceService.scala:124-126`). So nothing server-side will ever tell the UI it
   sent a non-canonical type. Strengthen to: a repo-wide grep over `frontend/src` for canonical-type
   array literals, plus a test asserting `CANONICAL_FIELD_TYPES` equals the backend's
   `CanonicalWireValues` in content and order.
6. **spec.md's scenarios are incomplete against the policy its own requirement cites.** Missing,
   all reachable from this UI: (a) **rename** — an explicit ticket AC (ticket.md:19, "metadata-only,
   safe") with no scenario at all; (b) **reorder on an existing dataset** — the only reorder
   scenario is create-flow, while the backend rewrites every row and returns
   `rowsMigrated = rowCount`; (c) **all-or-nothing multi-field rejection** — the backend rejects
   the whole request if any field is rejected, so the UI must never present partial success;
   (d) **drop on a zero-row dataset requires no confirmation** (the negative case task 2.3 tests
   but nothing specifies); (e) **the 400 structural family** — notably "a rename target that
   collides with a field simultaneously being dropped", which is a natural user action in this
   editor (rename A→B while removing existing field B) and returns a `400` whose body is *not*
   `SchemaUpdateConflictResponse`, so task 2.4's parser and Decision 3's inline-reason rendering
   (both 409-shaped) would drop it into an unhandled/bare error; (f) `rowsMigrated` messaging —
   task 2.2 toasts it, and a pure rename returns `0`, so state what the user is told.
7. **Reorder-by-buttons needs its focus and announcement behavior specified, or it reproduces the
   exact HEL-1080 lesson the plan cites.** Decision 2's choice is right, but moving a field to
   position 1 disables its own "Move up" button — focus is then lost, and tasks.md 3.2 itself
   names "`.focus()` on a still-disabled control silently no-ops". Specify the post-reorder and
   post-remove focus target (keep focus on the moved row's control, or don't disable at the
   boundary — pick one) and a live-region announcement of the field's new position, each with a
   test. Same for focus after the confirm-drop dialog closes.
8. **spec.md's create scenario asserts navigation that does not happen.** "…and the user is taken
   to its detail view" — `finishCreate` (`AddSourceModal.tsx:104-112`) only refetches, sets
   `selectedSourceId`, toasts and calls the optional `onCreated`; `SourcesPage.tsx:154` renders
   `AddSourceModal` with **no** `onCreated`, so nothing navigates to `/sources/:id`. Either drop
   the clause or add a task that implements the navigation.

### Non-blocking notes

- Decision 1 (extend `StaticSourceForm` in place) is sound, not merely convenient. `finishCreate`
  is a deliberately centralized 7-call-site convergence point carrying the HEL-535 D6 toast-dedup
  fix (`AddSourceModal.tsx:93-112`); a standalone route would have to re-derive it. The Risks
  section's mitigation (extract the field table into its own shared component) is the right
  containment. Note the form also owns a "rows" step that the field editor must keep consistent
  on reorder — `removeColumn` already re-slices rows (`StaticSourceForm.tsx:43-46`) but there is
  no reorder equivalent; worth a line in the design.
- Decision 5 (`binary-ref` has no `default` input) checks out against
  `useDatasetFieldEditor.ts:14-26`.
- Task group 4's e2e coverage is genuinely adequate on the two points raised at spawn: 4.1 uses
  real keyboard input against a live backend, 4.2 hits a real 409, 4.3 exercises confirm-drop and
  verifies the data is gone by re-fetching. Minor: 4.2's "e.g." offers two alternatives — pin one
  so it can't quietly become whichever is easier.
- Task 1.1's "in `types/dataSource.ts` or a small util" is an unresolved either/or; pick one.
