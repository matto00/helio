## Skeptic Report — final gate (round 4, skeptic-final-4.md)

I reviewed HEAD `fb0347186bb71081092fefb35469991514eeff20`. The diff base is `50993f49`, resolved
live via `resolve-review-base.sh`.

- `assert-cwd.sh` returned READY.
- `start-servers.sh` reused healthy servers on :6512 and :9419, and `assert-phase.sh servers`
  returned PASS.
- Evidence is persisted under `/home/matt/Development/helio/.concertino/runs/HEL-1080/evidence/.concertino/skeptic-f4/`
  and cited below by filename.
- Every claim rests on logged DOM, focus and HTTP output, plus screenshots. None rests on mtimes.

### What I verified (with evidence)

- **CR-G: the e2e spec exists, runs against the real backend, and passes.**
  - `e2e/hel1080-dataset-row-grid-live.spec.ts` seeds real `static` sources through `/api/data-sources`.
    It deletes rows concurrently through the real row API, and asserts real response statuses
    (PATCH 404, POST 200). It uses no `page.route` mocks.
  - I ran it myself with `DEV_PORT=6512 BACKEND_PORT=9419 npx playwright test e2e/hel1080-dataset-row-grid-live.spec.ts --repeat-each=2`,
    and got **6 passed (24.4s), exit 0**.
  - The assertions are meaningful, not vacuous:
    - (a) asserts status 404, the "already deleted" alert, no "changed concurrently"/Retry, the
      phantom row removed, and focus on a TD after Discard.
    - (b) asserts no POST is sent while the required field is blank, then a real 200, the row
      rendered, and total 2.
    - (c) asserts "Page 2" after the add, Prev enabled and Next disabled, then Prev back to page 1
      showing p0, and Refresh staying on page 1.
  - The claimed revert-to-red demonstrations are plausible, because each one targets code that
    the assertions really depend on.
  - One caveat applies to CR-H: see below.
- **CR-H path 1 (Enter on Add row): fixed.** Focus lands on `INPUT#dataset-row-grid__draft-name`
  in both themes (`run-light.txt`, `run-dark.txt`).
- **CR-H, the 400 path: fixed.** A POST with qty=1.5 returns a real 400, the error attaches to the
  field, and focus moves to `INPUT#dataset-row-grid__draft-qty` in both themes.
- **Save while in flight:** the button shows `aria-disabled=true` and is not natively disabled, so
  it keeps focus. The double-submit guard holds: 12 saves, 3 of them double-Enter, produced exactly
  12 new rows (`run-focus-1.txt`, total 13).
- **CR-H path 2 (focus after a successful Save): NOT fixed under real latency.** See CR-J.
- **Source-missing 404 vs deleted-row 404: fixed, live.**
  - Deleted row: the alert reads "This row was already deleted by someone else. [Discard]".
  - Deleted source: the real PATCH returns 404 `{"message":"Data source not found"}`, and the UI
    shows a generic "Data source not found [Retry]" banner.
  - Evidence: `f4-*-row-deleted.png`, `f4-*-source-missing.png`.
  - The backend string matches `DataSourceService.scala:751/769/776` exactly.
- **Pager desync and unhandled rejection: fixed, under real network conditions**, tested with an
  injected 429 or 500 through `page.route`.
  - A failed Next leaves the label at "Page 1" with p0 still shown, adds a banner, and raises
    **0 pageerrors**.
  - A failed Prev leaves the label at "Page 2" with p100 still shown, adds a banner, and raises
    0 pageerrors.
  - The following successful Next/Prev lands correctly. Keyboard Next to the last page moves
    focus to Prev. Both themes behave the same.
- **Checkbox: styled.** It gets the `dataset-row-grid__draft-checkbox` class, measures 18×18px,
  and `accent-color` resolves to `--app-accent` (#eab308). It looks cohesive in both themes
  (`f4-light-draft-open.png`, `f4-dark-draft-400.png`).
- **CR-I:** tasks.md 5.5 is checked, and it cites the round-2 and round-3 visual reviews.
- **Gates, re-run by me:**
  - jest `DatasetRowGrid|datasetRowsSlice|DataGrid|useDatasetFieldEditor|parseDatasetRow`:
    11 suites / 211 tests passed.
  - `tsc --noEmit`: exit 0.
  - `eslint --max-warnings 0 src/features/sources src/shared/ui` plus the new spec: exit 0.
- **Dev DB:** `select count(*) from data_sources where name like 'SKEPTIC-F4%' or 'SKEPTIC-F3%' or 'HEL-1080 e2e%'`
  returns **0**. My own 7 probe sources were deleted with 204; one was already deleted as part of
  the source-missing test.
- **Overall:** the rest of HEL-1080 and HEL-1122 still holds as established in rounds 1–3. The
  backend is unchanged since round 3.

### Verdict: REFUTE

### Change Requests

1. **CR-J: a successful add-row Save still drops focus to `<body>` whenever the POST takes more
   than a few milliseconds.** This is CR-H path 2, which the owner explicitly required, and it is
   not actually fixed.
   - **Reproduction:** probe `f4focus.cjs`, log `run-focus-1.txt`. Delaying the real POST by
     300ms or 800ms (`page.route` then `continue`) and pressing Enter on Save gave focus
     **`BODY` at 150, 500 and 1500ms, 6 out of 6 times**.
   - It also reproduced in both theme runs (`run-*.txt`, "H2 after success ae= BODY").
   - With no added latency it works 6 out of 6 times, which is the only condition the localhost
     e2e covers. That is why case (b)'s `toBeFocused` passes while real users on a real network
     would hit the defect.
   - **Mechanism, from the log:** "Add row" still reads `disabled=true` at 30ms after the response.
     - `DatasetRowGrid.tsx:794` sets `disabled={isAddingRow || isAddRowSubmitting}`.
     - `isAddRowSubmitting` is cleared only in `.finally` (`:767`).
     - The `requestAnimationFrame(() => addRowButtonRef.current?.focus())` at `:742` runs while
       the button is still natively disabled, so `.focus()` silently does nothing.
     - Nothing retries the focus afterwards.
   - **Fix:** focus from an effect that fires once the form has closed and submission has ended.
     For example, a `useEffect` on `[isAddingRow, isAddRowSubmitting]` guarded by a
     "just-saved" ref. Alternatively, clear `isAddRowSubmitting` in the same update as
     `setIsAddingRow(false)`.
   - **Test:** add a latency case to the e2e spec (`page.route` delay of 500ms or more on the
     POST, then `expect(addRowButton).toBeFocused()`), and demonstrate that it is red before the
     fix.

### Non-blocking notes

- After a failed pager fetch, the error banner stays up even after a later Next/Prev succeeds
  (`run-*.txt` P2/P4). Consider clearing `bannerError` when a page fetch succeeds.
- The shared dev DB still holds older `SKEPTIC-F2 *` probe sources that predate this round (visible
  in the sidebar in `f4-light-source-missing.png`). I did not touch them.
