## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD: e93bebc320d47ebcb2e5d7ad21070fc984400ce8 (branch bug/pie-chart-needle-slices/hel-1181; change dir untracked, no code diff yet).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/pie-chart-needle-slices/hel-1181`.
- **Premise is real:** `ChartOutputPanel.tsx` groups `records` with `chartAggregationSpec` + `groupAndAggregate` (HEL-1351), and `buildChartOption.ts:115-117` uses the aggregate for `bar|line|pie`. That matches the design's path description and the premise-validation evidence. The filed root cause really is already fixed on main, so a test-only restated scope is coherent.
- **The coverage gap is real:** `PanelCard.aggregateChart.test.tsx` uses only `BAR_AGG`. No test joins a pie Output config with `aggregation` to the final pie option.
- **The mutations are failable at the planned seam:**
  - M1 (drop pie from `useAggregate`) sends the pie to `chartDataOptions.ts:106-119`, which maps every raw row to its own `{name,value}` slice with no dedupe. That gives 80 slices against 4 expected, so the test goes red.
  - M2 (`chartAggregate` forced to null) reaches the same raw branch, so it also goes red.
  - The control (no `aggregation`, so `chartAggregationSpec` returns null) gives 80 slices under both mutations.
  - A regression in `resolvePanelChartType` that resolved the pie as `line` would also go red through the `series[0].type === "pie"` assertion.
  - Computing expected sums independently of `groupAndAggregate` is correct.
- **Seam choice (D1):** the full `PanelCard` path, using the existing harness (mocked `echarts-for-react/esm/core` exposing `data-option`, mocked `usePanelData`/`getOutputById`), is the right seam for "config → grouping → option". A new file avoids touching `PanelCard.tsx`, so it doesn't collide with HEL-1365.
- **D3 theme re-render: DEFECT.** The chart does not read PanelCard's `theme` prop.
  - `grep -n theme PanelCard.tsx`: the `theme` prop (lines 380/405) is used only at 553-554, in `getPanelCardStyle(panel.appearance, theme)`, which sets the card surface/text CSS vars. It is never passed to `ChartOutputPanel`, `ChartRenderer` or `ChartPanel`. A grep for `theme` in those three files finds no theme prop. I ran the check twice with the same result.
  - The chart's theme comes from context: `useChartOption.ts:43` `const { theme, accentColor } = useTheme();`, plus the rAF `themeSyncTick` recompute (lines 65-69), feeding `buildChartOption({..., theme})`.
  - In the test, `renderWithStore` wraps the UI in its own `<ThemeProvider>` (renderWithStore.tsx:287), and RTL `rerender` keeps that wrapper's state. So re-rendering `<PanelCard theme="light">` leaves the chart's theme as it was: the memo inputs don't change and the same option is asserted twice.
  - The "keeps doing so when the card re-renders with the other theme" half of Restated AC1 would therefore pass without ever exercising a chart theme flip. It is the kind of non-evidence that looks like evidence, and it is exactly the clause the ticket's resize/theme symptom is about.
  - The correct mechanism already exists in the repo: `ChartPanel.theme.test.tsx:129-150` toggles through a `useTheme().toggleTheme` consumer inside the provider, then waits under `act` for the rAF recompute.
- **AC coverage:** Restated AC1 is covered by D1–D3 (with the D3 defect). AC2 is covered by D5/task 1.3. AC3's unaggregated half is covered by D4. AC3's "aggregated pie with few rows" half is only implicitly covered, by "no production diff" (see notes). AC4's out-of-scope items are respected (proposal Non-goals).
- **No placeholders, no contract change needed:** test-only, no API or schema change, so `skip_specs: true` is appropriate.

### Verdict: REFUTE

### Change Requests

1. **design.md D3 / tasks.md 1.1: flip the theme the chart actually reads.** Do not re-render with PanelCard's `theme` prop; that prop only styles the card surface (`PanelCard.tsx:553-554`) and never reaches `useChartOption`. Revise D3 and task 1.1 so the test:
   (a) renders, next to the card inside `renderWithStore`'s wrapper, a small consumer that calls `useTheme().toggleTheme` (same pattern as `ChartPanel.theme.test.tsx:129-150`), or otherwise changes the ThemeProvider context;
   (b) flips it inside `act` and waits for the `themeSyncTick` rAF recompute;
   (c) **asserts the flip actually happened** before re-asserting the 4 slices. For example, `document.documentElement` `data-theme` changed, or a theme-dependent field of the new `data-option` (such as the text/legend color) differs from the first read. Without (c) the theme assertion can't fail, because nothing proves the option was rebuilt under the other theme.
   Optionally also pass the matching `theme` prop to PanelCard for realism, but the context flip is what must be tested.

### Non-blocking notes

- Restated AC3 also names "an aggregated pie with few rows". The plan proves no production change through the test-only diff (task 1.3's `git diff` check), which is enough. The PR should say that this half rests on the empty production diff, not on a dedicated test case.
- Task 1.3 saves the mutation transcripts under the gitignored `e2e-evidence/HEL-1181/`. Persist them with `scripts/concertino/persist-evidence.sh` and cite the `ref=` paths, so the red-first proof survives Phase-4 cleanup.
- The `usePanelData` mock is disclosed as a limitation in Risks. That's acceptable given the static reading and the live probe.
