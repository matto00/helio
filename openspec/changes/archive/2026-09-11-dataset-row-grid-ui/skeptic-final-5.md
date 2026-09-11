## Skeptic Report — final gate (round 5, skeptic-final-5.md) — SCOPED RE-CHECK

This round was scoped by the owner. It covers CR-J, the sibling-path audit, the new e2e test, the
banner fix, the dev-DB cleanup, and the diff since round 4. I reviewed HEAD
`ae1f8786d583fafd1af3238e6ec0d54d5c1522a2`. The spawn-cwd guard printed
`READY ambient=/home/matt/Development/helio branch=feature/dataset-row-grid-ui/HEL-1080`.

### What I verified (with evidence)

**Diff scope (item 6)**
- `resolve-review-base.sh` resolved the base to `50993f49` (exit 0), and `fb034718` is an ancestor
  of HEAD.
- `git log fb034718..HEAD` shows exactly one commit, `ae1f8786`.
- `git diff --stat fb034718..HEAD` lists 6 files:
  - `DatasetRowGrid.tsx` (+24/-?)
  - `DatasetRowGridPagerAndFocusPaths.test.tsx`
  - `e2e/hel1080-dataset-row-grid-live.spec.ts`
  - `eslint.config.cjs`
  - `files-modified.md`
  - `skeptic-final-4.md` (the round-4 report being committed)
- Nothing outside the stated scope. No backend file changed.
- **`eslint.config.cjs`:** the only change is the ignore entry `.concertino/runs/**` becoming
  `.concertino/**`, plus its comment.
  - `git ls-files .concertino` shows only `laws/*.md` and `workflow-state.template.md` are
    tracked, so no tracked lintable code is hidden by this.
  - The evidence the widening exists for really does live outside `runs/`. For example, the
    round-4 probe is at `.concertino/skeptic-f4/f4focus.cjs`, and this round's probes are at
    `.concertino/skeptic-f5/`.

**CR-J (item 1): fixed, reproduced live**
- The code at `DatasetRowGrid.tsx:808-815` now sets `aria-disabled={isAddingRow || isAddRowSubmitting}`
  on "Add row", with no native `disabled`.
- The click guard is at `:695` (`if (!schema || isAddingRow || isAddRowSubmitting) return;`), and
  its dependency list was updated at `:703`.
- I used the same method as round 4: `page.route` delays the real add-row POST, then Enter on
  "Save row", sampling `activeElement` at 30, 150, 500 and 1500ms. I ran it in both themes, at
  300ms ×3 and 800ms ×3 each.
  - **Light: 6/6 OK. Dark: 6/6 OK.**
  - Focus reads `BUTTON/Saving…` in flight, then `BUTTON/Add row` at 150, 500 and 1500ms, with
    `dis=false`. Round 4 got `BODY` 6/6 at the same delays.
  - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1080/evidence/.concertino/skeptic-f5/run-2.txt`
    and probe `.../skeptic-f5/f5probe.cjs` (same evidence directory).
- **Click guard checked live:** I force-clicked the aria-disabled "Add row" while the draft was
  open. The draft value stayed intact (`"light-300-0"` and `"dark-300-0"`), so the draft was not
  reset.
- **No double-submit:** the final row total was 162, which equals 150 seeded + 12 adds.

**Sibling audit (item 2): credible**
- I read every `.focus()` site in `DatasetRowGrid.tsx`: lines 80, 88, 218, 232, 243, 252, 538, 571,
  752 and 771.
- The only other native `disabled` attributes are on:
  - Prev (`:824`) and Next (`:833`). Each one's cross-focus targets the *other* pager button, and
    the Next→Prev path is already rAF-deferred (`:571`).
  - Cancel (`:923`), which is never a focus target.
- ConfirmInline Cancel (`:243`) and the draft input (`:252`) have no disabled state.
- The `:771` error-field focus targets an input, not a disabled control.
- I found no other instance of this race.

**E2E test (item 3): real, and it passes**
- I ran `DEV_PORT=6512 BACKEND_PORT=9419 npx playwright test e2e/hel1080-dataset-row-grid-live.spec.ts`.
  Result: **4 passed (16.9s)**.
- The CR-J test delays only the POST by 500ms against the real backend (`route.continue`, not a
  mock). It waits for the real response, checks for status 200, and then asserts
  `toBeFocused()` on "Add row".
- It cannot pass trivially:
  - Focus starts on "Save row", which unmounts.
  - Under the old code, this exact condition produced `BODY` 6/6 in round 4.
  - `toBeFocused` needs real DOM focus.
- I did not revert the code to show it going red, because my role is read-only. The executor's
  revert-to-red claim is consistent with round 4's reproduction.

**Banner fix (item 4): verified live**
- `setBannerError(null)` was added in the success `.then()` of both `handlePrev` (`:536`) and
  `handleNext` (`:562`).
- Live, in both themes, I fulfilled the cursor GET with a 500 once and then let it through:
  - After the failed Next: the label stays "Page 1" and the banner reads
    "Request failed with status code 500 Retry".
  - After the successful Next: the label reads "Page 2" and the banner is empty.
- The only console error was the one I injected on purpose (the 500 resource load). There were no
  page errors.
- Screenshots in `.../skeptic-f5/`: `f5-{light,dark}-banner-fail.png` and
  `f5-{light,dark}-banner-cleared.png`.
- The two new jest tests cover failed-then-successful Next and failed-then-successful Prev. Each
  asserts the banner text is absent after the success.

**Dev DB (item 5): clean**
- `select count(*) from data_sources where name like 'SKEPTIC-F2%'` returned **0**.
- The same query for `SKEPTIC-F%` or `HEL-1080 e2e%` also returned 0 before my probes.
- Each of my 3 probe sources was deleted with 204, and I re-checked the count after my runs.

**Gates**
- jest `--testPathPatterns=DatasetRowGrid`: 6 suites, 60 tests, all passing.
- The servers were reused from the pinned run (`assert-phase.sh servers` printed PASS).
- The vite process cwd is this worktree.

### Verdict: CONFIRM

### Non-blocking notes
- **Visual affordance regression from the CR-J fix.** While the draft form is open, "Add row" now
  renders at full strength, identical to Refresh. Before the fix it was dimmed by
  `DatasetRowGrid.css:30` `.dataset-row-grid__toolbar button:disabled` (opacity 0.5,
  not-allowed cursor).
  - Screenshots: `.../skeptic-f5/f5-light-form-open.png` and `f5-dark-form-open.png`. In both,
    Prev is dimmed but Add row is not.
  - The harm is low, because the open form sits directly below the button and a click is a no-op.
    That is why I did not treat it as blocking.
  - Suggested one-line follow-up: extend that selector to
    `.dataset-row-grid__toolbar button:disabled, .dataset-row-grid__toolbar button[aria-disabled="true"]`.
- Evidence directory for all artifacts:
  `/home/matt/Development/helio/.concertino/runs/HEL-1080/evidence/.concertino/skeptic-f5/`. None of
  the claims above depend on mtime ordering.
