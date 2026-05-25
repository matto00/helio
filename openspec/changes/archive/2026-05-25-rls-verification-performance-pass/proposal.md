## Why

The RLS epic (HEL-272) has applied row-level security across all nine ACL'd tables, but no
dedicated pass has verified fail-closed correctness, session-variable bleed, index coverage
for the new per-row policy predicates, or end-to-end documentation. A silent cross-tenant
leak via a pooled connection is the failure mode we cannot afford to leave untested.

## What Changes

- **New Flyway migration V37**: adds `idx_panels_owner_id` (missing from V17); adds a composite
  `idx_resource_permissions_resource_grantee` covering `(resource_type, resource_id, grantee_id)`
  to back the `helio_can_access_dashboard` SECURITY DEFINER function efficiently.
- **New Scala test `RlsPolicyGuardSpec`**: queries `pg_class` / `pg_policies` in an embedded-postgres
  environment to assert every expected table has `FORCE ROW LEVEL SECURITY` enabled and at least one
  policy, so future migrations cannot silently ship without RLS.
- **Flyway migration smoke test embedded in `RlsPolicyGuardSpec`**: applies all migrations from a
  fresh DB and checks the resulting role + policy state.
- **`CONTRIBUTING.md` update**: adds a `## Performance & RLS` section documenting the
  `helio_app` vs `helio_privileged` role split, required index coverage, and the
  `withUserContext` / `withSystemContext` pattern (already present — verify and extend if needed).
- **Archived `repo-acl-enforcement` design.md update**: note Q2 (RLS) resolved by HEL-272.

## Capabilities

### New Capabilities
- `rls-policy-guard`: automated pg_class / pg_policies guard test ensuring every ACL'd table
  has FORCE RLS enabled; regression-catches future tables missing RLS.

### Modified Capabilities
- `rls-privileged-bypass`: extend spec with Flyway smoke scenario.
- `rls-sharing-aware-tables`: extend spec with performance index requirement.

## Impact

- Backend only: one new Flyway migration, one new ScalaTest spec file.
- No API shape changes.
- No frontend changes.

## Non-goals

- Adding RLS to `auth_sessions`, `users`, or other non-ACL'd tables.
- Instrumenting Grafana dashboards (no metrics infrastructure in test; document as follow-up).
- Live EXPLAIN ANALYZE benchmarks in CI (no stable seeded DB; document analysis findings inline).
