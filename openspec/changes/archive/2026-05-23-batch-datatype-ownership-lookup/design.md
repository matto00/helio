## Context

`PanelService.resolveBindingsForRead` (in `backend/src/main/scala/com/helio/services/PanelService.scala`)
resolves typeId ownership for every panel in a dashboard. The current implementation calls the private
`resolveSingleBinding` helper inside a `Future.traverse`, which issues `dataTypeRepo.findByIdOwned` once
per typed panel — a classic N+1.

`DataTypeRepository.findByIdOwned` executes: `SELECT ... FROM data_types WHERE id = ? AND owner_id = ?`.
N panels → N sequential DB round-trips (Slick uses a connection pool but each query is independent).

Both callers of `resolveBindingsForRead`:
- `PublicDashboardRoutes` — delegates entirely, no changes needed there.
- `PanelService.update` — calls `resolveSingleBinding` directly (single panel, intentionally not batched).

## Goals / Non-Goals

**Goals:**
- Reduce `GET /api/dashboards/:id/panels` to a single DataType ownership query regardless of panel count.
- Keep behavioral semantics identical: panels whose typeId is unowned are still cleared.
- Add a test that exercises the batch path with multiple typed panels.

**Non-Goals:**
- Changing the `resolveSingleBinding` single-panel path (PATCH remains one query, which is correct).
- Batching across requests or adding in-process caching.
- Any API shape change.

## Decisions

### 1. Add `findByIdsOwned` to `DataTypeRepository` (not a service-layer join)

The existing pattern in this codebase is one repository per domain entity with typed query methods.
`DataTypeRepository` already has `findAll`, `findBySourceId`, `findByIdOwned`, and `findByIdInternal`.
Adding `findByIdsOwned(ids: Seq[DataTypeId], user: AuthenticatedUser): Future[Map[DataTypeId, DataType]]`
is consistent with this pattern.

Alternative considered: build the `IN` query inline in `PanelService`. Rejected — keeps SQL in service
layer, harder to test, breaks repository boundary.

SQL shape: `SELECT ... FROM data_types WHERE id IN (?, ?, ...) AND owner_id = ?`
Slick expression: `table.filter(r => (r.id inSet idSet) && r.ownerId === ownerUuid).result`
Return type `Map[DataTypeId, DataType]` so the caller can do O(1) lookups per panel.

### 2. Short-circuit empty-ids case

If no panels have a typeId, `resolveBindingsForRead` should not issue any query. Check
`typedIds.isEmpty` before calling `findByIdsOwned` and return panels unchanged in that branch.

### 3. Replace `Future.traverse` in `resolveBindingsForRead` with a two-phase approach

Phase 1: collect distinct typeIds → call `findByIdsOwned` once → get `Map[DataTypeId, DataType]`.
Phase 2: map over panels synchronously, clearing any panel whose typeId is absent from the map.

This is a pure refactor of `resolveBindingsForRead`; `resolveSingleBinding` remains unchanged.

## Risks / Trade-offs

- **Large IN clause**: A dashboard with hundreds of typed panels produces a large `IN (...)`. For the
  foreseeable panel count limits (~50 panels/dashboard), this is fine. PostgreSQL handles thousands of
  IN elements without issue. → No mitigation needed now; can add pagination if limits change.

- **Duplicate typeIds**: Two panels may share the same typeId. `inSet` de-duplicates automatically
  (Slick uses a Scala `Set`). The map lookup handles both panels correctly.

## Migration Plan

No schema changes, no Flyway migration. Deploy is a standard backend binary swap.
Rollback: revert the commit — interface and DB schema are unchanged.

## Open Questions

None — design is self-contained.

## Planner Notes

Self-approved. Change is entirely internal to the backend service layer; no API surface changes, no
frontend impact, no schema migration. Risk is low; fix is mechanical and well-bounded.
