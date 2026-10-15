## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 60086f02bb5b1ee48f2246bc09e3e66349199585 (change dir untracked on top of it).

### What I verified (with evidence)
- Spawn cwd: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/settle-lazy-chart-mounts/HEL-1599`.
- `ChartRenderer.tsx:19` is `const ChartPanel = lazy(() => import("../ChartPanel").then(...))`. Confirmed.
- HEL-1596 claims in design.md Context match the archive's `measurements.md`: injection method (l.47-48), the
  stall inside the `echartsCore` require is absorbed (l.51-55), the cliff at 1000 ms, and the warm-up having no effect (l.82-83, 122).
- crossFilter's local `settleChartMount` (`PanelCard.crossFilter.test.tsx:357-362`) matches the D2 shape. The
  helper's planned path `frontend/src/test/` -> `../features/panels/ui/ChartPanel` resolves to the same module.
- The "echarts" sweep: `grep -rl 'findByTestId("echarts")\|findAllByTestId("echarts")' frontend/src` gives exactly
  the 13 files listed. There are 43 sites (the design says "about 45", which is fine).
- I checked the other 18 test files that mention `"echarts"` (the ChartPanel.* direct-render suites,
  PanelDetailModal.{appearanceSentinel,panelSwitch,themeAwareFallback,truncation}, MobilePanelStack*,
  PanelFullscreenOverlay.truncation). They only define the echarts mock and never wait on it, so they are correctly excluded.
- The files that mock `./renderers/ChartRenderer` (PanelContent.chartOverlay, PanelContent.chartFieldTypes,
  ChartOutputPanel.aggregate) do not go through the lazy boundary, so they are correctly out of scope.
- **Gap found:** `frontend/src/features/panels/ui/PanelContent.test.tsx` mocks `./ChartPanel` (l.12-17, testid
  `chart-panel`) but renders the REAL `ChartRenderer`, so the mock still mounts behind the `React.lazy`/Suspense
  boundary. Its own comment (l.51-56) says so. It also mocks `getOutputById` (l.19-21), which is the HEL-1596
  causal shape exactly. It has 9 `findByTestId("chart-panel")` waits (l.76, 84, 99, 264, 273, 282, 289, 305, 314).
  The design's sweep (Context, "13 test files call findByTestId("echarts")") misses this file completely, because
  the sweep was keyed on the `echarts` testid and not on the lazy boundary.

### Verdict: REFUTE

### Change Requests
1. **The sweep definition and inventory miss a known exposed-shape file (AC4).** In design.md Context and
   tasks.md 1.1, define the sweep criterion as the lazy boundary rather than a testid: any `findBy*`/`findAllBy*`/`waitFor`
   whose target only exists after the real `ChartRenderer`'s lazy `ChartPanel` (real or `jest.mock`ed) mounts.
   Add `PanelContent.test.tsx` (9 `chart-panel` sites listed above) to the enumerated inventory so it is probed per D1
   and converted or left with a reason. Record the grep commands used for the sweep so the inventory can be
   reproduced. Also cover the `jest.mock("./ChartPanel")` case: `settleChartMount`'s `import(...)` resolves to the
   mocked module, which is still the correct causal promise. State this so the executor does not treat it as a mismatch.
2. **D1(b) duplicates (a).** The example in (b), "a scratch `jest.mock` of `../ChartPanel` wrapping the real module
   with a stalled factory", stalls inside the lazy `require`. That is the same point as (a), which HEL-1596 measured as
   absorbed. Either name a genuinely later point (after the import resolves and before React's retry render), or drop
   (b). If you drop it, change the "no injection point" outcome label from "not exposed" to "not exposed by any
   injectable point (only the absorbed in-require stall is reachable)". That way the inventory does not claim more
   than was measured.

### Non-blocking notes
- D2 signature `...sources: jest.Mock[]`: callers hold `jest.mocked(fn)` (`MockedFunction<...>`). If typecheck rejects
  the assignment, widen it to `jest.MockInstance<unknown, never[]>[]` or `{ mock: { results: { value: unknown }[] } }[]`
  rather than casting at call sites.
- `PublicDashboardViewerPage.truncation` may wait on a promise that no mock captures (the Risks section already covers
  this). If so, pass the promise source explicitly. Do not leave the file as "not exposed" just because no mock exists.
