# HEL-1304: Honour Output config.chartType at render; fix place_outputs docs

## Description

Found while designing the CI Health dashboard in helio-news. Charts were created via MCP with the chart type set on
the Output, and all rendered as line charts.

Evidence (as filed 2026-10-05):

* Repro: `add_output {kind:"chart", config:{chartType:"bar"}}` then `place_outputs` -> the panel renders a line chart.
* `frontend/src/utils/chartAppearance.ts:115-117` `resolveChartType` reads only panel `appearance.chart.chartType`,
  defaulting to `"line"`; `PanelCard.tsx:460` passes `resolveChartType(panel.appearance.chart)`. `PanelContent.tsx`
  never reads the Output's `config.chartType`.
* Yet the editor (`outputConfigTypes.ts:176`) and `OutputSummaryReducer.scala:109` do read `config.chartType`, so the
  field is stored and half-honoured.
* `helio-mcp/src/tools/placements.ts:44` says chartType "lives on the Output itself", which is misleading.

What: make the chart render resolve chart type from the Output config when the panel appearance has none (precedence:
panel appearance override, then Output config, then line). Correct the `place_outputs` description to match.

## Acceptance criteria

- [ ] The repro above renders a bar chart without any `update_panel_appearance` call.
- [ ] A panel appearance `chartType` still overrides the Output config (test).
- [ ] The `place_outputs` tool description accurately states where chartType is resolved.

## Premise drift (recorded at Setup, 2026-10-08)

The ticket's core render evidence is stale: HEL-1351 (#820, de1ae5b00) added
`frontend/src/features/panels/ui/resolvePanelChartType.ts` (panel appearance -> Output `config.chartType` -> line),
used by `ChartOutputPanel.tsx:68` and `PanelCard.tsx:463`. Scope is restated in proposal.md (ticket-drift escalation
answered `proceed-with-restated-scope`; no acceptance criterion dropped). See
`.concertino/runs/HEL-1304/evidence/premise-validation.md`.
