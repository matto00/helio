# HEL-292: Panel-level aggregation for metric & chart panels (hybrid model)

**Keystone of** HEL-291 (Agent-native dashboard usability: panel aggregation, config depth, ...). Implements the locked hybrid-aggregation decision.

## Problem

Panels are pure row renderers: `usePanelData` maps the **first row only** for metric panels, and `ChartPanel` plots **one mark per row** with no group-by. So any aggregated view (count of titles, avg rating, "titles by rating") requires a dedicated `aggregate`/`groupBy` pipeline. During the prod validation this meant **4 pipelines for a single 7-panel dashboard** — untenable for agent-built dashboards.

## Change

Give the visualization layer light aggregation, keeping pipelines as the transform/typing layer:

* **Metric panel:** add an aggregation spec — `{ value: <field>, agg: count|sum|avg|min|max }`. Renders the aggregate over all bound rows, not `rows[0]`.
* **Chart panel:** add `{ groupBy: <field>, agg: <fn>, yField: <field> }` so a chart can group N rows into categories with an aggregate per group (the bar/line case), instead of plotting every raw row.

Reuse the existing aggregate function semantics from the pipeline `aggregate` step (sum/avg/min/max/count, null-tolerant) so behavior matches.

## Scope / boundaries

* Pipelines keep owning transforms + typing (e.g. `cast` string→int). Dedicated aggregate pipelines remain valid for heavy/shared compute — this is additive, not a replacement.
* Wire the new specs through the panel config types, `propose_dashboard`/`apply_proposal` schema + MCP tools, and the panel creation UI.

## Acceptance criteria

* A single typed DataType (e.g. `NetflixTitles`, 1000 raw rows) can feed a metric showing avg rating **and** a chart of avg rating grouped by year — **with no aggregate pipeline**.
* Rebuilding the Netflix overview needs **1 pipeline (typing), not 4**.
* Backwards compatible: existing panels with no agg spec render as today.

## Links

- Linear: https://linear.app/helioapp/issue/HEL-292/panel-level-aggregation-for-metric-and-chart-panels-hybrid-model
- Parent: HEL-291
