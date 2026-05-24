-- HEL-274: Create the helio_privileged role for RLS bypass.
--
-- This role carries BYPASSRLS so connections using it skip all Row Level
-- Security policies. NOLOGIN means the role cannot authenticate directly —
-- only the application login role (DB_USER) may assume it via SET ROLE.
--
-- The GRANT below allows DB_USER to switch to helio_privileged within a
-- transaction. This is the mechanism DbContext.withSystemContext uses to
-- run privileged operations (background jobs, registry resolvers, boot
-- health checks) without being gated by RLS policies on user-owned tables.
--
-- Idempotent: the DO block checks pg_roles before creating the role so
-- repeat Flyway runs are safe (CREATE ROLE has no IF NOT EXISTS).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'helio_privileged') THEN
    CREATE ROLE helio_privileged BYPASSRLS NOLOGIN;
  END IF;
END
$$;

-- Grant the privileged role to the current login user so the application
-- pool can SET ROLE helio_privileged inside a transaction.
-- current_user resolves to DB_USER at migration time.
-- GRANT is idempotent in PostgreSQL — safe to re-run.
GRANT helio_privileged TO current_user;
