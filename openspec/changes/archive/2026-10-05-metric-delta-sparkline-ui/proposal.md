## Why

L1–L3 (HEL-1271/1272/1273) store a per-Output summary every real run and serve a resolved comparison, but nothing
in the app reads it: a metric panel still shows a headline computed in the browser over the first 200 loaded rows,
with no delta and no trend. The HEL-918 exit criterion — "1,204 ▲ 12% vs 7d" with a sparkline after only choosing
`compare` — needs this UI.

## What Changes

- A frontend history service + shared cache/hook reading `GET /api/outputs/:id/history` (authenticated) and
  `GET /api/dashboards/:d/panels/:p/history?token=` (public), invalidated when the pipeline run finishes.
- Metric panels use the server's all-rows headline when the stored summary matches the current config; otherwise
  (no history yet, or config edited since the last run) they keep today's in-browser value.
- Metric panels render a delta (▲/▼/flat, percent or absolute, "vs <compare>") in the existing trend slot, a
  "<window> comparison available from <date>" note when no baseline exists yet, and an inline SVG sparkline.
- Under an active viewer filter (viewer control or cross-filter narrowing the panel) the headline reflects the
  filtered rows and the delta/sparkline are replaced by a muted marker whose tooltip reads "comparison reflects
  unfiltered data".
- The Output editor gains a Compare selector for metric Outputs; every kind's save preserves an existing
  `config.compare` it does not edit.
- The provenance popover shows the "compared with" point's time and value (authenticated and public).

## Capabilities

### New Capabilities
- `metric-history-delta-ui`: metric panel server headline, delta, sparkline, filtered-state hiding, compare
  picker, and provenance "compared with" row, on authenticated and public render paths.

### Modified Capabilities
None.

## Non-goals

- Chart "vs" overlay, table changed-rows highlighting, pipeline run scrubber (L7, HEL-1277). Non-metric panels
  show no delta in L5.
- Any backend, API or migration change; payload history (L6). Defining "previous" semantics (HEL-1285).
- Custom-duration authoring in the picker (an existing custom value is preserved and shown, not authored).

## Impact

Frontend only: `features/panels` (renderers, PanelContent and its four call sites, provenance), `features/pipelines`
output editor, a new history service, Jest/RTL tests, one new Playwright spec. No dependency added.
