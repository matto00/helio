-- HEL-974: make `hel913_prevent_zero_root_pipelines` (V99) RLS-independent.
--
-- WHAT WAS VACUOUS, AND WHY. V99's guard is `SECURITY DEFINER`, created by the migrating role
-- (`DB_USER`, prod's `helio`), which OWNS `pipelines`/`pipeline_roots` -- both FORCE ROW LEVEL
-- SECURITY. `SECURITY DEFINER` runs the function body AS ITS OWNER for privilege purposes,
-- INCLUDING which RLS policies apply to its own internal reads -- a `BYPASSRLS` attribute on the
-- CALLING role/connection does not change this. So even a caller reaching `pipeline_roots` via
-- the privileged (`BYPASSRLS`) pool, with `app.current_user_id` never set, sees its own outer
-- DELETE skip RLS entirely (BYPASSRLS), while the trigger's *internal* `pipelines`/
-- `pipeline_roots` reads are still evaluated against `pipelines_select`/`pipeline_roots_select`
-- (both backed by `helio_can_access_pipeline`, `missing_ok=true`) -- which return FALSE for an
-- unset GUC, not an error. The JOIN then sees nothing, raises nothing, and the zero-root orphan
-- (`pipelines=1, pipeline_roots=0`) is recreated silently. Measured empirically in this ticket's
-- `probe.md` (task 1.1) BEFORE this fix existed, mirroring the identical trap V40 already fixed
-- for `helio_can_access_dashboard`/`helio_can_access_pipeline` themselves.
--
-- THE V40 PRECEDENT. Re-own the function to `helio_privileged` (`BYPASSRLS`, created in V34).
-- `SECURITY DEFINER` then executes the body as a `BYPASSRLS` role, so its own reads skip RLS
-- entirely, regardless of the calling connection's role or the GUC. Byte-for-byte the same
-- `GRANT CREATE ... / ALTER FUNCTION ... OWNER TO helio_privileged / REVOKE CREATE ...` bracket
-- V40 uses (transient `CREATE` grant on `public`, since `ALTER FUNCTION ... OWNER TO` requires
-- the new owner to hold `CREATE` on the function's schema).
--
-- The `CREATE OR REPLACE FUNCTION` below intentionally runs BEFORE the `ALTER FUNCTION ... OWNER
-- TO` -- if the re-own ran first, the replace would execute as `DB_USER` against a function it no
-- longer owns and fail.
--
-- THE `SET row_security = off` TRIPWIRE (co-equal deliverable, per design.md D2 / owner ruling
-- this run). With a `BYPASSRLS` owner this clause is a pure no-op. Its value is entirely about
-- FAILURE MODE if a future migration ever re-creates this function under `DB_USER` again (losing
-- the `helio_privileged` ownership without anyone noticing): WITHOUT this clause, that regression
-- reproduces today's exact silent-non-firing defect. WITH it, Postgres raises `42501 -- query
-- would be affected by row-level security policy` the moment the function's own read is
-- evaluated under RLS again -- a LOUD failure instead of a silent one. This ticket's own mutation
-- gates (task 3.7 / 3.7a, `probe.md`) prove both states behave exactly as described here.
--
-- GRANTS: `helio_privileged` already holds `SELECT` on all tables via V38's blanket grant +
-- `ALTER DEFAULT PRIVILEGES`, which should cover `pipeline_roots` (created by V98 as `DB_USER`).
-- V60/V61/V75/V91/V94 all still issue explicit grants rather than relying solely on the default-
-- privilege path, so this migration follows the same belt-and-braces convention: an explicit,
-- idempotent `GRANT SELECT` naming both tables.
--
-- CROSS-TENANT DISCLOSURE RISK THIS INTRODUCES (see design.md Risks, and D9/HEL-987 interaction
-- fixed alongside this in `DataSourceRepository`/`DataSourceService`): post-fix, the trigger reads
-- WITH BYPASSRLS, so a raise can in principle name a pipeline id the deleting caller cannot see
-- (e.g. bound to a source they no longer have access to, but a `pipeline_roots` row still
-- references). The shipped `DataSourceService.delete` path maps the raise to a generic 409 that
-- never echoes the trigger's own text, so this does not currently reach an API client -- but that
-- is a property of the caller, not of the trigger, and any FUTURE direct caller of this trigger
-- must account for it.
--
-- WHY `V99__prevent_zero_root_pipelines.sql` ITSELF IS NOT EDITED, NOT EVEN ITS COMMENT.
-- Flyway checksums the WHOLE file, comments included, and `Database.initApp` runs with
-- validation on (no `validateOnMigrate(false)`, no `ignoreMigrationPatterns`) -- editing a single
-- byte of an already-applied migration fails boot with a checksum mismatch on every database that
-- has already applied V99, including any database that has run since HEL-913 shipped. This is the
-- exact incident class the v0.7.x release already hit once. V99's own "HONEST LIMIT" section
-- therefore stays exactly as written -- a future `git blame`/`git log` reader lands there first,
-- and would find a claim that is now stale relative to this file. THAT IS DELIBERATE and settled
-- by escalation this run (`v100-header-only`): correcting V99 in place is not an option, so the
-- correction lives here instead, plus in the archived HEL-913 `tasks.md` caveat. If a future
-- reader is tempted to "fix" V99's comment to match this file, they must not -- doing so breaks
-- the next deploy against any database that already has V99's checksum recorded.

CREATE OR REPLACE FUNCTION hel913_prevent_zero_root_pipelines() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
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

GRANT CREATE ON SCHEMA public TO helio_privileged;

ALTER FUNCTION hel913_prevent_zero_root_pipelines() OWNER TO helio_privileged;

REVOKE CREATE ON SCHEMA public FROM helio_privileged;

GRANT SELECT ON pipelines, pipeline_roots TO helio_privileged;
