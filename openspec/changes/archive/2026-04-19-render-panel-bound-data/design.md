## Context

Panels carry `typeId` and `fieldMapping` (set via HEL-49). The backend already exposes two preview endpoints that return up to 10 rows:
- `GET /api/data-sources/:id/preview` → `{ headers: string[], rows: string[][] }` (CSV)
- `GET /api/sources/:id/preview` → `{ rows: object[] }` (REST API)

`DataType.sourceId` identifies which data source backs a type. `DataSource.sourceType` (`"csv"` or `"rest_api"`) determines which endpoint to call. Both types are already in Redux (`dataTypes` and `sources` slices).

`PanelContent` currently renders static placeholder markup for each `PanelType`. `panelSlots.ts` defines slot keys (`value`, `label`, `unit` for metric; `xAxis`, `yAxis`, `series` for chart; etc.).

## Goals / Non-Goals

**Goals:**
- Fetch preview data for bound panels and display it using `fieldMapping`
- Show a spinner while fetching; show a clear error if the fetch fails
- No regression for unbound panels

**Non-Goals:**
- Polling / auto-refresh
- SQL connector
- Computed fields
- Full table/chart data rendering (first pass: display first-row values in metric/text; table shows rows; chart shows placeholder with a data-present indicator)

## Decisions

**Decision: Fetch in a custom hook `usePanelData`, not in a Redux thunk.**
Panel data is ephemeral, per-panel, and not shared across components. A local hook with `useState`/`useEffect` keeps it out of global Redux state, avoids cache invalidation complexity, and aligns with the pattern used by `PanelDetailModal` for local async work. A Redux thunk would bloat the slice with per-panel loading/error keys.

**Decision: Determine source type from Redux stores, not an extra API call.**
`sources` slice already holds all `DataSource` items with `sourceType`. The hook resolves `dataType.sourceId → source.sourceType` from the in-memory store. If sources haven't been fetched yet, the hook dispatches `fetchSources`. This avoids a redundant network call.

**Decision: `fieldMapping` applied as first-row extraction.**
For metric panels, display `row[fieldMapping.value]` as the value, `row[fieldMapping.label]` as the label, etc. For tables, display all rows with column headers. For chart, show a "data loaded" badge on the existing placeholder skeleton (full chart rendering is out of scope). For text, show `row[fieldMapping.content]`.

**Decision: Modify `PanelContent` to accept optional data props.**
Rather than a new component, extend `PanelContent` with `data?: MappedPanelData | null`, `isLoading?: boolean`, `error?: string | null`. This keeps the rendering co-located and avoids prop-drilling a separate wrapper.

**Decision: `MappedPanelData` type is a plain object `Record<string, string>`.**
After applying `fieldMapping` the consumer only sees slot-key → display-value pairs. This is panel-type-agnostic and simple to test.

## Risks / Trade-offs

- **Sources not loaded on first render** → hook dispatches `fetchSources` if `sources.status === "idle"`; shows spinner until resolved.
- **DataType with no sourceId** → hook skips fetch and panel renders as unbound (no data, no error).
- **Preview returns 0 rows** → show an "No data available" message in the panel body rather than leaving it blank.
- **CSV field values are always strings** → display as-is; type coercion is out of scope.

## Planner Notes

Self-approved: purely additive frontend change, no API or schema modifications, no new dependencies.
