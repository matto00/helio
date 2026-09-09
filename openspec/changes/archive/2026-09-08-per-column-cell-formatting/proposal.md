## Why

Table panels print every value raw: `1234.5678`, an ISO timestamp, a price with no currency. `DataGrid`
already exposes `ColumnDef.render(row, value)` as a per-column override with no table-panel consumer,
so the hook exists and only the spec, the formatters and the config surface are missing. This is the
last of the four in-panel data-grid capabilities (HEL-448 sort shipped; HEL-451 filtering shipped as `a6bde0d3`;
HEL-465 pinning) and it lands on the extension point HEL-448 designed for it by name.

## What Changes

- A per-column format spec persisted as `columnFormats` on the Output's `TableOutputConfig` — a flat
  sibling of `columnSort`, exactly as HEL-448's own comment prescribes for this ticket.
- Formatter functions mapping spec + raw value to display text, driving `ColumnDef.render` from
  `TableRenderer`. A value that fails to parse falls back to its raw string; nothing throws.
- A per-column formatting control in the Output editor, beside the existing column visibility/order
  surface, keyboard operable and accessible.
- Numeric and currency columns right-align, per table convention.
- **A mutation-failable guard that sort reads RAW values, never formatted text.** The property holds
  today by construction; the guard is what makes it survive a refactor.

## Capabilities

### New Capabilities

- `table-panel-column-formatting`: Output-scoped per-column display formatting for table panels —
  the spec shape on `TableOutputConfig`, the formatter semantics for number/date/currency/text, the
  never-throw fallback, the raw-value guarantee for sorting, and what formatting means on a row set
  whose values were stringified upstream.

## Impact

- `frontend/src/features/pipelines/ui/outputEditor/outputConfigTypes.ts` — `columnFormats` beside
  `columnSort`, read tolerantly.
- New formatter module + tests.
- `frontend/src/features/panels/ui/renderers/TableRenderer.tsx` — builds `ColumnDef.render` per
  column from the spec; the sort path is untouched by design.
- `frontend/src/features/pipelines/ui/outputEditor/` — the per-column control.
- Styling for right-aligned numeric columns.
- No backend change, no migration, no new endpoint.

- `frontend/src/features/panels/ui/renderers/tableFilterPredicate.ts` — the match source becomes the
  per-column rendered text rather than bare `formatCell` (design D6a); its `:5-9` contract comment is
  rewritten in the same change.

## Non-goals

- Conditional/rule-based cell coloring; server-side column type inference; the `preview` variant.
- **Row-data export** — verified not to exist. `exportDashboard` returns a `DashboardSnapshot` of
  structure for re-import, and no CSV/row export exists in `frontend/src`. The ticket's "applies in
  exports if exporting is present" clause is dropped rather than carried as an unresolvable hedge.
- **Filter composition** — IN SCOPE (superseded). HEL-451 merged as `a6bde0d3`, so `columnFilters`
  exists and `tableFilterPredicate.ts` matches on rendered text. Per-column formatting breaks that
  contract in both directions unless the predicate resolves the same formatter, so this is required
  work, not optional composition. See design D6a.
- Changing `MetricRenderer`'s or `chartAppearance`'s existing formatting behaviour (see design D2).
- Fixing the upstream stringification that destroys object values on one branch — HEL-1033 owns it.
