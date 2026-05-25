-- HEL-277: Performance indexes to support RLS policy predicates.
--
-- All indexes in this migration are purely additive. No schema changes.
-- Two indexes were identified as missing during the RLS verification pass:
--
--   1. idx_panels_owner_id
--      Backs: panels_insert WITH CHECK (NULLIF(current_setting(...), '')::uuid = owner_id)
--             panels_delete USING (EXISTS (SELECT 1 FROM dashboards d WHERE d.owner_id = ...))
--      Without this index, the panels_insert and panels_delete policies evaluate
--      owner_id with a sequential scan on panels at scale. At low row counts
--      (~100s) the planner may prefer seqscan anyway, but at production volume
--      this index allows index-only scans on the WITH CHECK expression.
--
--   2. idx_resource_permissions_resource_grantee
--      Backs: helio_can_access_dashboard() SECURITY DEFINER function (V36)
--             Specifically the named-grantee branch:
--               EXISTS (SELECT 1 FROM resource_permissions rp
--                       WHERE rp.resource_type = 'dashboard'
--                         AND rp.resource_id   = p_dashboard_id
--                         AND rp.grantee_id    = v_uid)
--      The existing idx_resource_permissions_resource (V16) covers
--      (resource_type, resource_id) but requires a heap fetch to filter on
--      grantee_id. This composite index covers all three columns and enables
--      index-only scans on the named-grantee branch, which executes once per
--      row during dashboard/panel SELECT policy evaluation.
--
-- Note: idx_resource_permissions_grantee (V16) covers the reverse lookup
-- (find all resources granted to a given user). That index backs a different
-- access pattern (listing what a user can access). The composite index here
-- backs the per-row "can this user see this specific resource?" check.

-- ── 1. panels.owner_id ───────────────────────────────────────────────────────

CREATE INDEX idx_panels_owner_id ON panels(owner_id);

-- ── 2. resource_permissions (resource_type, resource_id, grantee_id) ─────────

CREATE INDEX idx_resource_permissions_resource_grantee
  ON resource_permissions (resource_type, resource_id, grantee_id);
