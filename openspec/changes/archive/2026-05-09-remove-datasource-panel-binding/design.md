## Context

Panels bind to DataTypes via `typeId`. `usePanelData` currently resolves `dataType.sourceId`,
looks up the DataSource from the Redux `sources` slice, then calls `fetchCsvPreview` or
`fetchRestPreview` directly on the DataSource ID. This short-circuits the DataType abstraction,
requiring the frontend to know about `sourceType` and choose between two different preview
endpoints. Table panels already use `fetchPanelPage` (the paginated execute endpoint) — all
other panel types should follow the same pattern through `GET /api/panels/:id/query` (mapped in
`panelsSlice` as `fetchPanelPage`).

The backend `PanelRoutes` execute path already validates `typeId → dataType → sourceId →
DataSource` internally, so the frontend does not need to replicate that traversal.

## Goals / Non-Goals

**Goals:**
- Remove `dataType.sourceId` resolution and direct preview calls from `usePanelData`
- Route all bound-panel data fetches through `GET /api/panels/:id/query` (the existing execute endpoint)
- Remove the `sources` slice dependency from panel rendering
- Guard the `PATCH /api/panels/:id` schema against a `dataSourceId` field (document 400 response)
- Update `panel-bound-data-fetch` spec to reflect execute-endpoint-only behavior

**Non-Goals:**
- Removing `sourceId` from the DataType model or DataType APIs
- Modifying the DataSource CRUD routes or pipeline references
- Changing the `fetchPanelPage` thunk itself (already correct)

## Decisions

**Decision: Use `fetchPanelPage` for all data-capable panel types**

`fetchPanelPage` dispatches to `GET /api/panels/:id/query` with `page=0, pageSize=N`.
Table panels already use this. Metric and chart panels can use the same thunk with a
larger `pageSize` (200 for charts, 10 for metrics). `usePanelData` calls `dispatch(fetchPanelPage(...))`
and reads results from `panelsSlice` state (e.g., `panels.pageData[panelId]`).

Alternative considered: keep the direct preview for non-table panels and only remove the sourceType
branching. Rejected — two fetch paths means two things to maintain and test; the execute endpoint
already exists and is validated on the backend.

**Decision: No backend changes to PATCH /api/panels/:id for dataSourceId rejection**

Inspecting `PanelRoutes` and the `update-panels-batch-request.schema.json`: the patch body schema
does not include `dataSourceId` and uses `additionalProperties: false` where applicable. The backend
already ignores or rejects unknown fields through Spray JSON's strict parsing. A 400 on unknown
fields is therefore already enforced; we document this in the spec but do not need a new guard.

**Decision: Remove `sources` import from usePanelData**

After removing the DataSource traversal, `usePanelData` no longer needs the `sources` slice.
The hook signature will drop the `sources` parameter. Callers (PanelGrid / PanelContainer) must
be updated accordingly.

## Risks / Trade-offs

- [Risk] `GET /api/panels/:id/query` returns structured data that must be field-mapped client-side.
  The existing `fetchPanelPage` result handling in `panelsSlice` returns a `PaginatedQueryResult`;
  the hook must extract `rows` and `headers` from it rather than from a preview response.
  Mitigation: the execute endpoint has been exercised by table panels — verify its response shape
  before wiring metric/chart panels to it.

- [Risk] `usePanelData` callers that currently pass a `sources` prop will get a type error after
  the signature change. Mitigation: this is compile-time safe — TypeScript will surface all callers.

## Migration Plan

1. Update `usePanelData` to remove DataSource resolution; wire all fetches to `fetchPanelPage`.
2. Remove `sources` prop threading from `PanelGrid` / `PanelContainer` and any other callers.
3. Update `panel-bound-data-fetch` spec delta (this change set).
4. Verify frontend tests pass; update or add tests for the new execute-only path.
5. No backend migration, no DB changes, no deployment steps beyond normal deploy.

## Planner Notes

Self-approved. The change is limited to the frontend hook and spec delta; no breaking API change
(the DataSource preview endpoints remain, they are just no longer called from panel rendering).
The backend already enforces DataType-only binding at the panel model level.
