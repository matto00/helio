## Context

`buildInitialChart(panel)` in `frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx` (line ~58 on
origin/main 63c2dd93) builds the `chartAppearance` state used by `resetFormToPanel` and passed to `AppearanceEditor`
with `showChartSection={false}`. It spreads `defaultChartAppearance` (theme/appearance.ts, which itself has
`chartType: "line"`), then the stored chart, then sets `chartType: panel.appearance.chart?.chartType ?? "line"`.
`handleEditSubmit` sends only `{background, color, transparency}` (+title) — `chartAppearance` is never sent today;
HEL-1351's `PanelDetailModal.aggregateChart.test.tsx` already asserts the save never writes `appearance.chart`.
`ChartAppearance.chartType` is optional in `types/panel.ts`, so an unset value type-checks.

## Goals / Non-Goals

**Goals:** edit state carries `chartType` only if the panel stores one; a test proves it (red before the fix) and proves
a save sends no chartType for the bar-Output case.

**Non-Goals:** see proposal.md (no change to `defaultChartAppearance`, no save-path wiring, no stored-row migration, no
file split).

## Decisions

**D1 — Omit the key, not just the fallback.** Destructure `chartType` out of `defaultChartAppearance` before spreading
it, drop the `chartType: ... ?? "line"` line, and let the stored chart's own spread carry a stored `chartType`. Removing
only `?? "line"` would still leave `"line"` from the defaults spread (stored undefined `chartType` is absent from the
object, so the spread wouldn't overwrite it). Result must have no own `chartType` key when the panel stores none
(assert `not.toHaveProperty("chartType")`, which also rejects `chartType: undefined` being present — either an absent
key or explicit undefined is acceptable in serialization, but absent is cleaner and matches "leaves it unset").
Alternative rejected: editing `defaultChartAppearance` — wide blast radius across five consumers.

**D2 — Observe the edit state via a mocked `AppearanceEditor`, not a new export.** The test `jest.mock`s
`../editors/AppearanceEditor` with a stub that records its `chartAppearance` prop (e.g. into a data attribute or a
captured variable) and renders title/appearance inputs enough to edit+save — or keeps the real module via
`jest.requireActual` and wraps it to capture props. No production export is added, so HEL-1399's split can move the
function freely; the mock is keyed by module path, not by importer. Alternative: export `buildInitialChart` — rejected to
keep the production diff to one function.

**D3 — Save assertion.** Reuse the pattern in `PanelDetailModal.aggregateChart.test.tsx` (render with store, enter edit
mode, change title, submit) and assert the dispatched `accumulatePanelUpdate` fields / store's pending update contain no
`appearance.chart` and no `chartType` anywhere. This half already passes on main; it is a regression guard, labelled
as such in the test, not the red proof.

**D4 — Red proof.** Executor must run the new test against the unfixed function and record it failing on the
"no chartType" assertion (expected `"line"`), then pass after the fix. Also a mutation: restore only the `?? "line"`
removal without D1's destructure and show the test still fails (proves D1 is needed).

## Risks / Trade-offs

- If the chart section is later enabled, `ChartAppearanceEditor` will show no chart-type radio checked for an unset
  value — acceptable; that section is spec'd to show no selector anyway (chart-type-selector).
- Collision with HEL-1399 (split) is limited to a ~5-line hunk in one function.

## Planner Notes

- Self-approved: frontend-only, no new dependencies, no API change — no escalation needed.
- Premise validation found the ticket's "saving would store line" claim slightly stale (save doesn't send chart today);
  verdict minor-staleness, scope unchanged.
- HEL-1379 ruling respected: no DB rows touched.
