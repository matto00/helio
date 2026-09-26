# HEL-588: Cross-filtering between panels on a dashboard

## Description
> **Design input from the Pipelines & Outputs remodel (HEL-903, 2026-08-30):** panels render materialized node snapshots, so cross-filtering is either a client-side filter over each Output's snapshot rows (cheap, no re-run) or a parameterized re-run of the pipeline; the spec leans client-side for Phase 1 dashboards. Decide against `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md`.

## Context
Drill-down (its own ticket) introduces a shared panel-selection descriptor (panelId, dimension, value, series) when a user clicks a chart element. Cross-filtering extends that: a selection in one panel filters the other panels on the same dashboard that share the selected dimension, so the dashboard behaves as one linked view. Panel data comes from `usePanelData` (`rawRows`/`headers`) with per-panel field mappings.

## Scope
* Consume the shared selection state from the drill-down ticket at the dashboard level: when a data point is selected in panel A (dimension = a column value), apply a client-side filter to sibling panels whose field mapping references a column matching that dimension (by column name), recomputing their `rawRows`/aggregates for the filtered subset.
* Make cross-filtering opt-in and legible: an active cross-filter shows a dismissible dashboard-level indicator ("Filtered by {dimension} = {value}", mono value, tokens) with a clear-all control; clicking the same element again or clearing removes the filter. Panels not sharing the dimension are unaffected (and visibly not dimmed/altered).
* Apply filtering in the data layer (a selector/hook over already-fetched rows) — do not refetch from the backend. Handle the case where a panel's aggregation must recompute over the filtered rows (reuse existing aggregate utils).
* Cross-filter is dashboard-scoped view state, cleared on dashboard switch; must not persist to the backend layout.

## Acceptance criteria
* Selecting a data point in one panel filters sibling panels sharing that dimension to the matching subset; non-matching panels are unchanged.
* A dashboard-level indicator shows the active filter and clears it; re-selecting/clearing restores all panels.
* Filtering is purely client-side over loaded rows (no backend refetch); aggregated panels recompute correctly over the subset.
* State is dashboard-scoped, cleared on switch, never persisted. Unit tests for dimension-matching + filtered recompute; `npm run lint` / `npm test` pass, zero new warnings.

## Out of scope
* Backend-driven filtering/queries.
* Fullscreen and per-panel refresh (their own tickets).

## Dependencies
Blocked by the drill-down ticket (reuses its shared panel-selection state). Shares the ECharts option surface with the tooltips ticket.
