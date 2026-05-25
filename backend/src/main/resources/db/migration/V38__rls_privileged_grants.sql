-- HEL-274 follow-up (found via dual-pool smoke boot): grant helio_privileged
-- the table-level privileges it actually needs.
--
-- V34 created helio_privileged with BYPASSRLS, but BYPASSRLS only skips Row
-- Level Security policies — it does NOT confer table-level DML. Without the
-- grants below, any DbContext.withSystemContext operation (DemoData seeding,
-- background jobs, boot health checks) that runs as helio_privileged fails
-- with "permission denied for table ..." as soon as the privileged pool is a
-- genuinely separate connection running SET ROLE helio_privileged — i.e. in
-- production. Local/test setups masked this by sharing a single superuser
-- datasource across both pools.
--
-- Grant broad DML on the application schema, matching the role's purpose as
-- the trusted "system" identity (it already bypasses RLS). Idempotent:
-- GRANT and ALTER DEFAULT PRIVILEGES are safe to re-run.

GRANT USAGE ON SCHEMA public TO helio_privileged;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_privileged;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO helio_privileged;

-- Cover tables/sequences created by future migrations so a new ACL'd table
-- can't silently reintroduce the "permission denied" boot failure. Applies to
-- objects created by the migration role (current_user) in schema public.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO helio_privileged;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO helio_privileged;
