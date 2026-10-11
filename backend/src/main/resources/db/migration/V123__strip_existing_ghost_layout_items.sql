-- HEL-1456: one-off repair -- strip every stored layout item whose panelId is not a panel of that dashboard.
--
-- Before V122 nothing removed a deleted panel's items from `dashboards.layout`, so existing dashboards carry
-- "ghost" items in lg/md/sm/xs. The client never renders them but they push new panels and auto-layout below the
-- deleted panel's old position. V122 prevents new ghosts; this migration removes the existing ones. Owner ruling
-- `approve-v123` (2026-10-11).
--
-- PROD COUNTS WERE NOT MEASURED. The owner did not run the count query before this shipped, so the number of
-- ghost items / affected dashboards in production is unknown. Run this read-only query as a BYPASSRLS role (e.g.
-- `SET ROLE helio_privileged;` -- `dashboards` and `panels` are FORCE RLS, so the app role `helio` would see
-- filtered, likely zero, rows and under-count) to see what this migration will touch:
--
--   WITH items AS (
--     SELECT d.id AS dashboard_id, bp.key AS breakpoint, item->>'panelId' AS panel_id
--     FROM dashboards d
--     CROSS JOIN LATERAL jsonb_each(d.layout) AS bp(key, value)
--     CROSS JOIN LATERAL jsonb_array_elements(
--       CASE WHEN jsonb_typeof(bp.value) = 'array' THEN bp.value ELSE '[]'::jsonb END) AS item
--   )
--   SELECT count(*)                      AS ghost_items,
--          count(DISTINCT dashboard_id)  AS dashboards_affected,
--          count(DISTINCT panel_id)      AS ghost_panel_ids,
--          (SELECT count(*) FROM dashboards) AS dashboards_total
--   FROM items i
--   WHERE NOT EXISTS (
--     SELECT 1 FROM panels p WHERE p.id = i.panel_id AND p.dashboard_id = i.dashboard_id);
--
-- (On the shared dev database the same query measured 84 ghost items on 9 of 2708 dashboards before V122/V123.)
--
-- RLS: HOW THIS READS PANELS. Both tables are FORCE RLS and Flyway runs as the non-BYPASSRLS `helio`. Reading
-- `panels` under that role (or under a per-owner `set_config` context as V114 does) can see zero panels, and a
-- "keep only live panels" rewrite over a zero-panel view would WIPE every item. So all reads and the write happen
-- inside a SECURITY DEFINER helper owned by `helio_privileged` (BYPASSRLS) with `SET row_security = off` (V100's
-- bracket and tripwire: if the re-own were lost this fails loudly with 42501 instead of matching nothing). The helper
-- is created, called and dropped inside this migration.
--
-- BEHAVIOUR. Per dashboard, each breakpoint array keeps the items whose `panelId` is a panel with that
-- `dashboard_id` -- unchanged and in stored order -- plus any element that carries no string `panelId` (not
-- addressable as a panel, so not a ghost by this definition). A breakpoint emptied here becomes `[]`, never null.
-- `last_updated` is NOT touched (the strip is invisible to users). Idempotent: rows that would not change are not
-- written, so a second run updates nothing.
--
-- NEVER EDIT THIS FILE once applied anywhere: Flyway checksums comments too.

CREATE OR REPLACE FUNCTION hel1456_repair_ghost_layout_items() RETURNS bigint
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
AS $$
DECLARE
  repaired bigint;
BEGIN
  WITH rewritten AS (
    SELECT d.id,
           COALESCE((
             SELECT jsonb_object_agg(
                      bp.key,
                      CASE WHEN jsonb_typeof(bp.value) = 'array' THEN
                        COALESCE((
                          SELECT jsonb_agg(e.item ORDER BY e.ord)
                          FROM jsonb_array_elements(bp.value) WITH ORDINALITY AS e(item, ord)
                          WHERE (e.item ->> 'panelId') IS NULL
                             OR (e.item ->> 'panelId') = ANY (
                                  COALESCE((SELECT array_agg(p.id) FROM panels p WHERE p.dashboard_id = d.id), ARRAY[]::text[]))
                        ), '[]'::jsonb)
                      ELSE bp.value END)
             FROM jsonb_each(d.layout) AS bp(key, value)
           ), '{}'::jsonb) AS new_layout
    FROM dashboards d
    WHERE jsonb_typeof(d.layout) = 'object'
  ),
  updated AS (
    UPDATE dashboards d
    SET layout = r.new_layout
    FROM rewritten r
    WHERE d.id = r.id
      AND d.layout IS DISTINCT FROM r.new_layout
    RETURNING d.id
  )
  SELECT count(*) INTO repaired FROM updated;
  RETURN repaired;
END;
$$;

GRANT CREATE ON SCHEMA public TO helio_privileged;

ALTER FUNCTION hel1456_repair_ghost_layout_items() OWNER TO helio_privileged;

REVOKE CREATE ON SCHEMA public FROM helio_privileged;

GRANT SELECT, UPDATE ON dashboards TO helio_privileged;
GRANT SELECT ON panels TO helio_privileged;

SELECT hel1456_repair_ghost_layout_items();

DROP FUNCTION hel1456_repair_ghost_layout_items();
