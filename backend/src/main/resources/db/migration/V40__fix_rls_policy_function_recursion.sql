-- Prod hotfix: fix infinite recursion in the RLS SELECT-policy helper functions.
--
-- helio_can_access_dashboard / helio_can_access_pipeline are SECURITY DEFINER
-- helpers invoked by the dashboards / panels / pipelines SELECT policies (V36,
-- V39). They were owned by the migrating role (DB_USER), which OWNS the tables
-- and is therefore subject to FORCE ROW LEVEL SECURITY. When a function body
-- re-reads the protected table -- directly (SELECT ... FROM dashboards) or
-- transitively via resource_permissions, whose own SELECT policy reads the
-- resource table back -- the SELECT policy re-invokes the same SECURITY DEFINER
-- function, producing unbounded mutual recursion:
--
--   read dashboards -> dashboards_select -> helio_can_access_dashboard
--     -> (grantee branch) read resource_permissions
--     -> resource_permissions_select -> read dashboards -> ... (repeat)
--
-- In production this surfaces as `ERROR: stack depth limit exceeded` and a 500
-- on every endpoint that reads dashboards / panels / pipelines (e.g. /api/auth/me
-- and /api/dashboards). data_sources / data_types are unaffected: their policies
-- compare owner_id inline with no helper function, so they never recurse.
--
-- Why it shipped green: dev and CI connect as a Postgres superuser, which
-- BYPASSes RLS, so these policy functions were never actually executed under
-- RLS (the exact coverage gap tracked by HEL-285). Production is the first
-- environment to run the app pool as a non-superuser, RLS-enforced role.
--
-- Fix: re-own the helper functions to helio_privileged (created BYPASSRLS in
-- V34). As SECURITY DEFINER, the body then executes as a BYPASSRLS role, so its
-- internal reads do not re-trigger any RLS policy and the recursion is broken.
-- ACL semantics are unchanged: the function still returns the same owner/grantee
-- boolean (verified against PostgreSQL 16 with the full schema: owner sees their
-- rows, named grantees see granted rows, unrelated users see nothing).
--
-- ALTER FUNCTION ... OWNER TO requires the new owner to hold CREATE on the
-- function's schema; grant it transiently for the re-own, then revoke so
-- helio_privileged keeps only the USAGE + DML it was granted in V38.

GRANT CREATE ON SCHEMA public TO helio_privileged;

ALTER FUNCTION helio_can_access_dashboard(text) OWNER TO helio_privileged;
ALTER FUNCTION helio_can_access_pipeline(text)  OWNER TO helio_privileged;

REVOKE CREATE ON SCHEMA public FROM helio_privileged;
