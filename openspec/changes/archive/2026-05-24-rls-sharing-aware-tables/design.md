## Context

HEL-275 established FORCE RLS on six owner-only tables using a simple
`owner_id = current_setting('app.current_user_id')::uuid` pattern. Dashboards
and panels have a richer ACL: access is granted to the owner, any named
grantee in `resource_permissions`, or an anonymous caller if a public-viewer
grant (grantee_id IS NULL) exists. `resource_permissions` itself must also have
RLS so grants don't leak across unrelated users.

Existing app-layer code already encodes the correct ACL logic in
`DashboardRepository.findById` and `PanelRepository.findAllByDashboardId` (HEL-265 CS4).
The DB policies mirror those rules so enforcement is defence-in-depth.

The `helio_privileged` BYPASSRLS role (HEL-274) skips all new policies;
`withSystemContext` callers are unaffected.

## Goals / Non-Goals

**Goals:**
- FORCE RLS + policies on `dashboards`, `panels`, `resource_permissions`
- SELECT, UPDATE, DELETE policies per table encoding the correct ACL shape
- A SECURITY DEFINER function `helio_can_access_dashboard(TEXT)` to keep panel
  and dashboard SELECT policies DRY
- DB-layer proof via `RlsSharingAwareTablesSpec`

**Non-Goals:**
- Changing service-layer ACL logic or AuthService
- EXPLAIN ANALYZE automation
- Policy on tables not in scope (covered by HEL-275 or future tickets)

## Decisions

**Q1: SECURITY DEFINER function for shared predicate**
The dashboard SELECT clause (`owner OR grantee OR public-viewer`) is needed by
both `dashboards` and `panels` policies. Duplicating multi-line SQL across two
policies is error-prone. A `SECURITY DEFINER` helper function lets Postgres
evaluate the predicate with the table owner's privileges, avoiding RLS
recursion (panel → dashboard RLS would re-evaluate under the calling role,
which has app-pool restrictions). Alternatives considered:
- Duplicate SQL in each policy — rejected: maintenance burden, drift risk.
- Row-security-context view — rejected: adds a layer with no clear benefit.

**Q2: anonymous / NULL user-id branch**
`current_setting('app.current_user_id', true)` uses the `missing_ok=true`
flag which returns NULL instead of raising an error when the GUC is unset.
The SELECT policy checks `current_setting(..., true) IS NULL` first; if
anonymous, only rows with a public-viewer grant (`grantee_id IS NULL, role =
'viewer'`) are visible. This preserves the public-dashboard path used by
`PublicDashboardRoutes` without requiring a session variable.

**Q3: resource_permissions SELECT — no grantor_id column**
`resource_permissions` has no explicit `grantor_id` column; the grantor is
the resource's owner (dashboards.owner_id). The SELECT policy joins to
`dashboards` to check if `current_setting(..., true)::uuid = dashboards.owner_id`.
Both the grantee branch and the owner branch are tested. The public-viewer row
(grantee_id IS NULL) is visible only to the dashboard owner.

**Q4: UPDATE vs DELETE split for dashboards**
Dashboard PATCH (name, layout) is permitted to editor grantees in the service
layer (`DashboardService`). The UPDATE policy mirrors this: owner OR editor
grantee. DELETE is owner-only — matching `findByIdOwned` in the repo. Using
separate named policies per command prevents a combined USING clause from
allowing editors to delete.

**Q5: panels DELETE policy**
Panels are always deleted by their parent dashboard owner (owner-only). The
panel DELETE policy joins to `dashboards` to check
`dashboards.owner_id = current_setting('app.current_user_id', true)::uuid`.

**Q6: Test strategy**
Follow `RlsOwnerTablesSpec` exactly: EmbeddedPostgres + `helio_app_test`
non-privileged role + `helio_privileged` privileged role. Seed via
`withSystemContext`, probe via `withUserContext`. Additional sharing-specific
assertions: (a) grantee sees rows, (b) non-grantee sees nothing, (c)
`resource_permissions` rows don't leak across unrelated owners.

## Risks / Trade-offs

- SECURITY DEFINER function executes as the table owner (postgres in embedded
  tests). In production, the owner is the migration user (also a superuser).
  This is correct: the function needs to read resource_permissions without
  the caller's RLS policies interfering.
- Panel SELECT policy calls the SECURITY DEFINER function which reads
  `resource_permissions` (also RLS-protected). Since the function runs as
  the table owner (BYPASSRLS-equivalent for that execution), this is safe.
- The `withUserContext` pool uses `helio_app_test` in tests; the anonymous
  path is simulated by running a raw query on `appDb` with no SET LOCAL.
  The anonymous policy branch (grantee_id IS NULL) is exercised using a
  direct JDBC call that does NOT set the GUC — same pattern as HEL-275
  fail-closed tests.

## Migration Plan

1. `V36__rls_sharing_aware_tables.sql` runs on next deploy after V35.
2. `withSystemContext` callers unaffected (BYPASSRLS).
3. Rollback: `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` + drop policies and
   function. No data migration needed.

## Open Questions

None — decisions above are self-approved. The anonymous-path branch relies
on `current_setting('app.current_user_id', true) IS NULL`; the fail-closed
branch (no variable set + non-anonymous route) is proven by the existing
`RlsOwnerTablesSpec.SELECT on data_sources without app.current_user_id set
raises an error` test, which remains in the suite.

## Planner Notes

- Self-approved: SECURITY DEFINER helper function (standard RLS pattern for
  cross-table predicate reuse).
- Self-approved: separate UPDATE/DELETE policies for dashboards (required to
  express editor-can-update, owner-only-delete distinction).
- Self-approved: resource_permissions SELECT via owner join (no grantor_id
  column exists; owner lookup via dashboards is the correct key).
