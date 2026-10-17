-- HEL-1629: one id-ordered `FOR NO KEY UPDATE` lock over pipeline rows the acting user may not be able to see under RLS.
--
-- WHY. The atomic draft save (POST /api/pipelines/:id/draft/save) and every writer of fingerprinted pipeline state that
-- the race specs prove needs it (steps, Outputs, roots, schedule, a source delete's rooted set) serialize on the pipeline
-- row, "lock (3)" in docs/live-draft-preview.md section 8.3. An application-level `SELECT ... FOR NO KEY UPDATE` on the
-- app pool needs the `pipelines_update` policy (V39:87, owner only): for an EDITOR grantee, or for a source owner
-- deleting a source that is rooted by someone else's pipeline, it silently matches ZERO rows and locks nothing. This
-- function is the lock that cannot do that: SECURITY DEFINER, re-owned to `helio_privileged` (BYPASSRLS), with
-- `SET row_security = off` as the tripwire (re-created under the migrating role it fails loudly, 42501, instead of
-- silently matching nothing). It is V129's `hel1498_lock_panels` pattern.
--
-- SOURCES. A writer that deletes a data source cascades into every pipeline ROOTED on it, and the source's owner cannot
-- see (under RLS) a pipeline another user owns. `p_source_ids` therefore adds "every pipeline with a root on one of these
-- sources" to the pipelines locked, read INSIDE the privileged statement, in the same id order. The source delete holds the
-- source row `FOR UPDATE` first, which a root add's FK key-share on that source conflicts with, so the set cannot grow
-- between this read and the DELETE (design D5, hypothesis H').
--
-- RETURNS. The number of rows locked, unlike V129's void. A caller compares it with the number of ids it passed: a short
-- count means a racer deleted a pipeline, which the caller must treat as "gone" (the save answers 404, a single-pipeline
-- writer takes its own not-found path, a set writer such as a source delete drops the id and carries on) and never as
-- permission to proceed. Returning the count discloses only how many of the CALLER-SUPPLIED ids exist, and the function
-- is executable only by the migrating role (granted below) and the privileged pool: no client can reach it, because only
-- server code calls it with ids it has already authorized. (V129 returned void because it locks a superset it computes;
-- this one locks exactly the ids it is handed.)
--
-- LOCKING. `FOR NO KEY UPDATE`, never `FOR UPDATE`: the run guard (PipelineRunRepository.runGuardAction) and every child-FK
-- insert (steps, roots, runs, Outputs) take `FOR KEY SHARE` on the pipeline row, which NO KEY UPDATE does not block, so a
-- save does not serialize against run inserts. Rows are taken in id order in ONE statement (two ordered statements in
-- sequence are not globally ordered). `FOR NO KEY UPDATE` skips a row a racer deleted and committed (READ COMMITTED
-- recheck), which is what makes the returned count meaningful.
--
-- EXECUTE. Revoked from PUBLIC and granted to the migrating role, i.e. CURRENT_USER (the production app role `helio`; the
-- embedded test role is `helio_migration_test`, so never a literal), BEFORE the re-own: afterwards the migrating role no
-- longer owns the function and could not change its ACL. The privileged pool reaches it as the owner; the app pool, whose
-- login role is the migrating role in production, holds the granted EXECUTE.
--
-- NEVER EDIT THIS FILE once applied anywhere: Flyway checksums comments too, and the dev database is shared by every
-- worktree.

CREATE OR REPLACE FUNCTION hel1629_lock_pipelines(p_pipeline_ids text[], p_source_ids text[]) RETURNS integer
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
AS $$
DECLARE
  v_locked integer;
BEGIN
  PERFORM 1
  FROM pipelines p
  WHERE p.id = ANY (COALESCE(p_pipeline_ids, ARRAY[]::text[]))
     OR p.id IN (SELECT r.pipeline_id FROM pipeline_roots r WHERE r.data_source_id = ANY (COALESCE(p_source_ids, ARRAY[]::text[])))
  ORDER BY p.id
  FOR NO KEY UPDATE OF p;
  GET DIAGNOSTICS v_locked = ROW_COUNT;
  RETURN v_locked;
END;
$$;

REVOKE ALL ON FUNCTION hel1629_lock_pipelines(text[], text[]) FROM PUBLIC;

-- Dynamic on purpose: the migrating role differs per environment (see EXECUTE above).
DO $grant$
BEGIN
  EXECUTE format('GRANT EXECUTE ON FUNCTION hel1629_lock_pipelines(text[], text[]) TO %I', current_user);
END
$grant$;

GRANT CREATE ON SCHEMA public TO helio_privileged;

ALTER FUNCTION hel1629_lock_pipelines(text[], text[]) OWNER TO helio_privileged;

REVOKE CREATE ON SCHEMA public FROM helio_privileged;

GRANT SELECT, UPDATE ON pipelines TO helio_privileged;
GRANT SELECT ON pipeline_roots TO helio_privileged;
