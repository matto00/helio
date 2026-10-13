-- HEL-1534: one lock order between panel CREATE and every Output-removing delete: panel rows by id, THEN dashboard rows
-- by id, THEN the Output (and pipeline / step / root / source) rows.
--
-- WHY. A panel create locks its dashboard D `FOR UPDATE` (PanelLayoutPlacement), then its INSERT takes KEY SHARE on the
-- bound Output O through the `panels.output_id` foreign key (V94): order D, then O. A pipeline / pipeline-step /
-- pipeline-root / data-source delete or a workspace teardown calls `hel1498_lock_panels` (V129) first, then deletes
-- the pipeline (or step, root, source) row, reaches O by FK cascade, and the cascade deletes O's panels, whose V122
-- statement trigger locks their dashboards only NOW: order panels, O, then D. A create on D bound to O racing such a
-- delete, with O already bound to a panel on D, deadlocks (40P01). V122's header said its dashboard lock could not
-- invert against anything; that holds for panel and dashboard rows only, and is superseded for Output rows by this file.
--
-- WHAT CHANGES. `hel1498_lock_panels` (same signature, same SECURITY DEFINER, same search_path, same
-- `row_security = off`) still locks the panel rows exactly as V129 does, in id order, in one statement, and now also
-- locks, in ONE further statement, the dashboards of the panels it locked (plus `p_dashboard_ids`) in dashboard-id order.
-- Every caller already invokes it once, as the first write of the transaction, so the delete now takes D before it
-- touches O, which is the order create already uses. The locked dashboards are invisible to the acting user under
-- RLS (a grantee's), which is why this lives in the SECURITY DEFINER function. `FOR UPDATE` skips a dashboard a racer
-- deleted and committed (READ COMMITTED recheck), so a lost race is not an error. It still returns void.
--
-- RESIDUAL (documented, not fixed). The dashboards locked are those of the panels bound at the moment the function
-- runs. A dashboard that gains its FIRST panel bound to O after that (a create committing between this function and the
-- DELETE statement) is locked late by V122, and a second create on that dashboard bound to O can still deadlock. It
-- needs two creates on a dashboard that had no panel bound to O, inside one delete transaction's window; the same class
-- as HEL-1485's accepted "panel created after the pre-lock" residual.
--
-- OWNERSHIP. `CREATE OR REPLACE` must run as the function's owner, `helio_privileged`. V129's header says the migrating
-- role "could not change its ACL" once the function was re-owned; that sentence is superseded: the migrating role
-- is a member of `helio_privileged` (V34 `GRANT helio_privileged TO current_user`) and can SET ROLE to it, which is
-- the capability the production app pool already uses on every system-context call. So the replacement runs under
-- `SET LOCAL ROLE helio_privileged` (inside the migration transaction), with V100/V122/V129's transient CREATE on the
-- schema around it, and relies on the SET capability rather than on INHERIT. The replace keeps the owner and the
-- EXECUTE ACL (revoked from PUBLIC, granted to the migrating role in V129), which are therefore NOT re-issued here.
-- `helio_privileged` already holds `SELECT, UPDATE ON dashboards` (V122), which `FOR UPDATE` needs; re-stated below.
--
-- NEVER EDIT THIS FILE once applied anywhere: Flyway checksums comments too, and the dev database is shared by every
-- worktree. V129 is not edited either.

GRANT CREATE ON SCHEMA public TO helio_privileged;

SET LOCAL ROLE helio_privileged;

CREATE OR REPLACE FUNCTION hel1498_lock_panels(
  p_dashboard_ids   text[],
  p_output_ids      text[],
  p_pipeline_ids    text[],
  p_step_ids        text[],
  p_root_ids        text[],
  p_data_source_ids text[]
) RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
AS $$
DECLARE
  v_dashboards text[];
BEGIN
  -- 1. Panel rows by id, one statement (V129). The distinct dashboards of the rows locked are collected from the
  --    locked, id-ordered subquery; the inner ORDER BY + FOR UPDATE keeps governing the lock order.
  SELECT array_agg(DISTINCT s.dashboard_id) INTO v_dashboards
  FROM (
    SELECT p.dashboard_id
    FROM panels p
    WHERE p.dashboard_id = ANY (COALESCE(p_dashboard_ids, ARRAY[]::text[]))
       OR p.output_id IN (
         WITH RECURSIVE
           roots AS (
             SELECT r.id
             FROM pipeline_roots r
             WHERE r.id = ANY (COALESCE(p_root_ids, ARRAY[]::text[]))
                OR r.data_source_id = ANY (COALESCE(p_data_source_ids, ARRAY[]::text[]))
           ),
           steps AS (
             SELECT s2.id FROM pipeline_steps s2 WHERE s2.root_id IN (SELECT id FROM roots)
             UNION
             SELECT c.id FROM pipeline_steps c JOIN steps ON c.parent_step_id = steps.id
           )
         SELECT o.id
         FROM outputs o
         WHERE o.id = ANY (COALESCE(p_output_ids, ARRAY[]::text[]))
            OR o.pipeline_id = ANY (COALESCE(p_pipeline_ids, ARRAY[]::text[]))
            OR o.node_step_id = ANY (COALESCE(p_step_ids, ARRAY[]::text[]))
            OR o.root_id IN (SELECT id FROM roots)
            OR o.node_step_id IN (SELECT id FROM steps)
       )
    ORDER BY p.id
    FOR UPDATE OF p
  ) s;

  -- 2. Then those dashboards (and the ones the caller names) by id, one statement: after every panel row, before any
  --    Output / pipeline / step / root / source row, the order panel create already follows.
  PERFORM 1
  FROM dashboards d
  WHERE d.id = ANY (COALESCE(v_dashboards, ARRAY[]::text[]) || COALESCE(p_dashboard_ids, ARRAY[]::text[]))
  ORDER BY d.id
  FOR UPDATE OF d;
END;
$$;

RESET ROLE;

REVOKE CREATE ON SCHEMA public FROM helio_privileged;

GRANT SELECT, UPDATE ON dashboards TO helio_privileged;
