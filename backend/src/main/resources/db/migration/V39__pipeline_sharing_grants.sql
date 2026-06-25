-- HEL-279: Pipeline sharing grants.
--
-- Adds sharing semantics for pipelines, mirroring the dashboard approach in V36.
-- Key additions:
--   1. helio_can_access_pipeline(pipeline_id TEXT) SECURITY DEFINER function
--      encodes the sharing-aware SELECT predicate for pipelines.
--   2. RLS policies on `pipelines` table are REPLACED:
--      - DROP the all-commands `pipelines_owner` policy from V35 (it uses
--        current_setting without missing_ok=true, which throws on anonymous callers)
--      - ADD `pipelines_select` (sharing-aware, via helio_can_access_pipeline)
--      - ADD `pipelines_insert`, `pipelines_update`, `pipelines_delete`
--        (owner-only, with NULLIF guard for safe anonymous handling)
--   3. Pipeline-owner INSERT/UPDATE/DELETE/SELECT policies on `resource_permissions`
--      (OR-ed alongside the existing dashboard policies; Postgres ORs permissive policies).
--
-- No public-viewer (anonymous) path for pipelines — grantee_id IS NULL grants
-- are rejected at the service layer for resource_type = 'pipeline'.

-- ── SECURITY DEFINER helper ──────────────────────────────────────────────────
--
-- Mirrors helio_can_access_dashboard from V36. Runs as table owner (postgres in
-- tests) so it can read resource_permissions without the caller's RLS policies
-- interfering.
--
-- No anonymous branch: if v_uid_raw is NULL or empty, returns FALSE immediately.
-- This implements the no-public-viewer contract for pipelines.

CREATE OR REPLACE FUNCTION helio_can_access_pipeline(p_pipeline_id TEXT)
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

  -- No anonymous path for pipelines: NULL or empty means no access.
  IF v_uid_raw IS NULL OR v_uid_raw = '' THEN
    RETURN FALSE;
  END IF;

  v_uid := v_uid_raw::uuid;

  RETURN EXISTS (
    SELECT 1 FROM pipelines p
    WHERE p.id = p_pipeline_id
      AND (
        -- Owner branch
        v_uid = p.owner_id

        -- Named grantee branch
        OR EXISTS (
          SELECT 1 FROM resource_permissions rp
          WHERE rp.resource_type = 'pipeline'
            AND rp.resource_id   = p_pipeline_id
            AND rp.grantee_id    = v_uid
        )
      )
  );
END;
$$;

-- ── pipelines: replace V35 policy with per-command policies ──────────────────
--
-- V35 created a single all-commands `pipelines_owner` policy using
-- `current_setting('app.current_user_id')` without missing_ok=true. This throws
-- an error for anonymous callers (empty string to UUID cast). V39 replaces it
-- with per-command policies that use NULLIF(..., '')::uuid for safe handling.
--
-- The SELECT policy is sharing-aware (owner + named grantees via SECURITY DEFINER
-- function). The INSERT/UPDATE/DELETE policies remain owner-only.

DROP POLICY IF EXISTS pipelines_owner  ON pipelines;
DROP POLICY IF EXISTS pipelines_select ON pipelines;

CREATE POLICY pipelines_select ON pipelines
  FOR SELECT
  USING (helio_can_access_pipeline(id));

CREATE POLICY pipelines_insert ON pipelines
  FOR INSERT
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY pipelines_update ON pipelines
  FOR UPDATE
  USING (owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY pipelines_delete ON pipelines
  FOR DELETE
  USING (owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- ── resource_permissions: add pipeline-owner policies ────────────────────────
--
-- V36 added dashboard-owner INSERT/UPDATE/DELETE policies on resource_permissions.
-- Postgres OR-s multiple permissive policies for the same command, so adding
-- pipeline-owner policies here extends coverage without replacing dashboard coverage.
--
-- SELECT: grantee sees their own row; owner sees all rows for their pipeline.
-- INSERT/UPDATE/DELETE: only the pipeline owner may manage pipeline grants.

CREATE POLICY resource_permissions_pipeline_select ON resource_permissions
  FOR SELECT
  USING (
    -- Caller is the pipeline owner
    EXISTS (
      SELECT 1 FROM pipelines p
      WHERE p.id       = resource_permissions.resource_id
        AND p.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
        AND resource_permissions.resource_type = 'pipeline'
    )

    -- Caller is the named grantee for a pipeline grant
    OR (
      resource_permissions.resource_type = 'pipeline'
      AND grantee_id IS NOT NULL
      AND grantee_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY resource_permissions_pipeline_insert ON resource_permissions
  FOR INSERT
  WITH CHECK (
    resource_type = 'pipeline'
    AND EXISTS (
      SELECT 1 FROM pipelines p
      WHERE p.id       = resource_permissions.resource_id
        AND p.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY resource_permissions_pipeline_update ON resource_permissions
  FOR UPDATE
  USING (
    resource_type = 'pipeline'
    AND EXISTS (
      SELECT 1 FROM pipelines p
      WHERE p.id       = resource_permissions.resource_id
        AND p.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY resource_permissions_pipeline_delete ON resource_permissions
  FOR DELETE
  USING (
    resource_type = 'pipeline'
    AND EXISTS (
      SELECT 1 FROM pipelines p
      WHERE p.id       = resource_permissions.resource_id
        AND p.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );
