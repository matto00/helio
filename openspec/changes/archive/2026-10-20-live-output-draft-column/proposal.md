## Why

Draft mode (HEL-1631) recomputes every step from the cached source samples with no network, but the pipeline page still cannot show what the edit does to the thing a user actually cares about: the Output a dashboard panel renders. The desktop page reserves an empty, zero-width `live-output` grid track for exactly this (`PipelineSpineLayout.tsx:286`, `--pipeline-live-output-width: 0px`). This change fills it (`docs/live-draft-preview.md` §7, §12 item (f); boards `PipelineLive*`).

## What Changes

- **Live Output column (desktop).** The `live-output` track becomes a ~360 px column ("Output" heading, a "live" marker per DESIGN.md §11) rendering one of the pipeline's Outputs from the rows of its node in the draft walk, through the same renderers a dashboard panel uses (`ChartRenderer`/`MetricRenderer`; table/collection/timeline/markdown through the existing preview-pane path), with the Output's saved config. No snapshot is written; no history and no rows are fetched per edit.
- **Render parity by construction.** The saved-panel computations that turn an Output config plus rows into renderer inputs (the chart's aggregation/field mapping/options inputs in `ChartOutputPanel`, the metric's loaded-rows value in `MetricOutputPanel`, the record→raw-row conversion in `usePanelData`) are extracted into pure shared functions used by both the dashboard path and the live column. A parity test renders the same rows through both and asserts identical tile values and chart series; a metric whose saved history headline differs from the draft rows shows the draft value in the column.
- **Summary tiles.** ROWS OUT (draft row count of the node), a key aggregate computed with `computeAggregate` (the metric's field/agg; a chart's aggregation spec; none for other kinds), and "N vs last run" against the Output's latest history point, read from ONE `GET /api/outputs/:id/history` per Output per page load (shared history cache) and refreshed once after a run.
- **States.** Caption "Rendered from the draft. Nothing is written until you save and run." in draft mode; the "live" marker only while the node's frame is fresh; "updating" while a server fallback is in flight; "stale" while an upstream step is in error or the frame is a last-good one; an Output on a not-previewed node (AI step or downstream) renders its saved rows (one `GET /api/outputs/:id/rows`, cached) labelled stale.
- **No draft.** The column renders the saved pipeline over the same sample with no "live" marker and a neutral caption, so the column does not appear and disappear as a draft starts and ends.
- **Narrow desktop and phone.** Below the page width where three columns fit, the column becomes a collapsible "Output" section under the preview table; on phones the same component renders in the Preview tab.
- **Pipelines with several Outputs.** The column follows the Output on the selected step when there is one, else the first Output; a compact selector switches between Outputs when there are two or more.

## Capabilities

### New Capabilities
- `pipeline-live-output-column`: the live Output render on the pipeline detail page: which Output and rows it shows, tiles and baseline, live/updating/stale/not-previewed states, the network contract (one baseline fetch per Output per load, none per edit), render parity with the saved panel, and its placement at desktop, narrow desktop and phone widths.

### Modified Capabilities
- `pipeline-detail-spine-layout`: the reserved zero-width `live-output` track is now sized and filled.

## Impact

- Frontend only: `frontend/src/features/pipelines/` (new live-output component + hook, spine and mobile layouts), `frontend/src/features/panels/ui/{ChartOutputPanel,MetricOutputPanel}.tsx` and `features/panels/hooks/usePanelData.ts` (behaviour-preserving extraction of pure helpers), CSS.
- No backend, schema or migration change. Uses existing `GET /api/outputs/:id/history` and `GET /api/outputs/:id/rows`.
- e2e: new `e2e/hel1632-live-output.spec.ts`; `e2e/hel1631-draft-mode.spec.ts` must stay green unchanged.
- Out of scope: HEL-1684, HEL-1685, HEL-1683, HEL-1677, HEL-1676; editing Output config while drafting (still blocked during a draft by HEL-1631 D2).
