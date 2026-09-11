-- HEL-1074 (v0.8 Interactive Data & Write-Back, "Migration A"): rename `static`
-- data_sources to `dataset`, add the declared-schema column, and move the row
-- payload off `data_sources.config` into a dedicated `dataset_rows` table.
--
-- See design.md (openspec/changes/migration-a-dataset-rows/design.md) for the
-- full decision record; this file implements Decisions 1-5 verbatim, in the
-- order those decisions require (constraint drop BEFORE the UPDATE; backfill
-- BEFORE clearing `config`; FORCE restored only after the whole backfill has
-- landed).
--
-- `data_sources` carries FORCE ROW LEVEL SECURITY (V35) and its owner policy
-- reads `current_setting('app.current_user_id')` WITHOUT `missing_ok`, which
-- raises SQLSTATE 42704 when unset -- exactly the failure that broke three
-- prior production deploys (HEL-943; see V94/V96's own headers). The
-- established fix, used by both V94 (section 0/22) and V96, is to bracket
-- every statement below that touches `data_sources` with `NO FORCE` / `FORCE
-- ROW LEVEL SECURITY` so the table owner (Flyway's `helio` role) can write
-- without needing `app.current_user_id` set. `dataset_rows` itself is created
-- with RLS `ENABLE`d but NOT `FORCE`d until its own backfill (this migration's
-- own INSERTs, run as the table owner) has completed -- mirroring V94's
-- "create new tables without FORCE, apply FORCE at the very end" pattern.

-- ── 1. `dataset_rows` table + RLS (not yet FORCEd) ──────────────────────────
--
-- `id`/`data_source_id` are TEXT, matching `data_sources.id`'s actual TEXT PK
-- type (V4) -- the v0.8 spec's "UUID PK" was wrong (design.md Decision 1).
-- `UNIQUE (data_source_id, seq)` costs nothing here and HEL-1077's future
-- append concurrency will need it.

CREATE TABLE dataset_rows (
    id             TEXT        NOT NULL PRIMARY KEY,
    data_source_id TEXT        NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
    seq            BIGINT      NOT NULL,
    data           JSONB       NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL,
    UNIQUE (data_source_id, seq)
);

CREATE INDEX idx_dataset_rows_data_source_id ON dataset_rows(data_source_id, seq);

ALTER TABLE dataset_rows ENABLE ROW LEVEL SECURITY;

-- Owner-scoped through the owning `data_sources` row -- mirrors
-- `data_sources_owner` (V35) exactly, joined rather than duplicated, since
-- `dataset_rows` carries no `owner_id` column of its own. A `data_sources` row
-- with `owner_id IS NULL` correctly makes every comparison NULL/false, so its
-- rows are invisible to any non-privileged caller (design.md Decision 8) --
-- the existing, already-documented posture for every owner-scoped table in
-- this codebase (V35's own header), not a new policy invented here.
CREATE POLICY dataset_rows_owner ON dataset_rows
  USING (
    EXISTS (
      SELECT 1 FROM data_sources ds
      WHERE ds.id = dataset_rows.data_source_id
        AND ds.owner_id = current_setting('app.current_user_id')::uuid
    )
  );

-- ── 2. `dataset_schema` column (nullable, backfilled below) ────────────────

ALTER TABLE data_sources ADD COLUMN dataset_schema JSONB NULL;

-- ── 3. Migration-context bracket (HEL-943 pattern, V94/V96) ─────────────────

ALTER TABLE data_sources NO FORCE ROW LEVEL SECURITY;

-- ── 4. Backfill `dataset_rows` from `data_sources.config` for `static` rows ─
--
-- `data` is the row's JSON array value, copied VERBATIM (positional, not
-- object-keyed -- design.md Decision 3, round 2): this is an exact,
-- lossless copy of what `config->'rows'[i]` already held, with zero
-- reconstruction ambiguity. `seq` comes from `WITH ORDINALITY` (matches
-- V96's own idiom for preserving JSONB array order), 0-based via `- 1` so it
-- lines up with the 0-based row/column indexing every reader already uses.
-- `COALESCE(config->'rows', '[]'::jsonb)` covers a source whose `config =
-- '{}'` (the pre-existing rename-wipes-rows state, `DataSourceRepository
-- .update`'s `case _: StaticSource => "{}"`, round-2 finding) by inserting
-- zero rows for it, not erroring.

INSERT INTO dataset_rows (id, data_source_id, seq, data, created_at, updated_at)
SELECT gen_random_uuid()::text, ds.id, elem.ord - 1, elem.value, ds.created_at, ds.updated_at
FROM data_sources ds,
     jsonb_array_elements(COALESCE(ds.config -> 'rows', '[]'::jsonb)) WITH ORDINALITY AS elem(value, ord)
WHERE ds.source_type = 'static';

-- ── 5. In-migration content-level parity guard (design.md Decision 2 step 2)─
--
-- Exact positional-array equality (`IS NOT DISTINCT FROM`), not merely a row
-- count -- round 2 found a count-only guard insufficient once byte-for-byte
-- fidelity matters (the positional-array shape from Decision 3 makes this an
-- exact-equality check). Aborts the whole migration transaction (via
-- RAISE EXCEPTION, uncaught, inside a DO block) on any mismatch, which is
-- also the stated precondition for clearing `config` in step 8 below.

DO $$
DECLARE
  mismatched_id TEXT;
BEGIN
  SELECT ds.id INTO mismatched_id
  FROM data_sources ds
  WHERE ds.source_type = 'static'
    AND (
      SELECT COALESCE(jsonb_agg(dr.data ORDER BY dr.seq), '[]'::jsonb)
      FROM dataset_rows dr
      WHERE dr.data_source_id = ds.id
    ) IS DISTINCT FROM COALESCE(ds.config -> 'rows', '[]'::jsonb)
  LIMIT 1;

  IF mismatched_id IS NOT NULL THEN
    RAISE EXCEPTION 'HEL-1074: dataset_rows backfill parity check failed for data_sources.id=%', mismatched_id;
  END IF;
END $$;

-- ── 6. Backfill `dataset_schema` from the declared `columns` (design.md
--       Decision 3: NOT `inferred_schema` -- declared and runtime types
--       diverge in the real fixture, and Spark needs the declared type) ─────
--
-- `COALESCE(config->'columns', '[]'::jsonb)` guarantees a non-null
-- `dataset_schema` even for a `config = '{}'` source.

UPDATE data_sources ds
SET dataset_schema = COALESCE(ds.config -> 'columns', '[]'::jsonb)
WHERE ds.source_type = 'static';

-- ── 7. Constraint drop BEFORE the UPDATE (design.md Decision 5) ─────────────
--
-- The existing constraint does not accept 'dataset', so it must be dropped
-- before the UPDATE runs, and the new constraint (accepting 'dataset', not
-- 'static') re-added only after the UPDATE completes.

ALTER TABLE data_sources DROP CONSTRAINT data_sources_source_type_check;

UPDATE data_sources
SET source_type = 'dataset'
WHERE source_type = 'static';

ALTER TABLE data_sources
  ADD CONSTRAINT data_sources_source_type_check
  CHECK (source_type IN ('rest_api', 'csv', 'dataset', 'sql', 'text', 'pdf', 'image'));

-- ── 8. Clear `config` for migrated rows (design.md Decision 4) ──────────────
--
-- Gated on step 5's parity check having already passed for every migrated
-- row above (this migration is one transaction; if step 5 raised, execution
-- never reaches here at all).

UPDATE data_sources
SET config = '{}'::jsonb
WHERE source_type = 'dataset';

-- ── 9. Restore FORCE on `data_sources`, then apply it to `dataset_rows` for
--       the first time (design.md Decision 1, sections B/C) ────────────────

ALTER TABLE data_sources FORCE ROW LEVEL SECURITY;
ALTER TABLE dataset_rows FORCE ROW LEVEL SECURITY;
