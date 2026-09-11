## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `75e874384a84027dfa1345eabc1cb1a5e34e4cd9`. The diff base is `50993f49`, resolved
live via `resolve-review-base.sh`.

The live probe ran in headless chromium: an isolated `playwright` library context against pinned
servers on :6512 and :9419. `assert-phase.sh servers` returned PASS. I checked that both server
processes' cwd is this worktree, and that Vite serves the HEAD source (`moveActiveCellDown` is
present in the served module).

I seeded two fresh probe sources:
- `cb67f54d-…`: `name` (string, required, no default), `qty` (integer) and `ok` (boolean), with 60 rows.
- `f2cbab7d-…`: `label` and `n` (both non-required), with 150 rows, so there are 2 pages.

Evidence (probe logs plus screenshots) is persisted under
`/home/matt/Development/helio/.concertino/runs/HEL-1080/evidence/.concertino/runs/HEL-1080/skeptic-f2/`
(`run1.txt`, `run2.txt`, `run3.txt` and `f2-*.png`, cited below by filename).

### What I verified (with evidence)

**Round-1 root causes: most are now genuinely fixed (live, not test-shaped)**
- **CR1 (keyboard entry):** fixed. On load exactly one cell has `tabindex=0` (row 0, `name`), and
  focus is not stolen (`activeElement=BODY`). A single Tab from Refresh lands on `TD/gridcell/r1`
  (run1.txt).
- **CR2 (arrow keys move DOM focus):** fixed. ArrowDown, ArrowRight, ArrowLeft and ArrowUp all
  move `document.activeElement` to the matching gridcell. At the top edge the cell is clamped.
  Focus ring: 2px `rgb(168,129,6)` outline in both themes.
- **CR3, edit paths:** fixed.
  - Enter → editor → type → Enter persists (`["r1-EDIT",1,false]` read back via the API). Focus
    returns to the next row's gridcell, and ArrowDown then works.
  - Escape returns focus to the cell and nothing is saved.
  - Refresh pressed from the keyboard keeps focus on the Refresh button.
- **CR4 (edit conflict):** fixed for the "modified elsewhere" case.
  - The banner lists the current value per field, and the grid cell shows the fresh `qty=999`.
  - Retry → server row `["MINE",999,false]`: only the edited cell is re-applied and the
    concurrent change survives.
  - Discard clears the banner and leaves the server value `THEIRS`.
- **Delete conflict ("modified elsewhere") → Delete anyway:** works. The row is removed on the
  server and from the grid.
- **CR5:** the wrong `popCursorStack` is gone. But the branch it lived in cannot be reached
  against the real backend. See CR-A.
- **CR6 / Decision 4 amended to pessimistic:** the ticket AC explicitly allows either strategy
  ("decided and justified; *if* optimistic, rollback is tested"). Pessimistic plus a justification
  satisfies the AC as written. It is not scope drift, and on its own it does **not** need another
  design-gate pass. The amended text overstates the implementation, though. See CR-F.
- **Refresh reflects a concurrent change:** a row patched via the API, then Refresh, showed
  `r2` → `CONCURRENT`.
- **Required field can't be emptied:** clearing `name` shows an inline cell error with
  `role="alert"`. The integer field uses a number input.
- **Jest:** `npx jest --testPathPatterns='DatasetRowGrid|datasetRowsSlice|DataGrid'` →
  8 suites / 172 tests passed. Every defect below reproduces live against a green suite, because
  the suite mocks backend behavior the real backend does not have.

**New defects found by the live probe (each reproduced at least twice)**
- **Concurrent delete:** the real backend returns **404, not 409**, for a row that no longer
  exists. This is HEL-1078 D5 (archived
  `2026-09-11-row-edit-delete-precondition/design.md:92-109`): row absent → 404.
  - Edit on a concurrently deleted row: two identical `"Row not found" [Retry]` banners appear, and
    the phantom row stays in the grid with its stale value (`f2-edit-on-deleted-row.png`, run2
    "A").
  - Delete of a concurrently deleted row: same double banner, and the row stays rendered (run2 "B",
    also run1 "CR5": `concurrent DELETE 204`, then UI delete → console 404, no conflict UI, 3 cells
    still present).
  - The "row already deleted / Discard" UI is reachable only when a 409 is followed by a row that
    vanishes before the re-fetch (a race). The test at
    `DatasetRowGridFocusAndConflict.test.tsx:323` mocks a **409** for this case, which the real
    API never returns.
- **Add row fails on any dataset with a required field that has no default.**
  - `handleAddRow` (`DatasetRowGrid.tsx:556-564`) posts all-`null` values, and the server rejects
    with 400 `row 0: field 'name' is required`. It shows as two duplicate banners
    (`f2-addrow-required-fail.png`, run2 "E" total `55→55`, run3).
  - The unit test (`DatasetRowGrid.test.tsx:220`) uses this same required-no-default schema but
    mocks `appendSourceRows` as a success, and only asserts that it was called.
- **After Add row, the pager desyncs** (non-required 150-row source).
  - After adding: the grid shows page-2 rows (first cell `p101`) but the label reads "Page 1".
    Prev and Next are both disabled, so the user is stranded (`f2-addrow-pager-mismatch.png`).
  - After Refresh: jumps back to page 1.
  - Cause: `appendDatasetRow` (`datasetRowsSlice.ts:160-165`) follows `nextCursor` but never
    pushes onto `cursorStack`, although tasks.md 3.6 (checked `[x]`) requires it.
- **Focus still drops to `<body>` on several keyboard paths** (the residue of round-1 CR3):
  - After a keyboard Delete → Confirm (ConfirmInline unmounts): `BODY` (run2 "C").
  - After activating Retry or Discard in the conflict banner (the banner unmounts): `BODY` (run1).
  - After keyboard Next to the last page, or Prev to page 1 (the pressed button becomes
    `disabled`): `BODY` in both themes (run3). With a 2-page dataset this happens on every pager
    press.
  - Pressing Delete leaves focus on the cell. The confirm is rendered **above** the toolbar-less
    grid in DOM order, so it is reached by Shift+Tab, and Cancel comes before Confirm. Nothing
    announces it.
- **Duplicate error banners:** every non-conflict mutation failure renders the same message twice,
  once from the local `bannerError` and once from the slice's `state.error`
  (`DatasetRowGrid.tsx:580-586` plus `datasetRowsSlice.ts:277,294,299`).

**Visual / DESIGN.md (both themes)**
- The grid and toolbar sit well next to the schema table in dark (`f2-dark-grid.png`) and light
  (`f2-light-required-src.png`). The focus ring is visible in both.
- The conflict banner's Retry/Discard buttons (`.dataset-row-grid__conflict button`, which has
  only a margin) render as unstyled text with no hairline and no control height
  (`f2-conflict-edit.png`). That matches none of DESIGN.md §5's recipes. §5 says "A new button
  style is a defect, not a variant."

### Verdict: REFUTE

### Change Requests

1. **CR-A — handle 404 on edit and delete as "row already deleted".**
   - In `submitPatch` (`DatasetRowGrid.tsx:211`), `handleDeleteConfirmed` (`:483`),
     `handleRetryConflict` and `handleDeleteAnyway`, treat a 404 row-not-found as the
     concurrently-deleted case.
   - Remove the phantom row from `rows` and show the "This row was already deleted" banner with
     Discard only. This is spec scenario "Concurrent delete detected on edit"
     (`specs/dataset-row-grid/spec.md:58-61`) and the ticket AC "never a generic toast".
   - The thunks' `rejectValue` needs a `notFound` discriminator alongside `conflict`.
   - Replace the 409-mocked test at `DatasetRowGridFocusAndConflict.test.tsx:323` with 404-mocked
     edit and delete tests that match HEL-1078 D5.
2. **CR-B — Add row must work when a field is required and has no default.**
   - `handleAddRow` (`DatasetRowGrid.tsx:556`) currently always 400s for such schemas.
   - Pick a design and state it in design.md: either an inline "new row" draft editor that is
     submitted only once the required fields are filled, or seed type-appropriate placeholder
     values. Do not silently post nulls.
   - Add a test whose mocked append **rejects** exactly as the real backend does (400
     `row 0: field '<name>' is required`) for that schema.
   - Fix the existing test at `DatasetRowGrid.test.tsx:220`: it passes against a behavior the
     backend refuses.
3. **CR-C — keep the pager consistent after Add row.**
   - `appendDatasetRow` (`datasetRowsSlice.ts:160-165`) must push each followed cursor onto
     `cursorStack`, per tasks.md 3.6, so the page label and Prev match the rows shown.
   - Add a multi-page test asserting "Page N", a working Prev, and that Refresh stays on the last
     page.
4. **CR-D — stop focus from landing on `<body>` in the remaining keyboard paths.**
   - After a delete is confirmed or cancelled, and after conflict Retry/Discard/Delete anyway,
     return focus to the active gridcell. The ref-gated `pendingFocusReturnRef` mechanism already
     exists.
   - When Prev or Next becomes disabled as a result of its own press, move focus to the other pager
     button or to the grid's active cell.
   - When Delete opens the confirm, move focus to its Cancel or Confirm button. ConfirmInline has
     no autofocus, and in DOM order it sits before the grid.
   - Tests should assert `document.activeElement`.
5. **CR-E — show one banner per error.**
   - Render either `bannerError` or `state.error`, not both. Every failure path currently
     duplicates the message (`DatasetRowGrid.tsx:580-586`).
6. **CR-F — style the conflict banner's buttons with a DESIGN.md §5 recipe, and make Decision 4's
   text match the code.**
   - Use Secondary for Discard and Retry. Use Danger for "Delete anyway".
   - Amended Decision 4 claims the "cell/row/toolbar" show a pending state ("disabled or dimmed").
     Only the edited cell gets a "Saving…" span: delete and add-row show no pending state, and the
     Add row button is not disabled while the request is in flight (a double-add is possible).
     Either build what is claimed (disable Add row, dim the row being deleted) or correct the
     sentence.

### Non-blocking notes

- The pessimistic Decision 4 is acceptable without a design re-gate: the AC permits it and the
  justification is reasoned. CR-F is only about making the text match the behavior.
- The toolbar buttons use `--app-text` where the Secondary recipe calls for muted text. This is a
  minor divergence.
- The existing schema table above the grid shows the inferred type (`qty float`, `Nullable no`),
  while the grid uses the declared schema (`integer`, not required). This predates the change, but
  the two tables now visibly disagree on the same page. Consider a follow-up.
- `refetchConflict.rejected` is unhandled. If the re-fetch fails, the user sees nothing.
- **Gate note:** the evaluator's PASS again rested on mocks whose status codes and acceptance
  behavior diverge from the real backend (409 vs 404; append accepting nulls for required fields).
  Future gates should probe the 404 and required-field paths live.
- **Side effects in the shared dev DB:** I created the sources `SKEPTIC-F2 grid probe` and
  `SKEPTIC-F2 pager probe` and mutated and deleted rows in them. No other data was touched.
