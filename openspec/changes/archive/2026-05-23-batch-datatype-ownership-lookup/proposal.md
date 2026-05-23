## Why

`PanelService.resolveBindingsForRead` uses `Future.traverse` + `dataTypeRepo.findByIdOwned` to verify
DataType ownership once per panel, producing N database round-trips for a dashboard with N typed panels.
This is a straightforward N+1 that grows linearly with panel count and executes on every dashboard load.

## What Changes

- Add `findByIdsOwned(ids: Seq[DataTypeId], user: AuthenticatedUser): Future[Map[DataTypeId, DataType]]`
  to `DataTypeRepository` — a single `WHERE id IN (...) AND owner_id = ?` query.
- Replace the per-panel `Future.traverse` loop in `PanelService.resolveBindingsForRead` with a single
  batch call, then resolve individual panels via an in-memory `Map` lookup.
- The `resolveSingleBinding` helper (used by `PanelService.update` and `PanelPatchApplier`) is unchanged —
  the single-panel path remains as-is.

## Capabilities

### New Capabilities
- None (this is a pure implementation optimization; no new API surface or behavioral contract).

### Modified Capabilities
- None (query result semantics are identical — panels whose typeId resolves to a different owner
  are still cleared, in exactly the same way).

## Non-goals

- Changing the public API shape of any route or response.
- Batching the `resolveSingleBinding` single-panel path (used on `PATCH /api/panels/:id`).
- Adding caching or pre-warming DataType lookups.
- Modifying `PublicDashboardRoutes` directly — it already delegates to `PanelService.resolveBindingsForRead`.

## Impact

- `DataTypeRepository.scala` — new `findByIdsOwned` method (backend-only).
- `PanelService.scala` — `resolveBindingsForRead` and `resolveSingleBinding` refactor.
- No schema changes, no migration, no frontend changes.
- Existing backend test suite must continue to pass; a new integration test verifies batch behaviour.
