# HEL-1598: After HEL-1592: remaining stale panel spec text (flat-field back-compat, chart annotation, type-selector "or changing", typeId in 4 specs, unexamined collection/timeline/metric-trend specs)

## Description

Origin: HEL-1592 (PR matto00/helio#1026, 8ae29ff5d), lane-reported. Out of its scope.

* `mcp-panel-composition-tools`: the flat-field back-compat requirement (fieldMapping, aggregation, chartType) and the chart `annotation` requirement.
* `panel-type-rendering`: the Purpose line, and the type-selector requirement that says "or changing" a panel type.
* `typeId` mentions in the dashboard-export-import, echarts-chart-panel, panel-polling and write-path-audit specs.
* The collection, timeline and metric-trend panel-type specs, which were not examined at all.

Make all changes through OpenSpec deltas, with a verification command for each factual claim. Re-derive every item against the tree first, and drop any that are accurate, with evidence. HEL-1466 and HEL-1592's archives show the pattern.

## Acceptance Criteria

- Every item above is re-derived against the tree with a recorded command; items found accurate are dropped with that evidence.
- Every stale statement found is restated or removed, through an OpenSpec delta wherever the delta grammar can address it; every factual claim in the new text has a verification command and its output recorded in the change's evidence.md.
- `openspec validate <change> --type change --strict` passes; no runtime behaviour change.

## Driver constraints (this run)

- Specs modified by an open parked change are not edited here. HEL-1572's open change `appearance-type-density-motion` carries an `echarts-chart-panel` delta, so the `echarts-chart-panel` `typeId` item is deferred to a follow-up (re-checked at Delivery).
