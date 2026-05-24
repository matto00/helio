-- HEL-276: Enable Row Level Security on the three sharing-aware tables.
--
-- Two pools exist (see DbContext):
--   * App pool (helio_app_test / DB_USER without helio_privileged): RLS policies
--     evaluate against current_setting('app.current_user_id', true).
--   * Privileged pool (SET ROLE helio_privileged BYPASSRLS): policies are
--     skipped entirely; withSystemContext callers see all rows.
--
-- FORCE ROW LEVEL SECURITY is required because DB_USER owns the tables.
-- Without FORCE, the table owner bypasses RLS even on the app pool.
--
-- Unlike the owner-only tables (V35), these tables carry sharing semantics:
-- a row is visible to the owner AND to any user with a matching grant in
-- resource_permissions. Anonymous callers (no app.current_user_id set) can
-- see rows with a public-viewer grant.
--
-- SECURITY DEFINER function
-- ─────────────────────────
-- helio_can_access_dashboard(dashboard_id TEXT) encodes the shared SELECT
-- predicate for dashboards and panels. It runs as the table owner (postgres
-- in embedded tests) so it can read resource_permissions freely without the
-- caller's RLS policies interfering. Both the dashboards and panels SELECT
-- policies call this function to stay DRY.
--
-- current_setting('app.current_user_id', true) uses missing_ok = true:
-- returns NULL instead of raising an error when the GUC is not set.
-- This enables the anonymous / public-viewer path. The fail-closed contract
-- (error on unset GUC) only applies to the owner-only tables (V35); here
-- we intentionally handle the NULL case for anonymous access.

-- ── SECURITY DEFINER helper ──────────────────────────────────────────────────
--
-- Uses PL/pgSQL so we can read the GUC once, handle NULL and empty-string
-- (both indicate an anonymous / unauthenticated caller), and avoid repeated
-- calls to current_setting() across the three branches.
--
-- The GUC app.current_user_id is NULL when it has never been SET in the
-- session (missing_ok = true returns NULL). It may also be empty-string ('')
-- on connections where a prior transaction's SET LOCAL reverted to a default
-- empty value — we treat that identically to NULL (anonymous path).

CREATE OR REPLACE FUNCTION helio_can_access_dashboard(p_dashboard_id TEXT)
  RETURNS BOOLEAN
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
AS $$
DECLARE
  v_uid_raw TEXT;
  v_uid     UUID;
BEGIN
  v_uid_raw := current_setting('app.current_user_id', true);

  -- Treat NULL or empty-string as anonymous (no authenticated user).
  IF v_uid_raw IS NULL OR v_uid_raw = '' THEN
    -- Anonymous / public-viewer branch: a public grant (grantee_id IS NULL, role = 'viewer')
    -- must exist for the dashboard to be visible.
    RETURN EXISTS (
      SELECT 1 FROM resource_permissions rp
      WHERE rp.resource_type = 'dashboard'
        AND rp.resource_id   = p_dashboard_id
        AND rp.grantee_id    IS NULL
        AND rp.role          = 'viewer'
    );
  END IF;

  v_uid := v_uid_raw::uuid;

  RETURN EXISTS (
    SELECT 1 FROM dashboards d
    WHERE d.id = p_dashboard_id
      AND (
        -- Owner branch
        v_uid = d.owner_id

        -- Named grantee branch
        OR EXISTS (
          SELECT 1 FROM resource_permissions rp
          WHERE rp.resource_type = 'dashboard'
            AND rp.resource_id   = p_dashboard_id
            AND rp.grantee_id    = v_uid
        )
      )
  );
END;
$$;

-- ── dashboards ───────────────────────────────────────────────────────────────
--
-- Three separate policies are used (Postgres allows multiple policies per
-- command; they are OR-ed for permissive policies):
--
--   dashboards_select  FOR SELECT  — owner OR named grantee OR public-viewer
--   dashboards_update  FOR UPDATE  — owner OR editor grantee (mirrors service layer)
--   dashboards_delete  FOR DELETE  — owner only

ALTER TABLE dashboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE dashboards FORCE ROW LEVEL SECURITY;

CREATE POLICY dashboards_select ON dashboards
  FOR SELECT
  USING (helio_can_access_dashboard(id));

CREATE POLICY dashboards_update ON dashboards
  FOR UPDATE
  USING (
    -- Owner
    NULLIF(current_setting('app.current_user_id', true), '')::uuid = owner_id

    -- Editor grantee
    OR EXISTS (
      SELECT 1 FROM resource_permissions rp
      WHERE rp.resource_type = 'dashboard'
        AND rp.resource_id   = dashboards.id
        AND rp.grantee_id    = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        AND rp.role          = 'editor'
    )
  );

CREATE POLICY dashboards_delete ON dashboards
  FOR DELETE
  USING (
    NULLIF(current_setting('app.current_user_id', true), '')::uuid = owner_id
  );

-- INSERT on dashboards: only the owner inserts their own rows. The owner_id
-- column is set by the caller (DashboardRepository.insert uses withUserContext).
CREATE POLICY dashboards_insert ON dashboards
  FOR INSERT
  WITH CHECK (
    NULLIF(current_setting('app.current_user_id', true), '')::uuid = owner_id
  );

-- ── panels ───────────────────────────────────────────────────────────────────
--
-- Panels inherit dashboard ACL via helio_can_access_dashboard.
--
--   panels_select  FOR SELECT  — delegated to dashboard ACL via SECURITY DEFINER
--   panels_update  FOR UPDATE  — delegated to dashboard ACL (same as select)
--   panels_delete  FOR DELETE  — parent dashboard owner only
--   panels_insert  FOR INSERT  — parent dashboard owner only

ALTER TABLE panels ENABLE ROW LEVEL SECURITY;
ALTER TABLE panels FORCE ROW LEVEL SECURITY;

CREATE POLICY panels_select ON panels
  FOR SELECT
  USING (helio_can_access_dashboard(dashboard_id));

CREATE POLICY panels_update ON panels
  FOR UPDATE
  USING (helio_can_access_dashboard(dashboard_id));

CREATE POLICY panels_delete ON panels
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM dashboards d
      WHERE d.id = panels.dashboard_id
        AND d.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY panels_insert ON panels
  FOR INSERT
  WITH CHECK (
    NULLIF(current_setting('app.current_user_id', true), '')::uuid = owner_id
  );

-- ── resource_permissions ─────────────────────────────────────────────────────
--
-- The grant table has no explicit grantor_id column. The grantor is implicitly
-- the resource owner (dashboards.owner_id). Two SELECT branches:
--   (a) The caller is the dashboard owner — sees all grants for that dashboard.
--   (b) The caller is the named grantee — sees only their own grant row.
-- Public-viewer rows (grantee_id IS NULL) are visible only to the dashboard owner.
--
-- INSERT/UPDATE/DELETE require the caller to be the dashboard owner.
--
-- Note: the SELECT policy joins to dashboards which also has RLS. Since this
-- policy runs on the APP pool, the dashboards RLS policy is active. However,
-- the SELECT policy on resource_permissions is only needed for direct queries
-- on the table — the service layer (ResourcePermissionRepository) uses
-- withSystemContext which bypasses RLS entirely. The policy is defence-in-depth.

ALTER TABLE resource_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_permissions FORCE ROW LEVEL SECURITY;

CREATE POLICY resource_permissions_select ON resource_permissions
  FOR SELECT
  USING (
    -- Caller is the dashboard owner
    EXISTS (
      SELECT 1 FROM dashboards d
      WHERE d.id       = resource_permissions.resource_id
        AND d.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )

    -- Caller is the named grantee
    OR (
      grantee_id IS NOT NULL
      AND grantee_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY resource_permissions_insert ON resource_permissions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM dashboards d
      WHERE d.id       = resource_permissions.resource_id
        AND d.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY resource_permissions_update ON resource_permissions
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM dashboards d
      WHERE d.id       = resource_permissions.resource_id
        AND d.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY resource_permissions_delete ON resource_permissions
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM dashboards d
      WHERE d.id       = resource_permissions.resource_id
        AND d.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );
