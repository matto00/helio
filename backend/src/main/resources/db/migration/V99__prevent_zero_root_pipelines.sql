-- HEL-913 skeptic-final-2.md FIX 1: closes a silent-data-loss hole V98 introduced.
--
-- V22:4 had `pipelines.source_data_source_id ... REFERENCES data_sources(id) ON DELETE CASCADE`
-- -- deleting a DataSource deleted the WHOLE pipeline. V98:145 re-homed that cascade onto
-- `pipeline_roots.data_source_id ... ON DELETE CASCADE` -- deleting a DataSource now deletes
-- only THAT ROOT, and can leave the pipeline itself behind with ZERO roots. This falsifies R1
-- (design.md: "a zero-root pipeline is not a representable state"), silently bypasses
-- `PipelineService.removeRoot`'s own last-root guard (`roots.size == 1 -> 400`) and its
-- placement-count report, and silently destroys any panels placed on that root's Outputs via
-- the outputs -> panels cascade -- because `DataSourceService.delete` never goes anywhere near
-- `removeRoot` at all.
--
-- Fixed at the DB level, not only the service layer, so this closes for EVERY writer --
-- including ones that don't exist yet (a future migration, an admin script, a different service
-- method) -- not merely "the only caller today", a decay this exact ticket has already observed
-- once (round 1's OutputService/PipelineRunService pair).
--
-- Distinguishes the one case that MUST still be allowed -- deleting the pipeline itself, whose
-- roots cascade along with it via `pipeline_roots.pipeline_id ... ON DELETE CASCADE` -- from the
-- one that must not: deleting a root (directly, or via its DataSource) while the pipeline itself
-- survives. An AFTER DELETE STATEMENT-level trigger with a transition table does this correctly:
-- by the time it fires, a same-statement `DELETE FROM pipelines` has ALREADY removed the
-- `pipelines` row (the FK cascade to `pipeline_roots` is a row-level action that completes before
-- the end-of-statement trigger runs), so the JOIN below finds nothing for that pipeline and
-- raises nothing. Only a delete that empties a STILL-EXISTING pipeline's roots is caught.
--
-- SECURITY DEFINER (mirrors V39/V36's `helio_can_access_*` precedent). `search_path` is pinned
-- (`pg_catalog, public`) -- standard hygiene, and it means there is no privilege-escalation
-- shape here.
--
-- HONEST LIMIT, MEASURED, NOT ASSUMED (HEL-913 final gate, round 3). An earlier version of this
-- comment claimed SECURITY DEFINER makes the check see the real state of
-- `pipelines`/`pipeline_roots` "regardless of the calling role's RLS visibility". THAT IS FALSE.
-- This trigger's own read IS subject to FORCE ROW LEVEL SECURITY. Measured in a prod-shaped role
-- configuration: with a NOSUPERUSER NOBYPASSRLS definer and `app.current_user_id` UNSET, the
-- JOIN below sees nothing, the guard raises nothing, and the zero-root orphan is recreated
-- silently (`pipelines=1, roots=0`). With the GUC set it raises correctly. V40 documents this
-- same trap.
--
-- So this is precisely the failure class the V98 "vacuous guard" incident in this same migration
-- series taught -- "a check that reads through the same RLS state it exists to guard is not a
-- backstop" -- and the first draft of this comment cited that lesson while reproducing it.
--
-- WHY THIS IS STILL SAFE TO SHIP, and what actually closes the hole: the user-facing deletion
-- path is closed independently of this trigger. `DataSourceRepository.delete` runs under
-- `withUserContext`, so the GUC is set and the trigger fires correctly there. The residual gap
-- is any writer reaching `pipeline_roots` WITHOUT a user context -- a migration, an admin
-- script, a background job, a future privileged path.
--
-- Making this trigger genuinely RLS-independent is HEL-974, which owns the fix and the
-- non-superuser test that would actually fire it.

CREATE OR REPLACE FUNCTION hel913_prevent_zero_root_pipelines() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
AS $$
DECLARE
  orphaned_pipeline_ids TEXT;
BEGIN
  SELECT string_agg(p.id, ', ') INTO orphaned_pipeline_ids
  FROM (SELECT DISTINCT pipeline_id FROM deleted_roots) AS d
  JOIN pipelines p ON p.id = d.pipeline_id
  WHERE NOT EXISTS (SELECT 1 FROM pipeline_roots pr WHERE pr.pipeline_id = p.id);

  IF orphaned_pipeline_ids IS NOT NULL THEN
    RAISE EXCEPTION
      'HEL-913: this delete would leave pipeline(s) [%] with zero roots (R1 violation) -- remove the pipeline itself instead of its last root, or add another root first',
      orphaned_pipeline_ids;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER hel913_prevent_zero_root_pipelines_trigger
  AFTER DELETE ON pipeline_roots
  REFERENCING OLD TABLE AS deleted_roots
  FOR EACH STATEMENT
  EXECUTE FUNCTION hel913_prevent_zero_root_pipelines();

-- `ENABLE ALWAYS` (V91's own precedent, `audit_events_no_mutation_stmt`): fires regardless of
-- `session_replication_role`, so a replication/bulk-load session cannot silently bypass it either.
ALTER TABLE pipeline_roots ENABLE ALWAYS TRIGGER hel913_prevent_zero_root_pipelines_trigger;
