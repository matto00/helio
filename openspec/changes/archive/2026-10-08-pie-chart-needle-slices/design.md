## Context

See proposal.md — Why. The dashboard path for a chart Output is `PanelCard` → `PanelContent` → `ChartOutputPanel`
(groups `records` with `chartAggregationSpec` + `groupAndAggregate` when the Output has `aggregation`) → `ChartRenderer`
→ `ChartPanel` → `useChartOption` → `buildChartOption` (`useAggregate` is true only for bar/line/pie) →
`buildAggregateDataOption(…, "pie")` → `{name, value}` slices. Existing coverage:

- `PanelCard.aggregateChart.test.tsx` (HEL-1351) drives the full card path, but only with a **bar** Output.
- `ChartPanel.aggregate.test.tsx` (HEL-624) covers pie, but feeds a precomputed `chartAggregate` straight into
  `ChartPanel`, skipping the config → grouping step.
- `ChartOutputPanel.aggregate.test.tsx` mocks `ChartRenderer`, so it never sees the final option.

No test joins "pie Output config with `aggregation`" to "final pie option has one slice per group".

## Goals / Non-Goals

**Goals:** a failable, red-first regression test at the dashboard-card seam for an aggregated pie; a control case
proving no behavior change for unaggregated pies. **Non-Goals:** any production code change (see proposal Non-goals).

## Decisions

**D1 — Test seam: the full `PanelCard` path, in a NEW test file.** Reuse the `PanelCard.aggregateChart.test.tsx`
harness pattern (mock `echarts-for-react/esm/core` to expose `option` as `data-option`; mock `usePanelData` to supply
`rawRows`/`headers`/`paginationRows`; mock `getOutputById` to return the Output). A new file
`PanelCard.aggregatePieChart.test.tsx` keeps the HEL-1351 file untouched and does not edit `PanelCard.tsx` (HEL-1365's
queued split owns that file). Alternative rejected: a `buildChartOption`-only test — it skips the config → grouping step,
the exact step the ticket's filed root cause lived in.

**D2 — Fixture shape mirrors the live probe.** ~80 records over 4 repeated categories with integer amounts, Output
config `{chartType: "pie", fieldMapping: {xAxis, yAxis}, aggregation: {groupBy, agg: "sum", yField}}` — the same shape
the probe built via the real API. Expected slices are computed independently in the test from the fixture
(per-category sums), never by calling `groupAndAggregate` (the code under test). Assert `series[0].type === "pie"`,
`data.length === 4`, and each `{name, value}` pair. The fixture must make the failure observable: with grouping off the
raw path yields 80 slices, so "length 4" cannot hold vacuously.

**D3 — Theme switch through the real ThemeProvider (skeptic-design-1 CR1).** PanelCard's `theme` prop only styles
the card (`getPanelCardStyle`); the chart reads its theme from `useTheme()` in `useChartOption.ts` plus a rAF-deferred
recompute. So the test renders a `ThemeToggler` (calls `useTheme().toggleTheme`) alongside the card inside
`renderWithStore`'s own `ThemeProvider` wrapper — the pattern in `ChartPanel.theme.test.tsx` — clicks it inside `act`,
and waits for the recompute. It FIRST asserts the switch reached the chart (`document.documentElement`'s `data-theme`
flipped AND a theme-dependent value in the rendered option differs from before, e.g. the legend/text colour resolved via
`resolveChartTextColor`), and only then re-asserts the same 4 slices; it toggles back and asserts once more. jsdom has no stylesheet, so CSS-variable-derived tokens may be identical in both
themes; if no theme-dependent option value differs unmocked, mock the chart-theme resolver per theme exactly as
`ChartPanel.theme.test.tsx` does, so the "switch reached the chart" precondition is genuinely failable. Viewport
resize is not meaningful in jsdom; the live probe (screenshots under gitignored `e2e-evidence/HEL-1181/`) is the
evidence for it — stated as such, not claimed by the unit test.

**D4 — Control case (AC3).** Same records, Output config without `aggregation` → the pie has one slice per row (80).
Named and commented as pinning CURRENT behavior so a future product decision changes it deliberately.

**D5 — Red-first proof by mutation, recorded.** Because the fix already shipped, "red" is shown by temporarily
reintroducing the bug and reverting: (M1) drop `chartType === "pie"` from `useAggregate` in `buildChartOption.ts`;
(M2) force `chartAggregate` to `null` in `ChartOutputPanel.tsx` (the filed root cause). Each must turn the aggregated-pie
test red (80 ≠ 4) while the control stays green; transcripts are saved under gitignored `e2e-evidence/HEL-1181/` AND persisted with
`scripts/concertino/persist-evidence.sh`; both mutations are reverted
before commit and `git diff` against base shows only the new test file.

## Risks / Trade-offs

- [AC3's "aggregated pie with few rows" case has no dedicated test] → it is covered by the change having no production
  diff; the PR says so explicitly.

- [The harness mocks `usePanelData`, so a race inside it is not exercised] → static reading shows `records` and `rawRows`
  derive from the same `paginationEntry.rows`; the live probe covered the real hook. Stated, not hidden.
- [Control case could read as endorsing needle slices] → its name/comment say it pins current behavior pending the
  separately-filed product decision.

## Planner Notes

- Self-approved: test-only scope per the driver's `proceed-with-restated-scope` answer (driver, overnight delegation).
- Worktree was created before the ticket-drift escalation resolved, to run the live repro the driver requested; disclose
  in the PR.
