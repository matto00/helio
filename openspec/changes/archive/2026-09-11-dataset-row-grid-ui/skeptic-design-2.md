## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 50993f49. The artifacts are uncommitted under `openspec/changes/dataset-row-grid-ui/`.
I re-read `ticket.md`, `proposal.md`, `design.md`, `tasks.md` and both spec deltas from scratch.
I checked the design against the real code in `frontend/src/shared/ui/DataGrid.tsx`,
`DatasetRowValidator.scala`, `DataSourceRepository.scala`, `DataSourceRoutes.scala`,
`e2e/focus-presence-guard.spec.ts` and `e2e/support/stateContrastProbe.ts`.

### What I verified (with evidence)

- **DataGrid's only per-cell hook returns the CHILDREN of a `<td>`.** At `DataGrid.tsx:1108-1121`,
  `<td key=... className=... style=...>{col.render ? col.render(row, value) : formatCell(value)}</td>`.
  At `:1089-1098`, `<tr key={i} aria-rowindex=...>` takes no caller-supplied props. At `:869-870`,
  `<div role="region" aria-label="Data grid"><table ...>`. `DataGridProps` (`:219-298`) has no
  row/cell/table attribute, focus or scroll prop.
- **Virtualization is internal and cannot be driven from outside.** At `:598`, virtualization is on
  when `variant === "full" && rows.length > 150`. At `:619-625`, `useVirtualRows({ scrollRef, ... })`
  is fed only the internal `scrollRef`. It has no "include this index" input, and `scrollRef` is not
  exposed. Rows outside the window are not in the DOM at all.
- **Row listing is forward-only.** `RowListResponse(rows, nextCursor: Option[Long], total)`
  (`DataSourceProtocol.scala:297`) takes `cursor`/`limit` params (`DataSourceRoutes.scala:124`).
  There is no previous-cursor.
- **PATCH never changes `seq`.** It updates only `(data, updatedAt)`
  (`DataSourceRepository.scala:~506-508`), so a row stays at the same cursor position. Decision 3's
  premise holds.
- **Real 400 templates** (`DatasetRowValidator.scala:27-36`):
  - `row N: field '<name>' is required` (no em dash)
  - `row N: field '<name>' — expected <t>, got <k>`
  - `row N: expected X fields, got Y`

  The service maps these to 400 (`ServiceResponse.scala:77`). `renderDefaultError` (`:97`) is the
  *declaration-time* default error. It is never produced by a row PATCH.
- **`FOCUSABLE_SELECTOR`** (`stateContrastProbe.ts:50-51`) excludes `[tabindex='-1']`. With a roving
  tabindex, the guard sees exactly one grid cell.
- **SourceDetailPanel** (`frontend/src/features/sources/ui/SourceDetailPanel.tsx:138-218`) already
  handles `dataset` through `fetchCsvPreview` behind a "Preview"/"Reload" button. Decision 7's
  "replace for dataset kind" is concrete and coherent.

Status of the round-1 change requests:

| CR | Status | Detail |
|---|---|---|
| 1 | NOT met | Approach (b) was picked but is not implementable as written (CR 1 below). The false "extension points already support" sentence is still in Risks (`design.md:216-219`). |
| 2 | NOT met | The pager was decided. The virtualization/focus mechanism is infeasible and the page size is unspecified (CR 2 below). |
| 3 | Partial | Status set fixed to 409/400. The parse template is wrong/incomplete (CR 4 below). |
| 4 | Partial | The overlay semantics are now correct and tested (task 4.1). "Store the cursor that produced each page" was not addressed (CR 3 below). |
| 5 | Met | Spec lines 38-52 fixed; both delete-conflict scenarios added. The proposal still has the old wording (CR 6 below). |
| 6 | Partial | The `BinaryRefType` read-only decision is sound. The "required field with a `default` cleared" behaviour is still unspecified, and the "schemas are flat" Risks claim is not removed (CR 5 below). |
| 7 | Met | Mount point, Preview replacement, and the Refresh control plus its test are covered. The proposal still says "(or a dataset-rows sibling)" (CR 6 below). |
| 8 | Partial | See CR 7 below. |
| 9 | Met | The route and ready marker are added (task 4.3), and the SR announcement task (4.4) is added. |
| 10 | Met | Decision 10 and tasks 1.4/1.5 name concrete files plus the `required`-always-present test. |

### Verdict: REFUTE

The two keyboard/a11y decisions the orchestrator asked me to look at hardest (Decision 0 and
Decision 0a) cannot be built as written on the real `DataGrid.tsx`. An executor following them
literally will either produce invalid ARIA or quietly change the shared component without the
regression task CR1(a) asked for.

### Change Requests

1. **Decision 0 is not implementable. Pick a real mechanism.** `design.md:66-69` says roles go "on
   `DataGrid`'s rendered `tr`/`td` via the `render` hook's return value". But `render` returns
   content *inside* the `<td>` (`DataGrid.tsx:1120`). It cannot set `role`/`tabindex`/`aria-*` on the
   `<tr>`/`<td>`. Wrapping the `region > table` in an outer `role="grid"` div also leaves an implicit
   `table` role between the grid and its rows. A "gridcell" div nested inside a `cell` is not a
   conforming APG Grid, and the "SR names/roles" AC fails. Choose one:
   - **(a)** Add opt-in, default-off props to `DataGrid`, for example a table-level `role="grid"`
     override plus `getCellProps(rowIndex, colKey)` for `tabIndex`/`onKeyDown`/`aria-selected`/
     `aria-invalid`/`aria-describedby`. Keep the `region`'s `aria-label` meaningful. Add a task to
     prove that the five existing consumers (TableRenderer, SourceDetailPanel preview, StepCard,
     SqlTab, ConnectorsPage) render identical markup. A snapshot/role assertion per consumer, or the
     existing DataGrid tests unchanged and green, would do.
   - **(b)** Do not use `DataGrid` for the body at all, and escalate the ticket's "reuse existing
     grid" constraint.

   Rewrite Decision 0's "`DataGrid` stays untouched" to match the choice, and update tasks 3.1/3.2.
   Also say what happens to DataGrid's own focusable header controls (sort, resize `separator`
   `tabIndex=0` at `:1002-1008`, filter inputs) inside the grid. The simplest answer is: do not pass
   `onSort`/`onColumnResize`/`onFilterChange`/`onPinToggle`, so none render.

2. **Decision 0a is not implementable. Also fix the page size.** The wrapper cannot "ensure that row's
   id is included in the range `useVirtualRows` is asked to render". `useVirtualRows` takes only the
   internal `scrollRef` (`DataGrid.tsx:619-624`), and a row outside the window has no DOM node to
   `scrollIntoView`. Decision 0a also never states a page size, and the API allows up to 500. The
   coherent fix given the pager is:
   - state a page `limit` ≤ `VIRTUALIZATION_ROW_THRESHOLD` (for example 100);
   - state that virtualization therefore never engages for this grid;
   - add a test asserting the page limit constant is ≤ the threshold, so a later bump fails loudly.

   Then rewrite Decision 0a, task 3.3 and task 4.6 accordingly. Task 4.6 becomes: arrow-navigate
   to a row below the visible scroll area within a 100-row page, and assert that it is scrolled into
   view and has focus. The alternative is a new `DataGrid` prop, such as `scrollToIndex`, under
   CR 1(a) with its own regression coverage. Either way, the current text describes an API that
   does not exist.

3. **The pager's "Prev" is undefined against a forward-only cursor, and page identity is not
   stored.** The listing returns only `nextCursor` (`DataSourceProtocol.scala:297`). Specify:
   - that the slice stores the cursor that produced each page (a cursor stack keyed by page index,
     with `undefined` for page 0);
   - that Prev pops it;
   - that Refresh (Decision 8) and conflict refetch (Decision 3 / task 2.4) both re-request with
     *that stored cursor*. This was round-1 CR4's second half, which is still unaddressed.

   Also specify where an appended row appears. Append gets the highest `seq`, so it lands on the
   *last* page, not the current one. The spec's "appears in the grid" (`spec.md:62-64`) needs one of:
   - jump to the last page;
   - or update `total` and show an inline "added on last page" notice.

   Add a test for whichever you choose.

4. **Decision 3a's parse template is wrong.**
   - `design.md:139-140` and task 2.5 give the shape `field '<name>' — <reason>` and cite
     `renderDefaultError`. That is the declaration-time default error, never emitted by row PATCH.
   - The actual row templates are listed in "What I verified" above.
   - A parser for the em-dash form alone sends every **required-field** server error to the
     grid-level banner, not the cell. That violates "errors surface on the offending cell".

   Name all three forms explicitly in Decision 3a and task 2.5:
   - `is required` → cell;
   - `— expected…` → cell;
   - `expected X fields, got Y` → row/grid-level.

   Also state that messages are split on `"; "` first. Add a test that a real server 400 of the
   `is required` form lands on the cell, driven through real UI input.

5. **Delete the stale Risks paragraph (`design.md:216-219`) and specify the required-with-default
   case.** It still says "constrains the editor UI to what that component's cell-render/edit extension
   points already support … dataset schemas are flat per `DatasetFieldDeclaration`". That contradicts
   Decisions 0 and 6, and both round-1 CR1 and CR6 required its removal. Round-1 CR6's "say how a
   required field with a `default` behaves when cleared" is still unanswered. Pick one:
   - block client-side, like any required field;
   - or send the value omitted/null and let the server default-fill it.

   Note that PATCH is a full positional replace, and check whether `validateRow` default-fills on
   PATCH. Then add the scenario to `spec.md`.

6. **Fix the stale proposal wording.**
   - `proposal.md:21-22`: "a 409 … surfaces the server's current row value inline". Reword it to
     match Decision 3's follow-up GET; this is the same contradiction CR5 fixed in spec.md.
   - `proposal.md:42`: "`features/sources/` (or a `dataset-rows` sibling)". Pick the concrete
     location that Decision 7 and task 3.1 now imply.

7. **Complete the measurement task (4.7) and the keyboard contract.**
   - Task 4.7 must seed a concrete row count spanning several pages (for example ≥ 3× the page
     limit, not "100+ pages" at an unstated size). It must assert every rows request carries `limit`
     (and `cursor` after page 0) and never omits `limit`. It must record the mounted DOM row count as
     a number.
   - The keyboard design never says how an edit is **committed**: Enter in edit mode, Tab while
     editing, or blur. It also never says whether `Delete`/`Backspace` fire only in navigation mode.
     They must, or Backspace inside a text editor deletes the row. State both in Decision 0, the
     spec's "Full keyboard operability" requirement, and task 3.2.

### Non-blocking notes

- Decision 6's "excluded from the tab order's editable cells, but still receives a focus stop" is
  fine under a roving tabindex. Phrase it as "navigable; Enter/F2 is a no-op (or opens a read-only
  detail)" so it is not read as two tab stops.
- With a roving tabindex, `focus-presence-guard` measures only the single `tabindex="0"` cell
  (`FOCUSABLE_SELECTOR` excludes `-1`). Make sure the visible focus ring is on that element itself,
  not on a child the probe won't see.
- The spec puts "Explicit refresh reflects a concurrent change" under the keyboard requirement. It
  belongs under the view/paging requirement. This is cosmetic.
- The backend half (Decisions 1, 2, 10; tasks 1.x) remains sound, as in round 1.
