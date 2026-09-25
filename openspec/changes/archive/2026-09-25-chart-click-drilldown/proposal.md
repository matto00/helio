## Why

Chart panels are static: clicking a bar/point/slice does nothing. HEL-572
establishes the click→selection→inspect interaction — the first
interactivity primitive — and originates the reusable panel-interaction
(selection) state HEL-588 (cross-filtering) is blocked on and will consume.

## What Changes

- Wire ECharts `click` events on chart series (`echarts-for-react`
  `onEvents`) in `ChartPanel.tsx`, mapping the clicked element back to its
  source category/series/value via the same `fieldMapping` `buildDataOption`
  already uses — one mapping per chart type (bar/line single- and
  multi-series, pie, scatter with optional size/color grouping).
- Introduce a small, reusable panel-interaction (selection) descriptor
  (`panelId`, `dimension`, `value`, `series`) in panel view state — cleared
  on panel/dashboard switch, never persisted.
- On click, open a dedicated inspect view (reusing `DataGrid`, `variant`
  `full`/`preview`) showing exactly the rows loaded for that
  category/series, with a labeled header and a clear/return control; honest
  copy when `rowsTruncated` is true (only the loaded page is shown). Works
  from both the in-grid `PanelCard` and the `PanelFullscreenOverlay`
  (HEL-584).
- Pointer-cursor affordance on clickable chart elements; a keyboard-reachable
  "Inspect" entry in the panel `ActionsMenu` opens the same view for the
  panel's current selection (or a no-selection empty state).
- Chart-element clicks stop propagation so they open Inspect instead of
  `panel-body-click`'s existing "open the Customize modal" behavior.

## Capabilities

### New Capabilities
- `chart-drilldown-inspect`: click→selection→inspect interaction on chart
  panels — event wiring, per-chart-type column mapping, the reusable
  selection descriptor, the inspect view, and its keyboard entry point.

### Modified Capabilities
- `panel-body-click`: a click that lands on a chart series element no longer
  falls through to "open the detail modal" — it opens Inspect instead and
  the panel-body-click handler must not also fire.

## Impact

- `frontend/src/features/panels/ui/ChartPanel.tsx` (click wiring, cursor),
  `PanelCard.tsx`/`PanelCardBody.tsx`, `PanelFullscreenOverlay.tsx`,
  `PanelContent.tsx` (new inspect-view mount point + selection state wiring),
  panel Redux state (new selection slice/reducer), `ActionsMenu` items list.
- New component: an inspect view (own `Modal`, not `PanelDetailModal`) using
  `DataGrid`.
- No backend/API/schema changes — pure frontend, view-state only.

## Non-goals

- Propagating the selection to sibling panels (HEL-588, cross-filter).
- Any server-side aggregation/filtering fork (HEL-1027) — this ticket
  inspects exactly the client's already-loaded `rawRows`.
- Fullscreen and per-panel refresh themselves (HEL-584/HEL-579, shipped).
