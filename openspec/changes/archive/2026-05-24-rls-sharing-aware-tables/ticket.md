# HEL-276 — Enable RLS on sharing-aware tables (dashboards, panels, resource_permissions)

## Scope

Second wave of HEL-272 policy enablement. The trickiest wave because policies
must encode sharing semantics, not just owner equality.

Blocked by: HEL-273 (session-var infra), HEL-274 (privileged-bypass), and
HEL-275 (owner-only wave shipped first to validate the pattern). Lands AFTER
HEL-265 CS4 merges so the app-layer sharing-aware reads exist to compare against.

## Tables in scope

| Table                 | ACL shape                                                          |
| --------------------- | ------------------------------------------------------------------ |
| `dashboards`          | owner OR `resource_permissions` grant OR public-viewer fallback    |
| `panels`              | inherits from parent dashboard's ACL                               |
| `resource_permissions`| the grant table itself — readable to grantor (owner) AND grantee  |

## Policy challenges

1. **Public-viewer fallback**: when `app.current_user_id` is unset (anonymous
   request to `/api/public/dashboards/:id`), the policy must allow reads of
   dashboards that have a public-viewer grant (grantee_id IS NULL). The policy
   needs a `current_setting('app.current_user_id', true) IS NULL` branch.

2. **Sharing grant**: a dashboard not owned by the user, but shared via
   `resource_permissions`, must be readable. The policy clause:
   ```sql
   EXISTS (
     SELECT 1 FROM resource_permissions rp
     WHERE rp.resource_type = 'dashboard'
       AND rp.resource_id = dashboards.id
       AND rp.grantee_id = current_setting('app.current_user_id')::uuid
   )
   ```

3. **Panels inherit dashboard ACL**: panel policy joins through
   `panels.dashboard_id → dashboards` and re-runs the dashboard policy logic.
   This may need a SECURITY DEFINER function to keep DRY.

4. **Mutation vs read policies**: the same dashboard may be readable by a
   viewer-role grantee but only mutable by editor-role grantees. Use separate
   `FOR SELECT` and `FOR UPDATE/DELETE` policies.

5. **resource_permissions grantor**: there is no `grantor_id` column — the
   grantor is implicitly the dashboard owner. The SELECT policy must allow
   both grantees AND owners (via a join to dashboards.owner_id) to see grants.

## Tasks

- [ ] Flyway `V36__rls_sharing_aware_tables.sql`
- [ ] `dashboards` policies: SELECT (owner OR grantee OR public-viewer when anon), UPDATE (owner OR editor grantee), DELETE (owner only)
- [ ] `panels` policies: JOIN through `dashboards`; SECURITY DEFINER helper function for DRY dashboard ACL check
- [ ] `resource_permissions` policies: SELECT visible to grantor + grantee; INSERT/UPDATE/DELETE restricted to grantor (dashboard owner)
- [ ] New `RlsSharingAwareTablesSpec`: DB-layer isolation proof (owner, grantee, anon, non-grantee, resource_permissions leakage)
- [ ] Verify DashboardPanelAclSpec (HEL-265 CS4) passes unchanged
- [ ] Update placeholder comments in DashboardRepository and PanelRepository (HEL-275/276 tracking comments)

## Acceptance criteria

1. All 3 tables in scope have RLS enabled + policies
2. HEL-265 CS4 sharing-aware test suite passes unchanged
3. Anonymous public-viewer path continues to work
4. Editor vs viewer role distinction preserved at the policy layer
5. resource_permissions rows do not leak across unrelated users

## Out of scope

- Performance + verification pass (final sub-ticket)
- EXPLAIN ANALYZE automation in tests (covered by final perf ticket)
