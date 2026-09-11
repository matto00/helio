## Context

Backend row CRUD (HEL-1077/1078/1121) and the declared-schema domain model (HEL-1076,
`DatasetFieldDeclaration` on `data_sources.dataset_schema`) already exist, but no route exposes
that declared schema (HEL-1122 — folded into this delivery by driver instruction, since the grid
cannot render typed columns/editors without it). `frontend/src/shared/ui/DataGrid.tsx` is the
existing shared grid component (used by table panels) — this ticket reuses it rather than
building a new grid.

Verified conflict-response gap: `RowMutationFailure.StalePrecondition` (repository layer) and
`ServiceError.Conflict` (service layer, `patchRow`/`deleteRow`) carry only a string message and
the conflicting `updatedAt` timestamp — **not** the row's current field data. Extending that
wire shape is out of scope for this change (it would touch HEL-1078's already-shipped, tested
contract for a UX-only need); see Decision 3.

**Verified: the shared `DataGrid` (`frontend/src/shared/ui/DataGrid.tsx`) is a plain `<table>`
with a per-cell `render` hook only** — no grid ARIA role, no cell focus management, no edit
mode, no keyboard cell-navigation, and it virtualizes (renders only visible rows) once a table
exceeds 150 rows (`useVirtualRows`). Five existing screens (table panels, sources list, etc.)
consume it today. This changes the shape of Decisions 1 and 4 below versus the original draft,
which assumed more built-in grid behavior than exists.

**Verified: `/sources/:id`** (`SourceDetailPage` → `SourceDetailPanel`) is the existing route for
a single source, and already renders a read-only "Preview" `DataGrid` for CSV/REST kinds. This
is where the row grid mounts (Decision 7).

**Verified: server-side row validation returns `ServiceError.BadRequest` → HTTP `400`** (not
`422`) with a single joined string message (`DatasetRowValidator.validate`'s `Left[Vector[String]]`,
joined `"; "` by the caller) — not a structured per-field error list. This changes Decision 3's
mapping and adds a new decision (Decision 3a).

**Verified: `dataset_schema` field types include `BinaryRefType`** (`DataFieldType.BinaryRefType`),
which stores a JSON object reference, not a scalar — this changes the "every field type is flat"
premise from the original draft (see Decision 6).

**Verified: `e2e/focus-presence-guard.spec.ts`'s `routes` array is `["/", "/sources",
"/pipelines/:id", "/settings"]`** — it does not visit `/sources/:id` today, so an unmodified run
of that spec proves nothing about this grid's focus conformance (Decision 9).

## Goals / Non-Goals

**Goals:**
- Grid: view (paged), inline edit, delete, add-row over a dataset source's rows.
- Declared-schema-driven editors and required-field/type validation.
- Recoverable stale-edit UX with no data loss on conflict.
- Full keyboard operability + a11y (focus-presence-guard conformance).

**Non-Goals:**
- Schema *editing* (declaring/changing fields) — read-only consumption of the declared schema.
- Bulk import/export.
- Extending the existing `patchRow`/`deleteRow` 409 wire contract (see Decision 3).

## Decisions

### Decision 0: Grid interaction model — `DataGrid` gains opt-in grid/a11y props (owner ruling)
**Owner ruling (2026-09-11, standing constraint C1 in `workflow-state.md`), superseding this
change's own round-1/round-2 draft attempts to build the keyboard pattern as a pure external
wrapper.** Two design-gate rounds independently confirmed a wrapper cannot work: `DataGrid`'s
per-cell `render` hook returns only cell *content* (`ReactNode`) — it has no way to attach
`role`/`tabindex`/`aria-*` to the `<tr>`/`<td>` elements `DataGrid` itself renders, and an
external `role="grid"` wrapper around `DataGrid`'s own `<table>` would produce an invalid ARIA
tree (a `<table>` between the grid role and its rows).

`DataGrid.tsx` itself gains a new, **default-off** prop group, active only when explicitly
supplied (existing 5 consumers pass none of these and are unaffected):

```ts
interface DataGridGridModeProps {
  /** Opts into role="grid"/"row"/"gridcell" + roving-tabindex keyboard nav. Absent = today's plain table. */
  gridMode?: boolean;
  /** Which (rowId, columnKey) cell currently holds the roving tabindex / visual focus. */
  activeCell?: { rowId: string; columnKey: string } | null;
  /** Fired on arrow-key/Tab navigation; DataGrid computes the next cell, the caller owns state. */
  onActiveCellChange?: (next: { rowId: string; columnKey: string } | null) => void;
  /** Row id accessor — required when gridMode is true (DataGrid has no built-in row-id concept otherwise). */
  rowId?: (row: Record<string, unknown>) => string;
}
```

When `gridMode` is true, `DataGrid` renders `role="grid"` on its `<table>`, `role="row"` on each
`<tr>`, `role="gridcell"` on each `<td>`, and manages `tabindex` itself (`0` on the cell matching
`activeCell`, `-1` on every other cell) — this is the one piece that MUST live inside `DataGrid`,
since it alone renders those elements. `DataGrid` also handles arrow-key `keydown` on the table
body when `gridMode` is set: it computes the next `{rowId, columnKey}` and calls
`onActiveCellChange`; it does **not** itself decide what "editing" means — entering/exiting edit
mode, `Enter`/`F2`/`Escape` handling, and the actual editor rendered per cell stay in the
`DatasetRowGrid` wrapper via the existing `render` hook (which, for the active editable cell,
returns an inline editor from `useDatasetFieldEditor` instead of static text). `Delete`/
`Backspace` triggers the wrapper's row-delete action **only when no cell is currently in edit
mode** (a plain keydown listener on the wrapper, gated on wrapper-owned edit state — this does
not need to live in `DataGrid`, since it's a wrapper-level action, not a navigation primitive).
`Tab`/`Shift+Tab` exits the grid to the next/previous focusable page element (native browser tab
order once no cell holds the roving `tabindex="0"` target — `gridMode` never traps Tab). A
dedicated "Add row" button (not a keyboard shortcut, to avoid a conflicting binding) appends a
row. `Enter` (when not editing) or `F2` enters edit mode on the active cell; `Enter` (while
editing) commits and moves the active cell down one row (matching common spreadsheet/grid
convention); `Escape` cancels and restores the pre-edit value.

**Tab/Shift+Tab and blur while editing (fixing a gap in the round-3 draft):** while a cell is in
edit mode, its inline editor element is itself a focusable child *inside* that `gridcell` — the
active cell's own `tabindex="0"` sits on the `<td>`, not the editor, so an ordinary
`Shift+Tab` from inside the editor would land the browser's native tab order on that same
`<td>` (or the previous DOM-order focusable element), not outside the grid, breaking the "Tab
exits the grid" requirement. The wrapper therefore attaches its own `keydown` handler to the
active editor specifically (not just the grid body) that intercepts `Tab`/`Shift+Tab` while
editing: it commits the in-progress edit first, then **programmatically** moves focus to the
next/previous focusable element outside the grid (`element.focus()` on the resolved target,
computed the same way native Tab would resolve it), rather than letting the browser's default
Tab traversal run from inside the editor. **Blur** (the editor loses focus for any other reason
— a mouse click elsewhere, a programmatic focus change) commits the in-progress edit exactly
like Tab, rather than silently discarding it or leaving it in an ambiguous half-committed state
— consistent with Tab's behavior, and simpler than adding a third, distinct blur-specific rule.

**`DatasetRowGrid` uses `variant="preview"`, never `"full"`.** Verified: `resizable`/`sortable`/
`filterable`/`pinnable` are all gated on `variant === "full"` — the `"full"` variant's per-column
resize-handle (`tabIndex={0}`, `DataGrid.tsx:~1005`) and pin-toggle button each add their own tab
stop, which would land `Shift+Tab` from the active cell on a header control instead of leaving
the grid, and would give the grid more than one `tabindex="0"` element at once (breaking the
roving-tabindex invariant `gridMode` depends on). `"preview"` renders none of these controls, so
`gridMode` on `"preview"` has exactly one interactive tab stop: the active cell. Task 4.1 adds a
test asserting exactly one element inside the grid has `tabindex="0"` at all times.

**Regression check (owner-mandated, task 2.3), named precisely:** the 5 real existing `DataGrid`
consumers, verified by import (not "table panels, sources list, etc." — that list included a
non-consumer and omitted two real ones): `frontend/src/features/panels/ui/renderers/
TableRenderer.tsx`, `frontend/src/features/sources/ui/SourceDetailPanel.tsx` (its own *existing*
Preview usage, distinct from the *new* `DatasetRowGrid` usage this change adds — see Decision 7),
`frontend/src/features/sources/ui/forms/SqlTab.tsx`, `frontend/src/features/connectors/ui/
ConnectorsPage.tsx`, and `frontend/src/features/pipelines/ui/StepCard.tsx`. The "before" snapshot
for each MUST be captured from `main` (i.e. committed and diffed against, or captured in a
separate commit before the `DataGrid.tsx` prop change lands) — a snapshot generated after the
change would only prove the after-state matches itself, not that nothing changed. Each snapshot
asserts the rendered DOM's `role`/`tabindex` attributes (or full DOM, whichever the test harness
captures more precisely) are identical with `gridMode` omitted.

### Decision 0a: Virtualization is structurally avoided by `variant="preview"`; pagination is
explicit-cursor, not implicit
**Correcting the round-2/round-3 framing of this decision:** `DataGrid` only ever engages
`useVirtualRows` windowing when `variant === "full"` (verified: `const virtualized = variant ===
"full" && rows.length > VIRTUALIZATION_ROW_THRESHOLD`, `DataGrid.tsx:598` — the exported constant
is `VIRTUALIZATION_ROW_THRESHOLD = 150`, `DataGrid.tsx:196`). Decision 0 already mandates
`variant="preview"` for `DatasetRowGrid` (to avoid the `"full"` variant's resize-handle/pin-toggle
extra tab stops) — so this grid **never virtualizes, structurally, regardless of row count**,
not because of a page-size coincidence. This makes the earlier "un-buildable virtualization vs.
focus interaction" concern moot for `DatasetRowGrid` specifically: there is no case where a row
on the current page is unmounted out from under keyboard focus, because `"preview"` never
unmounts any row on the current page. Task 5.8 accordingly asserts `DatasetRowGrid` always passes
`variant="preview"` to `DataGrid` (a test that fails if this is ever changed to `"full"`) — this
is the actual guarantee, not a coupling to a numeric page-size threshold.

The row-listing page size for this grid is still fixed at a named constant
(`DATASET_GRID_PAGE_SIZE = 100`), passed explicitly on every `fetchDatasetRowsPage` call (never
the row-listing API's own default) — but now purely for a UX/performance reason (a page stays
comfortably single-viewport-scale, and clearly separate from `DataGrid`'s own "first 50 rows"
default-column-derivation heuristic), not to dodge virtualization. The row-listing API's true
ceiling (`Page.MaxLimit = 500`) is irrelevant here; this grid deliberately requests well under it.

Because the row-listing API is cursor-paged (`GET .../rows` returns only a `nextCursor` — there
is no "previous cursor" concept on the wire), the wrapper/slice maintains its own **stack of
seen cursors** per source id (`cursorStack: (number | null)[]`, index 0 = the first page's
`null`/absent cursor): "Next" pushes `nextCursor` onto the stack and fetches with it; "Prev" pops
the stack and re-fetches using the cursor now on top (a cheap re-fetch, not a no-op cache read —
acceptable given this is a rare, explicit user action, not a hot path). The Refresh action
(Decision 8) and the conflict re-fetch (Decision 3) both re-fetch using the **current** top of
this stack, not page 1, so they land the user back where they were. Paging is an explicit
**pager control** (Prev/Next + a 1-based page indicator derived from `cursorStack.length`), not
infinite scroll, for the same reason as before: one mechanism deciding what's mounted, not two.

**Add-row placement:** a newly added row is appended server-side (`POST .../rows`, append mode)
and, since dataset rows are ordered by an increasing `seq`, always lands on the **last** page.
After a successful add, the wrapper pages forward to the last page (repeatedly following
`nextCursor` until it's `None`, pushing each onto `cursorStack`) so the user sees the row they
just added rather than being left looking at an unrelated page with no visible feedback.

**Scope boundary on "cell-level focus survives virtualization" (correcting C1's phrasing
against what this change actually builds):** this change satisfies that requirement for
`DatasetRowGrid` specifically because virtualization is `"full"`-variant-only (Decision 0a) and
`DatasetRowGrid` always uses `"preview"` — there is structurally no off-screen/unmounted-row case
for this consumer to survive, independent of page size. This change does **not** add
virtualization-awareness to `gridMode` for the `"full"` variant (e.g. an API for a future
`"full"`+`gridMode` consumer to force a specific row to stay mounted past the 150-row threshold)
— that remains a real gap for any *other* future consumer that wants both `gridMode` and
`"full"`'s virtualization at once. That gap is out of this change's scope and does not block it
(`DatasetRowGrid` never uses `"full"`), but it is a real, named limitation, not silently
resolved — worth a follow-up ticket if a future consumer needs `gridMode` on `"full"`, rather
than being implied to already exist.

### Decision 1: Declared-schema route is additive on the source, not the row endpoint
`GET /api/data-sources/:id/schema` is a new, separate route rather than embedding the schema on
every row-listing response (which would repeat the same schema on every page). It reuses
`findByIdOwned` (same ACL / HEL-1002 not-found convention as every other row route) and 400s on
a non-`dataset`-kind source. Wire shape: `DatasetSchemaResponse(fields: Vector[DatasetFieldResponse])`
where `DatasetFieldResponse(name: String, `type`: String, required: Boolean, default: Option[JsValue])`
mirrors `DatasetFieldDeclaration` field-for-field. `default` is `Option[JsValue]`, tested for
spray-json's Option=None-when-absent behavior (not `null`) per the CLAUDE.md-documented trap.
Existing `StaticSourceResponse` (the dataset-kind entry in `GET /api/data-sources` /
`GET /api/data-sources/:id`) is untouched — no new field added there, so no existing consumer
(frontend list view, MCP `data-source` tools) needs to change.

### Decision 2: RLS verification for the new read path
The new route reads the same `data_sources` row `findByIdOwned` already reads for every other
row route (no new table, no new column beyond the already-shipped `dataset_schema`) — it does
not touch `data_sources` "differently" from the existing, already-RLS-verified row routes. No
new RLS policy work is required; the executor will still run the route's integration test
against the project's non-superuser RLS-enforcing test path (documented in
`project_rls_testing_parity_gap`) as a regression check, not because this route's shape is new.

### Decision 3: Stale-conflict recovery re-fetches, rather than extending the 409 body
Rather than extend `RowMutationFailure.StalePrecondition`/`ServiceError.Conflict` to carry the
row's current data (a change to HEL-1078's already-shipped, tested precondition contract, used
by both `patchRow` and `deleteRow`), the frontend recovers by re-fetching the row's current page
via the existing paged `GET .../rows` on a `409`, locating the row by `id` in that page (rows are
paged by a stable `seq` cursor, so the edited row is expected on the same page it was loaded
from), and displaying its current value with retry/discard.

**The current value is always taken from this follow-up `GET`, never from the 409 response
itself** — the spec (dataset-row-grid, "Concurrent edit detected") is corrected to say so
explicitly (it previously said "the grid shows the row's current value from the server
response", which read as the 409 response and contradicted this decision).

**Retry re-applies only the user's edited cells, on top of the re-fetched current row** — never
the user's full stale row — so a retry cannot silently clobber a *different* cell another client
changed concurrently in the same row. The wrapper tracks which cell(s) the user actually edited
(not the whole row snapshot) and constructs the retry `PATCH` body as `current row data with
those specific cells overwritten by the user's edits`, sent with the re-fetched row's
`updatedAt` as the new precondition.

**Delete has its own conflict scenario**, added to the spec: if a delete's `409` occurs, the
same re-fetch runs; if the row is still present (concurrently edited, not deleted), show its
current value with a "delete anyway" (retry, with the fresh `updatedAt`) or discard action; if
the row is absent from the refetched page (concurrently deleted by someone else), the grid shows
"row was already deleted" and removes it from the grid with discard only — there is nothing left
to retry against.

Trade-off: an extra round-trip on conflict (rare path) instead of widening a shipped API's error
contract for a UI-only need.

### Decision 3a: Server-side field validation errors are parsed from the 400 message
`DatasetRowValidator.validate` returns a `Left[Vector[String]]` of already-formatted messages
(row-then-field order, joined `"; "` by the service into a single `ServiceError.BadRequest`
string) — there is no structured per-field error list on the wire. Extending this shape is out
of scope for this change for the same reason as Decision 3 (it's `DatasetRowValidator`'s
existing, tested contract, shared with the bulk row-write path).

**Verified exact templates** (`DatasetRowValidator.renderRowFailures`, the actual per-edit path
— `renderDefaultError`, referenced in an earlier draft of this decision, is a *different* method
used only for declaration-time default-value errors, which a row edit never produces):
- Required-field: `row <idx>: field '<name>' is required`
- Type mismatch: `row <idx>: field '<name>' — <reason>` (e.g. `expected integer, got string`)
- Row-length mismatch: `row <idx>: expected <n> fields, got <m>`

The frontend parses these three templates specifically (a `field '([^']+)'` match recovers the
field name for the first two; the row-length case has no single field to attach to and always
renders as a grid-level banner, not a cell error) to attach an error to the offending cell. An
unparseable message (a future validator change alters the format) falls back to the same
grid-level error banner rather than silently dropping the error — this fallback path is a
tracked, not silent, degradation and gets its own test (task 5.9).

**Emptying a cell always means "submit `JsNull`" — never `""` — and is blocked client-side
exactly when the server would reject it.** `DatasetRowValidator.validateRow` treats `JsNull`
specifically (not `""`, not "falsy") as "use the field's `default` if one is declared; only fail
as `required` when there is no default." A naive implementation that lets a `StringType`
editor's ordinary backspace-to-empty pass through as `""` would defeat "required fields can't be
emptied" entirely, since `""` is a valid, non-missing string value the server accepts
unconditionally (`DatasetRowValidator.scala:67` — this was round-3's fix's own regression,
corrected here). The rule, unified across every editor type:

- **Every editor's "emptied" state (backspaced-to-`""` for `StringType`/`StringBodyType`,
  cleared for `IntegerType`/`FloatType`/`TimestampType`, unset for `BooleanType` — there is no
  meaningful "empty" `BooleanType`, so it is excluded from this rule and always has a value) is
  treated as a clear attempt, uniformly, submitting JSON `null` if allowed at all** — there is no
  separate "typed empty string" outcome distinct from "cleared" for these editors. This is
  simpler than round 3's draft (which tried to distinguish an explicit "clear" affordance from
  ordinary backspacing) and closes the gap that draft left open.
- **A required field with no declared default blocks this entirely, client-side, before
  submission**: the editor's emptied/cleared state renders a validation error on the cell and
  the edit is not submitted (matching the corrected spec scenario, "Required field with no
  default cannot be emptied" — now enforced for every field type, not only ones a user might
  think to send `null` for).
- **A required field with a declared default, or any non-required field, allows the clear**:
  the wrapper submits `null` for that cell, and the server either fills the declared default
  (required-with-default) or persists `null` (non-required) — matching existing, already-tested
  server behavior in both cases.

### Decision 4: Pessimistic updates for edits, delete, and add-row (amended, skeptic-final-1.md
CR6; pending-state wording corrected, skeptic-final-2.md CR-F)
**Amended from this document's earlier "optimistic edits" draft, which was never actually built —
the shipped `patchDatasetRow` thunk only sets a `pending` flag and updates `rows` on
`.fulfilled`, applying nothing before the server confirms.** Rather than retrofit true optimistic
apply-then-rollback onto a flow that already has real interaction complexity (client-side
required/type validation, the 409 stale-conflict re-fetch-and-retry loop, and the roving-focus
cell editor unmounting on commit), this change keeps ALL THREE mutations — cell edits, delete,
and add-row — pessimistic: nothing changes in the UI until the server confirms. A brief pending
indicator on a database-editing surface is a smaller cost than the bug surface true optimistic-
with-rollback would add here — a stale-conflict retry, for instance, would otherwise have to
reconcile "what the optimistic UI showed" against "what the server actually had" on TOP of the
already-nontrivial edited-cell-only-retry logic (Decision 3). Nothing about the interaction budget
for a row-by-row grid edit is latency-sensitive enough to justify that added risk; a future ticket
can add true optimism if a measured need arises.

**What the pending indicator actually is, precisely (corrected — the prior text said "cell/row/
toolbar... disabled or dimmed", which overstated what existed at the time):** every cell in a row
with an in-flight edit OR delete renders a `"Saving…"` span (`DatasetRowsSourceState.pending` is
keyed by row id, not by which mutation is in flight, so a delete's pending state is visible the
same way an edit's is — this was already true, just previously undocumented). The "Add row"
button itself shows `"Saving…"` and is disabled while its own append is in flight (skeptic-final-2
CR-F fix: previously neither was true, so a double-add was possible). This is a decision-and-code-
agreement fix, not a scope cut: every mutation the ticket describes (edit, delete, add-row) is
built, tested, and pessimistic consistently, with its own real observable pending state.

### Decision 5: Redux slice shape
`datasetRowsSlice`: `schema` (by source id), `rows` (paged, by source id + page), `pending`
edits (by row id), `conflicts` (by row id, holding the refetched current value). Thunks:
`fetchDatasetSchema`, `fetchDatasetRowsPage`, `patchDatasetRow`, `deleteDatasetRow`,
`appendDatasetRow`. Presentational `DatasetRowGrid` component wraps the shared `DataGrid`,
receiving cell-editor selection from `schema` via a `useDatasetFieldEditor` hook.

### Decision 6: Cell editor per declared field type, including `BinaryRefType`
`useDatasetFieldEditor` maps every `DataFieldType` value to a concrete editor: `StringType` →
text input, `IntegerType`/`FloatType` → numeric input with type-appropriate validation,
`BooleanType` → checkbox/toggle, `TimestampType` → a date/time input, `StringBodyType` → a
multi-line text editor. **`BinaryRefType` is read-only in this grid** — it stores a JSON object
reference (e.g. an uploaded file pointer), not an editable scalar, and this change does not add
a file-picker/upload editor to the row grid. A `BinaryRefType` cell renders its reference (e.g.
a filename/link if present) and is excluded from the tab order's editable cells, but still
receives a focus stop for consistent keyboard navigation (never a "hole" in the grid). This
supersedes the original draft's incorrect premise that every declared field type is a flat
scalar.

### Decision 7: Mount point and Preview-grid coexistence
`DatasetRowGrid` mounts on the existing `/sources/:id` route (`SourceDetailPanel`), for
`dataset`-kind sources only, **replacing** that panel's existing read-only "Preview" `DataGrid`
for this source kind (a dataset source's rows ARE its data — a separate read-only preview above
an editable grid of the same rows would be redundant and confusing). Non-dataset source kinds
(CSV, REST, etc.) keep their existing Preview behavior unchanged.

### Decision 8: Refresh control and "reflects a concurrent change" criterion
A dedicated "Refresh" button re-runs `fetchDatasetRowsPage` for the current page (and
`fetchDatasetSchema`, in case the schema itself changed) — this is what the spec's "grid
reflects a concurrent change on refresh" scenario exercises; it is not implicit browser-refresh
behavior. Task 5.1 must include a test that seeds a row change via a second simulated
client/direct API call, then confirms the Refresh action shows the change without a full page
reload.

### Decision 9: Large-dataset criterion is a measured task (corrected against the real row cap),
and focus-guard coverage is extended
**Verified: a dataset source's total row count is itself capped at `staticMaxRows = 500`**
(`DataSourceService.staticMaxRows`, enforced on every append/replace) — the round-2 draft's
"navigating 100+ pages" language was impossible (at 100 rows/page, 500 rows is at most 5 pages)
and is corrected here. The measurement task (5.7) instead: seeds a dataset source with the
maximum, 500 rows; asserts every `fetchDatasetRowsPage` request carries an explicit `limit=100`
(and a `cursor` param on every page after the first — never relying on the API's own default);
asserts the mounted DOM row count is recorded as a literal number and is `<= 100` on every page;
and asserts that number does not grow while paging from page 1 through page 5. This is a real
measurement (a specific asserted count) rather than an assumption that "paging exists" is
sufficient.

Separately, `e2e/focus-presence-guard.spec.ts`'s `routes` array does not currently visit
`/sources/:id` (verified — only `/`, `/sources`, a pipeline detail route, and `/settings`), so an
unmodified run of that spec proves nothing about this grid. Task 5.3 adds `/sources/:id` (seeded
with a dataset source) to that spec's `routes`/`ROUTE_READY_MARKERS`, and task 5.4 verifies
screen-reader announcement of a validation/conflict error (via an `aria-live` region or
`role="alert"` on the error message, confirmed present in the accessibility tree, not just
visually rendered).

### Decision 10: Concrete file list for the schema/OpenAPI/type contract task
Task 1.4 (contract change) touches, concretely: `schemas/` — add the declared-schema response
shape alongside the existing data-source schemas; the OpenAPI spec file(s) under `openspec/`
covering `/api/data-sources` routes — add the new `GET .../schema` operation; frontend
`frontend/src/features/sources/types/dataSource.ts` — add the matching TypeScript type; and
`frontend/src/features/sources/services/dataSourceService.ts` — add the fetch function. A test
asserts the response always includes `required` (never omits it even when `false`) — verified
against the existing wire format above, which always writes `"required" -> JsBoolean(...)`
unconditionally (never behind an `Option`), so this is a regression check on that already-true
property, not new behavior to build.

### Decision 11: Add-row is a draft form, not an immediate all-`null` append (skeptic-final-2.md
CR-B)
**Correcting a real bug, not a design preference:** `handleAddRow` originally posted a row of all
`null`s immediately on click. The real backend (`DatasetRowValidator`, exercised by
`appendRows`/`replaceRows`) 400s that outright whenever any declared field is `required` with no
default — so add-row was completely broken for any such schema, which is common (this ticket's
own probe schemas included one). Fixed with an inline draft-row form: clicking "Add row" opens a
plain `role="group"` form (deliberately NOT part of the grid's ARIA-grid/roving-tabindex
machinery — ordinary Tab order through its own inputs and Save/Cancel buttons is the right
pattern for a form, not a grid), pre-filled from each field's declared default (or blank). Client-
side validation mirrors cell editing exactly (`canEmptyField`/`isEmptyEditorValue`/
`serializeEditorValue`, design.md Decision 3a/4.3b): a required field with no usable default
blocks Save with a per-field error; every other field submits `null` when left blank, never `""`.
A server-side 400 on submission parses the same way `submitPatch` already does (per-field where
possible, banner fallback otherwise). `BinaryRefType` fields are never rendered in the draft form
(consistent with Decision 6 — never editable anywhere in this grid) and always submit `null`.

## Risks / Trade-offs

- Re-fetch-on-conflict (Decision 3) means the "current value" shown to the user is only as
  fresh as that follow-up GET — acceptable since it's strictly more accurate than the status
  quo (no current value shown at all).
- Extending `DataGrid` (Decision 0) adds permanent surface area to a component 5 other screens
  depend on; the opt-in-prop + regression-check discipline (task 2.3) is what keeps that safe,
  but it is real ongoing maintenance surface, not a free abstraction.
- One declared field type, `BinaryRefType`, is not a flat scalar (it stores a JSON object
  reference) — handled as a read-only cell per Decision 6, not editable in this grid. Every other
  declared type (`StringType`/`IntegerType`/`FloatType`/`BooleanType`/`TimestampType`/
  `StringBodyType`) is flat and gets a concrete editor.
- Relying on `variant="preview"` to keep virtualization off (Decision 0a) is a coupling to
  `DataGrid`'s current implementation (virtualization being gated on `variant === "full"`); task
  5.8's test asserts the variant choice itself, so a future `DataGrid` change that virtualizes
  `"preview"` too would need this grid re-verified — a real but narrow coupling, not a silent one.
