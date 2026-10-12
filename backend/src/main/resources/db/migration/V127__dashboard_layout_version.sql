-- HEL-1457: a database-maintained version of a dashboard's stored layout, so a layout writer can say "only write if
-- the layout is still the one I read" (compare-and-set) without a lock.
--
-- WHY A TRIGGER. The layout is rewritten by many writers: the layout PATCH, auto-layout, panel create (insert and
-- append), the V122 delete-strip, the contents replace, the layout repair and patch-set apply / undo. A BEFORE UPDATE
-- trigger bumps the version for every one of them, present and future, with no application code to forget.
--
-- WHEN IT FIRES. Only when the layout changes (a value comparison of the jsonb, so a rewrite to an equal layout is not
-- a change) or when a statement tries to assign the version itself. The second case makes the column unforgeable: a
-- whole-row write that carries a stale version cannot move it backwards or sideways, the function pins it to
-- OLD.layout_version (+1 when the layout changed). A rename or an appearance change fires nothing.
--
-- LOCKING / RLS. The function only assigns NEW, so it reads and writes nothing else and takes no lock beyond the row
-- lock the UPDATE already holds; it is invoker-rights and needs no re-own to a BYPASSRLS role (unlike V122, which
-- UPDATEs dashboards from a trigger on panels). V122's own UPDATE fires this trigger, so a panel delete that strips
-- layout items bumps the version too. `SET search_path` mirrors V122.
--
-- NEVER EDIT THIS FILE once applied anywhere: Flyway checksums comments too, and the dev database is shared by every
-- worktree.

ALTER TABLE dashboards ADD COLUMN layout_version bigint NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION hel1457_bump_dashboard_layout_version() RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.layout IS DISTINCT FROM OLD.layout THEN
    NEW.layout_version := OLD.layout_version + 1;
  ELSE
    NEW.layout_version := OLD.layout_version;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER hel1457_bump_dashboard_layout_version_trigger
  BEFORE UPDATE ON dashboards
  FOR EACH ROW
  WHEN (NEW.layout IS DISTINCT FROM OLD.layout OR NEW.layout_version IS DISTINCT FROM OLD.layout_version)
  EXECUTE FUNCTION hel1457_bump_dashboard_layout_version();

-- `ENABLE ALWAYS` (V99 / V122 precedent): fires even under `session_replication_role = replica`.
ALTER TABLE dashboards ENABLE ALWAYS TRIGGER hel1457_bump_dashboard_layout_version_trigger;
