## Context

`DataSource` and `DataType` in `model.scala` have no `ownerId` field. Repositories (`DataSourceRepository`,
`DataTypeRepository`) do not filter by user. Routes (`DataSourceRoutes`, `DataTypeRoutes`) receive no
`AuthenticatedUser` — they are instantiated directly in `ApiRoutes` without the user parameter that
`DashboardRoutes` and `PanelRoutes` already receive. `AclDirective.authorizeResource` exists and is
resource-type-agnostic; new resource types need only a resolver registered in `ApiRoutes`.

Latest Flyway migration: `V13__add_sql_source_type.sql`. Two new migrations are needed.

## Goals / Non-Goals

**Goals:**
- Add `owner_id` to `data_sources` and `data_types` domain models, DB tables, and repositories
- Filter list queries and enforce ownership on per-id routes for both resource types
- Thread `AuthenticatedUser` into `DataSourceRoutes` and `DataTypeRoutes` (matching `DashboardRoutes`/`PanelRoutes`)
- Register `DataSource` and `DataType` resolvers in `ApiRoutes` ACL directive
- Panels bound to a cross-user type resolve type as `None` (unbound) on read

**Non-Goals:**
- Sharing resources across users
- Migrating legacy rows (they get `owner_id = NULL`; invisible to all users until recreated)

## Decisions

### D1: Add `ownerId: UserId` to domain models (not just DB column)

`Dashboard` and `Panel` carry `ownerId: UserId` in the case class; same pattern for `DataSource` and `DataType`.
Alternative (filter only at DB layer without model field): rejected because resolvers for `AclDirective` need
`ownerId` from the fetched object without a second DB query.

### D2: Route constructor receives `AuthenticatedUser`

`DataSourceRoutes` and `DataTypeRoutes` gain a constructor param `user: AuthenticatedUser`, matching
`DashboardRoutes(dashboardRepo, panelRepo, authenticatedUser)`. `ApiRoutes` passes it at instantiation inside the
`authenticate` block. No new abstraction needed.

### D3: List queries filter by `ownerId` in the repository

`findAll(ownerId: UserId)` replaces the no-arg variant. `findBySourceId(id, ownerId: UserId)` similarly scoped.
Keeps ownership logic in the repository, out of routes.

### D4: Per-id routes use `AclDirective.authorizeResource`

Same pattern as dashboard/panel routes. Resolvers are lambdas passed at `ApiRoutes` instantiation:
```
dataSourceRepo.findById(DataSourceId(id)).map(_.map(_.ownerId.value))
```
No new resolver registry needed — existing `authorizeResource` signature is sufficient.

### D5: Cross-user panel type binding treated as unbound on read

`PanelRepository` already has a `findById` / `findAll` path that reads `typeId`. When the panel's `typeId` refers
to a type with a different `owner_id`, the panel is returned with `typeId = None` in the response. This requires
`DataTypeRepository.findById` to be called with an `ownerId` guard (returns `None` on mismatch). The panel
repository then resolves the type defensively. No cascade delete, no hard error.

### D6: `DemoData` assigns the demo user's id to seeded sources/types

`DemoData.scala` must pass `ownerId` when constructing seeded `DataSource` / `DataType` values.

## Risks / Trade-offs

- [Legacy null `owner_id` rows] → Any data seeded before migration will be invisible after the fix. For
  development this is fine; there is no production deployment with multi-user data.
- [Migration ordering] → Two migrations (V14 for `data_sources`, V15 for `data_types`) must be additive only
  (`ALTER TABLE … ADD COLUMN owner_id UUID NULLABLE`). Column becomes non-null in application logic, not DB
  constraint, to avoid blocking on existing null rows.

## Migration Plan

1. `V14__data_sources_owner.sql` — `ALTER TABLE data_sources ADD COLUMN owner_id UUID`
2. `V15__data_types_owner.sql` — `ALTER TABLE data_types ADD COLUMN owner_id UUID`
3. Deploy: existing null rows are filtered out of all list/read queries (effectively orphaned)
4. Rollback: revert code deploy; columns remain but are ignored

## Open Questions

None. Cross-user binding behavior (unbound on read) is specified by the ticket.

## Planner Notes

Self-approved. No new external dependencies. No API shape changes. Pattern is a direct extension of
dashboard/panel ownership already in the codebase.
