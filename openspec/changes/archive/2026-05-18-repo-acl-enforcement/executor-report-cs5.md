# Executor Report — CS5 (Cleanup + spec sync)

## Audit pass

### Unscoped `*Repo.findById(` callers

Grepped `backend/src/main/scala/com/helio/services/` and `backend/src/main/scala/com/helio/api/`
for unscoped callers. Findings:

| Callsite | Form found | Verdict |
|----------|-----------|---------|
| `DashboardService.delete/duplicate/update/exportSnapshot` | `dashboardRepo.findById(id, Some(user))` | Correct — sharing-aware form per design.md Q1 |
| `PanelService.findById` | `panelRepo.findById(panelId, callerOpt)` | Correct — sharing-aware form per design.md Q1 |
| `ApiRoutes.userRepo.findById(authenticatedUser.id)` | `userRepo.findById(...)` | Not an ACL'd repo; this is the user's own session lookup — no change needed |

**Finding: no unscoped callers remain.** All `findById` calls in services/api are either the
sharing-aware `(id, callerOpt)` form, the `*Owned(id, user)` form, or the `*Internal(id)` form.
The triad is uniformly applied.

### `AccessChecker.requireOwnerOnly` callers

Callsites found:

| Callsite | Status |
|----------|--------|
| `PermissionService.addGrant/removeGrant/listGrants` (3 calls) | **Keep** — these guard permission management (grant/revoke) on a dashboard, where only the owner may manage ACL. The repo enforcement on dashboards uses `findById(sharing-aware)` for mutation but not for permission management. These `requireOwnerOnly` calls are the authoritative gate for permission routes and are not redundant. |
| `AccessCheckerImpl` (definition) | Definition, not a callsite |

**Finding: no `requireOwnerOnly` callers are redundant.** The three remaining callers in
`PermissionService` guard the permission management surface (`POST/DELETE/GET
/api/dashboards/:id/permissions`), which the repo enforcement does not cover. `AccessChecker`
itself is not deleted.

### `AccessChecker.requireAccess` callers

| Callsite | Status |
|----------|--------|
| `DashboardService.update` — grantee path | **Keep** — called after `findById` returns `Some`, only for non-owner grantees. Enforces editor-vs-viewer distinction. |
| `DashboardService.exportSnapshot` — grantee path | **Keep** — same rationale. |
| `PanelService.create` | **Keep** — dashboard-level editor gate for panel creation. |
| `PanelService.batchUpdate` | **Keep** — dashboard-level editor gate for batch layout updates. |
| `PanelService.delete/duplicate/update` via `authorizeEditorOnDashboard` | **Keep** — dashboard-level gate; still needed because `findByIdInternal` is used to look up the panel's dashboardId. |

### Inline `if (ownerId != user.id) Forbidden` guards

None found in services after CS3/CS4 cleanup. The design.md Q1 table called out the specific
guards in `DataTypeService.update/delete` and `DataSourceService.*` that were removed in CS3,
and the `DashboardService.delete/duplicate` guards in CS4. All have been replaced by
`findByIdOwned` (returning `None` → 404) or by the `requireAccess` path.

The remaining `d.ownerId != user.id` checks in `DashboardService.delete` (line 71) and
`DashboardService.duplicate` (line 91) are **intentional role-differentiation guards** (grantee
visible but not owner → 403), not redundant ACL checks. They operate on a value already returned
by `findById(sharing-aware)` and are part of the documented two-step pattern (repo returns `Some`
for grantees, service then checks if caller is owner for owner-only operations).

## OpenAPI spec updates

### `openspec/specs/data-type-acl/spec.md`

Updated `PATCH /api/types/:id` and `DELETE /api/types/:id` cross-user scenarios from **403
Forbidden** to **404 Not Found** with existence-not-leaked semantics documented. This reflects the
CS3 implementation: `findByIdOwned` returns `None` for cross-user IDs, which the service maps to
`NotFound`. There was never a 403 path for these operations after CS3.

### `openspec/specs/data-source-acl/spec.md`

Updated `DELETE /api/data-sources/:id` and `GET /api/data-sources/:id/preview` cross-user
scenarios from **403 Forbidden** to **404 Not Found**. Also updated the `refresh` endpoint
language to match. Same rationale: `findByIdOwned` → `None` → 404.

### `openspec/specs/acl-enforcement/spec.md`

Multiple updates reflecting the CS4 dashboard/panel ACL changes:

- `PATCH /api/dashboards/:id` and `DELETE /api/dashboards/:id`: split into two scenarios per
  no-grant (404) and viewer-grant (403) cases. The old spec said "non-owner = 403" uniformly,
  which was incorrect after CS4.
- `GET /api/dashboards/:id/panels`: **no change** — still 403 for no-grant authenticated users,
  because `AclDirective.authorizeResourceWithSharing` confirms the resource exists then checks the
  grant. The 403 behavior here is the sharing-aware directive, not the service layer.
- `GET /api/dashboards/:id/export` and `POST /api/dashboards/:id/duplicate`: updated to 404
  for no-grant users, 403 for viewer-grant users.
- DataSource/DataType resolver scenario text updated from `findById` to `findByIdInternal`
  (reflects the CS3 rename). Non-owner 403 → 404 for per-id DataSource/DataType routes.

## Performance smoke (EXPLAIN ANALYZE)

Seeded dev DB with ~100 dashboards / pipelines / data_sources / data_types per user across 5 test
users (500 rows per table). Cleaned up after measurements.

### Q1: `SELECT * FROM dashboards WHERE owner_id = ?`

```
Bitmap Heap Scan on dashboards  (cost=4.93..24.18 rows=100) (actual time=0.017..0.038 rows=100)
  Recheck Cond: (owner_id = ?)
  ->  Bitmap Index Scan on idx_dashboards_owner_id  (cost=0.00..4.90 rows=100)
        Index Cond: (owner_id = ?)
Execution Time: 0.074 ms
```
**Index scan. No seq scan.**

### Q2: Sharing-aware dashboard read (EXISTS subquery against resource_permissions)

```
Nested Loop Semi Join  (cost=0.67..16.72 rows=1) (actual time=0.022..0.023 rows=0)
  ->  Index Scan using dashboards_pkey on dashboards d  (cost=0.28..8.29)
  ->  Index Scan using idx_resource_permissions_resource on resource_permissions
        Index Cond: (resource_type = 'dashboard' AND resource_id = ?)
        Filter: (grantee_id = ?)
Execution Time: 0.054 ms
```
**Index scan on both legs. Estimated cost 16.72 — O(log n). No seq scan.**

### Q3: `SELECT * FROM pipelines WHERE owner_id = ?`

```
Index Scan using idx_pipelines_owner_id on pipelines  (cost=0.14..8.15 rows=1) (actual 0.010..0.034 rows=100)
  Index Cond: (owner_id = ?)
Execution Time: 0.065 ms
```
**Index scan. No seq scan.**

### Q4: `SELECT * FROM data_types WHERE owner_id = ?`

```
Index Scan using idx_data_types_owner_id on data_types  (cost=0.14..10.33 rows=4) (actual 0.011..0.035 rows=100)
  Index Cond: (owner_id = ?)
Execution Time: 0.066 ms
```
**Index scan. No seq scan.**

### Q5: `SELECT * FROM data_sources WHERE owner_id = ?`

```
Index Scan using idx_data_sources_owner_id on data_sources  (cost=0.14..8.16 rows=1) (actual 0.003..0.015 rows=100)
  Index Cond: (owner_id = ?)
Execution Time: 0.041 ms
```
**Index scan. No seq scan.**

**Overall: all five hot paths hit their owner-id indexes. The sharing-aware EXISTS subquery also
hits `idx_resource_permissions_resource`. No spinoff needed for performance.**

One note: the dashboard list query uses a Bitmap Heap Scan (vs the pure Index Scan on the other
tables). This is expected at 100 rows/user because Postgres prefers Bitmap Scan when the result
set is large enough that sequential heap access is more efficient than random I/O. At the current
data volume this is a non-issue; the planner will switch to a pure Index Scan at lower row counts.

## Docs

- `CONTRIBUTING.md` — added the ACL triad section (findByIdOwned / findByIdInternal / findById)
  under the Backend standards section. Documents the three flavors, when each is appropriate, and
  the existence-not-leaked semantics for 403 vs 404 mapping.
- `README.md` — no security posture section exists; skipped.
- `design.md` — updated Q2 section to note the RLS epic is now tracked under HEL-272 with
  sub-tickets HEL-273 through HEL-277.

## Spinoff tickets

The `mcp__linear__save_issue` MCP tool was not available in this executor session. The following
tickets need to be filed manually or by the orchestrator. Details provided for each:

### Spinoff A: Cross-user JoinStep right-source (Priority: 2 / High — security-adjacent)

**Title**: Restrict pipeline join step right-source to caller-owned or shared data sources  
**Context**: HEL-265 CS2. `JoinStep.evaluate` and `SparkJobSubmitter` resolve `rightDataSourceId`
via `DataSourceRepository.findByIdInternal` (documented inline). A pipeline owner can reference any
data source in the system as the JOIN right-side regardless of ownership.  
**Scope**: `JoinStep.evaluate` + `SparkJobSubmitter` — switch to `findByIdOwned` or a sharing-aware
form once the data-source sharing model exists.  
**Blocker**: Should be coordinated with pipeline sharing (Spinoff B) and HEL-272 RLS epic.

### Spinoff B: Pipeline sharing (Priority: 3 / Medium)

**Title**: Add sharing grants for pipelines (analogous to dashboard sharing)  
**Context**: HEL-265 CS2. Every pipeline read is currently owner-only (`findByIdOwned`). There is no
`resource_permissions` check for pipelines. Dashboard sharing (HEL-36) is the template.  
**Scope**: `PipelineRepository.findById` → add sharing-aware variant; `PermissionService` to support
`resource_type = 'pipeline'`; `PipelineRoutes` + `PublicPipelineRoutes` analog.

### Spinoff C: File-size soft-budget overruns in dashboard/panel area (Priority: 3 / Medium)

**Title**: Split DashboardService, PanelService, DashboardRepository, PanelRepository to meet file-size budget  
**Context**: HEL-265 CS4 left four files above the 250L soft budget (300L for services):
- `DashboardService.scala`: 332 lines
- `PanelService.scala`: 336 lines
- `DashboardRepository.scala`: 353 lines
- `PanelRepository.scala`: 336 lines

Not a blocker. File as a refactor ticket. The split is behavior-preserving — extract companion
object helper methods into a `DashboardServiceHelpers` or split the snapshot logic into a separate
`DashboardSnapshotService`.

### Spinoff D: `PanelRepository.findAllByDashboardId` multi-round-trip optimization (Priority: 3 / Medium)

**Title**: Optimize sharing-aware panel list to a single JOIN query  
**Context**: HEL-265 CS4 executor report noted that `findAllByDashboardId(dashboardId, callerOpt)`
uses 2-3 `db.run` calls in the grantee path (fetch dashboard → check grant → fetch panels). A
single Slick JOIN query could reduce this to one round-trip. Not hot enough to block CS4/CS5 but
worth tracking.

## Archive

`openspec archive repo-acl-enforcement` completed successfully. Change moved to
`openspec/changes/archive/2026-05-18-repo-acl-enforcement/`.

## Gates (pending — to be run after this report)

- `sbt test` (backend, ~715 tests expected)
- `npm run lint && npm run format:check && npm test && npm run build` (frontend)
- `npm run check:openspec` (after archive, should pass clean)
