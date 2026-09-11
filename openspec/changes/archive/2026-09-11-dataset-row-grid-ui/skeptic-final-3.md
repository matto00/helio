## Skeptic Report — final gate (round 3, skeptic-final-3.md)

I reviewed HEAD `47b58df9f6434bcda1f3af30dd5724f680903207`. The diff base is `50993f49`, resolved
live via `resolve-review-base.sh`.

The live probe ran in headless chromium (playwright library, an isolated context per theme)
against pinned servers on :6512 and :9419.
- `assert-phase.sh servers` returned PASS. Both servers were reused, so I checked where they came
  from: both PIDs have their cwd in this worktree (backend and frontend).
- Vite serves the HEAD source: the served `DatasetRowGrid.tsx` and `datasetRowsSlice.ts` contain
  `markRowDeleted`, `resetCursorStack` and `dataset-row-grid__draft`.

Evidence (probe scripts, logs and screenshots) is persisted under
`/home/matt/Development/helio/.concertino/runs/HEL-1080/evidence/.concertino/skeptic-f3/` and is
cited below by filename. All claims rest on content: logged DOM, focus and HTTP-status output, plus
screenshots. None rest on mtimes.

### What I verified (with evidence)

For each run I seeded fresh sources:
- A required-field source: `name` (string, required, no default), `qty` (integer) and `ok`
  (boolean).
- A 150-row pager source: `label` and `n`.

**Round-2 findings A–F: all six reproduce as fixed, live, against the real backend, in both
themes** (`run-dark-1.txt`, `run-light-1.txt`, `run2-*.txt`, `run3-light-pager.txt`).

- **A (404 on a row deleted concurrently): fixed.**
  - Edit path: the real PATCH returned **404**. The UI shows exactly one alert, "This row was
    already deleted by someone else. [Discard]". The phantom row is removed (0 cells), and focus
    lands on a gridcell. After Discard is activated by keyboard, focus lands on a gridcell.
  - Delete path: the real DELETE returned **404**, with the same single banner, the row removed,
    and focus on a gridcell.
  - Screenshots: `f3-light-a1-edit-on-deleted.png`, `f3-light-a2-delete-on-deleted.png`.
- **B (add row with a required field that has no default): fixed, driven by keyboard.**
  - Enter on "Add row" opens the draft.
  - Saving with `name` empty shows an inline "name is required and has no default." and sends no
    request (server total unchanged).
  - Typing `NEWROW`, `42` and Space for the checkbox, then Enter on Save row: real POST **200**,
    total 4→5, server row `["NEWROW",42,true]`, and the row renders in the grid.
  - A server-side 400 (`qty=1.5` gives `row 0: field 'qty' — expected integer, got number`)
    attaches to the qty draft field rather than a banner (`f3-light-draft-frac.png`).
- **C (pager after append): fixed.**
  - Adding a row on a 2-page source shows "Page 2" with `p101…` and `ADDED`. Prev is enabled and
    Next disabled. Refresh stays on Page 2, and Prev goes to Page 1 (`p1`).
  - Reproduced in dark (`run-dark-1.txt`) and in light (`run3-light-pager.txt`).
- **D (focus paths named in round 2): fixed.**
  - Delete key → focus on **Cancel**. Shift+Tab → Confirm.
  - After delete-confirm, delete-cancel, conflict Retry, conflict Discard, and "Delete anyway",
    focus lands on a `TD/gridcell` every time.
  - Keyboard Next to the last page → focus on Prev. Prev back to page 1 → focus on a gridcell.
- **E (duplicate banner): fixed.** An injected 500 on PATCH (`page.route`) rendered exactly one
  "Injected server failure [Retry]" alert. The 404 and 409 paths render one banner each.
- **F (conflict-banner buttons): fixed.** Computed styles show a 28px control height, a 1px
  hairline, a 6px radius and `0 12px` padding. Discard uses the muted Secondary style and
  "Delete anyway" the danger colour and border. They look correct in both themes
  (`f3-*-conflict-edit-banner.png`, `f3-*-conflict-delete-banner.png`). Decision 4's text now
  matches the code: Add row shows "Saving…" and is disabled while the request is in flight.
- **Round-1 behaviour still holds:**
  - A 409 edit conflict shows the current values, and Retry re-applies only my edited cell (server
    `["MINE",777,false]`).
  - Discard keeps the other client's value (`THEIRS`).
- **Gates, re-run by me:**
  - jest `DatasetRowGrid|datasetRowsSlice|DataGrid|useDatasetFieldEditor|parseDatasetRow`:
    11 suites / 207 tests passed.
  - `tsc --noEmit`: exit 0.
  - `eslint --max-warnings 0 src/features/sources`: exit 0.
  - The backend is unchanged since round 2.
- **Task 5.5 visual review (done by me, live, both themes):**
  - The grid, toolbar, conflict banner and draft form sit cohesively under the existing schema
    table on the source detail page (`f3-dark-conflict-edit.png`, `f3-light-s1-final.png`,
    `f3-light-draft-frac.png`, `f3-dark-draft-form.png`).
  - Both themes use the same surface, hairline and focus-ring language.
  - I found no new visual dialect.

### Verdict: REFUTE

The six round-2 defects are genuinely fixed, and I observed that live myself. The REFUTE rests on
two things. First, the explicit condition the owner attached to this extra round is unmet. Second,
the new draft form reintroduces exactly the defect class round 2's CR-D required to be eliminated.

### Change Requests

1. **CR-G — owner condition not met: there are no real-backend tests for the three cases round 2
   found evidence-gapped.**
   - The only e2e change on the branch is `e2e/focus-presence-guard.spec.ts`, which adds the
     `/sources/:id` route to the focus guard (task 5.3). No e2e or backend-integrated test drives:
     - (a) edit or delete of a row deleted concurrently, which must hit the real 404;
     - (b) add-row on a schema with a required field that has no default;
     - (c) pager state after add-row on a multi-page dataset.
   - Every new test in 47b58df9 is jest with a mocked service. The mocks now use the right codes,
     but this is the same class of evidence that let rounds 1 and 2 through.
   - Required: add a Playwright e2e spec, run via the pinned harness, that seeds a `static`/dataset
     source through the API and drives cases (a), (b) and (c) with real keyboard input against the
     real backend.
   - My probe `f3probe.cjs` (persisted, see above) is a working template for all three, including
     how to delete a row concurrently through the API.
2. **CR-H — the new add-row draft form drops focus to `<body>` on two keyboard paths.** This is the
   same defect class as round-2 CR-D, introduced by the Decision 11 form. It reproduced in both
   themes (`run2-light.txt`, `run2-dark.txt`, `run-*-1.txt`).
   - **Enter on "Add row" → `activeElement=BODY`.** `DatasetRowGrid.tsx:743` disables the button
     that was just pressed (`disabled={isAddingRow || …}`), and nothing moves focus into the form.
     The next Tab lands on Refresh, not the form. Screen readers get no announcement that the
     "New row" group opened.
     - Fix: autofocus the first editable draft input when `isAddingRow` becomes true, or don't
       disable Add row while the draft is open.
   - **Enter on "Save row" → `BODY`, both while submitting and after success.**
     `DatasetRowGrid.tsx:834` disables Save during the request, and the `.then` at `:697-700`
     unmounts the draft without restoring focus.
     - After success, return focus to the Add row button or to the new row's cell.
     - On a 400, keep focus in the form, ideally on the first field with an error. Do not disable
       the focused button in a way that blurs it. Using `aria-disabled`, or keeping focus on the
       field, both avoid that.
   - Cancel already does this correctly (`focusActiveCell`, `:659`). Mirror it.
   - Add jest `document.activeElement` assertions for both paths, and cover them in the CR-G e2e
     spec.
3. **CR-I — tasks.md 5.5 is still unchecked** (`tasks.md:49`).
   - I performed the visual review in this round, and the result is acceptable (above).
   - Check the task off, citing the screenshots persisted above, so archive hygiene does not trip
     on an open task.

### Non-blocking notes

- **Pager desync when a fetch fails.** In my light run, the backend rate limiter (120 req/min)
  started returning 429 partway through the pager steps.
  - `handleNext` (`:525`) pushes onto `cursorStack` **before** the fetch. On failure, the label
    advanced ("Page 3") while page-1 rows stayed on screen.
  - `.unwrap().then(...)` at `:526-533` has no `.catch`, which produced uncaught `PAGEERR Object`
    rejections (`run-light-1.txt`).
  - This is a failure path, not the happy path, but it is a real, user-reachable desync: push the
    cursor only on success, and add a `.catch`.
- `classifyRowMutationError` maps **every** 404 to "row already deleted". A 404 for a missing
  source (`RowMutationFailure.SourceNotFound` → "Data source not found",
  `DataSourceService.scala:819`) would be mis-labelled. Consider checking the message, or
  refreshing the source.
- The draft form's native checkbox is unstyled (13px, UA default) next to token-styled inputs. The
  inputs are 25px tall and the buttons 28px. This is minor polish.
- The existing schema table still shows inferred types (`qty float`, `Nullable no`), while the grid
  uses the declared schema. This predates the change; it is follow-up material.
- **Side effects in the shared dev DB:** I created four probe sources, the `SKEPTIC-F3 required *`
  and `SKEPTIC-F3 pager *` pairs (ids in the run logs), and mutated and deleted rows in them. No
  other data was touched.
