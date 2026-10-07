## Why

HEL-1277 draws a labelled "vs" baseline overlay on dashboard chart panels whose Output has `config.compare`, but the
Output editor's Compare picker (HEL-1275) exists only for metric Outputs. Chart owners can reach the overlay only via
`PATCH /api/outputs/:id` or MCP. Owner ruling (2026-10-07, `show-with-inline-note`) fixes the shape of the fix.

## What Changes

- The Output editor shows a Compare picker on every chart Output (create and edit), saving `config.compare` with the
  same tokens and explicit-`null` semantics as the metric picker; the server's existing HEL-1273 validation is reused.
- Fixed help text under the chart picker lists when the overlay won't show: aggregated Outputs, more than 200 rows,
  a viewer filter or cross-filter, and pie, scatter, multi-series, 100%-stacked and horizontal-bar charts.
- An additional, specific note appears when this Output's own (unsaved, in-editor) config already rules the overlay
  out: aggregation set, a series split, horizontal bars, 100%-stacked bars, or no x/y field mapping.
- The chart picker offers None, 1 day, 7 days, 30 days. It adds no "previous" option or copy (HEL-1285 is open);
  a pre-existing `previous_run` or `custom:` value is still shown as a selectable option and kept on save.
- Nothing is hidden: a compare set earlier stays visible and clearable.

## Capabilities

### New Capabilities

### Modified Capabilities
- `chart-history-overlay`: adds a requirement for the chart-Output Compare picker, its help text and Output-level note.

## Impact

- Frontend only: `features/pipelines/ui/outputEditor/` (`OutputKindFields.tsx`, `OutputEditorSheet.tsx`,
  `buildOutputConfig.ts`), a pure predicate co-located with `features/panels/history/chartOverlay.ts`, RTL tests, one
  new e2e spec. No backend, schema, migration, or API change.

## Non-goals

- HEL-1351 (overlay coverage for aggregated Outputs / >200 rows). HEL-1285 ("previous" semantics).
- Changing the metric picker, `compareLabel`, the overlay rendering rules, or panel-level chart type.
- `ci.yml`, `playwright.config.ts`, `.gitignore`.
