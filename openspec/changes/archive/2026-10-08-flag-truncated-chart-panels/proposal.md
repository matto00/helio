## Why

Dashboard chart panels load only the first 200 rows of an Output and plot (or, for aggregated Outputs, group) just
those rows, with nothing on the chart saying so. A viewer of a 1,234-row Output sees a chart that looks complete but is
not. HEL-1358 asks, at minimum, that a truncated chart say so on the chart.

## What Changes

- A chart panel whose loaded rows are fewer than the Output's total row count shows a short muted note under the chart:
  "Based on the first 200 of 1,234 rows." ("matching rows" when a viewer filter or server cross-filter narrowed the
  total). A chart holding every row shows nothing.
- Applies on every surface that renders a chart panel: the dashboard grid card, the mobile stack, fullscreen, the
  panel detail modal, and public/shared dashboards.
- Uses counts the client already has (the paginated rows response's `total`, already returned by both the
  authenticated and the public rows endpoint). No backend or API change; nothing new is exposed publicly.
- **Deferred, pending an owner product decision:** how large charts should load or summarise their data, and making
  the "vs" compare overlay draw for charts over 200 rows. The overlay stays hidden for truncated charts, unchanged.

## Capabilities

### New Capabilities

- `chart-panel-truncation-notice`: a chart panel discloses on the chart when it is drawn from fewer rows than its
  Output holds.

### Modified Capabilities

(none)

## Non-goals

- Choosing a loading/summarising strategy for large charts (load-all up to a cap, server-side downsampling or
  aggregation, plotting the stored summary series, or other). Recorded as an open product question for the owner.
- Showing the "vs" compare overlay on charts over 200 rows.
- A "Load more" control for charts, or any change to the 200-row page size.
- HEL-1392 (resize remount refetch storm) and HEL-1380 (useOutputMeta redundant render).

## Impact

- Frontend only: `frontend/src/features/panels/ui/` (chart branch of `PanelContent`/`ChartOutputPanel`, the fullscreen
  and detail-modal hosts that do not yet pass the total), one small stylesheet rule, and tests.
- No backend, schema, migration, or public-API change.
