# HEL-1599 measurements (probe, convert, red-before / green-after)

Environment: worktree `/home/matt/Development/helio/.claude/worktrees/task/settle-lazy-chart-mounts/HEL-1599`, cwd `frontend/`,
Node v22, `CI=true`, `nice -n 19`, `--maxWorkers=1` for single files (`--maxWorkers=3` for folders), cold `--cacheDirectory`
(removed before every probe run), strictly sequential. Stall `STALL_MS=1200`, N=5 per file unless noted. Every run below is in this
worktree (paths above) and ran non-zero tests. Stall instrumentation is scratch only (outside the repo, in the session scratchpad);
test files edited for the exact-method probes were restored from a backup copy and `git grep "SCRATCH STALL"` returns nothing.

## Probe method (and a deviation from design.md D1, stated up front)

design.md D1 specified one injection point per file (the `getOutputById` mock resolution microtask, or inside the lazy require for
files with no async boundary, predicted "absorbed"). Applying that per file would have needed ~15 hand edits, so the sweep used one
generic scratch jest setup file (`--config` wrapper that appends `setupFilesAfterEnv`), which needs no per-file edit:

- `STALL_MODE=arm` (BEFORE evidence): wraps `global.setTimeout`; when RTL's `waitFor` arms its 1000 ms `handleTimeout` for a
  `findBy*`/`findAllBy*` (stack contains `query-helpers`), a microtask queued right after busy-waits `STALL_MS`, only if the
  timer was not already cleared (so the wait really was pending). It appends `fired` to `$STALL_FIRED`. This is the same
  mechanism as HEL-1596 (stall after `findBy` armed its 1 s timer, before the lazy mount), at the earliest point instead of in the
  mock resolution. Failures are classified by message: `data-testid="echarts"` / `"chart-panel"` = chart-wait failure,
  other `Unable to find` = a non-chart wait that the same stall also breaks.
- `STALL_MODE=act` (AFTER evidence for converted sites): converted sites have no pending `findBy*`, so `arm` would not fire.
  This wraps `React.act`; when called from `settleChartMount` it busy-waits `STALL_MS` inside the act scope before the helper's
  body runs (stall after the wait began, before the chart mounts). Fires once per helper call.
- Exact HEL-1596 method for the two ticket-named files (AC1): the stall in the `getOutputById` mock's resolution microtask
  (`getOutputByIdMock.mockResolvedValue` replaced by a `mockImplementation` that busy-waits then returns the value).
- Finding that contradicts design.md D1: files that render `ChartRenderer` directly (no mocked data source) are NOT "absorbed".
  `ChartRenderer{,.timeNote,.histogramNote}` fail 5/5 under the `arm` stall (the stall delays React's post-resolution retry past
  the overdue 1 s timer). Only a stall strictly inside the lazy `require` is absorbed (HEL-1596), and that is not where a
  stall landing after `findBy` arms falls. So no file was left as "not exposed by any injectable point".
- Which tests fail: only the first test of a file to load `ChartPanel` pays the lazy-chunk cost (later tests find it resolved),
  so a whole-file run fails some tests and `-t <single test>` fails whichever test is first. All chart waits in an exposed file
  were converted, so the result does not depend on test order or filtering.

Literal commands (scratch config `$S/jest.stall.config.cjs` = base `frontend/jest.config.cjs` + `rootDir` + `$S/stall.setup.js`):

    STALL_MODE=<arm|act> STALL_MS=1200 STALL_FIRED=$S/fired CI=true nice -n 19 \
      npx jest -c $S/jest.stall.config.cjs --maxWorkers=1 --cacheDirectory=$S/cache <file>      # cache dir removed before each run
    STALL_MS=1200 STALL_FIRED=$S/fired CI=true nice -n 19 npx jest --maxWorkers=1 --cacheDirectory=$S/cache <file> [-t "<test>"]   # exact method (file-edited)

## Before (unmodified tests on main 60086f02b): `arm` stall, 1200 ms, N=5, whole file

All 15 swept files (13 `findByTestId("echarts")` files + `PanelContent.test.tsx` + already-fixed `PanelCard.crossFilter`) and the two truncation
files. `chart-wait` = runs whose failure names the echarts / chart-panel element. "other" = runs that also failed a non-chart wait.

```
panels/ui/PanelCard.inspect  mode=arm STALL_MS=1200 N=5 pass=0 fail=5 fired_runs=5 chart_wait_fail_runs=5 other_fail_runs=0 tests: 2 failed, 3 passed, 5 total
panels/ui/PanelCard.aggregateChart  mode=arm STALL_MS=1200 N=5 pass=0 fail=5 fired_runs=5 chart_wait_fail_runs=5 other_fail_runs=0 tests: 4 failed, 4 passed, 8 total
panels/ui/PanelCard.aggregatePieChart  mode=arm STALL_MS=1200 N=5 pass=0 fail=5 fired_runs=5 chart_wait_fail_runs=5 other_fail_runs=0 tests: 1 failed, 1 passed, 2 total
panels/ui/PanelContent.chartTruncation  mode=arm STALL_MS=1200 N=5 pass=0 fail=5 fired_runs=5 chart_wait_fail_runs=5 other_fail_runs=5 tests: 4 failed, 4 passed, 8 total
panels/ui/PanelFullscreenOverlay  mode=arm STALL_MS=1200 N=5 pass=0 fail=5 fired_runs=5 chart_wait_fail_runs=5 other_fail_runs=5 tests: 2 failed, 10 passed, 12 total
panels/ui/PanelFullscreenOverlay.aggregateChart  mode=arm STALL_MS=1200 N=5 pass=0 fail=5 fired_runs=5 chart_wait_fail_runs=5 other_fail_runs=0 tests: 1 failed, 1 total
panels/ui/detailModal/PanelDetailModal.aggregateChart  mode=arm STALL_MS=1200 N=5 pass=0 fail=5 fired_runs=5 chart_wait_fail_runs=5 other_fail_runs=0 tests: 1 failed, 1 passed, 2 total
panels/ui/detailModal/PanelDetailModal.chartTypeDefault  mode=arm STALL_MS=1200 N=5 pass=0 fail=5 fired_runs=5 chart_wait_fail_runs=5 other_fail_runs=0 tests: 1 failed, 1 total
panels/ui/detailModal/PanelDetailModal.editScrollFade  mode=arm STALL_MS=1200 N=5 pass=0 fail=5 fired_runs=5 chart_wait_fail_runs=5 other_fail_runs=0 tests: 2 failed, 1 passed, 3 total
panels/ui/renderers/ChartRenderer  mode=arm STALL_MS=1200 N=5 pass=0 fail=5 fired_runs=5 chart_wait_fail_runs=5 other_fail_runs=0 tests: 1 failed, 9 passed, 10 total
panels/ui/renderers/ChartRenderer.timeNote  mode=arm STALL_MS=1200 N=5 pass=0 fail=5 fired_runs=5 chart_wait_fail_runs=5 other_fail_runs=0 tests: 1 failed, 5 passed, 6 total
panels/ui/renderers/ChartRenderer.histogramNote  mode=arm STALL_MS=1200 N=5 pass=0 fail=5 fired_runs=5 chart_wait_fail_runs=5 other_fail_runs=0 tests: 1 failed, 3 passed, 4 total
dashboards/ui/PublicDashboardViewerPage.truncation  mode=arm STALL_MS=1200 N=5 pass=0 fail=5 fired_runs=5 chart_wait_fail_runs=5 other_fail_runs=5 tests: 2 failed, 2 total
panels/ui/PanelContent  mode=arm STALL_MS=1200 N=5 pass=0 fail=5 fired_runs=5 chart_wait_fail_runs=5 other_fail_runs=5 tests: 8 failed, 19 passed, 27 total
panels/ui/PanelCard.crossFilter  mode=arm STALL_MS=1200 N=5 pass=0 fail=5 fired_runs=5 chart_wait_fail_runs=0 other_fail_runs=5 tests: 3 failed, 4 passed, 7 total
panels/ui/PanelFullscreenOverlay.truncation  mode=arm STALL_MS=1200 N=5 pass=5 fail=0 fired_runs=5 chart_wait_fail_runs=0 other_fail_runs=0 tests: 1 passed, 1 total
panels/ui/detailModal/PanelDetailModal.truncation  mode=arm STALL_MS=1200 N=5 pass=5 fail=0 fired_runs=5 chart_wait_fail_runs=0 other_fail_runs=0 tests: 1 passed, 1 total
```

Reading: every converted file is red 5/5 with the stall fired 5/5 and a chart-wait failure in 5/5 runs. `PanelCard.crossFilter` shows 0 chart-wait
failures (already fixed by HEL-1596); its 5/5 red is non-chart `findByText`/`findByRole("table")` waits that this arm-everything stall also breaks
(out of scope, see inventory). Both truncation files are green 5/5 with the stall fired 5/5: their `findByText` target is the truncation note, rendered
outside the `Suspense` boundary, so they are not exposed to the lazy mount and were left unchanged.

Failure DOM excerpt (PanelCard.inspect, exact HEL-1596 method, run 1): `Unable to find an element by: [data-testid="echarts"]`; the dumped card holds
`class="suspense-fallback suspense-fallback--panel"` in `chart-panel__canvas` (the CI failure DOM). aggregateChart run 1: identical message, fallback at log line 181.

### Exact HEL-1596 method on the two ticket-named files (AC1/AC3)

| file | mode | before pass/fail (fired) | after pass/fail (fired) |
| --- | --- | --- | --- |
| PanelCard.inspect | whole file, N=5 | 0/5 (5/5), 2 of 5 tests fail | 5/0 (5/5) |
| PanelCard.inspect | `-t "shows an Inspect item"`, N=3 | 0/3 (3/3) | 3/0 (3/3) |
| PanelCard.aggregateChart | whole file, N=5 | 0/5 (5/5), 4 of 8 tests fail | 5/0 (5/5) |
| PanelCard.aggregateChart | `-t "the 'vs' overlay"`, N=3 | 0/3 (3/3) | 3/0 (3/3) |

## After (converted tests)

### `act` stall inside `settleChartMount`, 1200 ms, N=5, whole file (stall fired in every run)

```
panels/ui/PanelCard.inspect  mode=act STALL_MS=1200 N=5 pass=5 fail=0 fired_runs=5 chart_wait_fail_runs=0 other_fail_runs=0 tests: 5 passed, 5 total
panels/ui/PanelCard.aggregateChart  mode=act STALL_MS=1200 N=5 pass=5 fail=0 fired_runs=5 chart_wait_fail_runs=0 other_fail_runs=0 tests: 8 passed, 8 total
panels/ui/PanelCard.aggregatePieChart  mode=act STALL_MS=1200 N=5 pass=5 fail=0 fired_runs=5 chart_wait_fail_runs=0 other_fail_runs=0 tests: 2 passed, 2 total
panels/ui/PanelContent.chartTruncation  mode=act STALL_MS=1200 N=5 pass=5 fail=0 fired_runs=5 chart_wait_fail_runs=0 other_fail_runs=0 tests: 8 passed, 8 total
panels/ui/PanelFullscreenOverlay  mode=act STALL_MS=1200 N=5 pass=5 fail=0 fired_runs=5 chart_wait_fail_runs=0 other_fail_runs=0 tests: 12 passed, 12 total
panels/ui/PanelFullscreenOverlay.aggregateChart  mode=act STALL_MS=1200 N=5 pass=5 fail=0 fired_runs=5 chart_wait_fail_runs=0 other_fail_runs=0 tests: 1 passed, 1 total
panels/ui/detailModal/PanelDetailModal.aggregateChart  mode=act STALL_MS=1200 N=5 pass=5 fail=0 fired_runs=5 chart_wait_fail_runs=0 other_fail_runs=0 tests: 2 passed, 2 total
panels/ui/detailModal/PanelDetailModal.chartTypeDefault  mode=act STALL_MS=1200 N=5 pass=5 fail=0 fired_runs=5 chart_wait_fail_runs=0 other_fail_runs=0 tests: 1 passed, 1 total
panels/ui/detailModal/PanelDetailModal.editScrollFade  mode=act STALL_MS=1200 N=5 pass=5 fail=0 fired_runs=5 chart_wait_fail_runs=0 other_fail_runs=0 tests: 3 passed, 3 total
panels/ui/renderers/ChartRenderer  mode=act STALL_MS=1200 N=5 pass=5 fail=0 fired_runs=5 chart_wait_fail_runs=0 other_fail_runs=0 tests: 10 passed, 10 total
panels/ui/renderers/ChartRenderer.timeNote  mode=act STALL_MS=1200 N=5 pass=5 fail=0 fired_runs=5 chart_wait_fail_runs=0 other_fail_runs=0 tests: 6 passed, 6 total
panels/ui/renderers/ChartRenderer.histogramNote  mode=act STALL_MS=1200 N=5 pass=5 fail=0 fired_runs=5 chart_wait_fail_runs=0 other_fail_runs=0 tests: 4 passed, 4 total
dashboards/ui/PublicDashboardViewerPage.truncation  mode=act STALL_MS=1200 N=5 pass=5 fail=0 fired_runs=5 chart_wait_fail_runs=0 other_fail_runs=0 tests: 2 passed, 2 total
panels/ui/PanelContent  mode=act STALL_MS=1200 N=5 pass=5 fail=0 fired_runs=5 chart_wait_fail_runs=0 other_fail_runs=0 tests: 27 passed, 27 total
panels/ui/PanelCard.crossFilter  mode=act STALL_MS=1200 N=5 pass=5 fail=0 fired_runs=5 chart_wait_fail_runs=0 other_fail_runs=0 tests: 7 passed, 7 total
```

### `arm` stall on the converted files (confirms no chart wait remains)

chart-wait failures: 0 in all 15 files x 5 runs (this `arm` probe stalls `findBy*`/`findAllBy*` waits only; it never stalls a bare `waitFor`, which is how cycle 1 missed the `waitFor` site fixed below). 11 files have no pending `findBy*` left, so the stall never fires (`fired_runs=0`, they pass
5/5, which here only means "nothing to race"). The 4 files that still contain non-chart `findBy*`/`findByText`/`findByRole` waits fail them
under this stall exactly as before (none names a chart element):
`PanelContent.chartTruncation` (2 tests, `findByText` truncation note after `fetchHistory`), `PanelFullscreenOverlay.test` (1, `findByRole("table")`),
`PublicDashboardViewerPage.truncation` (1, note `findByText`), `PanelContent.test` (3, metric/markdown/table `findByText`/`findByTestId("markdown-content")`),
`PanelCard.crossFilter` (3, `findByRole("table")`/`findByText`).

### Clean (no stall) after: 10 cold-cache `CI=true` runs per converted file, single file, `--maxWorkers=1`

| file | result |
| --- | --- |
| panels/ui/PanelCard.inspect | N=10 pass=10 fail=0, Tests: 5 passed, |
| panels/ui/PanelCard.aggregateChart | N=10 pass=10 fail=0, Tests: 8 passed, |
| panels/ui/PanelCard.aggregatePieChart | N=10 pass=10 fail=0, Tests: 2 passed, |
| panels/ui/PanelContent.chartTruncation | N=10 pass=10 fail=0, Tests: 8 passed, |
| panels/ui/PanelFullscreenOverlay | N=10 pass=10 fail=0, Tests: 12 passed, |
| panels/ui/PanelFullscreenOverlay.aggregateChart | N=10 pass=10 fail=0, Tests: 1 passed, |
| panels/ui/detailModal/PanelDetailModal.aggregateChart | N=10 pass=10 fail=0, Tests: 2 passed, |
| panels/ui/detailModal/PanelDetailModal.chartTypeDefault | N=10 pass=10 fail=0, Tests: 1 passed, |
| panels/ui/detailModal/PanelDetailModal.editScrollFade | N=10 pass=10 fail=0, Tests: 3 passed, |
| panels/ui/renderers/ChartRenderer | N=10 pass=10 fail=0, Tests: 10 passed, |
| panels/ui/renderers/ChartRenderer.timeNote | N=10 pass=10 fail=0, Tests: 6 passed, |
| panels/ui/renderers/ChartRenderer.histogramNote | N=10 pass=10 fail=0, Tests: 4 passed, |
| dashboards/ui/PublicDashboardViewerPage.truncation | N=10 pass=10 fail=0, Tests: 2 passed, |
| panels/ui/PanelContent | N=10 pass=10 fail=0, Tests: 27 passed, |
| panels/ui/PanelCard.crossFilter | N=10 pass=10 fail=0, Tests: 7 passed, |

## Regression guard (task 3.3, scratch, restored from backup copies)

One mutation per converted file: first `getByTestId("echarts")` / `("chart-panel")` renamed to `...-MUT`. Every file turns red (the sync query
still asserts the real chart path); `ChartRenderer.test` needed the mutation moved to its first `getByTestId` because its first match was a
`queryByTestId` negation.

```
panels/ui/PanelCard.inspect.test.tsx rc=1 Tests:       1 failed, 4 passed, 5 total
panels/ui/PanelCard.aggregateChart.test.tsx rc=1 Tests:       1 failed, 7 passed, 8 total
panels/ui/PanelCard.aggregatePieChart.test.tsx rc=1 Tests:       1 failed, 1 passed, 2 total
panels/ui/PanelContent.chartTruncation.test.tsx rc=1 Tests:       1 failed, 7 passed, 8 total
panels/ui/PanelFullscreenOverlay.test.tsx rc=1 Tests:       1 failed, 11 passed, 12 total
panels/ui/PanelFullscreenOverlay.aggregateChart.test.tsx rc=1 Tests:       1 failed, 1 total
panels/ui/detailModal/PanelDetailModal.aggregateChart.test.tsx rc=1 Tests:       1 failed, 1 passed, 2 total
panels/ui/detailModal/PanelDetailModal.chartTypeDefault.test.tsx rc=1 Tests:       1 failed, 1 total
panels/ui/detailModal/PanelDetailModal.editScrollFade.test.tsx rc=1 Tests:       3 failed, 3 total
panels/ui/renderers/ChartRenderer.test.tsx rc=0 Tests:       10 passed, 10 total
panels/ui/renderers/ChartRenderer.timeNote.test.tsx rc=1 Tests:       1 failed, 5 passed, 6 total
panels/ui/renderers/ChartRenderer.histogramNote.test.tsx rc=1 Tests:       1 failed, 3 passed, 4 total
dashboards/ui/PublicDashboardViewerPage.truncation.test.tsx rc=1 Tests:       1 failed, 1 passed, 2 total
panels/ui/PanelContent.test.tsx rc=1 Tests:       1 failed, 26 passed, 27 total
panels/ui/PanelCard.crossFilter.test.tsx rc=1 Tests:       1 failed, 6 passed, 7 total
panels/ui/renderers/ChartRenderer.test.tsx (first getByTestId) rc=1 Tests:       1 failed, 9 passed, 10 total
```

## Sweep inventory

Literal commands (cwd `frontend/`):

    grep -rn 'findByTestId("echarts")\|findAllByTestId("echarts")' src          # 13 files / 43 sites
    grep -rn 'jest.mock(.*ChartPanel' src                                        # PanelContent.test.tsx:13 only
    grep -rn 'chart-panel\|echarts' src --include=*.test.tsx | grep 'findBy\|findAllBy\|waitFor'   # + PanelContent.test.tsx chart-panel sites
    grep -rln 'ChartRenderer\|"chart"\|kind: "chart"\|ChartPanel' --include=*.test.tsx src | xargs grep -ln 'findBy\|findAllBy\|waitFor'   # 35 candidates, triaged below
    grep -rln 'echarts-for-react\|echartsCore' --include=*.test.tsx src          # 31 files mocking the chart, triaged below

Converted (14 files, 51 sites; each: `await settleChartMount(<sources>)` then synchronous `getBy*`):

| file | sites | sources passed |
| --- | --- | --- |
| panels/ui/PanelCard.inspect | 4 | getOutputByIdMock |
| panels/ui/PanelCard.aggregateChart | 8 | getOutputByIdMock |
| panels/ui/PanelCard.aggregatePieChart | 2 | getOutputByIdMock |
| panels/ui/PanelContent.chartTruncation | 3 | getOutputById |
| panels/ui/PanelFullscreenOverlay.test | 1 | getOutputByIdMock |
| panels/ui/PanelFullscreenOverlay.aggregateChart | 1 | getOutputById mock |
| panels/ui/detailModal/PanelDetailModal.{aggregateChart (2), chartTypeDefault, editScrollFade} | 4 | getOutputById mock |
| panels/ui/renderers/ChartRenderer (10), .timeNote (6), .histogramNote (3) | 19 | none (lazy module only) |
| dashboards/ui/PublicDashboardViewerPage.truncation (second test) | 1 | two steps: fetchPanels, then fetchMeta + fetchRows (the chain issues each request after a React flush) |
| panels/ui/PanelContent.test (`chart-panel`, mocked ChartPanel) | 9 | getOutputByIdMock (fetchDatasetSchemaMock is only used by a non-chart test) |

Also migrated: `PanelCard.crossFilter.test.tsx` (local helper removed, uses the shared one; 1 site, behaviour unchanged, green under its own
HEL-1596 stall and the `act` stall above).

Left, with reasons:

| site | reason |
| --- | --- |
| `PanelFullscreenOverlay.truncation`, `PanelDetailModal.truncation` (`findByText` note) | probed 5/5 green under the stall (fired 5/5); the note is rendered outside the `Suspense` boundary and does not wait for the lazy chart |
| `findByText(NOTE)` sites in `PanelContent.chartTruncation` (lines 93, 99, 131, 151, 153, 170, 179), the note test in `PublicDashboardViewerPage.truncation`, `crossFilter` `findByText`/`findByRole("table")`, `PanelFullscreenOverlay.test` `findByRole("table")`, `PanelContent.test` metric/markdown/table waits | not lazy-chart waits (targets render outside the lazy `ChartPanel`: truncation note is in `ChartRenderer` outside `Suspense`, table/metric/markdown are other renderers). They do race the same 1 s deadline against the output-meta/rows/history promises (see the `arm` table), so they are a distinct, wider follow-up class, not widened here (focused-change rule) |
| `ChartOutputPanel.aggregate`, `PanelContent.chartFieldTypes`, `PanelContent.chartOverlay`, `OutputEditorSheet.fieldTypes`, `OutputHistoryModal` | `jest.mock(".../ChartRenderer")`: the lazy boundary is replaced wholesale, no lazy mount to race |
| `OutputEditorSheet.test` `findByRole("combobox", { name: "Chart type" })`, other OutputEditorSheet*/Outputs gallery/PipelineDetailPage candidates | no chart is rendered (no chart mock or reference); wait targets are form controls |
| `PanelDetailModal.{appearanceSentinel,panelSwitch,themeAwareFallback}`, `MobilePanelStack*`, `UsageChart.test` | mock the chart but have no `findBy*`/`waitFor` on it (grep above); `MobilePanelStack.provenance` `findByText("Weekly sales")` is a panel title |
| `ChartPanel.*.test` (9 files) | render `ChartPanel` directly, not through the lazy `ChartRenderer` |

## Gates (after the last edit)

- `npm run lint` exit 0; `npm run format:check` exit 0 ("All matched files use Prettier code style!"); `npm run typecheck` exit 0.
- `cd frontend && CI=true nice -n 19 npx jest --maxWorkers=3 src/features/panels src/features/dashboards src/test`:
  `Test Suites: 236 passed, 236 total`, `Tests: 2883 passed, 2883 total`, exit 0.
- `npm --prefix frontend run build` exit 0.

## Verdict

- All 14 swept files with a lazy-chart `findBy*` wait were exposed (red 5/5, stall fired 5/5) and are converted; green under the
  stall 5/5 (fired), green cold 10/10 each, red under a scratch mutation.
- design.md D1's "absorbed" prediction for directly rendered `ChartRenderer` files did not hold for a stall landing after the wait armed.
- Natural source of CI stalls remains unconfirmed (out of scope). Follow-up candidate: the non-chart `findByText`/`findByRole` waits listed
  under "Left" race the same 1 s deadline against meta/rows/history promises.

## Post-merge (HEL-1600)

Merged `origin/main` (10d8626cc, global jest network guard) into the branch as an ordinary merge commit (4924d1274); no textual conflict,
no converted test trips the guard (no test edits were needed). Worktree `/home/matt/Development/helio/.claude/worktrees/task/settle-lazy-chart-mounts/HEL-1599`.

- `npm run lint` exit 0; `npm run format:check` exit 0; `npm run typecheck` exit 0.
- Full frontend suite, `cd frontend && CI=true nice -n 19 npx jest --maxWorkers=3`: `Test Suites: 612 passed, 612 total`, `Tests: 7268 passed, 7268 total`, exit 0.
- Exact HEL-1596 method (stall in the `getOutputById` mock resolution microtask, `STALL_MS=1200`, `--maxWorkers=1`, cold cache, scratch edit reverted),
  with the guard active: `PanelCard.inspect` 3/3 pass (5 tests each, stall fired 3/3); `PanelCard.aggregateChart` 3/3 pass (8 tests each, stall fired 3/3).

## Cycle 2 (evaluation-1.md change requests)

### CR2: sweep gap (bare multi-line `waitFor`)

The cycle-1 inventory greps were single-line and the `arm` probe only stalled `findBy*`, so a bare multi-line `waitFor` was missed. Added commands (cwd `frontend/`):

    grep -rn -A6 'waitFor(' src --include=*.test.tsx | grep 'echarts\|chart-panel'
    grep -rn -A8 'waitFor(' src --include=*.test.tsx --include=*.test.ts | grep -i 'echarts\|chart-panel\|data-option\|chart'
    grep -rn -A3 'findBy[A-Za-z]*($\|findAllBy[A-Za-z]*($' src --include=*.test.tsx | grep -i 'echarts\|chart-panel'     # multi-line findBy: no hit
    grep -rn 'waitForElementToBeRemoved' src --include=*.test.tsx | grep -i 'fallback\|Loading data'                      # none
    grep -rn 'findBy[A-Za-z]*(' src --include=*.test.tsx | grep -i 'data-option\|chart-panel__\|"Loading data"'           # none

Result: exactly one lazy-chart `waitFor` site, `PanelContent.chartTruncation.test.tsx` (the AC5 positive control, `data-option` contains "vs 7d"). Other hits are not lazy-chart waits:
`PanelContent.chartFieldTypes:63` and `PanelContent.chartOverlay:86` (`waitFor` on `types`/`fetchHistory` call counts; both files mock `ChartRenderer`, no lazy boundary),
`PipelineDetailPage.outputSwap:208` (a chart-type combobox), `PanelContent.chartTruncation:176` (`waitFor(fetchHistory calls)`, a mock call count) and line 177 (a synchronous `getByTestId("echarts")` after the chart is already mounted in the same test; not a wait), `PreferencesEditor` (unrelated).

### CR1: converted `PanelContent.chartTruncation.test.tsx` "leaves the vs overlay hidden" positive control

`await waitFor(() => expect(getByTestId("echarts")...).toContain("vs 7d"))` became `await settleChartMount(getOutputById); await settleChartMount(fetchHistory);` (two steps: history is issued only after the
meta resolved and React flushed) followed by the synchronous assertion. The file now has 4 chart sites converted (3 `findByTestId` + this one).

Red-before / green-after at the SAME stall point: busy-wait 1200 ms in the first `getOutputById` mock resolution microtask (exact HEL-1596 method; once per process so the later non-chart `findByText(NOTE)` waits are not also stalled),
`-t "leaves the vs overlay hidden"`, `--maxWorkers=1`, cold cache, N=5:

    before (original waitFor): pass=0 fail=5 fired_runs=5  "Unable to find an element by: [data-testid=\"echarts\"]"
    after  (settleChartMount): pass=5 fail=0 fired_runs=5

Note: with the stall on EVERY resolution (also the second render's), the after version still fails 3/3 on the later non-chart `findByText(NOTE)` wait (and the aggregated-chart test fails the same way in both versions):
that is the out-of-scope class listed under "Left", not the chart wait.

Clean (no stall) after: 10 cold-cache `CI=true --maxWorkers=1` runs of the file, 10/10 pass, 8 tests each.

### Stronger regression guard (evaluator's, scratch)

Deleting the first `await settleChartMount(getOutputByIdMock);` line turns the file red: `PanelCard.inspect` 1 failed / 5 and `PanelCard.aggregateChart` 1 failed / 8, both `Unable to find an element by: [data-testid="echarts"]`.
Deleting both settle lines in `chartTruncation` turns it red (1 failed / 8, same message).
