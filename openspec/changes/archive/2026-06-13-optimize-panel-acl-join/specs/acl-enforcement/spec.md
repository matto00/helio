## ADDED Requirements

### Requirement: Panel list and single-panel reads use a single db.run per call
The system SHALL ensure `PanelRepository.findAllByDashboardId(dashboardId, callerOpt)` and
`PanelRepository.findById(id, callerOpt)` each perform at most one
`db.run` regardless of caller path (owner, grantee, public-viewer, or no-grant).
Both SHALL use `withSystemContext` and embed the ACL predicate — owner check,
grantee EXISTS subquery, and public-viewer EXISTS subquery — directly in the SQL
WHERE clause, eliminating sequential round-trips.

The public-viewer branch checks for a `resource_permissions` row where
`grantee_id IS NULL` and `role = 'viewer'`. When `callerOpt = None` the owner
and grantee branches SHALL evaluate as false, leaving only the public-viewer branch
eligible to match.

#### Scenario: Owner receives panels in a single query
- **WHEN** `findAllByDashboardId` is called with a caller whose ID matches the dashboard `owner_id`
- **THEN** the result is non-empty and exactly one `db.run` is executed

#### Scenario: Grantee receives panels in a single query
- **WHEN** `findAllByDashboardId` is called with a caller who has a `resource_permissions` row for the dashboard
- **THEN** the result is non-empty and exactly one `db.run` is executed

#### Scenario: Anonymous caller with public-viewer grant receives panels in a single query
- **WHEN** `findAllByDashboardId` is called with `callerOpt = None` and a public-viewer grant exists
- **THEN** the result is non-empty and exactly one `db.run` is executed

#### Scenario: No-grant caller receives empty result in a single query
- **WHEN** `findAllByDashboardId` is called with a caller who has no grant on the dashboard
- **THEN** the result is empty and exactly one `db.run` is executed

#### Scenario: findById owner path resolves in a single query
- **WHEN** `findById` is called with a caller who owns the panel's parent dashboard
- **THEN** the result is Some and exactly one `db.run` is executed

#### Scenario: findById grantee path resolves in a single query
- **WHEN** `findById` is called with a caller who has a grant on the panel's parent dashboard
- **THEN** the result is Some and exactly one `db.run` is executed

#### Scenario: findById public-viewer path resolves in a single query
- **WHEN** `findById` is called with `callerOpt = None` and a public-viewer grant exists on the parent dashboard
- **THEN** the result is Some and exactly one `db.run` is executed

#### Scenario: findById no-grant path returns None in a single query
- **WHEN** `findById` is called with a caller who has no grant on the panel's parent dashboard
- **THEN** the result is None and exactly one `db.run` is executed

### Requirement: resource_permissions JOIN uses an index scan
The SQL produced by both single-JOIN methods SHALL use an index scan on
`resource_permissions` (not a sequential scan). This MUST be confirmed via
`EXPLAIN ANALYZE` captured during verification.

#### Scenario: EXPLAIN ANALYZE shows index scan on resource_permissions
- **WHEN** EXPLAIN ANALYZE is run on the generated SQL for any caller path
- **THEN** the plan contains "Index Scan" or "Index Only Scan" on `resource_permissions`
- **THEN** no "Seq Scan" on `resource_permissions` appears in the plan
