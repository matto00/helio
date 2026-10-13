-- HEL-1434: a transactional deletion queue so a stored object (local file / GCS object) is removed whenever the
-- row that referenced it is deleted, by ANY path -- including the `ON DELETE CASCADE` from `users` (V119), V119's
-- one-time orphan cleanup and raw SQL, none of which pass through application code.
--
-- WHY A TRIGGER QUEUE. The cascade happens inside Postgres, so only the database sees every delete. An
-- AFTER DELETE row trigger on `image_uploads` and on `data_sources` writes the deleted row's storage key into
-- `stored_object_deletions` in the SAME transaction: a rolled-back delete enqueues nothing, a committed one cannot lose
-- its key. The queue holds exactly keys of rows that WERE deleted, so it can never name an in-flight upload (a fresh
-- UUID key whose row either exists or never existed). A drain on the scheduler tick (StoredObjectDeletionService)
-- deletes the objects and dequeues; it re-checks that no surviving row still references the key first.
--
-- KEYS. `image_uploads.storage_key`; for a `data_sources` row of kind csv/text/pdf/image,
-- COALESCE(NULLIF(config->>'path',''), NULLIF(config->>'filePath','')). The `filePath` fallback is required: the csv
-- codec still reads a legacy HEL-237 `filePath` key that no migration renamed. Other kinds enqueue nothing.
--
-- RLS. `data_sources`/`image_uploads` are FORCE ROW LEVEL SECURITY and prod's runtime/Flyway role is NOSUPERUSER
-- NOBYPASSRLS. The trigger must enqueue both for an RLS-bound app session (app.current_user_id set) and for a cascade
-- from `DELETE FROM users` (unset). The queue table is ENABLE + FORCE RLS with NO policy, so only a BYPASSRLS role can
-- touch it; the trigger functions are SECURITY DEFINER, pinned search_path and row_security = off, and re-owned to
-- `helio_privileged` (BYPASSRLS) with V100/V122's exact bracket (transient CREATE on the schema, ALTER FUNCTION ...
-- OWNER TO, revoke), plus explicit idempotent grants. The queue is never exposed by any route.
--
-- ENABLE ALWAYS (V99/V122 precedent): the triggers also fire under `session_replication_role = replica`.
-- Known gaps (design.md): TRUNCATE fires no row trigger.
--
-- NEVER EDIT THIS FILE once applied anywhere (Flyway checksums comments; the dev database is shared by every worktree).

CREATE TABLE stored_object_deletions (
  id              BIGSERIAL    PRIMARY KEY,
  storage_key     TEXT         NOT NULL,
  source_table    TEXT         NOT NULL,
  enqueued_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  attempts        INTEGER      NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ  NULL,
  claimed_at      TIMESTAMPTZ  NULL
);

ALTER TABLE stored_object_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE stored_object_deletions FORCE ROW LEVEL SECURITY;
-- Deliberately NO policy: only helio_privileged (BYPASSRLS) and the definer triggers can read or write the queue.

CREATE OR REPLACE FUNCTION hel1434_enqueue_image_upload_object() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
AS $$
BEGIN
  INSERT INTO stored_object_deletions (storage_key, source_table) VALUES (OLD.storage_key, 'image_uploads');
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION hel1434_enqueue_data_source_object() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
AS $$
DECLARE
  key TEXT;
BEGIN
  IF OLD.source_type IN ('csv', 'text', 'pdf', 'image') THEN
    key := COALESCE(NULLIF(OLD.config ->> 'path', ''), NULLIF(OLD.config ->> 'filePath', ''));
    IF key IS NOT NULL THEN
      INSERT INTO stored_object_deletions (storage_key, source_table) VALUES (key, 'data_sources');
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

GRANT CREATE ON SCHEMA public TO helio_privileged;

ALTER FUNCTION hel1434_enqueue_image_upload_object() OWNER TO helio_privileged;
ALTER FUNCTION hel1434_enqueue_data_source_object() OWNER TO helio_privileged;

REVOKE CREATE ON SCHEMA public FROM helio_privileged;

GRANT SELECT, INSERT, UPDATE, DELETE ON stored_object_deletions TO helio_privileged;
GRANT USAGE, SELECT ON SEQUENCE stored_object_deletions_id_seq TO helio_privileged;
GRANT SELECT ON image_uploads, data_sources TO helio_privileged;

CREATE TRIGGER hel1434_image_upload_object_trigger
  AFTER DELETE ON image_uploads
  FOR EACH ROW
  EXECUTE FUNCTION hel1434_enqueue_image_upload_object();

CREATE TRIGGER hel1434_data_source_object_trigger
  AFTER DELETE ON data_sources
  FOR EACH ROW
  EXECUTE FUNCTION hel1434_enqueue_data_source_object();

ALTER TABLE image_uploads ENABLE ALWAYS TRIGGER hel1434_image_upload_object_trigger;
ALTER TABLE data_sources ENABLE ALWAYS TRIGGER hel1434_data_source_object_trigger;
