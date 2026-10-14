# HEL-1596 measurements (mechanism reproduced via injected stall; deadline-free wait applied)

All runs executed in `/home/matt/Development/helio/.claude/worktrees/task/fix-crossfilter-echarts-flake/HEL-1596/frontend`
(Node v22.23.2, local 12-thread box), `CI=true`, `nice -n 19`, `--maxWorkers=1` (single file) or `--maxWorkers=3`
(full suite), strictly sequential. Probe = temporary instrumentation in a scratch edit of
`PanelCard.crossFilter.test.tsx` (MutationObserver from `renderPanelCard` to the first `[data-testid="echarts"]` node;
fallback-seen flag; `echartsCore` mock-factory timestamp as the "import evaluated" marker). Reverted with
`git checkout`; never committed.

## Baseline failure rate (before; no fix exists to compare)

| Condition                                                                  | N   | Pass | Fail |
| -------------------------------------------------------------------------- | --- | ---- | ---- |
| Single file, cold `--cacheDirectory` per run, CI=true                      | 30  | 30   | 0    |
| Failing test alone (`-t`), fresh cache per run                             | 5   | 5    | 0    |
| Full frontend suite (596 suites, 7131 tests), cold cache, `--maxWorkers=3` | 5   | 5    | 0    |

Full suite wall time locally 91 s vs 219 s on the failing CI run (CI roughly 2.4x slower).

## Render-to-visible (echarts node in DOM), ms from render start (C3)

| Condition                   | N   | min / median / p90 / max | fallback shown |
| --------------------------- | --- | ------------------------ | -------------- |
| Single file, cold           | 30  | 313 / 317 / 367 / 400    | 30/30          |
| Full suite, cold, 3 workers | 5   | 308 / 312 / 312 / 314    | 5/5            |
| Failing test alone          | 5   | 262 / 291 / 295 / 296    | 5/5            |

The Suspense fallback is always committed; render-to-visible is about max(import, 300 ms React `FALLBACK_THROTTLE_MS`)
plus about 10 ms. The cold import of the ChartPanel graph is 230-390 ms. The worst observation (400 ms) is 2.5x under
the 1000 ms `findBy` window.

## Commands (literal)

CI's step (`.github/workflows/ci.yml`, job `frontend`, line 156): `npm test` = `jest && npm --prefix frontend test`
(root jest first, then `jest --config jest.config.cjs --passWithNoTests` in `frontend/`), `CI=true`, so no local caps:
default jest workers (3 on a 4-vCPU runner), default cache dir under os.tmpdir, cold on a fresh runner. One invocation,
no retry. Local equivalents (cwd `frontend/`, scratch cache dirs under the session scratchpad):

- Single file, cold, one run of the 30:
  `CI=true nice -n 19 npx jest --maxWorkers=1 --cacheDirectory=<fresh dir> src/features/panels/ui/PanelCard.crossFilter.test.tsx`
  (cache dir deleted before each run).
- Failing test alone: same plus `-t "Fullscreen's nested Inspect"`.
- Full suite: `CI=true nice -n 19 npx jest --maxWorkers=3 --cacheDirectory=<fresh dir>`.
- Render-to-visible probe: scratch MutationObserver in the test (never committed), `PROBE_OUT=<file>`.
- Stall probe (scratch, never committed): in the last test replace
  `getOutputByIdMock.mockResolvedValue(makeChartOutput())` with
  `mockImplementation(() => Promise.resolve().then(() => { busy-wait STALL_MS (Date.now loop); append "fired" to $STALL_FIRED; return out; }))`,
  then `STALL_MS=<ms> STALL_FIRED=<file> CI=true nice -n 19 npx jest --maxWorkers=1 --cacheDirectory=<dir> <file> [-t "SAME narrowed"]`.
  Every stalled run below logged `fired` once per run (fired == N).

## Artificial stall inside the lazy `require` (absorbed)

Busy-wait D ms in the `./echartsCore` mock factory (inside the lazy `import()` -> `require`), warm cache, 3 runs each:
D = 400/600/800/950/1000/1200 gave render-to-visible 432/632/834/983/1035/1233 ms, all 3/3 pass; D = 3000, 1 run, 3094 ms,
pass. A stall inside the lazy `require` is absorbed: it runs after `findBy` armed its timer, and once it ends React's
already-due reveal timer commits the chart and the DOM mutation resolves `findBy` before the overdue timeout timer runs.

## Artificial stall BEFORE the lazy mount (reproduces the CI symptom); cycle-2 warm-up experiment

Stall in the `getOutputById` mock's resolution microtask (after `findAllByTestId` armed its 1 s timer, before `ChartPanel`
mounts). Warm cache, `--maxWorkers=1`. "before" = unmodified test, "after" = test with the candidate fix below.

| STALL_MS | mode       | before (pass/fail) | after (pass/fail) |
| -------- | ---------- | ------------------ | ----------------- |
| 700      | `-t` alone | 5/0                | 5/0               |
| 850      | `-t` alone | 5/0                | 5/0               |
| 950      | `-t` alone | 3/0                | 3/0               |
| 1000     | `-t` alone | 0/3                | 0/3               |
| 1050     | `-t` alone | 0/3                | 0/3               |
| 1100     | `-t` alone | 0/3                | 0/3               |
| 1200     | `-t` alone | 0/5                | 0/5               |
| 1200     | whole file | 0/5                | 0/5               |

Failure DOMs (before): alone, `chart-panel__canvas` holding `suspense-fallback suspense-fallback--panel` ("Loading data"),
identical to CI's dump; whole file, the output-meta loading state (`panel-content panel-content--state`) with no chart
fallback (React has not yet reached the lazy mount).

Candidate fix tried (scratch, reverted, not committed): a `beforeAll` in the last describe rendering
`<ThemeProvider><ChartRenderer /></ThemeProvider>` (same module registry as PanelCard's) and awaiting
`findByTestId("echarts")`, so the lazy payload is resolved before the timed render; it deliberately bypasses PanelCard so
the timed render still passes through the stalled `getOutputById` (stall fired in all after-runs). Effect: the Suspense
fallback no longer appears (after-DOMs at stall >= 1000 show only the meta loading state, 0 fallbacks), but the pass/fail
cliff did not move at all: both variants pass at 950 ms and fail from 1000 ms, at every N above.

## Fix applied (cycle 3): wait on the causal events, not a 1 s polling deadline

`PanelCard.crossFilter.test.tsx`: new helper `settleChartMount()` =
`await act(async () => { await Promise.all(getOutputByIdMock.mock.results.map(r => r.value)); await import("./ChartPanel"); })`;
the grid `findAllByTestId("echarts")` became `await settleChartMount()` + synchronous `getAllByTestId`, with a
why-comment. The Fullscreen `findByTestId("echarts")` became a plain synchronous `getByTestId` with no wait: the
Fullscreen `useOutputMeta` is served from `outputMetaCache` (so `getOutputById` is called once in the whole test) and the
lazy `ChartPanel` is already loaded by the grid chart, so the Fullscreen chart mounts synchronously on the click. No timeout raised, no retry (C1). The remaining
`findByText("Showing rows for region: West")` waits follow a synchronous click inside `act` and depend on no promise the
stall can delay; they passed under the 3000 ms stall below, so they were left alone. The unmodified test is the
"before"; the stall (STALL_MS in the `getOutputById` mock's resolution microtask, a point both variants pass through)
fired in every run (fired == N each row).

| STALL_MS | mode                 | before pass/fail | after pass/fail | stall fired (after) |
| -------- | -------------------- | ---------------- | --------------- | ------------------- |
| 1200     | `-t "SAME narrowed"` | 0/5              | 5/0             | 5/5                 |
| 1200     | whole file           | 0/5              | 5/0             | 5/5                 |
| 3000     | `-t "SAME narrowed"` | not run          | 3/0             | 3/3                 |
| 3000     | whole file           | not run          | 3/0             | 3/3                 |

Commands: `STALL_MS=<ms> STALL_FIRED=<file> CI=true nice -n 19 npx jest --maxWorkers=1 --cacheDirectory=<dir> src/features/panels/ui/PanelCard.crossFilter.test.tsx [-t "SAME narrowed"]` (cwd `frontend/`).
(The fired count is 1 per run: the Fullscreen mount is served from `outputMetaCache`.)

Clean (no stall) after: 30 cold-cache CI=true single-file runs, 30/30 pass (same command, cache dir removed each run,
no `-t`, STALL_MS=0). Render-to-visible with scratch MutationObserver probe: min / median / max = 194 / 204 / 272 ms
(before: 313 / 317 / 400 ms). The Suspense fallback is still committed in 30/30 runs but the test no longer waits on its
300 ms reveal throttle or any deadline (act flushes it). Regression guard intact: a scratch mutation flipping the
Fullscreen narrowing assertion (`queryByText("205")` expected present) fails the test.
Gates: eslint clean, prettier clean, `tsc --noEmit` 0, `jest src/features/panels` 194 suites / 2577 tests pass
(`CI=true nice -n 19 --maxWorkers=3`).

## Verdict (final)

- Mechanism reproduced via injected stall: a ~1 s main-thread stall after `findAllByTestId` armed its 1 s timer and
  before the chart mounts makes the overdue timeout fire before React's next commit; matches the CI DOM and line.
  A stall inside the lazy `require` is absorbed. The natural source of the CI stall is UNCONFIRMED (0 failures in 40
  cold natural runs).
- The 300 ms reveal throttle is not the binding constraint (warm-up experiment above: cliff unchanged at ~1000 ms).
- The fix removes the deadline dependency for the chart-mount waits; it does not claim to remove the stall.
- Follow-up candidates (not widened here): `PanelCard.inspect.test.tsx` and `PanelCard.aggregateChart.test.tsx` use the
  same `findByTestId("echarts")` after-lazy-load pattern; mocking the two metric-describe tests' unmocked axios calls;
  CI-side per-test duration/runner load to find the stall source.
