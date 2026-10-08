## Context

HEL-1351 (#820) introduced `frontend/src/features/panels/ui/resolvePanelChartType.ts`: stored
`appearance.chart.chartType` -> bound Output `config.chartType` -> `line`. `ChartOutputPanel.tsx:68` resolves with it
and injects the resolved type into the appearance it hands `ChartRenderer`, so `appearanceToEChartsOption`
(`chartAppearance.ts:142`) and `useChartClickHandler.ts:77` — which still call the panel-only `resolveChartType` —
only ever see an already-resolved appearance on the dashboard path. `PanelCard.tsx:463` uses the same resolver for
Inspect. The other `ChartRenderer` callers (`OutputPreviewPane`, `HistoryChart`) build their appearance from the
Output config. So the render path is correct; the ticket's remaining gaps are elsewhere (proposal.md).

`POST /api/panels/batch` (what `place_outputs` calls, `helioApi.ts` `placeOutputs`) sends no appearance, and
`PanelAppearance.Default.chart` is `None` (`model.scala:397`), so a fresh placement stores no chart type.
`PanelAppearance.applyPatch` (`model.scala:460-470`) merges a chart patch over `existing.chart.getOrElse(
ChartAppearance.Default)`, and `ChartAppearance.Default.chartType` is `Some("line")` (`model.scala:238`). The same
merge serves `PATCH /api/panels/:id` and `POST /api/panels/updateBatch` (`applyPatchJson`).

## Goals / Non-Goals

**Goals:** measure AC1 against the literal API repro; keep AC2 (panel override wins) proven live; stop a chart patch
from inventing a `chartType`; make both MCP descriptions accurate (AC3); correct stale docstrings.

**Non-Goals:** see proposal.md. In particular `ChartAppearance.Default` keeps `chartType = Some("line")`; only
`model.scala` and tests (`PanelAppearanceMergeSpec`, `DashboardSnapshotValidationSpec`) reference it, so the narrow fix
is to change the merge base rather than the shared default (skeptic-design-1 note 1).

## Decisions

**D1 — Fix the merge base, not the default.** In `PanelAppearance.applyPatch`, the fallback base for a panel with no
stored chart becomes `ChartAppearance.Default.copy(chartType = None)`. Alternative rejected: changing
`ChartAppearance.Default.chartType` to `None` — wider blast radius (proposal apply, snapshot validation) for no gain.
Alternative rejected: frontend-side ignore of a stored `"line"` — indistinguishable from a user's deliberate choice.
The existing `"pie"` scenario is unchanged (an explicit `chartType` still sets it). `ChartAppearance.applyPatch`'s
`chartType` fold already passes `existing.chartType` through, so `None` stays `None`.

**D2 — No migration.** Already-stored implicit `"line"` values cannot be distinguished from chosen ones; leave them.

**D3 — AC1/AC2 measured by e2e, not just unit.** New `e2e/hel1304-output-charttype-render.spec.ts`, modelled on
`e2e/hel1351-aggregated-chart-overlay.spec.ts` (API seeding, ECharts instance read via React fiber, `evidencePath`
from `e2e/support/evidencePath`). Seed one source/pipeline with chart Outputs `bar` and `pie`, run it, create a
dashboard, place them with **`POST /api/panels/batch`** (the exact `place_outputs` request body: `type: "output"`,
`config: {outputId}`, no appearance). Create the Outputs with `POST /api/pipelines/:id/outputs` (what `add_output` calls). Read `series[].type`
(HEL-1351's helper returns names only). Assert the rendered series `type`: bar -> `bar`, pie -> `pie` (AC1). Then a third
placement of the bar Output PATCHed with `{chart:{chartType:"line"}}` must render `line` (AC2 live), and a fourth
PATCHed with a legend-only chart patch must still render `bar` (D1; must be shown failing without the D1 fix, then passing with it). Clean up created rows by exact id.

**D4 — MCP descriptions are text plus a test.** Edit `placements.ts` and `write.ts` descriptions; add assertions in
the existing helio-mcp test style that each description mentions the precedence (Output `config.chartType`, panel
override, line fallback) and that `place_outputs` no longer says chartType only lives on the Output.

**D5 — Frontend is docstring-only.** Correct `resolveChartType`'s docstring (`chartAppearance.ts:110-118`) and
`chartClickSelection.ts:~192` to say it reads an appearance whose type was already resolved by
`resolvePanelChartType` on the dashboard path. Do not delete `resolveChartType` (still the line fallback for
`appearanceToEChartsOption`'s other callers, e.g. `UsageChart`).

## Risks / Trade-offs

- A client that relied on a chart patch implicitly storing `"line"` now gets the Output's type. That is the ticket's
  intended behaviour; non-output (content) panels never render charts, so nothing else reads it.
- e2e reads ECharts internals via fiber; the same technique is already used by HEL-1351's spec.

## Planner Notes

- Self-approved: D1 (narrow backend fix in-scope — it directly defeats the ticket's "Output type when the panel has
  none" intent); scope restated per the answered ticket-drift escalation; no AC dropped.
- Files the concurrent lanes own (`ci.yml`, root `package.json`, lockfile, `.audit-ci.jsonc`) are not touched. If the
  e2e needs shard-weight registration in `ci.yml`, stop and report rather than edit.
