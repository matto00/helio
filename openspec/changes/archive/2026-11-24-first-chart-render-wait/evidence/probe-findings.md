# HEL-1651 probe findings (local host: AMD Ryzen 5 7600X; CI failure: AMD EPYC 7763, 4 vCPU)

Probe: `hel1651-probe.spec.ts.txt` (a scratch spec, not committed as a spec). Timestamps are ms after `goto`; raw
timelines in `probe-1x.txt`, `probe-4x.txt`, `probe-6x.txt`. The unchanged chart test: `red-6x-chart-test.txt` (2 of 3
fail at `HEL1651_CPU_THROTTLE=6`, `toBeVisible` at :127, "element(s) not found", 5000ms); at 4x it passes 3/3
(`unthrottled-spec-at-4x-passes-3of3.txt`, name is historical: that run was 4x). The 6x failure page snapshot matches
the CI one: Table rows and Metric present, Chart card header and footer, empty body.

Candidates, at the moment the 5 s lapses (6x run):
- (a) seed run: `/run` awaited by seedWorld; `GET /runs/latest` 200 after seeding. NOT the cause.
- (b) chart chunk: `ChartPanel.tsx` REQUESTED at 4681 ms (the instant `GET /api/outputs/:id` resolved at 4598;
  the HEL-1760 preload DOES fire, gated on the Output's kind), done 5509; echarts deps requested 5545-5655, done
  5722. Canvas first present between 6953 and 7572 ms. So at 5000 ms the chunk had not even finished loading.
- (c) canvas box: 259x258, never zero-size once it exists. NOT HEL-1647.
- (d) card content: wrapper absent until ~5.5 s (no Suspense fallback visible yet), then empty until the canvas.
- (e) the serial chain (6x): boot modules -> auth/me (2.5-3.1 s) -> dashboards list (3.6 s) -> panels (3.8-4.46 s) ->
  Output metadata (4.5-4.6 s; the first point the chart kind is known) -> chart chunk (4.7-5.5 s) -> echarts deps
  (5.5-5.7 s) -> ECharts init under a starved main thread (canvas at ~7.5 s).
Canvas-visible time vs throttle: 1x ~1.5-2.0 s, 4x ~3.6-4.9 s, 6x ~7.5 s.

Root cause: every step progresses correctly; the first canvas sits at the end of a ~7-hop serial request/module
waterfall, and the Output kind (which triggers the chart preload) is only known after panels -> Output metadata. On a
slow host the sum exceeds the 5 s expect budget. No app misbehaviour found (no zero-size init, no gated-on-later-event
request, no duplicated fetch). Per design.md D2 this is the "host slowness, correct behaviour" branch: ESCALATED, no
fix applied.

Sibling assessment (D4): every spec with a first-chart-canvas wait straight after `goto` shares this cause class
(hel1573 :127 and :405 sites, hel1584-motion-surfaces ~:107/:505, hel1658's CDP-6x record); none changed.

## Owner ruling and fix (cycle 1 resume)

Owner answered the escalation with `preload-chart-chunk-earlier` (the app fix, not a test-side wait).

Fix: `preloadChartPanelWhenIdle()` in `chartPanelModule.ts` (the one preload module; the Output-metadata trigger
`preloadChartPanel()` stays as the fallback for other surfaces and shares the same memoised `import()`), started from
`useChartPreloadOnMount` in `PanelList` and `DashboardRoute`. It runs at an idle moment (`requestIdleCallback`, 100 ms
timeout, else `setTimeout 0`), never synchronously, and is a no-op once the chunk is loading. Jest, red first
(`red-jest-idle-preload.txt`, compile-red: the exports did not exist) then `green-jest-idle-preload.txt`.

Effect (6x probe, `probe-6x-fix2.txt`): the chart chunk is requested at ~2.9 s (when `PanelList` mounts) and the echarts
deps are done by ~3.5 s, instead of the chunk being first requested at ~4.7 s after Output metadata. The root cause
stands: the remaining critical path (auth/me -> dashboards -> panels -> Output metadata -> ECharts init) is CPU-bound
on the throttled main thread, and the preload competes with it, so it removes the chunk hop but not the whole delay.

Measured outcome, chart test (`hel1573 :115`):
- 5x throttle, 10 runs: mutated (preload removed) 6 failed / 4 passed (`ab-5x-mut.txt`); with the fix 2 failed / 8 passed
  (`ab-5x-fix.txt`). 6x, mutated: 5/5 failed (`mutation-6x-chart.txt`); 6x with the fix: still failing 4 of 5
  (`green-6x-chart.txt`), so 6x is NOT made green. Baseline 6x before any fix: 2 of 3 failed (`red-6x-chart-test.txt`).
- 4x, with the fix: 5/5 (`green-4x-chart.txt` first run of a different revision of the test had 1 failure on
  `expect(entrance).toBeGreaterThan(150)` = 148.4, an entrance-span LOWER bound, a different assertion; the rerun of
  10 passed 10/10, `green-4x-chart-b.txt`). Spinoff candidate: the :165 lower bound is not immune to a throttled host.
- Unthrottled, full spec file `--repeat-each=10`, 2 workers: 40/40 (`green-full-40.txt`).
- Every seedWorld caller run once: hel1584 14/14 (`callers-hel1584.txt`); hel1657 + hel1656 + hel1681 + hel1738 +
  hel1746 54/54 (`callers-others.txt`); hel1573 40/40.
- The siblings (hel1573 :405 "shrinking a mounted panel", hel1584 :107/:505) do NOT go red at 6x or 10x even before the
  fix (`red-6x-h1573-fit.txt`, `red-10x-h1573-fit.txt`, `red-6x-h1584.txt`, `red-10x-h1584.txt`: all passed): each waits
  for the panel grid first (`waitForPanelGrid`), which absorbs the waterfall, so they share the cause class but are not
  exposed. The app fix covers them regardless. No test wait changed.

Prod build (`prod-build.txt`: `npm run e2e:prod-build`, 6 passed). Chunk cost, `frontend/dist/assets`:
`useChartEntranceMotion-*.js` (the echarts chunk) 651,301 bytes / 216,033 gzip, `ChartPanel-*.js` 20,901 / 7,477 gzip:
about 224 kB gzip that a table-only dashboard now also downloads (owner accepted). Long tasks while opening a chart
dashboard on the production build (scratch spec `hel1651-longtask.spec.ts.txt`, 3 runs each): none (> 50 ms) with the
preload (`longtask-fix.txt`) and none without it (`longtask-mut.txt`). The download is scheduled at idle and, in the
throttled dev-server probe, competes with the critical path for main-thread time (see above).

## Owner ruling 2 (`preload-plus-state-wait`): keep the preload, add a state wait

`hel1573 :115` now waits (15 s ceiling, the `waitForPanelGrid` helper's own) for a seeded Table cell (`500`) to be
visible after `goto("/dashboards")`, then asserts the canvas with the unchanged 5 s default. No retry, no timeout raised
on the canvas assertion. Siblings: hel1573 :405 and hel1584 :107/:505 already wait on `waitForPanelGrid` (the live grid
reaches N items, then the skeleton unmounts: a real state wait with a 15 s ceiling), so they are unchanged.

Chart test, `--repeat-each=10`, 2 workers, canvas-wait failures (the number of runs that failed at the canvas `toBeVisible`):

| Throttle | preload | state wait | failed at canvas / 10 | file |
|---|---|---|---|---|
| 6x | no | no | 2 of 3 (baseline) | red-6x-chart-test.txt |
| 6x | yes | no | 8 | mutation-b-no-wait-preload-kept-6x-n10.txt |
| 6x | no | yes | 0 (10 passed) | mutation-a-no-preload-wait-kept-6x-n10.txt |
| 6x | yes | yes | 0 (9 passed; the 1 failure is the :172 entrance lower bound, 131.7 < 150) | both-6x-n10.txt |
| 8x | no / yes | yes | 0 / 0 (10 passed each) | mutation-a-...-8x-n10.txt / both-8x-n10.txt |
| 12x | no / yes | yes | 0 / 0 (10 / 9 passed; the 1 failure is a later assertion, :273) | mutation-a-...-12x-n10.txt / both-12x-n10.txt |

Findings: the STATE WAIT is the half that fixes the canvas wait (mutation b red at 6x: 8 of 10). The preload alone only
reduces the failure (5x: 6 -> 2 of 10 earlier; 6x: no help). With the wait present, removing the preload (mutation a)
does NOT go red at 6x, 8x or 12x, so the preload's benefit cannot be shown by this test once it waits on the state; it is
kept by owner ruling. Its cost: about 224 kB gzip of echarts + ChartPanel downloaded by table-only dashboards
(`useChartEntranceMotion-*.js` 216,033 + `ChartPanel-*.js` 7,477 gzip); no long task on the production build with or without it.

Recorded flake (out of scope, not rerun away): once the canvas wait stops failing, the next assertion
`expect(entrance).toBeGreaterThan(150)` (now `:172`, was `:165`) fails intermittently on a throttled host: 148.4 (4x,
`green-4x-chart.txt`), 59.8 (4x, `final-4x-n5.txt`: 4 of 5 passed, so the "5/5 at 4x" AC is NOT met because of this
assertion, not the canvas), 131.7 (6x, `both-6x-n10.txt`); and `:273` once at 12x. Follow-up for triage.

Final unthrottled runs after the merge of main (8abb826b7): hel1573 spec 40/40 (`final-full-40.txt`); every seedWorld
caller spec (hel1584, hel1657, hel1656, hel1681, hel1738, hel1746) 68/68 (`final-callers.txt`); `npm run e2e:prod-build`
6 passed (`final-prod-build.txt`).

## Cycle 2 (evaluation-1): production measurements, new start point, wiring proof

Scratch spec `hel1651-timing.spec.ts.txt` (the evaluator's, adapted: relative imports, `@prod-build` tag under
`HELIO_E2E_PROD_BUILD`). `fix` = the preload as shipped; `mut` = emulated no-preload (the chart chunk request is held
until the first `GET /api/outputs/:id` response). N=6 per arm, 1 worker, ms after navigation, means (range in the summaries).

Production build (`npm run e2e:prod-build`, DEV_PORT 7083):

| start point | rate | arm | Table | Metric | canvas | file |
|---|---|---|---|---|---|---|
| on mount (cycle 1) | 4x | preload / none | 996 / 999 | 1143 / 1064 | 1309 / 1416 | prod-timing-onmount-summary.txt |
| on mount (cycle 1) | 6x | preload / none | **1387 / 1162** | **1506 / 1284** | 1686 / 1685 | prod-timing-onmount-summary.txt |
| after first data | 4x | preload / none | 881 / 906 | 970 / 972 | 1321 / 1312 | prod-timing-summary.txt |
| after first data | 6x | preload / none | 1186 / 1174 | 1326 / 1268 | 1727 / 1650 | prod-timing-summary.txt |

So the on-mount preload DID delay the first data render on the production build at 6x (+225 ms Table, +222 ms Metric, no
canvas gain), as the evaluator measured in dev (+730 / +900 ms). Starting it after the first panel rows commit removes the
delay (differences within the run-to-run range). Dev server, after-first-data start point (`dev-timing-summary.txt`):
6x Table 5160 vs 5210, Metric 5509 vs 5630, canvas 6816 vs 6954; 4x Table 3655 vs 3467, Metric 3812 vs 3595, canvas
4772 vs 4462 (ranges overlap; noise). The dev cost the PR must state for the first version: +730 ms Table / +900 ms Metric
at 6x (evaluator, evaluation-1.md). Ordering: with the new start point the chunk request (dev 6x mean 4946) follows the
Output-metadata response (4702), the preload no longer precedes it; the canvas effect is a wash. The preload's measurable
benefit is therefore nil; it is kept by owner ruling C2, at ~224 kB gzip per table-only dashboard.

The pass/fail canvas test cannot detect the preload once the state wait is in place (see design.md): the wait starts the
5 s budget after the data is on screen, and chunk load + ECharts init then fit in 5 s even at 12x with or without it.
Wiring proof: `PanelList.chartPreload.test.tsx` is red with the hook call removed (`mutation-jest-call-site-removed.txt`),
red before the implementation (`red-jest-after-first-data.txt`), green after (`green-jest-after-first-data.txt`).
Single call site (`PanelList`): it covers `/dashboards` and `/dashboards/:id` (`DashboardRoute` renders it), and the signal
is data, so an earlier call in `DashboardRoute` could not start sooner.

Final runs: hel1573 spec 40/40 (`c2-full-40.txt`); chart test 4x 5/5 (`c2-4x-n5.txt`); chart test 6x N=10 twice:
7 passed + 3 failed at `:273` bars-grow-from-zero (`c2-6x-n10.txt`), then 10 passed (`c2-6x-n10-b.txt`): no canvas-wait failure in
either; `:273` and `:172` are the out-of-scope post-canvas assertions; every seedWorld caller 68/68 (`c2-callers.txt`);
`e2e:prod-build` 6 passed (`c2-prod-build.txt`).

## Cycle 3 (owner ruling C3): preload dropped; flakes

**Why the preload was tried.** The first-canvas delay is a serial startup waterfall; the chart chunk was requested only
after Output metadata, so the owner ruled (C1) to start it earlier at low priority.
**Why it was dropped.** Production, 6x, N=6/arm: started on mount it delayed the first data render, Table 1387 vs 1162 ms
(+225) and Metric 1506 vs 1284 ms (+222), with no canvas gain (1686 vs 1685); dev (evaluator): +730 ms Table / +900 ms
Metric. Started after the first panel data it delayed nothing (prod 6x Table 1186 vs 1174, Metric 1326 vs 1268) and gained
nothing measurable (canvas 1727 vs 1650 prod 6x; dev 6816 vs 6954), for ~224 kB gzip (216,033 + 7,477) that every
table-only dashboard would download. Owner ruling C3 dropped it. `frontend/src` now matches origin/main.

**Chart test after the drop** (state wait only): 6x 40/40 (`c3-nopreload-6x-n40.txt`), 4x 20/20, 10x 20/20.

**`:273`: reproduced and fixed.** Root cause in `flake-273-root-cause.md`: a stale frame sampled before zrender repainted.
Red: `c3-final-6x-n10-a.txt` (2 of 10, Received 0.1242, no preload in the code) and 2 of 70 probe runs with the recorder
data. Fix: only frames from the first one differing from the pre-`setOption` frame count; plus a "painted frames > 0"
assertion. Bound unchanged. This changes what the assertion samples, not what it guards: a real replay still fails it
(mutations, 6x: `c3-mutation-273-replay-real-6x.txt` 4/4 red at the span assertion; with that assertion removed,
`c3-mutation-273-bars-assertion-alone-6x.txt` 4/4 red at the bars assertion, ratio 0.13). Reverting the fix is the red run above.

**`:172`: not reproduced; no change.** The entrance span lower bound (>150) failed 148.4 / 131.7 / 59.8 only in runs where
the early preload was present (`green-4x-chart.txt`, `both-6x-n10.txt`, `final-4x-n5.txt`). With the preload dropped it
did not fail in ~150 runs (`c3-nopreload-*`, `c3-fixed-*`), so there is no red to fix against and, under the
systematic-debugging law, no fix was written. Likely mechanism (not proven): the span is measured between recorder
animation-frame ticks, so a starved first tick sees the entrance mid-way. If it reappears, capture the recorder samples
with `hel1651-flake-probe.spec.ts.txt` first.
