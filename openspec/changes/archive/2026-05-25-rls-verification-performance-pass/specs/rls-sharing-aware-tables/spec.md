## ADDED Requirements

### Requirement: Performance indexes back RLS policy predicates on sharing-aware tables
The database schema SHALL include indexes that prevent sequential scans on RLS-policy-filtered
queries on sharing-aware tables. Specifically:
- `idx_panels_owner_id` on `panels(owner_id)` — backs the `panels_insert` WITH CHECK and
  `panels_delete` USING predicates.
- `idx_resource_permissions_resource_grantee` on
  `resource_permissions(resource_type, resource_id, grantee_id)` — backs the inner EXISTS in
  `helio_can_access_dashboard` that checks for named grantees, enabling index-only scans.

#### Scenario: panels.owner_id queries use index scan
- **WHEN** a panel INSERT or DELETE is executed on the app pool with `app.current_user_id` set
- **THEN** the RLS policy predicate on `panels.owner_id` uses an index scan rather than a
  sequential scan (verified by `idx_panels_owner_id` existing in `pg_indexes`)

#### Scenario: resource_permissions grantee lookup uses composite index
- **WHEN** `helio_can_access_dashboard` is evaluated for a dashboard with named grantees
- **THEN** the `resource_permissions` lookup uses `idx_resource_permissions_resource_grantee`
  covering `(resource_type, resource_id, grantee_id)`, enabling an index-only scan
