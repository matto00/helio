## Why

HEL-918 L1–L6 record a per-Output summary on every real run (and, opt-in, the full node rows), and L5 surfaces it for metrics only. Nothing lets an author look back at what an Output looked like at an earlier run, a chart cannot show "where it was", and a table cannot show what changed. L7 is the last rendering leaf of the epic.

## What Changes

- New per-Output **History view**, opened from each Output card in the pipeline's Outputs tab (owner ruling Q1=A). It scrubs that Output's retained history points (newest first), showing each point's summary (capture time, trigger, row count, headline metric, per-column stats, chart series) and — only when the point has a stored payload — its rows.
- Each scrubbed point is compared against the **next-older retained point**, labelled by its capture time ("vs 5 Oct, 14:02"), never "previous run" (Q3=A; HEL-1285 open).
- **Changed-rows highlight** in TableRenderer inside the History view (Q2=A): whole-row content multiset match; rows absent from the comparison point are highlighted "new or changed", plus a count of comparison rows no longer present. No cell-level highlight. Shown only when BOTH points have payloads; otherwise the view states that row comparison is unavailable and never marks rows as removed.
- A labelled **"vs" overlay series** in buildChartOption: used by the History view's chart and by dashboard chart panels whose Output has `config.compare` (Q4=B) — the baseline point's summary series, drawn as a second, visually subordinate, legend-labelled series. Summary-only, so public dashboards work without payloads (D8). Hidden while a viewer filter is active (D3 analogue).
- Frontend `HistoryPoint` type gains L6's `id`/`hasPayload`; client for `GET /api/outputs/:id/history/:pointId/rows`.
- Backend (additive, zero-query): resolved `current`/`baseline` in both history responses carry the point's stored `series`, so a window baseline older than the returned points can be overlaid; JSON Schemas for both responses updated; MCP `get_output_history` strips that `series` unless `includeSummaries`.
- No migration. No `historyPayloads` toggle (HEL-1331). No chart Compare picker: the editor's Compare picker is metric-only, so the dashboard overlay is reachable today only by API/MCP PATCH of `config.compare` on a chart Output (stated non-goal; follow-up noted).

## Capabilities

### New Capabilities
- `output-history-scrubber`: the per-Output History view — point scrubbing, summary display, payload rows, comparison point, changed-rows diff, and missing-payload degradation.
- `chart-history-overlay`: the labelled "vs" overlay series on chart renders (History view and dashboard chart panels with `config.compare`), its data source, alignment, labelling and hiding rules.

### Modified Capabilities
- `output-history-api`: resolved `current`/`baseline` points gain the stored `series`.
- `mcp-output-tools`: `get_output_history` also omits resolved-point `series` unless `includeSummaries`.

## Impact

- Backend: `OutputHistoryService.ResolvedHistoryPoint`, `OutputHistoryProtocol`, `schemas/outputs/output-history-response.schema.json`, `schemas/outputs/public-output-history-response.schema.json`, route specs.
- helio-mcp: `getOutputHistoryHandler`, `types.ts` mirror, handler test.
- Frontend: `features/pipelines/ui/` (Outputs gallery card action + new History view), `features/panels/history/` (types, payload client, diff + comparison helpers), `features/panels/ui/buildChartOption.ts` (+ chart option plumbing), `features/panels/ui/renderers/TableRenderer.tsx` (row highlight hook), CSS tokens per DESIGN.md.
- Reads existing APIs only: `GET /api/outputs/:id/history`, `GET /api/outputs/:id/history/:pointId/rows`, public `GET /api/dashboards/:d/panels/:p/history`.
- New e2e spec using `isolateLivePage`; history seeded via existing support helpers and `PATCH` of `config.historyPayloads`.
