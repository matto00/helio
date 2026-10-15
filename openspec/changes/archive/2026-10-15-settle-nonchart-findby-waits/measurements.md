# HEL-1612 measurements (probe, convert, red-before / green-after)

Environment: worktree `/home/matt/Development/helio/.claude/worktrees/task/settle-nonchart-findby-waits/HEL-1612`, cwd `frontend/`,
Node v22, `CI=true`, `nice -n 19`, `--maxWorkers=1` for single files, `--maxWorkers=3` for folders/suite, cold `--cacheDirectory`
(removed before every probe run), strictly sequential. `STALL_MS=1200`. Every run was in this worktree and ran non-zero tests.
Stall instrumentation is scratch only (session scratchpad `.../scratchpad/hel1612`); each probed test file was backed up, edited,
and restored byte-identical (`cmp` after restore; `git grep "SCRATCH STALL"` over `frontend/` returns nothing).

## Method (HEL-1596 injected stall at the mock-resolution microtask, design.md D4)

The scratch edit rewrites each `X.mockResolvedValue[Once](v)` (also `X.mockReset().mockResolvedValue(v)` and
`jest.mocked(X).mockResolvedValue(v)`) of the file's gating mocks into
`X.mockImplementation(() => Promise.resolve().then(() => { busyWait(1200 ms); append "fired" to $STALL_FIRED; return v; }))`,
i.e. a stall on EVERY resolution, after `findBy*` armed its 1 s timer and before React commits. BEFORE (main's file, 563a4c476) and
AFTER (converted file) use the identical edit. Gating mocks per file: chartTruncation `getOutputById,fetchHistory`; PublicDashboardViewerPage.truncation
`fetchPanels,fetchMeta,fetchRows`; crossFilter / FullscreenOverlay.test `getOutputByIdMock`; PanelContent.test `getOutputByIdMock,fetchDatasetSchemaMock`.

    # per probe (probe.sh): cp file backup; python3 stalledit.py file <mocks>; N times:
    rm -rf $S/cache; STALL_MS=1200 STALL_FIRED=$S/fired CI=true nice -n 19 npx jest --maxWorkers=1 --cacheDirectory=$S/cache src/features/<file> [-t "<selector>"]
    # restore file from backup; cmp; fired_runs = runs with >= 1 line in $S/fired (a run that did not fire would be invalid; none occurred)
    # generic `arm` sweep (HEL-1599's mechanism, scratch jest setup, no file edit): STALL_MODE=arm STALL_MS=1200 CI=true nice -n 19 npx jest -c <scratch config> --maxWorkers=1 ...

### Finding: the first stall in a process is absorbed

A single test selected with `-t` (the first stall of the process) passes even on main: chartTruncation `-t "names both counts"` and `-t "shows the note for an aggregated chart too"`,
crossFilter `-t "narrows a sibling table panel"` and `-t "never narrows the originating"`, FullscreenOverlay.test `-t "client-fallback narrows"` and `-t "server renders the rows"`,
PanelContent.test `-t "renders the metric placeholder"` and `-t "renders live rows and headers"` all pass N=3 (fired 3/3, one stall per run); PublicDashboardViewerPage.truncation
is the exception (its first test chains three stalled resolutions and is red). The later tests of a whole-file run, or a two-test `-t` selector, fail. A `-t` selector therefore needs two stalled tests; the selectors below are the failing test plus its predecessor. This extends HEL-1599's
"once-per-process stalls hide later waits" and is why the whole-file run (every test) is the primary proof.

## Before (main) vs after (converted), same stall, fired every run

| file | selector | BEFORE pass/fail (fired runs) | AFTER pass/fail (fired runs) |
| --- | --- | --- | --- |
| panels/ui/PanelContent.chartTruncation | whole file, N=5 | 0/5 (5/5), `2 failed, 6 passed, 8` | 5/0 (5/5), 8 passed |
| panels/ui/PanelContent.chartTruncation | `-t "shows the note for an aggregated chart too\|leaves the vs overlay"`, N=3 | 0/3 (3/3), 1 failed | 3/0 (3/3) |
| dashboards/ui/PublicDashboardViewerPage.truncation | whole file, N=5 | 0/5 (5/5), `1 failed, 1 passed` | 5/0 (5/5) |
| dashboards/ui/PublicDashboardViewerPage.truncation | `-t "names both counts"`, N=3 | 0/3 (3/3) | 3/0 (3/3) |
| panels/ui/PanelCard.crossFilter | whole file, N=5 | 0/5 (5/5), `3 failed, 4 passed, 7` | 5/0 (5/5), 7 passed |
| panels/ui/PanelCard.crossFilter | `-t "HEL-588 cross-filter application"`, N=3 | 0/3 (3/3), 1 failed | 3/0 (3/3) |
| panels/ui/PanelFullscreenOverlay.test | whole file, N=5 | 0/5 (5/5), `1 failed, 11 passed, 12` | 5/0 (5/5), 12 passed |
| panels/ui/PanelFullscreenOverlay.test | `-t "HEL-1191 threaded"`, N=3 | 0/3 (3/3), 1 failed | 3/0 (3/3) |
| panels/ui/PanelContent.test | whole file, N=5 | 0/5 (5/5), `3 failed, 24 passed, 27` | 5/0 (5/5), 27 passed |
| panels/ui/PanelContent.test | `-t "output kind dispatch"`, N=3 | 0/3 (3/3), 2 failed | 3/0 (3/3) |
| panels/ui/PanelContent.test (form, site 426) | `-t "renders the metric placeholder\|dispatches a configured form"`, N=2 before / N=3 after | 0/2 (2/2), the form test fails | 3/0 (3/3) |

Failing tests BEFORE (whole file, run 1): chartTruncation "shows the note for an aggregated chart too", "leaves the vs overlay hidden ... (AC5)";
PublicDashboardViewerPage.truncation "names both counts ..."; crossFilter "never narrows the originating panel's own data", "a sibling metric panel's displayed value is the SUM ...",
"the Fullscreen overlay's disclosure reports the panel's TRUE loaded row count ..."; FullscreenOverlay.test "client-fallback narrows the loaded rows client-side";
PanelContent.test "renders live rows and headers", "renders the literal config.content of a placed markdown Output ...", "renders the metric placeholder for output kind metric".

One failure excerpt per file (run 1, BEFORE):

- chartTruncation: `Unable to find an element with the text: Based on the first 2 of 1,234 rows..`
- PublicDashboardViewerPage.truncation: `Unable to find an element with the text: /Based on the first 2 of 1,234 rows\./`
- crossFilter: `Unable to find role="table"` and `Unable to find an element with the text: 250.`
- FullscreenOverlay.test: `Unable to find role="table"`
- PanelContent.test: `Unable to find an element with the text: --.` and `Unable to find an element by: [data-testid="markdown-content"]`

### Re-probed, left unchanged (not exposed)

| file | stall | result | disposition |
| --- | --- | --- | --- |
| panels/ui/PanelFullscreenOverlay.truncation | mock-resolution, N=5 | 5/0 pass, fired 5/5 | unchanged |
| panels/ui/PanelFullscreenOverlay.truncation | `arm`, N=5 | 5/0 pass, fired 5/5 | unchanged: note renders outside the lazy boundary and survives the stall |
| panels/ui/detailModal/PanelDetailModal.truncation | mock-resolution, N=5 | 5/0 pass, fired 5/5 | unchanged |
| panels/ui/detailModal/PanelDetailModal.truncation | `arm`, N=5 | 5/0 pass, fired 5/5 | unchanged |
| panels/ui/PanelFullscreenOverlay.test `findByText("hello world")` (118, 161) | `arm`, N=5, whole file | only the `findByRole("table")` test fails (1 failed, 11 passed, fired 3 per run) | unchanged: markdown, no mocked promise gates it, green under both stalls |

## Secondary: `arm` sweep on the converted files (N=3, whole file)

```
PanelContent.chartTruncation               arm N=3 pass=3 fail=0 fired_runs=0
PublicDashboardViewerPage.truncation       arm N=3 pass=3 fail=0 fired_runs=0
PanelCard.crossFilter                      arm N=3 pass=3 fail=0 fired_runs=0
PanelContent.test                          arm N=3 pass=3 fail=0 fired_runs=0
PanelFullscreenOverlay.test                arm N=3 pass=3 fail=0 fired_runs=3   (the two unchanged markdown findByText, green under the stall)
```

## Clean (no stall): 10 cold-cache `CI=true` runs per converted file, `--maxWorkers=1`

```
panels/ui/PanelContent.chartTruncation.test.tsx N=10 pass=10 fail=0 Tests: 8 passed, 8 total
dashboards/ui/PublicDashboardViewerPage.truncation.test.tsx N=10 pass=10 fail=0 Tests: 2 passed, 2 total
panels/ui/PanelCard.crossFilter.test.tsx N=10 pass=10 fail=0 Tests: 7 passed, 7 total
panels/ui/PanelFullscreenOverlay.test.tsx N=10 pass=10 fail=0 Tests: 12 passed, 12 total
panels/ui/PanelContent.test.tsx N=10 pass=10 fail=0 Tests: 27 passed, 27 total
```

## Regression guard (scratch mutation, restored): the synchronous query still asserts the real target

```
PanelContent.chartTruncation   getByText(NOTE) -> getByText(NOTE + "-MUT")           rc=1 1 failed, 7 passed
PublicDashboardViewerPage.trunc getByText(/Based on ...) -> getByText(/MUT Based ...) rc=1 1 failed, 1 passed
PanelCard.crossFilter          getByRole("table") -> getByRole("tablex")             rc=1 1 failed, 6 passed
PanelFullscreenOverlay.test    getByRole("table") -> getByRole("tablex")             rc=1 1 failed, 11 passed
PanelContent.test              getByText("--") -> getByText("--MUT")                  rc=1 1 failed, 26 passed
```

## HEL-1599's settleChartMount files

All 15 test files that import `settleChartMount`/`settleMocks` (folder run, `--maxWorkers=3`): `Test Suites: 15 passed, 15 total; Tests: 98 passed, 98 total`.

## Inventory: every `findBy*`/`findAllBy*`/`waitFor` in the touched files (main line numbers)

| file:line (main) | wait | gating promise | disposition |
| --- | --- | --- | --- |
| chartTruncation:94, 100, 135, 155, 157, 175, 184 | `findByText` x7 | `getOutputById` then `fetchHistory` | converted: `settleNote()` (`settleMocks(getOutputById)`, `settleMocks(fetchHistory)`), `getByText` |
| chartTruncation:176 | `waitFor(fetchHistory called 2x)` | `fetchHistory` | converted: same two-stage settle, then a synchronous `expect(...).toHaveBeenCalledTimes(2)`; `waitFor` import removed |
| PublicDashboardViewerPage.truncation:89 | `findByText` note | `fetchPanels` then `fetchMeta` + `fetchRows` | converted: `settleMocks(fetchPanels)`, `settleMocks(fetchMeta, fetchRows)` |
| crossFilter:177, 187, 199, 292 | `findByRole("table")` | `getOutputById` | converted |
| crossFilter:241, 249 | `findByText("250"/"370")` | `getOutputById` | converted |
| crossFilter:293 | `findByText("2 of 3 loaded rows match.")` | `getOutputById` | converted (same settle as 292) |
| crossFilter:302 | `within(fullscreenDialog).findByText` | none: Fullscreen reads the grid card's cached output meta, synchronous after the click | converted to `getBy`, stall + 10 clean runs green |
| crossFilter:392, 416 | `within(...).findByText("Showing rows for region: West")` | none: sync state update inside `act(click)` | converted to `getBy`, stall + 10 clean runs green (no AC1 deviation) |
| FullscreenOverlay.test:285, 292 | `findByRole("table")` | `getOutputById` | converted |
| FullscreenOverlay.test:118, 161 | `findByText("hello world")` | markdown `React.lazy` only, no mock | left: green under both stalls (above) |
| PanelContent.test:106 | `findByText("--")` | `getOutputById` | converted |
| PanelContent.test:126 | `findByRole("table")` | `getOutputById` | converted |
| PanelContent.test:152 | `findByTestId("markdown-content")` | `getOutputById`, then the lazy `MarkdownPanel` module | converted: `settleMocks(getOutputByIdMock)`, `settleMocks(import("./MarkdownPanel"))` |
| PanelContent.test:353 | `findByText("Revenue")` | `getOutputById` | converted |
| PanelContent.test:426 | `findByRole("form")` | `fetchDatasetSchema` | converted (probe-red, table above) |
| FullscreenOverlay.truncation:77, PanelDetailModal.truncation:78 | `findByText` note | `getOutputById` | left (not exposed, above) |

The fetchOutputHistory rejecting stub in PanelContent.test (HEL-1600) needs no settle: no converted wait depends on it, and `settleMocks` uses `Promise.allSettled`, so a rejecting source would not throw.

## Gates (final head)

- `npm run lint` (frontend): exit 0, zero warnings.
- `npm run format:check`: `All matched files use Prettier code style!`
- `npm run typecheck`: exit 0.
- Full frontend jest: `CI=true nice -n 19 npx jest --maxWorkers=3` in `frontend/`: `Test Suites: 612 passed, 612 total; Tests: 7268 passed, 7268 total; Snapshots: 19 passed; exit=0`.
