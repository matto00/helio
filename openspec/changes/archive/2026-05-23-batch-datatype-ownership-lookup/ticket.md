# HEL-131 — Fix N+1 query in resolvePanels — batch DataType ownership lookup

## Title
Fix N+1 query in resolvePanels — batch DataType ownership lookup

## Description

When loading panels for a dashboard, `resolvePanels()` fires one database query per panel that has a `typeId` to verify ownership. A dashboard with 10 typed panels produces 11 queries for a single request.

## Root Cause

`DashboardRoutes.scala` and `PublicDashboardRoutes.scala` both call `resolvePanels()`, which uses `Future.traverse` and calls `dtRepo.findById(typeId, user.id)` individually per panel:

```scala
Future.traverse(panels) { panel =>
  panel.typeId match {
    case Some(typeId) => dtRepo.findById(typeId, user.id).map { ... }  // N queries
    ...
  }
}
```

## Fix

Add a `findByIds(ids: Seq[DataTypeId], ownerId: UserId): Future[Map[DataTypeId, DataType]]` method to `DataTypeRepository` that fetches all needed types in a single `WHERE id IN (...)` query. Replace the `Future.traverse` loop with a single batch call followed by an in-memory lookup.

## Files

* `backend/src/main/scala/com/helio/infrastructure/DataTypeRepository.scala` — add `findByIds`
* `backend/src/main/scala/com/helio/api/routes/DashboardRoutes.scala` — update `resolvePanels`
* `backend/src/main/scala/com/helio/api/routes/PublicDashboardRoutes.scala` — update `resolvePanels`

## Acceptance Criteria

- `DataTypeRepository` gains a `findByIds` method performing a single batched SQL query
- `resolvePanels()` in both `DashboardRoutes.scala` and `PublicDashboardRoutes.scala` is updated to use `findByIds`
- N+1 query pattern is eliminated: loading a dashboard with N typed panels produces 1 query (not N)
- All existing backend tests pass
- New unit/integration test verifies `findByIds` correctness

## Priority
High

## Project
Helio v1.3.1 — Polish & Hardening
