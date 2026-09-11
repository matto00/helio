## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `d30616a6426a5ffb195e2d7f3eb95afd194c7c7b`, diff base `50993f49` (resolved live via
`resolve-review-base.sh`). Working tree also has an uncommitted `tasks.md` edit and an untracked
`evaluation-2.md`. Neither was part of the review.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY`.
- **HEL-1122 backend:** `DataSourceService.getDatasetSchema` calls `findByIdOwned`. It returns a
  404 when the source is missing or not owned, a 400 naming the actual kind when the source is
  not `dataset`-kind, and 200 otherwise. The hand-rolled `datasetFieldResponseFormat` leaves
  `default` out of the object when it is None and always writes `required`. The
  `StaticSourceResponse` shape is untouched. The schema enum matches `DataFieldType.asString`
  (model.scala:683-689). The repo has no tracked OpenAPI file (`git ls-files | grep -i openapi`
  finds nothing), so nothing was missed there. Live probes on the running backend :9419:
  - `GET /api/data-sources/fa2079b0-.../schema` returned `200 {"fields":[{"name":"a","required":false,"type":"string"}]}`, with no `default` key.
  - A nonexistent id returned `404 {"message":"Data source not found"}`.
  - **HEL-1122 looks sound.**
- **DataGrid extension (Decision 0):** I read the diff. Every addition is gated on `gridMode`
  (`role`, `tabIndex` and `onKeyDown` are `undefined` when it is false), so the default path is
  unchanged.
  - `DataGridConsumerRegression.test.tsx` renders inline copies of each consumer's prop shape. It
    does not render the consumers, and it does not use a before-snapshot taken from `main` as
    task 2.3 / Decision 0 required. It is a weak guard, not proof.
  - The code-level gating is enough to accept non-breakage. See the non-blocking notes.
- **Live keyboard probe.** I ran headless chromium (`@playwright/test` library, isolated context,
  because the shared MCP browser was in use by another agent) against the pinned servers on
  :6512/:9419, source `fa2079b0-...`. `assert-phase.sh servers` returned PASS. Results, reproduced
  across two separate probe runs:
  - `initial {"tab0":0,"cells":3}`: on load, **no grid cell has `tabindex="0"`**.
  - Tab from the Refresh button goes to `BODY` and then wraps to "Skip to content". **The grid is
    skipped entirely.** A 40-Tab walk from the top of the page also never reached a gridcell.
  - Clicking a cell and pressing ArrowDown: before `{"a":"gridcell","txt":"x","t0":"x"}`, after
    `{"a":"gridcell","txt":"x","t0":"y"}`. **The tabindex moves but DOM focus stays on the old
    cell.** `DataGrid.tsx` has no `.focus()` call (grep finds none).
  - After Enter-commit, focus is on `BODY`, the active cell does not move down (design says it
    should), and a later ArrowDown does nothing.
  - Pressing Refresh from the keyboard leaves focus on `BODY`.
  - Side effect: this probe committed one edit in the shared dev DB (row "y" became "yQ").
- **Unit tests:** `grep` shows every keyboard-matrix test enters the grid with `fireEvent.click`,
  so keyboard-only entry is never tested. No test exercises conflict retry/discard, Refresh
  showing a concurrent change, pager Prev/Next, or optimistic rollback. Tasks 3.4, 4.4, 4.6, 5.1
  and 5.2 are nonetheless checked `[x]`.
- **Visual check** (dark theme default, screenshot taken during the probe): the grid uses the
  token-based `DataGrid` preview styling, which is consistent with the sibling schema table. The
  "ROWS" label sits flush against the schema table above it.

### Verdict: REFUTE

### Change Requests

1. **The grid cannot be reached by keyboard (a11y / "keyboard-operable" AC).**
   `DatasetRowGrid.tsx:97` starts `activeCell` as `null`, and `DataGrid` only gives
   `tabIndex=0` to the cell that matches `activeCell`. Result: zero tab stops in the grid, and the
   only way in is a mouse click. Fix: default `activeCell` to the first row's first column
   whenever rows load and no active cell is set, or when the current active row disappears. Add a
   test that reaches a gridcell using only Tab, with no click.

2. **Roving tabindex does not move DOM focus.** `DataGrid.tsx` `handleGridKeyDown` (around
   line 663) updates the tabindex, but focus stays on the old `<td>`. The visible focus ring and
   the screen-reader position are therefore wrong after every arrow key. Fix: when `gridMode` is
   on and `activeCell` changes as a result of keyboard navigation, focus the matching `<td>`.
   Assert `document.activeElement` in the keyboard-matrix tests. They currently only check which
   cell has the tabindex.

3. **Focus is lost after commit and after Refresh / paging.** Enter, Escape and Tab-without-target
   all unmount the editor and leave focus on `<body>`, and Enter does not move down a row as
   Decision 0 specifies. Separately, `DatasetRowGrid.tsx:414` replaces the whole component,
   toolbar included, with "Loading…" on every `rowsStatus === "loading"`. That unmounts the
   Refresh/Prev/Next button that was just pressed. Fix: return focus to the active `<td>` after
   commit or cancel, and move down one row on Enter. Keep the toolbar and grid mounted during
   refetches: show the loading state only when there are no rows yet, or show an inline busy
   indicator.

4. **The stale-edit AC ("show the current value, allow retry") is not implemented.**
   `DatasetRowGrid.tsx:451-485` handles an edit conflict by printing
   `JSON.stringify(conflict.current.data)`. It has **no Retry and no Discard** for edits.
   `refetchConflict.fulfilled` (`datasetRowsSlice.ts:278`) never updates `rows` with the fresh
   row or `updatedAt`, so any re-edit will 409 again. `clearConflict` is never dispatched, so the
   banner stays forever. Fix: implement Decision 3 / task 4.6.
   - Show the current value per field.
   - Retry: re-apply only the user's edited cell(s) on top of `conflict.current`, with
     `conflict.current.updatedAt`.
   - Discard: `clearConflict` plus replacing the row with `current`.
   - Add UI tests that drive a 409 through real input for both the edit and delete paths.

5. **The "row already deleted" Discard dispatches the wrong action.** `DatasetRowGrid.tsx:456`
   calls `popCursorStack` instead of `clearConflict`. The conflict never clears, and the pager's
   cursor stack gets corrupted. Fix: dispatch `clearConflict({sourceId,rowId})` and remove the
   row from `rows`.

6. **Optimistic edits (Decision 4) were never built, but tasks 4.4 and 5.2 are marked done.**
   `patchDatasetRow.pending` (`datasetRowsSlice.ts:239`) only sets `pending`, so the update is
   actually pessimistic, and no rollback test exists. Pick one:
   - implement optimistic apply plus rollback, with a rollback test; or
   - amend design.md Decision 4 to "pessimistic", with a justification.

   Either way the AC wants the decision and the code to agree.

7. **Missing required tests (task 5.1), and tasks.md checkboxes that do not match the code.**
   Add tests for:
   - Refresh showing a concurrent change (seed via a second client call, then press Refresh);
   - Prev/Next round-trips through `cursorStack`;
   - conflict retry/discard.

   Un-check or correct 3.4, 4.4, 4.6, 5.1 and 5.2 until they are actually delivered.

### Non-blocking notes

- `DataGridConsumerRegression.test.tsx` uses inline prop copies, not the real consumers, and no
  before-snapshot from `main`. It is fixture-shaped, not the owner-mandated check. I accept it
  only because I verified the gating myself. Consider rendering the real consumer components.
- The toolbar buttons are styled by hand in `DatasetRowGrid.css`. Check whether DESIGN.md's shared
  button component should be used instead, and confirm they have a visible `:focus-visible` style.
- Add a little vertical spacing between the "ROWS" label and the schema table above it.
- Gate note: `evaluation-2.md` reported the keyboard and focus-guard matrices as passing. That was
  possible because every keyboard test starts with a mouse click, and the focus-presence guard
  only checks elements that already are focusable.
