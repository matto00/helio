## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 60086f02bb5b1ee48f2246bc09e3e66349199585. The change dir is untracked on top of it, and nothing else in the tree is modified.

### What I verified (with evidence)
- Spawn cwd: `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/settle-lazy-chart-mounts/HEL-1599`.
- Lazy boundary: line 19 of `ChartRenderer.tsx` is `lazy(() => import("../ChartPanel")...)`. Confirmed.
- The sweep inventory is reproducible. `grep -rl 'findByTestId("echarts")\|findAllByTestId("echarts")' frontend/src` returns the exact 13 files listed in design.md Context, and the per-file counts sum to 43. That matches the design's figure.
- `grep -rln 'jest.mock(.*ChartPanel' frontend/src` returns only `PanelContent.test.tsx`. Its line 13 mocks `./ChartPanel`, and the file is now in the inventory together with its 9 `chart-panel` sites. Round 1 CR1 is addressed: the sweep is now defined by the lazy boundary rather than by testid, and task 1.1 must record the literal grep commands and every excluded candidate with a reason.
- CR1's mocked-ChartPanel case is now stated explicitly in D2: under jest's per-file module registry, the helper's `import()` resolves to the mocked module.
- Round 1 CR2 is addressed. D1 no longer claims a separate "later" injection point. For files without an async data boundary, the probe runs at the lazy require. The inventory label is limited to "not exposed by any injectable point (only the lazy require, absorbed)", and uncaptured promises (for example PublicDashboardViewerPage.truncation) are stalled at their real boundary and passed to the helper explicitly. Round 1's non-blocking note about the `jest.mocked` typing is handled by D2's widened source type.
- Helper placement is feasible:
  - `jest.config.cjs:6` testMatch is `*.test.ts(x)`, so `src/test/settleChartMount.ts` will not be collected as a suite.
  - Existing `src/test/remountFixtures.tsx` already imports from `../features/...`, so the import direction is established.
  - `src/test/` + `../features/panels/ui/ChartPanel` resolves to the existing `frontend/src/features/panels/ui/ChartPanel.tsx`.
- The crossFilter local helper at `PanelCard.crossFilter.test.tsx:357-362` matches the D2 body shape, so migrating it onto the shared helper is mechanical.
- `PanelCard.inspect.test.tsx` mocks `getOutputById` (l.38-46, 98) and waits with `findByTestId("echarts")` (l.129, 144, 161, 170). This is the HEL-1596 shape, so AC1's probe target is concrete.
- AC coverage:
  - AC1 is covered by task 1.2.
  - AC2 is covered by D2 and tasks 2.1/2.2.
  - AC3 is covered by tasks 1.2/3.1, with a stall-fired guard.
  - AC4 is covered by tasks 1.1/1.3/2.3 and the D4 inventory table.
  - AC5 is covered by C1, the non-goals and D2's rejected alternatives.
- No TODO/TBD placeholders and no contradictions between the proposal, design and tasks. The change is test-only with no contract surface, so no spec delta is needed (`skip_specs`).

### Verdict: CONFIRM

### Non-blocking notes
- D1's per-test `-t` clause ("when the whole-file run is green but an individual test is the first to load ChartPanel") is wordy. In practice, run the stalled probe per test for any multi-test file whose whole-file run is green, because only the first test in a file pays the lazy-chunk cost.
- For `PanelContent.test.tsx`, also note `fetchDatasetSchema` (mocked, l.24-29) as a possible causal source. Pass it to the helper if a probed test's chart waits on it.
