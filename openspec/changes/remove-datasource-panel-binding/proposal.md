## Why

Panels currently fetch preview data by traversing `panel.typeId → dataType.sourceId → DataSource` and calling `/api/data-sources/:id/preview` or `/api/sources/:id/preview` directly from the `usePanelData` hook. This bypasses the DataType abstraction layer, couples the frontend to the DataSource's internal sourceType, and creates a second data-fetch path that diverges from the execute endpoint already used by table panels. Any API or UI path that hard-wires a panel to a DataSource (rather than going through a DataType/Pipeline) must be removed so that the DataType is the single indirection point.

## What Changes

- **REMOVED**: `usePanelData` no longer resolves `dataType.sourceId` or calls `fetchCsvPreview` / `fetchRestPreview` directly; all panel data fetches go through `GET /api/panels/:id/query` (the paginated execute endpoint)
- **REMOVED**: Frontend no longer imports or reads `sources` slice state in panel-rendering contexts
- **REMOVED**: Any remaining UI affordance that allows selecting a DataSource (not DataType) when configuring a panel
- **ERROR PATH**: If a backend panel execute route receives a direct DataSource reference (not through DataType), it SHALL return `400 Bad Request` with a descriptive message (this path does not currently exist but the spec must guard against it)
- **UPDATED**: OpenAPI spec updated to reflect that `PATCH /api/panels/:id` does not accept a `dataSourceId` field; error response documented for any such attempt
- **UPDATED**: `panel-bound-data-fetch` spec revised: all bound panel data fetches use the execute endpoint, not direct DataSource preview endpoints

## Capabilities

### New Capabilities
- None

### Modified Capabilities
- `panel-bound-data-fetch`: requirements change — direct preview-endpoint fetch path replaced by execute-endpoint path for all panel types; DataSource is no longer reached directly from panel rendering code

## Impact

- `frontend/src/hooks/usePanelData.ts` — primary change: remove DataSource resolution and direct preview calls; route all fetches through execute endpoint
- `frontend/src/components/PanelDetailModal.tsx` — remove any direct DataSource selection UI (if present)
- `frontend/src/features/panels/panelsSlice.ts` — may need `fetchPanelPage` thunk used for all panel types, not just table
- `openspec/specs/panel-bound-data-fetch/spec.md` — spec update to document execute-endpoint-only path
- No backend model or DB migration changes required (Panel does not store dataSourceId)

## Non-goals

- Removing the `dataType.sourceId` field from the DataType model itself (it is used by SourceRoutes for refresh, etc.)
- Changing how Pipelines reference DataSources
- Modifying the DataSource CRUD API
