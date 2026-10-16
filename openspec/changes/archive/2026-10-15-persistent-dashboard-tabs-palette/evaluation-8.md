## Evaluation Report — Cycle 8 (evaluation-8.md)

Reviewed head: `c999d3ccfa9807956eab49b3f41b90176ecc1cd0` (origin/main is an ancestor, checked with `git merge-base --is-ancestor`).
Scope: the delta since evaluation-7's FAIL on `7b5945234`. The rest of the branch was reviewed in evaluations 1 to 7 and is unchanged.

### Phase 1: Spec Review — PASS
Issues: none.

- `git diff --name-only 7b5945234..HEAD` lists exactly four files: `e2e/hel1457-stale-tab-layout-save.spec.ts`,
  `frontend/src/app/hidesBreadcrumbItemName.ts`, `ci-fix-cycle.md` and `evaluation-7.md` (my own previous report, now committed). There is one commit, `c999d3ccf`.
- The claim matches the diff. The spec adds `await expect(page.getByLabel("Loading panels")).toHaveCount(0)` after the `.react-grid-item` count wait at both
  goto sites (lines 44 and 120). It also adds `await expect(page.getByRole("button", { name: "Done" })).toBeVisible()` after the guarded click in `dragA` (line 126).
  The frontend change is a two-line comment only, with no code change. The `ci-fix-cycle.md` change adds the evaluation-7 section and corrects the
  `processedWidth` attribution.
- The diff touches no constraints in workflow-state.md: C1 to C7 are honored as previously evaluated.

### Phase 2: Code Review — PASS
Issues: none.

- **No assertion was weakened.** The spec hunks add lines and remove none. Every existing `expect` is unchanged, and the new lines are stricter waits and
  assertions.
- **The selectors match real UI.** `aria-label="Loading panels"` is on the skeleton root (`frontend/src/features/panels/ui/grid/PanelGridSkeleton.tsx:28`).
  `"Done"` is the toggle's on-label (`frontend/src/app/dashboardMeta/DashboardMetaRow.tsx:107`). Both new waits therefore wait on the real cause:
  the skeleton is gone, and edit mode is actually on.
- **I checked the sweep claim independently with grep.**
  - `grep -l 'Edit layout\|panel-grid-card__handle\|mouse.down' e2e/*.ts` matches hel1457, hel1028, hel1230, hel1574, hel1575-dashboard-tabs and hel1605.
  - `grep -rn 'count()) > 0)' e2e/` matches only three guarded clicks:
    - hel1457:125, which is now followed by the "Done" assertion;
    - hel1575-dashboard-tabs:190 and hel1028:120, where `enterLayoutEditMode` already asserts "Done".
  - hel1028 already waits for "Loading panels" to reach count 0 (line 78).
  - hel1230:82 uses an unconditional click, which auto-waits for the real-grid-only button.
  - hel1574 and hel1605 match only `mouse.down`, which they use for non-grid drags.
  - No other instance of the skeleton-satisfiable guarded-click pattern exists. The sweep claim holds.
- **Gates were run fresh by me on this head.** Transcript: `/home/matt/Development/helio/.concertino/scratch/HEL-1575/eval8/static.txt`, header
  `pwd=<worktree> head=c999d3ccfa98...`.
  - `npm run lint`: exit 0.
  - `npm run typecheck`: exit 0.
  - `npm run format:check`: exit 0 ("All matched files use Prettier code style!").
  - I did not re-run full jest. The only `frontend/src` change is a comment. The executor's `fix2d/static.txt` reports 650 suites and 7761 tests, but it ran on
    `7b5945234` plus the uncommitted fix, not on the committed head. I accept it given that the commit adds only a comment.
- **Executor evidence checked.**
  - `fix2d/hel1457-prefix2.txt` shows a real red before the fix: 1 failed and 31 passed at 16x, on `7b5945234`.
  - `fix2d/hel1457-postfix.txt` shows 24 passed. It was run on `7b5945234 (+uncommitted fix)` rather than the committed head. My own run below covers the
    committed head.
  - `fix2d/e2e-full.txt` shows head `c999d3ccf` with 333 passed and 1 skipped, exit 0.

### Phase 3: UI Review — PASS
Issues: none. The only UI-path change is a comment, so the behavior change since evaluation 7 is nil. The gate that failed last time is the e2e suite, and it was re-run here.

- **hel1457 with `--repeat-each 8`, 2 workers, `nice -n 19`.** DEV_PORT 7007, BACKEND_PORT 9914, servers from `start-servers.sh`, the same `DATABASE_URL`
  (`helio`) for the backend and Playwright. Header `pwd=<worktree> head=c999d3ccfa98... load=3.06`.
  Result: **16 passed (52.9s), exit 0**. Transcript: `/home/matt/Development/helio/.concertino/scratch/HEL-1575/eval8/hel1457.txt`.
- **Full e2e suite under the lock.** Command: `flock -w 3600 .../scratchpad/e2e.lock`, then `npx playwright test --workers 2` under `nice -n 19`.
  Header `pwd=<worktree> head=c999d3ccfa9807956eab49b3f41b90176ecc1cd0 load=4.85`.
  Result: **334 tests, 333 passed, 1 skipped, 0 failed (20.5m), exit 0**. There are zero `✘` lines.
  The skipped test is the opt-in `hel1575-switch-measurement.spec.ts:70`.
  Transcript: `/home/matt/Development/helio/.concertino/scratch/HEL-1575/eval8/e2e-full.txt`.
- I stopped the servers with `stop-servers.sh` (`STOPPED ports=7007,9914`). After all runs, HEAD was still `c999d3ccf` and the worktree was clean.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `hel1230-drag-then-create-persists.spec.ts:82-84` and the first hel1457 test (lines 46-48) call `handle.boundingBox()!` right after the Edit-layout click,
  without an explicit visibility wait on the handle. The auto-waiting click only proves that the real grid mounted, so this is not the evaluation-7 pattern.
  A `await expect(handle).toBeVisible()` before `boundingBox()` would make any future null fail at its cause. This is optional, and both passed 16/16 and in the full run here.
