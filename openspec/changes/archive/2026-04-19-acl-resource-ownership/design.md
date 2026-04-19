## Context

Dashboards and panels exist in PostgreSQL but have no `owner_id` column. The `AuthenticatedUser(id: UserId)` is already resolved by `AuthDirectives.authenticate` and passed into route classes (e.g. `DashboardRoutes(…, user: AuthenticatedUser)`). The `users` table is present from V6; `user_sessions` from V7. `DashboardRepository` and `PanelRepository` are the only access paths to their respective tables. `DemoData` seeds with a hardcoded `"demo-seed"` string as `createdBy` — this needs to reference the system user's actual UUID.

## Goals / Non-Goals

**Goals:**
- Add `owner_id` (FK → `users.id`) to `dashboards` and `panels` via a new Flyway migration
- `findAll()` on `DashboardRepository` filters by `ownerId`; all mutation routes check ownership
- 403 returned when authenticated user does not own the targeted resource
- Demo seed data assigned to the system user inserted during migration (or looked up at seed time)
- Panels inherit ownership from their parent dashboard (no independent panel owner field)

**Non-Goals:**
- Sharing resources across users
- Admin/super-user bypass
- Panel-level ownership independent of dashboard ownership

## Decisions

**D1: Add `owner_id` to both `dashboards` and `panels` tables.**
Panels need `owner_id` so a direct `PATCH /api/panels/:id` or `DELETE` can verify ownership without a dashboard join.
Alternative: derive panel ownership via join to dashboards — rejected for query complexity and the fact that panels could theoretically be reassigned in the future.

**D2: Migration assigns existing rows to the system user.**
A `system` user with a fixed UUID (`00000000-0000-0000-0000-000000000001`) is inserted (ON CONFLICT DO NOTHING) and all existing NULL `owner_id` rows are backfilled. This keeps the migration self-contained with no application-layer seeding logic.
Alternative: default NULL and handle at query time — rejected because NULL ownership is ambiguous and complicates every query.

**D3: Ownership check at the route layer, not the repository layer.**
Routes already receive `AuthenticatedUser` and call `findById` before mutating. Adding an ownership guard after `findById` is the lowest-change approach.
Alternative: add `ownerId` parameter to every repository method and filter at DB level — considered for `findAll` (where it IS at the repo level) but overkill for single-resource checks.

**D4: `DashboardRepository.findAll(ownerId: UserId)` filters at query time.**
The list endpoint must scope to the calling user. This is the correct place for the filter.

**D5: `DemoData` looks up the system user UUID at seed time.**
`DemoData.seedIfEmpty` receives a `UserRepository` and queries `users` for `id = system-uuid` to use as `ownerId`. This avoids hardcoding the UUID in application code; the migration owns it.

## Risks / Trade-offs

- [Risk] Flyway migration may fail if `users` table doesn't exist → Mitigated: V6 creates `users`; new migration will be V10 or higher.
- [Risk] Duplicate tests break if `ApiRoutesSpec` creates resources without specifying ownership → Mitigation: test helper must insert a user and pass a valid session token.
- [Trade-off] Panels get their own `owner_id` column (denormalized) rather than deriving from dashboards — simpler queries at the cost of needing both columns kept in sync on panel creation.

## Migration Plan

1. Add migration `V10__owner_id.sql`: insert system user, add `owner_id` columns with FK, backfill.
2. Update `DashboardRow` / `PanelRow` case classes and `Table` mappings in the repositories.
3. Thread `ownerId` through `findAll`, `insert`, and ownership-check helpers in route classes.
4. Update `DemoData` to pass `UserId` for the system user.
5. Run `sbt test` — update `ApiRoutesSpec` fixtures to include authenticated users where needed.

## Planner Notes

Self-approved: no external dependencies, no breaking API changes (403 is new but additive), no new services. The system-user UUID approach is consistent with the existing `"system"` string used in `DashboardRepository.duplicate` and `importSnapshot` — both of those will also need updating so duplicated/imported dashboards are owned by the calling user.
