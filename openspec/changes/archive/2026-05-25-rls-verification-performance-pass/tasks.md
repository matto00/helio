## 1. Backend — Flyway Migration

- [ ] 1.1 Create `V37__rls_performance_indexes.sql` adding `idx_panels_owner_id` on `panels(owner_id)`
- [ ] 1.2 Add `idx_resource_permissions_resource_grantee` on `resource_permissions(resource_type, resource_id, grantee_id)` to V37
- [ ] 1.3 Add a comment in V37 explaining which RLS policy predicates each index backs

## 2. Backend — Documentation

- [ ] 2.1 Update archived `openspec/changes/archive/2026-05-18-repo-acl-enforcement/design.md` to note Q2 (RLS) resolved by HEL-272

## 3. Tests

- [ ] 3.1 Create `RlsPolicyGuardSpec` in `backend/src/test/scala/com/helio/infrastructure/`
- [ ] 3.2 In `RlsPolicyGuardSpec` beforeAll: start EmbeddedPostgres, apply all Flyway migrations
- [ ] 3.3 Assert `helio_privileged` role exists with `rolbypassrls = true` in `pg_roles`
- [ ] 3.4 For each ACL'd table in the allowlist, assert `relrowsecurity = true` in `pg_class`
- [ ] 3.5 For each ACL'd table in the allowlist, assert `relforcerowsecurity = true` in `pg_class`
- [ ] 3.6 For each ACL'd table in the allowlist, assert at least one policy in `pg_policies`
- [ ] 3.7 Assert `idx_panels_owner_id` exists in `pg_indexes` after migrations
- [ ] 3.8 Assert `idx_resource_permissions_resource_grantee` exists in `pg_indexes` after migrations
