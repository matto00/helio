-- HEL-1530: extend HEL-1434's stored-object deletion queue (V128) to the two blob families it left out --
-- `form-uploads/<uuid>.<ext>` objects referenced from `dataset_rows` binary-ref JSON, and the
-- `assistant-conversations/...` transcript behind an `assistant_conversations` row -- plus TRUNCATE, and a `not_before`
-- hold on a queue row so the drain can defer a key still copied into a derived table.
--
-- NO BACKFILL (owner's HEL-1529): nothing is enqueued for a row that exists when this runs; only rows deleted (or
-- updated away, or truncated) AFTER V132 is applied are queued. Historic orphans stay in storage.
--
-- NEW-STYLE QUEUE ROWS. Every row written by a trigger below, by the app (form-submit compensation) or by a deferral has
-- `claimed_at = 'infinity'` permanently and a non-null `not_before`. V128-era claim SQL
-- (`claimed_at IS NULL OR claimed_at < stale`) can never match 'infinity', so an older revision still running during a
-- rolling deploy (whose shared-key guard knows only two tables) can never claim, and so never wrongly delete, one of
-- these rows. The new claim leases them through `lease_until` instead.
--
-- SHAPE (identical to V128): every function is SECURITY DEFINER, `search_path = pg_catalog, public`,
-- `row_security = off`, re-owned to `helio_privileged` (BYPASSRLS) with V100/V122/V128's bracket (transient CREATE on the
-- schema, ALTER FUNCTION ... OWNER TO, revoke), every trigger ENABLE ALWAYS, and NO function has an EXCEPTION block.
--
-- FORM-UPLOAD KEYS. Row JSON is user-writable through the rows API, so the key is extracted with
-- `jsonb_path_query(data, 'lax $.**.storageKey')` (lax mode never raises on any JSONB value), kept only when it is a
-- string matching exactly `form-uploads/<uuid>.<ext>`. Without that regex a user could queue another user's transcript.
--
-- NEVER EDIT THIS FILE once applied anywhere (Flyway checksums comments; the dev database is shared by every worktree).

ALTER TABLE stored_object_deletions ADD COLUMN not_before  TIMESTAMPTZ NULL;
ALTER TABLE stored_object_deletions ADD COLUMN lease_until TIMESTAMPTZ NULL;

-- The drain's shared-key guard looks a key up here.
CREATE INDEX idx_binary_refs_storage_key ON binary_refs (storage_key);

-- ── dataset_rows: statement-level DELETE / UPDATE triggers over transition tables ──────────────────────────────────
-- Statement level (not per row) because deleting a dataset source cascades over every one of its rows. A Postgres
-- trigger with transition tables may name only one event, hence two triggers.

CREATE OR REPLACE FUNCTION hel1530_enqueue_dataset_row_delete() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
AS $$
BEGIN
  INSERT INTO stored_object_deletions (storage_key, source_table, claimed_at, not_before)
  SELECT DISTINCT v #>> '{}', 'dataset_rows', 'infinity'::timestamptz, now()
  FROM old_rows o
  CROSS JOIN LATERAL jsonb_path_query(o.data, 'lax $.**.storageKey') AS v
  WHERE strpos(o.data::text, 'form-uploads/') > 0
    AND jsonb_typeof(v) = 'string'
    AND (v #>> '{}') ~ '^form-uploads/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.[a-z0-9]{1,16}$';
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION hel1530_enqueue_dataset_row_update() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
AS $$
BEGIN
  -- Only rows whose JSON actually changed (or whose id changed, so no new row matches) are walked: an UPDATE that
  -- touches other columns, such as `updated_at`, costs a JSON equality test instead of a path extraction. The
  -- MATERIALIZED CTE keeps the planner from running the extraction before that filter.
  WITH changed AS MATERIALIZED (
    SELECT o.id, o.data
    FROM old_rows o
    LEFT JOIN new_rows nr ON nr.id = o.id
    WHERE (nr.id IS NULL OR o.data IS DISTINCT FROM nr.data)
      AND strpos(o.data::text, 'form-uploads/') > 0
  )
  INSERT INTO stored_object_deletions (storage_key, source_table, claimed_at, not_before)
  SELECT DISTINCT ok.k, 'dataset_rows', 'infinity'::timestamptz, now()
  FROM (
    SELECT c.id, v #>> '{}' AS k
    FROM changed c
    CROSS JOIN LATERAL jsonb_path_query(c.data, 'lax $.**.storageKey') AS v
    WHERE jsonb_typeof(v) = 'string'
      AND (v #>> '{}') ~ '^form-uploads/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.[a-z0-9]{1,16}$'
  ) ok
  WHERE NOT EXISTS (
    SELECT 1
    FROM new_rows n
    CROSS JOIN LATERAL jsonb_path_query(n.data, 'lax $.**.storageKey') AS nv
    WHERE n.id = ok.id
      AND jsonb_typeof(nv) = 'string'
      AND (nv #>> '{}') = ok.k
  );
  RETURN NULL;
END;
$$;

-- ── assistant_conversations: per-row AFTER DELETE ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION hel1530_enqueue_conversation_object() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
AS $$
BEGIN
  IF NULLIF(OLD.gcs_body_ref, '') IS NOT NULL THEN
    INSERT INTO stored_object_deletions (storage_key, source_table, claimed_at, not_before)
    VALUES (OLD.gcs_body_ref, 'assistant_conversations', 'infinity'::timestamptz, now());
  END IF;
  RETURN NULL;
END;
$$;

-- ── TRUNCATE: row triggers never fire, so each owning table queues all its keys BEFORE the truncate ─────────────────
-- Postgres fires these for every table a `TRUNCATE ... CASCADE` reaches; a rolled-back truncate queues nothing.

CREATE OR REPLACE FUNCTION hel1530_truncate_image_uploads() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
AS $$
BEGIN
  INSERT INTO stored_object_deletions (storage_key, source_table, claimed_at, not_before)
  SELECT storage_key, 'image_uploads', 'infinity'::timestamptz, now() FROM image_uploads;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION hel1530_truncate_data_sources() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
AS $$
BEGIN
  INSERT INTO stored_object_deletions (storage_key, source_table, claimed_at, not_before)
  SELECT COALESCE(NULLIF(config ->> 'path', ''), NULLIF(config ->> 'filePath', '')), 'data_sources',
         'infinity'::timestamptz, now()
  FROM data_sources
  WHERE source_type IN ('csv', 'text', 'pdf', 'image')
    AND COALESCE(NULLIF(config ->> 'path', ''), NULLIF(config ->> 'filePath', '')) IS NOT NULL;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION hel1530_truncate_dataset_rows() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
AS $$
BEGIN
  INSERT INTO stored_object_deletions (storage_key, source_table, claimed_at, not_before)
  SELECT DISTINCT v #>> '{}', 'dataset_rows', 'infinity'::timestamptz, now()
  FROM dataset_rows o
  CROSS JOIN LATERAL jsonb_path_query(o.data, 'lax $.**.storageKey') AS v
  WHERE strpos(o.data::text, 'form-uploads/') > 0
    AND jsonb_typeof(v) = 'string'
    AND (v #>> '{}') ~ '^form-uploads/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.[a-z0-9]{1,16}$';
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION hel1530_truncate_conversations() RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = pg_catalog, public
  SET row_security = off
AS $$
BEGIN
  INSERT INTO stored_object_deletions (storage_key, source_table, claimed_at, not_before)
  SELECT gcs_body_ref, 'assistant_conversations', 'infinity'::timestamptz, now()
  FROM assistant_conversations
  WHERE NULLIF(gcs_body_ref, '') IS NOT NULL;
  RETURN NULL;
END;
$$;

GRANT CREATE ON SCHEMA public TO helio_privileged;

ALTER FUNCTION hel1530_enqueue_dataset_row_delete() OWNER TO helio_privileged;
ALTER FUNCTION hel1530_enqueue_dataset_row_update() OWNER TO helio_privileged;
ALTER FUNCTION hel1530_enqueue_conversation_object() OWNER TO helio_privileged;
ALTER FUNCTION hel1530_truncate_image_uploads() OWNER TO helio_privileged;
ALTER FUNCTION hel1530_truncate_data_sources() OWNER TO helio_privileged;
ALTER FUNCTION hel1530_truncate_dataset_rows() OWNER TO helio_privileged;
ALTER FUNCTION hel1530_truncate_conversations() OWNER TO helio_privileged;

REVOKE CREATE ON SCHEMA public FROM helio_privileged;

-- The truncate functions and the drain's guard read these as helio_privileged (idempotent grants).
GRANT SELECT ON image_uploads, data_sources, dataset_rows, assistant_conversations,
                binary_refs, node_snapshots, node_payload_history, alert_events TO helio_privileged;

CREATE TRIGGER hel1530_dataset_row_delete_trigger
  AFTER DELETE ON dataset_rows
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION hel1530_enqueue_dataset_row_delete();

CREATE TRIGGER hel1530_dataset_row_update_trigger
  AFTER UPDATE ON dataset_rows
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION hel1530_enqueue_dataset_row_update();

CREATE TRIGGER hel1530_conversation_object_trigger
  AFTER DELETE ON assistant_conversations
  FOR EACH ROW
  EXECUTE FUNCTION hel1530_enqueue_conversation_object();

CREATE TRIGGER hel1530_image_uploads_truncate_trigger
  BEFORE TRUNCATE ON image_uploads
  FOR EACH STATEMENT
  EXECUTE FUNCTION hel1530_truncate_image_uploads();

CREATE TRIGGER hel1530_data_sources_truncate_trigger
  BEFORE TRUNCATE ON data_sources
  FOR EACH STATEMENT
  EXECUTE FUNCTION hel1530_truncate_data_sources();

CREATE TRIGGER hel1530_dataset_rows_truncate_trigger
  BEFORE TRUNCATE ON dataset_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION hel1530_truncate_dataset_rows();

CREATE TRIGGER hel1530_conversations_truncate_trigger
  BEFORE TRUNCATE ON assistant_conversations
  FOR EACH STATEMENT
  EXECUTE FUNCTION hel1530_truncate_conversations();

ALTER TABLE dataset_rows ENABLE ALWAYS TRIGGER hel1530_dataset_row_delete_trigger;
ALTER TABLE dataset_rows ENABLE ALWAYS TRIGGER hel1530_dataset_row_update_trigger;
ALTER TABLE assistant_conversations ENABLE ALWAYS TRIGGER hel1530_conversation_object_trigger;
ALTER TABLE image_uploads ENABLE ALWAYS TRIGGER hel1530_image_uploads_truncate_trigger;
ALTER TABLE data_sources ENABLE ALWAYS TRIGGER hel1530_data_sources_truncate_trigger;
ALTER TABLE dataset_rows ENABLE ALWAYS TRIGGER hel1530_dataset_rows_truncate_trigger;
ALTER TABLE assistant_conversations ENABLE ALWAYS TRIGGER hel1530_conversations_truncate_trigger;
