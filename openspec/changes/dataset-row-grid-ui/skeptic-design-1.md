## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 50993f49 (artifacts uncommitted under openspec/changes/dataset-row-grid-ui/).

### What I verified (with evidence)

- **Backend schema route (Decision 1) is additive and scoped correctly.** `DatasetFieldDeclaration`
  (`backend/.../domain/model/DataSource.scala:165-211`) is `name/fieldType/required/default: Option[JsValue]`.
  Its hand-rolled format already omits `default` when None and normalizes `JsNull` to None on read.
  A new `GET /:id/schema` leaves `StaticSourceResponse` (`DataSourceProtocol.scala:82`, `jsonFormat6`) alone.
  Reusing `findByIdOwned` (404) and then the kind check (400) matches every sibling row method
  (`DataSourceService.scala:810-886`). Decision 2's RLS reasoning holds, since it reads the same row through
  the same `findByIdOwned`. Sound.
- **409 body (Decision 3).** `ServiceError.Conflict` is a prose string only
  (`DataSourceService.scala:822-823, 846-847`). It has no structured current `updatedAt` and no row data,
  so the design's "carries the conflicting updatedAt" is true only inside prose. Re-fetching instead of
  widening HEL-1078's contract is a defensible trade-off: row listing is ordered by `seq` with a seq cursor,
  so a patched row stays on its page. I accept the approach. The gaps are in the details, listed below.
- **Server validation error shape.** `ValidationFailed(msg)` becomes `ServiceError.BadRequest(msg)`, which
  is **400, not 422** (`DataSourceService.scala:821`). The message is a single string built from pinned
  templates `row N: field '<name>' is required` / `row N: field '<name>' — expected <t>, got <k>`
  (`DatasetRowValidator.scala:27-36, 60-78`). No structured field is on the wire.
- **PATCH is a full-row replace.** `RowPatchRequest(updatedAt, data: Vector[JsValue])`
  (`DataSourceProtocol.scala:275`). Row data is positional, aligned to `dataset_schema` order.
- **Field types.** `DatasetRowValidator.validateValue` accepts `string`, `string_body`, `integer`, `float`,
  `boolean`, `timestamp` and **`binary_ref` (a JsObject)**. That contradicts design.md's Risks claim that
  "dataset schemas are flat… not expected to bite."
- **DataGrid extension points.** `frontend/src/shared/ui/DataGrid.tsx` renders a plain `<table>` inside
  `role="region"` (line 869). Its only per-cell hook is `ColumnDef.render` (line 34). It has no `role="grid"`,
  no cell focus or roving tabindex, no edit mode, and no keyboard cell navigation. It virtualizes above 150
  rows (`VIRTUALIZATION_ROW_THRESHOLD`, line 196-198), and it is shared by TableRenderer, SourceDetailPanel,
  StepCard, SqlTab and ConnectorsPage. The design's "cell-render/edit extension points already support" is
  not true of the actual component.
- **focus-presence-guard coverage.** `e2e/focus-presence-guard.spec.ts:185` scans only
  `["/", "/sources", "/pipelines/:id", "/settings"]`. The grid will live under `/sources/:id`
  (`AppRoutes.tsx:102`, SourceDetailPage), and that route is **not scanned**, so task 4.3 "passes" would be
  vacuous. The spec already seeds a dataset (`type: "static"`) source at line 167, so extending it is cheap.
- **Decision 4** (optimistic edit, pessimistic delete/add) is reasonably justified, and task 4.2 covers
  rollback. Accepted.

### Verdict: REFUTE

The backend half is sound. The frontend design rests on a false premise about DataGrid, leaves the
a11y grid pattern undecided, and has several contract mismatches that would produce wrong code.

### Change Requests

1. **Decide how DataGrid becomes an editable, keyboard-navigable grid (design.md Decision 5 and Risks; tasks 2.3/3.1/3.6).**
   DataGrid has no edit, focus or cell-navigation extension points, only `ColumnDef.render`. The design must
   state one approach and its blast radius:
   - (a) Add opt-in props to the shared DataGrid, such as `interactive`/`role="grid"`, roving tabindex and
     `onCellKeyDown`. This must default off, and there must be a regression task proving TableRenderer,
     SourceDetailPanel preview, StepCard, SqlTab and ConnectorsPage are unchanged.
   - (b) Implement the grid semantics entirely in `DatasetRowGrid` through `render`. If you choose this,
     explain how it satisfies an ARIA grid pattern when DataGrid emits a `<table>` in a `region`.

   Either way, name the pattern: WAI-ARIA APG "Data Grid", with arrow keys, Home/End, Enter/F2 to edit,
   Escape to cancel, Tab out of the grid, and the keys that trigger delete and add. Delete the false
   "extension points already support" sentence.
2. **Say how roving focus behaves under virtualization.** DataGrid windows rows above 150. Pages can reach
   `Page.MaxLimit` (500), and the grid accumulates pages. The design must say what happens when the focused
   cell's row scrolls out of the window. Either keep focus on the row, or cap rows per render at or below the
   threshold with explicit pagination. It must also say whether paging is a pager control or
   load-more/infinite scroll. Right now "requests successive pages as the user navigates" can be read either
   way. That ambiguity also blocks the "measured, not assumed" AC; see CR 8.
3. **Say how server validation errors map to a cell.** The server returns **400** with the pinned string
   `row N: field '<name>' …`, not a 422 and not a structured field. Choose one:
   - parse the pinned template (it is pinned by HEL-1076's spec, so this is legitimate), with a fallback to
     a row-level inline error when parsing fails; or
   - extend the 400 body additively with structured field errors, with the contract delta planned.

   Fix Decision 4's "409/422/5xx" to the real status set, 409/400/5xx. Add a test that a real server 400
   lands on the offending cell.
4. **Define retry semantics for a full-row PATCH (Decision 3; spec "Stale-edit conflict is recoverable").**
   PATCH replaces the whole positional `data` vector. Specify what Retry submits. It should be the refetched
   current row with only the user's edited cell(s) overlaid, sent with the refetched row's `updatedAt`.
   Say explicitly that it is not the user's stale full row, which would silently overwrite the other
   client's changes to other columns and violate the "never a silent overwrite" AC. Also specify how the
   design finds "the row's current page": store the cursor that produced each page, and state that `seq` is
   stable across PATCH. Add a test for the overlay behaviour with a concurrent change in a different column.
5. **Fix the spec/design contradiction on the conflict source.** `specs/dataset-row-grid/spec.md:37-38` says
   the grid shows the current value "from the server response". Decision 3 says it comes from a follow-up
   GET. Reword the scenario to match Decision 3. Add a scenario for "row deleted concurrently → discard only",
   and one for a stale DELETE (409 on delete). Decision 3 names `deleteRow`, but no spec scenario or task-3
   UI step covers a delete conflict.
6. **Specify editors for every declared type.** Map each of `string`, `string_body`, `integer`, `float`,
   `boolean`, `timestamp` and `binary_ref` to an editor, or to read-only. `binary_ref` is a JsObject, so it
   cannot be edited as a flat cell and should probably be read-only with a formatted display. Remove the
   Risks claim that schemas are flat. Say how a required field with a `default` behaves when cleared.
7. **Name the entry point and the refresh affordance.** The proposal says "features/sources/ (or a
   dataset-rows sibling)". Pick one, and state that the grid mounts on `/sources/:id` (SourceDetailPage) for
   `dataset` sources. Say what happens to the existing read-only Preview DataGrid there: replace it, or sit
   beside it. The visual-cohesion AC depends on this answer. The "reflects a concurrent change on refresh"
   AC also needs a concrete refresh control (or reuse of the existing Preview "Reload" button) and a task
   that tests it.
8. **Add a measurement task for the large-dataset AC.** The ticket requires "measured, not assumed."
   Add a task that seeds a dataset of more than one page (for example 1,000+ rows). It should assert the
   requests are paged (`limit`/`cursor` present, never a full fetch) and record the rendered DOM row count
   as numbers.
9. **Make the focus-presence-guard scan the grid.** Extend `e2e/focus-presence-guard.spec.ts`:
   - add `/sources/${source.id}` to `routes` (line 185), with a ready marker for the grid;
   - confirm the grid's cells or cell controls fall inside `FOCUSABLE_SELECTOR`. Roving `tabindex="-1"`
     cells may otherwise be skipped.

   Without this, task 4.3 cannot fail. Also add a task that verifies an SR announcement for validation and
   conflict errors, such as an `aria-live` region or `aria-describedby` plus `aria-invalid` on the cell.
10. **Minor contract accuracy (task 1.4).** Name the concrete files: the `schemas/*.json` file, the OpenAPI
    path entry, and the frontend type file. Also require a test that the `required` key is always emitted,
    since the write side always emits it and the frontend type should be non-optional. Keep the
    `default`-absent test as planned.

### Non-blocking notes

- The 400 message for a non-dataset source can follow the siblings' wording ("… only supported for dataset
  sources"). The spec's "naming the actual kind" is fine but is not what sibling routes do. Either is OK;
  just be consistent with the spec as written.
- If the executor decides to put the schema into a Redux slice, co-locating it with the existing
  sources slice versus a new `datasetRowsSlice` is a judgment call. The design's choice is fine.
