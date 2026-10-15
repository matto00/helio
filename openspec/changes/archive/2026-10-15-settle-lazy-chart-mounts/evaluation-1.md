## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `c4f46e2bdba94455e50137cd247699dbea184567` against the live-resolved base `10d8626cc3816fd4e8ec643c2c1ebace5d268ead`
(`resolve-review-base.sh`, origin/main). Worktree `/home/matt/Development/helio/.claude/worktrees/task/settle-lazy-chart-mounts/HEL-1599`.
All runs below: cwd = this worktree's `frontend/`, `CI=true nice -n 19`, `--maxWorkers=1` (single file) / `--maxWorkers=3` (suites),
cold `--cacheDirectory` per run, strictly sequential. Every scratch edit was restored with `git checkout --`; `git status --short` is empty.

### Phase 1: Spec Review — FAIL

- AC1 (probe the two named files with HEL-1596's method): PASS. Independently reproduced (below).
- AC2 (HEL-1596 pattern, shared helper): PASS. `frontend/src/test/settleChartMount.ts` is the HEL-1596 body generalised to N sources;
  crossFilter's local copy is removed and migrated.
- AC3 (red before / green after): PASS for the converted sites. Reproduced two pairs myself at an identical injection point (below).
- AC4 (sweep, every site converted and every site left with reasons): **FAIL** — one lazy-chart wait is neither converted nor listed:
  `frontend/src/features/panels/ui/PanelContent.chartTruncation.test.tsx:168-170`
  `await waitFor(() => expect(screen.getByTestId("echarts").getAttribute("data-option")).toContain("vs 7d"))`.
  It is the first chart query in its test, so its target only exists after the lazy `ChartPanel` mounts — exactly design.md's sweep
  definition ("`waitFor` blocks that query a chart marker"). measurements.md's "Left" row for this file lists only the `findByText(NOTE)`
  lines (93, 99, 131, 151, 153, 170, 179), not this `waitFor`. **It is exposed**: with a 1200 ms busy-wait queued in a microtask
  immediately before the `waitFor` (so after `waitFor` arms its 1 s timer), `-t "leaves the vs overlay hidden"` failed 3/3 (stall fired
  3/3) with `Unable to find an element by: [data-testid="echarts"]` and the CI failure DOM
  `class="suspense-fallback suspense-fallback--panel"`; the same test without the stall passes.
  Why the sweep missed it: (a) the inventory grep `grep 'chart-panel\|echarts' ... | grep 'findBy\|findAllBy\|waitFor'` is
  single-line and this `waitFor` spans three lines; (b) the generic `arm` probe only stalls when the timer is armed from a stack that
  contains `query-helpers` (`findBy*`), so a bare `waitFor` is never stalled. The "after `arm` stall: chart-wait failures 0 in all 15 files"
  claim therefore covers `findBy*` only, not `waitFor`.
- AC5 (no raised timeouts / retries): PASS. The diff adds no `timeout:` option, no `retryTimes`, no stall code
  (`git grep -n 'STALL\|retryTimes'` under `frontend/src` hits nothing; the three `timeout:` hits are pre-existing, untouched files).
- Tasks marked done: 1.1 / 3.4 claim a complete inventory, which the site above contradicts.
- Scope: test-only plus change artifacts; no product code. PASS.
- CONSTRAINTS C1/C2/C3: honored in the diff (no timeouts/retries; no scratch stall committed). PASS.

### Phase 2: Code Review — PASS

Gates run fresh by me in this worktree (HEAD c4f46e2bd):
- `npm run lint` exit 0; `npm run format:check` exit 0 ("All matched files use Prettier code style!"); `npm --prefix frontend run typecheck` exit 0.
- root `CI=true nice -n 19 npx jest --maxWorkers=3`: Test Suites 51 passed, Tests 469 passed, exit 0.
- `frontend/`: `CI=true nice -n 19 npx jest --config jest.config.cjs --maxWorkers=3`: Test Suites 612 passed / 612, Tests 7268 passed / 7268, exit 0.
- `npm --prefix frontend run build` exit 0.

Independent verification of the brief's points:
1. **Red/green fairness.** I did not rely on the executor's `act`-mode stall (it stalls inside the helper, a point the old code never had,
   so on its own it would not be a like-for-like comparison). Instead I injected the stall at the *same* source point in both versions:
   - `PanelCard.inspect.test.tsx`, exact HEL-1596 method (busy-wait 1200 ms in the `getOutputById` mock's resolution microtask):
     base file (10d8626cc) 3/3 red, `Unable to find an element by: [data-testid="echarts"]`, suspense fallback in the dump (1-2 of 5 tests
     failing per run); branch file 3/3 green, 5/5 tests. Stall fired in every run.
   - `ChartRenderer.timeNote.test.tsx -t "states how many rows"` (no data source; a 1200 ms microtask stall queued right after `render`,
     i.e. after the wait began): base 3/3 red with the same message; branch 3/3 green. Stall fired every run. This also confirms the
     executor's finding that the D1 "absorbed" prediction does not hold for directly rendered `ChartRenderer` files.
   The comparison is fair: same stall, same place; the fix removes the 1 s deadline, so the only thing that can still fail is the
   helper returning before the mount, which the sync `getBy*` would catch.
2. **Regression guard.** The `-MUT` rename only proves `getByTestId` throws for a non-existent id (largely tautological). A stronger guard,
   run by me: deleting the first `await settleChartMount(getOutputByIdMock);` in `PanelCard.inspect.test.tsx` turns it red
   (1 failed / 5, `Unable to find an element by: [data-testid="echarts"]`), so the helper is load-bearing and the sync query really asserts
   the mounted chart. The downstream assertions are unchanged lines. Acceptable.
3. **Sweep** — see Phase 1 (one missed exposed site).
4. **No timeouts/retries/scratch code** — confirmed.

Code: helper is small, typed without `any`, carries a why-comment; conversions are mechanical and DRY. No CONTRIBUTING mechanical violations found.

### Phase 3: UI Review — N/A

Test-only change (no product UI code); orchestrator-scoped as non-UI.

### Overall: FAIL

### Change Requests

1. `frontend/src/features/panels/ui/PanelContent.chartTruncation.test.tsx:167-170` — convert the exposed `waitFor(() => expect(screen.getByTestId("echarts")...).toContain("vs 7d"))`
   to the HEL-1596 pattern: await the causal promises with `settleChartMount` (the output meta `getOutputById` and the overlay's
   `fetchHistory`; if `fetchHistory` is only issued after the meta resolves, settle in two steps as in
   `PublicDashboardViewerPage.truncation.test.tsx:97-98`), then assert synchronously. Record before (red, stall fired) / after (green,
   stall fired) with the stall at the same point in both, and the clean 10-run result, in measurements.md.
2. `openspec/changes/settle-lazy-chart-mounts/measurements.md` — fix the sweep method so it cannot miss multi-line `waitFor` sites
   (e.g. `grep -rn -A6 'waitFor(' src --include=*.test.tsx | grep 'echarts\|chart-panel'`, which finds this site and no other), add
   the command to the inventory, add this site to the converted table, and qualify the "after `arm` stall: chart-wait failures 0" line
   as covering `findBy*` waits only (the `arm` probe never stalls a bare `waitFor`).

### Non-blocking Suggestions

- Replace or supplement the `-MUT` regression guard in measurements.md with the "remove the `settleChartMount` call -> red" mutation,
  which proves the helper is load-bearing rather than that `getByTestId` throws on an unknown id.
