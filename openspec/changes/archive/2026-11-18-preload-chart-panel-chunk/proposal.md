## Why

A chart panel's code (`ChartPanel` and the echarts graph) is requested only when the chart component mounts, after the
panel's data has arrived. Under CI load that serial wait pushes the canvas past the 5 s window in
`hel1573-motion-grid-chart.spec.ts:104` (HEL-1758 D5), and users see the same late chart. The app knows an Output is a
chart well before the chart mounts: its metadata (`kind: "chart"`) resolves through the shared Output metadata cache.

## What Changes

- Start loading the chart code as soon as an Output's metadata resolves with `kind: "chart"` -- on the authenticated
  fetch, on a warm-restore seed, and on the public / share-token viewer -- so the chunk download overlaps the rows
  fetch instead of following it.
- One shared loader for the chart module, used by both the lazy chart renderer and the preload, so the chunk is
  requested once and echarts stays out of the initial entry chunk.
- A failed preload is harmless: it is swallowed and the renderer's own lazy load retries.
- No test timeout, sleep or retry changes. Frontend only.

## Non-goals

- Preloading chart code for dashboards with no chart Output, or on app boot.
- Changing how echarts initialises once its chunk has loaded (measured and reported only).
- Editing the driver's known-flake list (not in the repo; reported in the PR for the driver to remove).
- Any backend, schema or migration change.

## Capabilities

### New Capabilities

### Modified Capabilities

- `frontend-code-splitting`: adds a requirement that the chart chunk is preloaded once a chart-kind Output is known,
  while it stays out of the initial entry chunk.

## Impact

- `frontend/src/features/panels/state/outputMetaCache.ts` (fetch + seed triggers),
  `frontend/src/features/dashboards/services/publicDashboardService.ts` (public trigger),
  `frontend/src/features/panels/ui/renderers/ChartRenderer.tsx` (lazy factory moves to the shared loader), one new
  small loader module, unit tests.
- Shared with concurrent lanes: no panel-rendering component (`OutputPanelContent.tsx`, `PanelContent.tsx`,
  `LiveOutputRender`) or hook changes.
