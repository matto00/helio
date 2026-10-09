## Context

- `PanelInspectView.tsx` renders `<DataGrid rows={gridRows} …/>` with no `columns`; `DataGrid.resolvedColumns` falls back
  to `deriveColumns` (`DataGrid.tsx:396`): union of keys over the first 50 rows, `Intl.Collator` natural sort. That sort,
  not server key order, is why Inspect is alphabetical.
- `PanelInspectView` is mounted twice: grid-context in `PanelCard.tsx` and nested in `PanelFullscreenOverlay.tsx`. Both
  receive the same `chartInspectConfig` object computed once in `usePanelCardInspect.ts` from `useOutputMeta(outputId)`
  (an `Output` with `schema: OutputSchemaField[]` and `config`). Inspect is only built for `output.kind === "chart"`.
- Two row paths: raw-row selection (`gridRows` built from `headers` + `filteredRows`) and aggregate-group selection
  (`gridRows` built from `Object.entries(record)`). Both feed the same `DataGrid`.
- `columnOrder` semantics (HEL-255/HEL-1389): `readTableConfig(config).columnOrder`; absent/empty = natural; non-empty =
  visible subset in order, stale keys skipped (`TableRenderer.orderedColumns`).

## Goals / Non-Goals

**Goals:** Inspect column order = `columnOrder` (when set) → declared schema → leftover row keys; both mounts, both row
paths; no new fetch; no column dropped.

**Non-Goals:** table panel fallback order (`TableRenderer.deriveKeys`); hiding columns in Inspect; public viewer.

## Decisions

**D1 — Pure helper `inspectColumnKeys(rowKeys, schemaFields, columnOrder)`** in a new
`frontend/src/features/panels/ui/inspectColumnOrder.ts` (or alongside `chartClickSelection.ts`): returns
`string[]` = present `columnOrder` keys (deduped, in order) ++ present schema names not yet emitted (schema order) ++
remaining row keys natural-sorted with the same `Intl.Collator({numeric:true, sensitivity:"base"})` DataGrid uses (so
the fallback for undeclared keys is identical to today's). `rowKeys` = union over the rows actually rendered (first 50,
matching DataGrid's own scan window). Alternatives: reuse `TableRenderer.orderedColumns` — rejected, it hides
non-listed columns (wrong for Inspect, AC3) and is module-private.

**D2 — Ordering inputs travel on `ChartInspectConfig`.** Add optional `columnOrderHint?: { schema: string[];
columnOrder?: string[] }` (name finalised by executor; a plain optional field, so existing test fixtures that build a
`ChartInspectConfig` stay valid). `usePanelCardInspect` fills it from the `output` it already holds:
`schema: output.schema.map(f => f.name)`, `columnOrder: readTableConfig(output.config).columnOrder`. Because
`chartInspectConfig` already reaches both mounts, no prop plumbing through `PanelCard`/`PanelFullscreenOverlay` is
needed, and no second `useOutputMeta` call is added (AC4).

**D3 — `PanelInspectView` passes `columns`.** A `useMemo` over `gridRows` + the hint computes
`inspectColumnKeys(...)` → `ColumnDef[]` and passes `columns` to `DataGrid`. When `gridRows` is empty it passes
`undefined` (DataGrid's empty state is unchanged). When the hint is absent (defensive), behavior is today's.

**D4 — `columnOrder` orders, never hides (AC3).** Owner ruling covers order; Inspect's purpose is "the underlying rows".
Today Inspect shows every column; keeping that invariant is the non-controversial reading. In practice the question is
moot: `columnOrder` is a table-config key and Inspect only exists for chart Outputs, so the ruling resolves to schema
order for real data; the server rejects `columnOrder` on non-table Outputs (`OutputConfigValidation.scala`) and V117 strips it, so the
`columnOrder` branch is defensive only: comment it as such; its precedence is proven by unit tests with a hand-built hint,
and the live check can only show schema order.

## Risks / Trade-offs

- Schema can drift from rows (stale Output schema): handled — absent schema keys skipped, undeclared keys appended.
- `useOutputMeta` still loading → `chartInspectConfig` is null and Inspect is not mounted, so no flash of a different
  order from this change.

## Planner Notes

- Self-approved: helper location/name, the optional-field shape on `ChartInspectConfig`, natural-sort for leftover keys.
- Owner ruling (option 2) recorded in ticket.md; driver relayed it — the ruling settles ordering only.
- Follow-up (not filed by this change): table panel no-`columnOrder` fallback should arguably use schema order too.
