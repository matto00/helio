-- HEL-1456: deleting a panel removes its items from every breakpoint of its dashboard's stored layout.
--
-- WHY A TRIGGER. `dashboards.layout` carries `{panelId,x,y,w,h}` items per breakpoint (lg/md/sm/xs) and nothing
-- removed a panel's items when the panel row went. Panel rows are removed by `PanelRepository.delete`,
-- `deleteByOutputIdInternal`, the `replaceContents` bulk replace, and -- with no application code at all -- the FK
-- cascades `panels.output_id -> outputs ON DELETE CASCADE` (V94) reached from pipeline-step / pipeline / root /
-- data-source deletes. A trigger on `panels` is the only place that covers every present and future path, in the
-- same transaction as the delete, by construction.
--
-- WHAT IT DOES. A statement-level AFTER DELETE trigger (one firing per DELETE statement, however many panels):
-- it locks each affected dashboard row (`FOR UPDATE`, ordered by id, so two bulk deletes sharing dashboards cannot
-- deadlock each other), then rewrites each breakpoint array without the items whose `panelId` was deleted, keeping
-- the surviving items in stored order. A breakpoint emptied by the delete becomes `[]`, never JSON null
-- (`jsonb_agg` over zero rows is NULL, hence the COALESCE). Non-array breakpoints and other keys are left alone.
-- Rows with nothing to strip are not written. `last_updated` is deliberately NOT bumped: the strip changes nothing a
-- user can see (a ghost never renders) and bumping would reorder dashboard lists on unrelated cascades.
--
-- LOCKING. The dashboard row lock is the same row lock `PanelLayoutPlacement.insertAndAppend` takes on create, so a
-- concurrent create on the dashboard is serialized against the strip and neither change is lost. Creates never wait
-- on existing panel rows, so there is a single lock order (panel rows, then dashboards by id) and no inversion.
-- The lock and the UPDATE are separate statements on purpose: under READ COMMITTED the UPDATE then takes a fresh
-- snapshot after the lock wait and sees the committed layout of whoever held it, instead of overwriting it.
--
-- RLS. `dashboards` is ENABLE + FORCE RLS (V36) and the migrating role is not BYPASSRLS. A cascade can run on the
-- app pool under a user who cannot `dashboards_update` the affected dashboard (e.g. a shared-pipeline owner deleting
-- a pipeline bound on someone else's dashboard); an invoker-rights trigger would then silently update 0 rows. So the
-- function is SECURITY DEFINER and re-owned to `helio_privileged` (BYPASSRLS) with V100's exact bracket (transient
-- CREATE on the schema, ALTER FUNCTION ... OWNER TO, revoke), plus explicit idempotent grants. `SET row_security =
-- off` is V100's tripwire: if a later migration re-creates this function under the migrating role, the strip fails
-- loudly with 42501 instead of silently matching zero rows. The CREATE OR REPLACE intentionally precedes the
-- re-own (after the re-own the migrating role no longer owns the function).
--
-- NEVER EDIT THIS FILE once applied anywhere: Flyway checksums comments too, and the dev database is shared by every
-- worktree.

CREATE OR REPLACE FUNCTION hel1456_strip_deleted_panel_layout_items() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
AS $$
BEGIN
  PERFORM 1
  FROM dashboards
  WHERE id IN (SELECT dashboard_id FROM deleted_panels)
  ORDER BY id
  FOR UPDATE;

  WITH gone AS (
    SELECT dashboard_id, array_agg(id) AS ids
    FROM deleted_panels
    GROUP BY dashboard_id
  ),
  rewritten AS (
    SELECT d.id,
           COALESCE((
             SELECT jsonb_object_agg(
                      bp.key,
                      CASE WHEN jsonb_typeof(bp.value) = 'array' THEN
                        COALESCE((
                          SELECT jsonb_agg(e.item ORDER BY e.ord)
                          FROM jsonb_array_elements(bp.value) WITH ORDINALITY AS e(item, ord)
                          WHERE NOT COALESCE((e.item ->> 'panelId') = ANY (gone.ids), false)
                        ), '[]'::jsonb)
                      ELSE bp.value END)
             FROM jsonb_each(d.layout) AS bp(key, value)
           ), '{}'::jsonb) AS new_layout
    FROM dashboards d
    JOIN gone ON gone.dashboard_id = d.id
    WHERE jsonb_typeof(d.layout) = 'object'
  )
  UPDATE dashboards d
  SET layout = r.new_layout
  FROM rewritten r
  WHERE d.id = r.id
    AND d.layout IS DISTINCT FROM r.new_layout;

  RETURN NULL;
END;
$$;

GRANT CREATE ON SCHEMA public TO helio_privileged;

ALTER FUNCTION hel1456_strip_deleted_panel_layout_items() OWNER TO helio_privileged;

REVOKE CREATE ON SCHEMA public FROM helio_privileged;

GRANT SELECT, UPDATE ON dashboards TO helio_privileged;
GRANT SELECT ON panels TO helio_privileged;

CREATE TRIGGER hel1456_strip_deleted_panel_layout_items_trigger
  AFTER DELETE ON panels
  REFERENCING OLD TABLE AS deleted_panels
  FOR EACH STATEMENT
  EXECUTE FUNCTION hel1456_strip_deleted_panel_layout_items();

-- `ENABLE ALWAYS` (V99's precedent): fires even under `session_replication_role = replica`.
ALTER TABLE panels ENABLE ALWAYS TRIGGER hel1456_strip_deleted_panel_layout_items_trigger;
