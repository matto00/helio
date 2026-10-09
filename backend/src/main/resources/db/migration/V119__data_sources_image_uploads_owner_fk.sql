-- HEL-1347: bind `data_sources` and `image_uploads` to an existing owner.
--
-- Neither table had a foreign key on `owner_id`, so deleting a user silently orphaned their rows (invisible to every
-- user under RLS, blocking nothing). Owner rulings (escalation HEL-1347, 2026-10-09): CASCADE; delete existing orphans
-- in this migration (approved production data deletion; the owner checks the prod count before release); delete
-- NULL-owner data sources too; cover `image_uploads` as well.
--
--   1. Guard: abort, before deleting anything, if a data source about to be deleted is still referenced by a
--      pipeline root, a join/lookup/union step's `secondaryInput`, an `upsertsource` step's existing-source target,
--      or a form panel's `dataSourceId` (every reference kind DataSourceReferenceRepository, HEL-1252, knows).
--   2. Delete data sources whose owner is NULL or no longer exists (cascades `dataset_rows`), and orphaned
--      `image_uploads`; each count is logged with RAISE NOTICE.
--   3. `data_sources.owner_id` SET NOT NULL; `data_sources_owner_id_fkey` and `image_uploads_owner_id_fkey`,
--      both `REFERENCES users(id) ON DELETE CASCADE`. The owner indexes already exist.
--
-- RLS (the reason for the bracket): prod's Flyway role `helio` is the table owner but NOSUPERUSER NOBYPASSRLS, and its
-- connection never sets `app.current_user_id`. Every table below has FORCE ROW LEVEL SECURITY, so without the
-- NO FORCE ... FORCE bracket:
--   data_sources, image_uploads, pipeline_steps  raise 42704 (bare current_setting, fail-loud)
--   pipeline_roots, panels                       show nothing (missing_ok policies, fail-SILENT) -- the guard would
--                                                count zero references and pass vacuously, then delete sources in use
-- Local dev and CI connect as a superuser and would show all of this as green; the migration spec runs it as a
-- NOSUPERUSER NOBYPASSRLS table owner. The V99 zero-root trigger is not the reason for the bracket: its function runs
-- with row_security off since V100. Do not set app.current_user_id here and do not rely on BYPASSRLS.
-- FK validation and RI cascade actions run as the table owner without RLS, so the constraint steps need no bracket.
--
-- Not covered by the guard: `image_uploads` rows deleted here may be referenced by a panel's `image_url` (left
-- dangling, as it is for any deleted upload); storage blobs behind deleted uploads/CSV sources are not removed.
-- The full user-reference inventory and what a `DELETE FROM users` now reaches: docs/user-reference-inventory.md.

ALTER TABLE data_sources NO FORCE ROW LEVEL SECURITY;
ALTER TABLE image_uploads NO FORCE ROW LEVEL SECURITY;
ALTER TABLE pipeline_roots NO FORCE ROW LEVEL SECURITY;
ALTER TABLE pipeline_steps NO FORCE ROW LEVEL SECURITY;
ALTER TABLE panels NO FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  targets          text[];
  root_refs        integer;
  step_refs        integer;
  panel_refs       integer;
  deleted_sources  integer;
  deleted_images   integer;
BEGIN
  SELECT array_agg(ds.id) INTO targets
  FROM data_sources ds
  WHERE ds.owner_id IS NULL OR NOT EXISTS (SELECT 1 FROM users u WHERE u.id = ds.owner_id);

  IF targets IS NOT NULL THEN
    SELECT count(*) INTO root_refs FROM pipeline_roots pr WHERE pr.data_source_id = ANY (targets);

    -- Deliberately conservative text match on the config: a false positive only aborts loudly, never deletes.
    SELECT count(*) INTO step_refs
    FROM pipeline_steps s
    WHERE s.op IN ('join', 'lookup', 'union', 'upsertsource')
      AND EXISTS (SELECT 1 FROM unnest(targets) t WHERE strpos(s.config, t) > 0);

    SELECT count(*) INTO panel_refs
    FROM panels pn
    WHERE pn.kind = 'form' AND pn.form_config ->> 'dataSourceId' = ANY (targets);

    IF COALESCE(root_refs, 0) + COALESCE(step_refs, 0) + COALESCE(panel_refs, 0) > 0 THEN
      RAISE EXCEPTION
        'HEL-1347: refusing to delete orphaned data sources that are still referenced (pipeline roots: %, join/lookup/union/upsertsource steps: %, form panels: %); resolve these references, then re-run',
        COALESCE(root_refs, 0), COALESCE(step_refs, 0), COALESCE(panel_refs, 0);
    END IF;

    DELETE FROM data_sources WHERE id = ANY (targets);
    GET DIAGNOSTICS deleted_sources = ROW_COUNT;
  ELSE
    deleted_sources := 0;
  END IF;
  RAISE NOTICE 'HEL-1347: deleted % orphaned or ownerless data_sources rows (dataset_rows cascade)', deleted_sources;

  DELETE FROM image_uploads iu WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = iu.owner_id);
  GET DIAGNOSTICS deleted_images = ROW_COUNT;
  RAISE NOTICE 'HEL-1347: deleted % orphaned image_uploads rows', deleted_images;
END $$;

ALTER TABLE data_sources ALTER COLUMN owner_id SET NOT NULL;
ALTER TABLE data_sources
  ADD CONSTRAINT data_sources_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE;
ALTER TABLE image_uploads
  ADD CONSTRAINT image_uploads_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES users (id) ON DELETE CASCADE;

ALTER TABLE panels FORCE ROW LEVEL SECURITY;
ALTER TABLE pipeline_steps FORCE ROW LEVEL SECURITY;
ALTER TABLE pipeline_roots FORCE ROW LEVEL SECURITY;
ALTER TABLE image_uploads FORCE ROW LEVEL SECURITY;
ALTER TABLE data_sources FORCE ROW LEVEL SECURITY;
