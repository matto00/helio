## Why

The chart Inspect view lists its columns in alphabetical order (`DataGrid.deriveColumns` natural-sorts row keys because
`PanelInspectView` passes no `columns`), so a source declared as `date, category, merchant, amount_usd` inspects as
`amount_usd, category, date, merchant`. The owner ruled (HEL-1394, option 2) that Inspect should follow the Output's
`columnOrder` when set, falling back to the Output's declared schema order.

## What Changes

- A pure helper derives Inspect's column order: `columnOrder` keys (present in the rows) first, then remaining declared
  schema fields in schema order, then any other row keys in today's natural order. No column is ever dropped.
- `usePanelCardInspect` adds the ordered column-key inputs (from the already-resolved `useOutputMeta` Output) to
  `ChartInspectConfig`; `PanelInspectView` passes explicit `columns` to its `DataGrid`, covering both Inspect mounts and
  both row paths (raw selection and aggregate records).

## Capabilities

### New Capabilities

### Modified Capabilities
- `chart-drilldown-inspect`: adds a requirement fixing the Inspect view's column order.

## Impact

- Frontend only: `usePanelCardInspect.ts`, `utils/chartClickSelection.ts` (type), `PanelInspectView.tsx`, a new small
  ordering util, and tests. No backend, schema, or API change; no new fetch.

## Non-goals

- The table panel's own no-`columnOrder` fallback order (`TableRenderer.deriveKeys`, natural-sorted) — separate code
  path, separate user-visible change; listed as a follow-up.
- Hiding columns in Inspect based on `columnOrder` (Inspect shows all loaded data; `columnOrder` only orders here).
- The public dashboard viewer (no Inspect there) and the Output editor preview pane.
