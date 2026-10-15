## Context

- `ChartRenderer.tsx:19` lazy-loads `ChartPanel` (HEL-512 split). In jest the dynamic `import()` is a `require` resolved
  in a later microtask; React 19 shows the Suspense fallback and reveals the chart no earlier than 300 ms after the
  fallback (`FALLBACK_THROTTLE_MS`).
- HEL-1596 (`openspec/changes/archive/2026-10-14-fix-crossfilter-echarts-flake/measurements.md`) measured, by injected
  stall (busy-wait `STALL_MS` in the `getOutputById` mock's resolution microtask, i.e. after `findBy*` armed its 1 s timer
  and before the lazy mount):
  - stall >= 1000 ms fails the `findBy` wait, with the CI failure DOM; < 1000 ms passes.
  - a stall INSIDE the lazy `require` (the `./echartsCore` mock factory) is absorbed (passes even at 3000 ms), because the
    reveal timer was already scheduled before the stall.
  - fix: `await act(async () => { await Promise.all(getOutputByIdMock.mock.results.map(r => r.value)); await import("./ChartPanel"); })`
    then synchronous `getBy*` — passes at 1200 ms and 3000 ms stalls.
- Sweep definition (scope of this change): every frontend test `findBy*` / `findAllBy*` / `waitFor` whose target only
  exists after `ChartRenderer`'s lazy `ChartPanel` mounts — whether `ChartPanel` is real (target `echarts` from the
  echarts-for-react mock, or any chart-derived text/role) or mocked (e.g. `PanelContent.test.tsx` mocks `./ChartPanel` with
  test id `chart-panel` but still renders the real lazy `ChartRenderer`, so the mock mounts behind the same Suspense
  boundary). Searching by the `echarts` test id alone is insufficient (design gate round 1 found `PanelContent.test.tsx`,
  9 `findByTestId("chart-panel")` waits, missed that way).
- Starting inventory on main 60086f02b (to be completed and recorded by task 1.1 with the literal grep commands used):
  13 files / 43 sites with `findByTestId("echarts")`:
  `PanelCard.{inspect,aggregateChart,aggregatePieChart}`, `PanelContent.chartTruncation`,
  `PanelFullscreenOverlay{,.aggregateChart}`, `detailModal/PanelDetailModal.{aggregateChart,chartTypeDefault,editScrollFade}`,
  `renderers/ChartRenderer{,.timeNote,.histogramNote}`, `dashboards/ui/PublicDashboardViewerPage.truncation`;
  plus `PanelContent.test.tsx` (lines 76, 84, 99, 264, 273, 282, 289, 305, 314, `chart-panel`). Task 1.1 must also grep for
  `jest.mock(...ChartPanel...)` test ids, `waitFor` blocks that query a chart marker, and `findBy*` on chart-only text, and
  record which candidate sites were excluded and why (e.g. the wait follows a synchronous interaction on an already
  mounted chart). `PanelCard.inspect` and `PanelCard.aggregateChart` both mock `getOutputById` exactly like crossFilter did.

## Goals / Non-Goals

**Goals:** per-file probe-confirmed exposure verdict; deadline-free chart waits for every exposed site; red-before /
green-after evidence for every converted file; a complete inventory of swept sites (converted / left + reason).

**Non-Goals:** raised timeouts, retries, production code changes, finding the natural CI stall source, other lazy
components (`MarkdownRenderer`) unless a swept chart site depends on them.

## Decisions

**D1 — Probe every file before changing it (systematic-debugging law).** For each swept file, inject a busy-wait stall
(`STALL_MS`, `Date.now` loop, scratch edit, never committed, recorded as fired via a `STALL_FIRED` file) at the latest
causal async boundary that precedes the lazy `ChartPanel` mount and follows the first `findBy*` call:
- Files whose chart waits on a mocked async data source (e.g. `getOutputById`, a mocked service/thunk, a fetch) stall in
  that mock's resolution microtask — HEL-1596's exact method.
- Files with no such async boundary (the lazy import starts in the initial synchronous render, e.g. rendering
  `ChartRenderer` directly with props) are probed with the stall inside the lazy require (the `./echartsCore` / echarts mock
  factory, or the `./ChartPanel` mock factory when ChartPanel is mocked) — the only injectable point after the `findBy*`
  timer is armed without editing product code. HEL-1596 measured this point as absorbed; the probe still runs to confirm it
  per file. If green, the inventory label is "not exposed by any injectable point (only the lazy require, absorbed)".
  If some other async boundary exists in the file (a promise not captured by a mock, e.g. a thunk or an awaited fetch in
  `PublicDashboardViewerPage.truncation`), stall there and, if exposed, pass that promise to the helper explicitly rather
  than marking the file unexposed.
- Probe at `STALL_MS=1200`, N=5, whole file AND (for a multi-test file) per affected test with `-t` when the whole-file
  run is green but an individual test is the first to load `ChartPanel`. A file is exposed if any stalled run fails with a
  chart-wait timeout. A run where the stall did not fire is invalid and does not count.

**D2 — Fix shape for exposed sites: shared helper.** Add `frontend/src/test/settleChartMount.ts` exporting
`settleChartMount(...sources)` where each source is either a jest mock (its `mock.results` values are awaited) or a
plain `Promise` (awaited directly) — the parameter type is widened to accept `jest.mocked(...)` values without per-call
casts; body = `await act(async () => { await Promise.all(<all source promises>); await import("../features/panels/ui/ChartPanel"); })`
with a why-comment (the deadline race, no wall-clock deadline). Callers then query synchronously (`getByTestId`). When a test file mocks `./ChartPanel`, jest's module registry makes the
helper's `import()` resolve to that mock — the same module object the lazy `import("../ChartPanel")` resolves to — which
is the correct promise to wait on (it is what gates the Suspense reveal in that file).
Migrate `PanelCard.crossFilter.test.tsx`'s local copy onto it (no behaviour change; it remains green under its own
HEL-1596 stall). If only one file ends up exposed besides crossFilter the helper is still shared (reused by two files).
A site that is reached after the chart is already mounted (e.g. a second `findByTestId` in the same test after a sync
interaction that does not remount the chart) becomes a plain synchronous `getByTestId` only if probing shows it needs no
wait; otherwise it gets `settleChartMount` too.
Rejected: raising timeouts (C1), `jest.retryTimes` (C1), mocking `ChartRenderer`/`ChartPanel` away (stops exercising the
real chart path), a bare top-level `import "./ChartPanel"` warm-up (HEL-1596 measured the cliff unchanged).

**D3 — Sites left alone.** A site is left unchanged only if D1's probe shows it green under the 1200 ms stall at every
applicable injection point (fired == N), or no injection point exists; the inventory records which.

**D4 — Evidence (`measurements.md` in this change).** Literal commands, cwd (this worktree's `frontend/`), env
(`CI=true`, `nice -n 19`, `--maxWorkers=1` for single files, `--maxWorkers=3` for folders), N, stall point, pass/fail,
fired count, per file before and after; failure-DOM excerpt for one red run per exposed file; the full sweep inventory
table (file:line → converted / left + reason). Clean (no stall) after: each converted file 10 cold-cache runs green.

**D5 — Regression guard.** For each converted file, one scratch mutation of a load-bearing assertion must turn the test
red (proves the synchronous query still asserts the real chart path); recorded, never committed.

## Risks / Trade-offs

- `act` + awaited promises assume every causal promise is a mock result; a file whose chart waits on a promise not
  captured by a mock (e.g. an RTK thunk on real axios) needs the promise source passed explicitly or is reported.
- The helper's `import` path must resolve to the same module the lazy `import("../ChartPanel")` loads (same jest module
  registry per file); verified by the green-under-stall runs.

## Planner Notes

- Self-approved: test-only, `skip_specs: true`.
- Concurrent lanes HEL-1606 (e2e) and HEL-1597 (backend) touch disjoint files.
