-- HEL-1498: one id-ordered lock over every panel a delete can reach, including panels the caller cannot see under RLS.
--
-- WHY. HEL-1485 fixed a 40P01 between a dashboard delete and a panel delete by locking panel rows first, in id order
-- (DashboardRepository.lockPanelRows), matching V122's "panel rows, then dashboards by id". Every OTHER transaction that
-- deletes or updates two or more panel rows (contents replace, batch update, output delete, and the FK cascades
-- panels.output_id -> outputs (V94) reached from pipeline / pipeline-step / pipeline-root / data-source deletes and from
-- workspace teardown) still locked panels in scan or request order, so a dashboard delete racing one of them over two or
-- more shared panels could still deadlock. This function is the single mechanism: call it ONCE, as the first write of the
-- transaction, and the transaction holds every panel row it may delete or update in panel-id order before it locks
-- anything else.
--
-- WHAT IT LOCKS. `PERFORM 1 FROM panels ... ORDER BY id FOR UPDATE`, one statement (two ordered statements in sequence
-- are not globally ordered): the panels on any of `p_dashboard_ids`, and the panels bound to any Output that
-- `p_output_ids`, `p_pipeline_ids`, `p_step_ids`, `p_root_ids` or `p_data_source_ids` (via the roots bound to those
-- sources) would remove: outputs of the pipeline, outputs attached to the steps, outputs rooted on the roots, and outputs
-- attached to any step under those roots (parent_step_id walked recursively). A superset is safe. `FOR UPDATE` skips a row
-- a racer deleted and committed (READ COMMITTED recheck), so a racing delete is never an error here.
--
-- RLS. A cascade deletes panels on another user's dashboard, which the acting user's own `FOR UPDATE` cannot see (V36
-- panel policies), so an application-level lock cannot order them. The function is SECURITY DEFINER and re-owned to
-- `helio_privileged` (BYPASSRLS) with V100/V122's exact bracket (transient CREATE on the schema, ALTER FUNCTION ... OWNER
-- TO, revoke); `SET row_security = off` is the tripwire: re-created under the migrating role it fails loudly (42501)
-- instead of silently matching zero rows. It returns void, so it discloses nothing about the rows it locked.
--
-- EXECUTE. Revoked from PUBLIC and granted to the migrating role, i.e. CURRENT_USER (the production app role `helio`;
-- the embedded test role is `helio_migration_test`, so never a literal), BEFORE the re-own: afterwards the migrating role
-- no longer owns the function and could not change its ACL. The privileged pool reaches it as the owner.
--
-- NEVER EDIT THIS FILE once applied anywhere: Flyway checksums comments too, and the dev database is shared by every
-- worktree.

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
BEGIN
  PERFORM 1
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
           SELECT s.id FROM pipeline_steps s WHERE s.root_id IN (SELECT id FROM roots)
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
  FOR UPDATE OF p;
END;
$$;

REVOKE ALL ON FUNCTION hel1498_lock_panels(text[], text[], text[], text[], text[], text[]) FROM PUBLIC;

-- Dynamic on purpose: the migrating role differs per environment (see EXECUTE above).
DO $grant$
BEGIN
  EXECUTE format(
    'GRANT EXECUTE ON FUNCTION hel1498_lock_panels(text[], text[], text[], text[], text[], text[]) TO %I',
    current_user);
END
$grant$;

GRANT CREATE ON SCHEMA public TO helio_privileged;

ALTER FUNCTION hel1498_lock_panels(text[], text[], text[], text[], text[], text[]) OWNER TO helio_privileged;

REVOKE CREATE ON SCHEMA public FROM helio_privileged;

GRANT SELECT, UPDATE ON panels TO helio_privileged;
GRANT SELECT ON outputs, pipeline_steps, pipeline_roots TO helio_privileged;
