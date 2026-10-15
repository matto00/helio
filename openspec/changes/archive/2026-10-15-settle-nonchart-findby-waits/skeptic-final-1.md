## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 7e3479c6a2dd1136470b4d9e2c357559f88168dd. Base resolved live via `resolve-review-base.sh` (main/origin): 563a4c476c7f7340cf494deec06dbe6932edff7d (exit 0, non-empty).

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/settle-nonchart-findby-waits/HEL-1612`.
- **Diff scope** (`git diff $BASE...HEAD`): the only frontend changes are `frontend/src/test/settleChartMount.ts` (new `settleMocks`, shared `collectPending`; `settleChartMount` keeps `Promise.all` + the `ChartPanel` import, so its behavior is unchanged) and five `*.test.tsx` files. `git diff --name-only` filtered for non-test, non-openspec, non-`src/test/` paths returns nothing. No product code changed. `jest.config.cjs`/`setupTests.ts` diff is 0 lines, so the HEL-1600 network guard is untouched, and the diff adds no new `jest.mock`.
- **AC3 (no timeouts, retries or stall code)**: grepping added frontend lines for timeout/retry/retryTimes/asyncUtil/setTimeout/busy/stall finds one hit, a doc comment in `settleChartMount.ts` ("a main-thread stall of about 1 s ..."). `git grep "SCRATCH STALL" -- frontend` finds nothing.
- **AC1 (each listed wait)**: I checked each one against HEL-1599's measurements.md "Left" list (archive 2026-10-15-settle-lazy-chart-mounts, line 106-111):
  - chartTruncation: 7 `findByText` waits and the `waitFor(fetchHistory x2)` are now handled by `settleNote()`, which settles `getOutputById` and then `fetchHistory` in two stages before `getBy*`. The `waitFor` import is removed.
  - PublicDashboardViewerPage.truncation: settled in two stages (`fetchPanels`, then `fetchMeta, fetchRows`), then `getByText`.
  - PanelCard.crossFilter: the table and metric waits settle `getOutputByIdMock` before `getBy*`. Lines 307, 396 and 420 (HEAD) became `getBy` without a settle. The justification is sound: they follow a synchronous click/`act` with no pending promise. `useOutputMeta` reads the cache in the initializer, and the line after each one on main was already a synchronous `getByText`.
  - PanelFullscreenOverlay.test: both `findByRole("table")` waits are converted.
  - PanelContent.test: the metric, table, markdown and live-table waits are converted, plus the form wait. For markdown, `import("./MarkdownPanel")` resolves the same module as `renderers/MarkdownRenderer.tsx:11`'s `lazy(() => import("../MarkdownPanel"))`.
  - The only remaining `findBy*` waits in the touched files are `PanelFullscreenOverlay.test.tsx:118,161` `findByText("hello world")`. AC1 does not list them for that file, and measurements.md disposes of them explicitly ("left: green under both stalls").
- **AC2 red-before / green-after, re-run independently** on two files the evaluator did not re-run. I used the lane's `stalledit.py` method in my own wrapper (`scratchpad/hel1612/skeptic/sprobe.sh`). BEFORE installs the base-commit file content via `git show $BASE:<file>`, both sides get the identical stall edit, every run uses a cold cache, `CI=true nice -n 19 --maxWorkers=1`, and each probe ends with `git checkout --` to restore the file:
  - `PanelContent.test.tsx` (mocks `getOutputByIdMock,fetchDatasetSchemaMock`, 14 call sites):
    - BEFORE N=3: `rc=1 fired=14 Tests: 3 failed, 24 passed, 27 total` in every run. The failing tests are the metric placeholder, the markdown literal content and the live rows and headers, which matches measurements.md.
    - AFTER N=3: `rc=0 fired=14 Tests: 27 passed, 27 total` in every run.
  - `PublicDashboardViewerPage.truncation.test.tsx` (mocks `fetchPanels,fetchMeta,fetchRows`, 4 call sites):
    - BEFORE N=2: `rc=1 fired=6 Tests: 1 failed, 1 passed, 2 total`, failing on "names both counts ...".
    - AFTER N=2: `rc=0 fired=6 Tests: 2 passed, 2 total`.
  - The stall fired in every run, so neither result is a no-op.
- **AC5 full suite, re-run by me**: in `/home/matt/Development/helio/.claude/worktrees/task/settle-nonchart-findby-waits/HEL-1612/frontend`, `CI=true nice -n 19 npx jest --config jest.config.cjs --maxWorkers=3` gave rc=0, `Test Suites: 612 passed, 612 total; Tests: 7268 passed, 7268 total; Snapshots: 19 passed`. This matches the executor's and evaluator's counts.
- **Other gates**: `npm run typecheck` (frontend) rc=0, and `eslint --max-warnings=0` on the 6 changed frontend files rc=0.
- **UI judgment**: not applicable. The change is test-only with no rendered UI, so I started no servers and took no screenshots.
- **Worktree hygiene**: after my probes, `git status --short` shows only the evaluator's untracked `evaluation-1.md` (plus this report).

### Verdict: CONFIRM

### Non-blocking notes
- `PanelFullscreenOverlay.test.tsx:118,161` still use `findByText("hello world")` against the lazy `MarkdownPanel` chunk. AC1 does not list them and they are green under both stalls. The same `settleMocks(import("./MarkdownPanel"))` pattern used in PanelContent.test would make them deadline-free too, if a future flake points there.
- The measurements.md finding that "the first stall in a process is absorbed" (a single `-t` test passes even on main) is a useful caveat for future stall probes. Whole-file runs are the reliable proof.
