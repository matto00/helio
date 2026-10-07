## Why

HEL-1277's chart "vs" overlay misses common dashboard cases (HEL-1351): aggregated chart Outputs render raw rows on
dashboards (unlike the editor preview) and never overlay, compact panels hide the legend that names the overlay, and a
panel with no explicit chart type renders `line` while the History view renders the Output's `config.chartType`.
The >200-row gap was escalated; the owner chose to defer it to HEL-1358 (no overlay on truncated panels).

## What Changes

- Dashboard chart panels honour `config.aggregation` (groupBy/agg/yField): they group the loaded row records
  client-side with the editor preview's own `groupAndAggregate`, on every surface (card, mobile stack, fullscreen,
  detail modal, public viewer). Click-to-select and the Inspect view on an aggregated chart key on `aggregation.groupBy`;
  the aggregated primary series is named `<agg>(<yField>)`.
- The overlay accepts a `grouped` baseline series whose `x`/`y`/`agg` equal the panel's groupBy/yField/agg, still only
  when the panel holds the Output's complete, unfiltered rows.
- The Compare picker's help text and Output-level note stop claiming aggregated Outputs never overlay.
- Compact chart panels showing an overlay keep a compact legend instead of hiding it.
- One resolver (stored panel type, else Output `config.chartType`, else line) drives render, click mapping and
  Inspect. The detail modal (chart section hidden since HEL-909, never writes `chart`) is unchanged.

## Capabilities

### New Capabilities

### Modified Capabilities
- `chart-history-overlay`: dashboard overlay covers aggregated Outputs; aggregation rendering; compact legend;
  picker copy; chart-type default.
- `echarts-chart-panel`: active chart type resolves via the panel-or-Output resolver.
- `panel-appearance-settings`: null-cleared chartType falls back to the Output's chartType.

## Impact

Frontend only: `features/panels/history/chartOverlay.ts`, `ui/ChartOutputPanel.tsx`, `ui/PanelContent.tsx`,
`ui/PanelFullscreenOverlay.tsx`, `ui/PanelCard.tsx`, `ui/PanelInspectView.tsx`,
`ui/chartDataOptions.ts`, `ui/buildChartOption.ts`, chart click
selection, `pipelines/ui/outputEditor/{ChartCompareField,OutputPreviewPane}.tsx`. No backend, schema or migration.

## Non-goals

- Item 2 (>200-row charts): deferred to HEL-1358 per owner decision; truncated panels still get no overlay.
- Rendering dashboard panels from the stored summary series.
- Changing an explicitly stored per-panel `appearance.chart.chartType` (a deliberate panel override stays).
