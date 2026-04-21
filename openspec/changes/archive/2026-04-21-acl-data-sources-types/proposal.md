## Why

Data Sources and Data Types (Type Registry) lack per-user ownership enforcement: any authenticated user can read,
modify, or delete resources created by another user. This was found during HEL-68 testing and is a data-isolation
bug that must be fixed before multi-user use is viable.

## What Changes

- Add `owner_id` (UUID FK → users) column to `data_sources` and `data_types` tables via Flyway migration
- Populate `owner_id` from the authenticated user on all insert paths
- Filter `findAll` / list queries in both repositories by caller's `owner_id`
- Extend `authorizeResource` resolver registry (existing ACL directive) to cover `DataSource` and `DataType`
  resources on per-id routes
- `GET /api/data-sources`, `GET/DELETE /api/data-sources/:id`, `GET /api/data-sources/:id/sources` and `/preview`
  — enforce ownership
- `GET/POST /api/data-types`, `PATCH/DELETE /api/data-types/:id` — enforce ownership
- Panels whose bound `DataType` is owned by a different user are treated as unbound on read (type resolved as
  `None`); no hard delete or cascade

## Capabilities

### New Capabilities

- `data-source-acl`: Per-user ownership scoping and enforcement for all data-source endpoints
- `data-type-acl`: Per-user ownership scoping and enforcement for all data-type (Type Registry) endpoints

### Modified Capabilities

- `acl-enforcement`: Extend the resolver registry to include `DataSource` and `DataType` resource types
- `data-source-persistence`: Add `owner_id` column; filter `findAll` by owner; `findById` scoped to owner
- `data-type-persistence`: Add `owner_id` column; filter `findAll` / `findBySourceId` by owner; `findById`
  scoped to owner; `findById` used in panel-read path returns `None` when owner mismatches

## Impact

- **Backend**: `DataSourceRepository`, `DataTypeRepository`, `DataSourceRoutes`, `DataTypeRoutes`, `ApiRoutes`
  (resolver registration), Flyway migrations V_next_1 and V_next_2
- **Frontend**: No API shape changes — list endpoints return a filtered subset; no new fields surfaced
- **Tests**: Repository and route-level tests must cover ownership filtering and 403/404 paths
- **DemoData**: Seeded sources/types must be assigned to the demo user's id

## Non-goals

- Sharing data sources or types across users (future work)
- Migrating existing cross-user data (no existing multi-user prod data; migration sets `owner_id = null` for
  legacy rows, which will be invisible to all users until re-created)
