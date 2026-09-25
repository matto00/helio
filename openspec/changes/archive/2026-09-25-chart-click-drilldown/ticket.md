# HEL-572: Drill-down: click a chart element to filter / inspect

## Description

Panels are static renders: clicking a bar/point/slice does nothing.
`ChartPanel.tsx` (ECharts) has the raw rows/headers and field mapping
available (`usePanelData` provides `rawRows`/`headers`; `buildDataOption`
maps x/y/series columns). A first interactivity step is drill-down: clicking
a chart element inspects the underlying rows for that category/series and
lets the user focus on them. This ticket establishes the click→selection→inspect
interaction that cross-filtering later builds on.

## Scope

- Wire ECharts `click` events on chart series (via the `echarts-for-react`
  `onEvents`/`onChartReady` API) to a handler that identifies the clicked
  element's category (x value) and series, mapped back to the source columns
  via the panel's field mapping.
- On click, present the underlying rows for that element: reuse `DataGrid`
  (variant `full`/`preview` per §6) inside the panel's `PanelDetailModal`
  (or a focused inspect view) showing the filtered subset, with a clear
  "showing rows for {category}/{series}" header and a way to clear/return.
- Introduce a small, reusable panel-interaction state (a selected data-point
  descriptor: panelId, dimension, value, series) in panel state — designed
  so the cross-filter ticket can consume the same selection. Keep it view
  state, cleared on panel/dashboard switch.
- Provide affordance/cursor feedback that chart elements are clickable;
  keyboard-accessible alternative where feasible (e.g. inspect action in the
  panel `ActionsMenu`).

## Acceptance criteria

- Clicking a chart element opens an inspect view listing exactly the
  underlying rows for that category/series via `DataGrid`, with a labeled
  header and a clear/return control.
- The selected-point descriptor is stored in reusable panel-interaction state
  and cleared on panel/dashboard switch.
- Clickable elements have a pointer cursor; an equivalent inspect entry
  exists in the panel menu for keyboard users (§8).
- No regression to rendering/tooltips. Unit tests for the click→column
  mapping and row-filtering logic; `npm run lint` / `npm test` pass, zero
  new warnings.

## Out of scope

- Propagating the selection to other panels (cross-filter ticket, HEL-588).
- Fullscreen (HEL-584, already shipped) and per-panel refresh (HEL-579,
  already shipped) — this ticket must work correctly alongside both, not
  re-implement either.

## Dependencies

None. Produces the shared panel-selection state consumed by HEL-588
(cross-filtering), which is blocked on this ticket.

## Batch context (driver brief, 2026-09-25)

HEL-350 Panel Interactivity epic, one lane, strictly sequential:
HEL-579 refresh (merged `572dc8d6`) → HEL-584 fullscreen (merged `8a746496`)
→ HEL-566 tooltips (merged `e195481a`) → **HEL-572 drill-down (this ticket)**
→ HEL-588 cross-filter (blocked by this ticket; it consumes this ticket's
selection state).

Premise validated 2026-09-25 (`.concertino/runs/HEL-572/evidence/premise-validation.md`,
verdict: no-drift). Key confirmed facts:

- No ECharts click wiring exists anywhere yet.
- A dashboard chart panel always renders from `rawRows` (`chartAggregate` is
  always `null` from `usePanelData`) — inspect-view rows are exactly what the
  chart plotted, no server-aggregate product fork needed. Must honestly
  reflect `rowsTruncated` in the inspect view's copy when true.
- `buildDataOption` maps bar/line (single + multi-series), pie
  (mapped-y or auto-detected), and scatter (with optional size/color
  grouping) differently — each needs its own click→row-filter mapping.
- Both `PanelCard`'s in-grid render and `PanelFullscreenOverlay` (HEL-584)
  render the same `ChartPanel`; both must support click→inspect.
- No panel-interaction/selection state exists yet — this ticket originates
  it.
- `ActionsMenu` already holds Rename/Customize/Duplicate/Delete; Refresh and
  Fullscreen already occupy header icon slots — Inspect's keyboard-accessible
  entry point should go in `ActionsMenu`, not crowd the header further
  (decide and record in design.md).
- Related open follow-up, not fixed here: HEL-1178 — a chart panel with no
  stored `appearance.chart` gets `{}` for its appearance option; click
  wiring/pointer cursor must not live in the appearance-conditional half of
  the option or it silently won't engage for such a panel.
