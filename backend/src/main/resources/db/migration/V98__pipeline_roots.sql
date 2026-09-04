-- HEL-913: multi-root pipelines — `pipeline_roots` table, replacing
-- `pipelines.source_data_source_id` (a pipeline had exactly one source) with
-- N roots per pipeline, each an independent (data_source_id, position) pair
-- that a trunk of steps can be attached to. See design.md § "Migration V98"
-- for the full derivation; this header restates only what a future reader
-- must not get wrong.
--
-- ── The failure mode this migration is designed against ─────────────────────
--
-- The danger is on the READ SIDE of the backfill, not the write side. V94/
-- V96/V97 all bracket the table they MUTATE, which makes "bracket what you
-- write" look like the pattern — that reading is wrong here. This migration's
-- backfill is `INSERT INTO pipeline_roots SELECT id, source_data_source_id, 0
-- FROM pipelines WHERE ...`: the SELECT reads `pipelines`, a FORCE-RLS table,
-- as the Flyway role (`helio`, non-superuser, NOBYPASSRLS, but the OWNER of
-- every table it created). `pipelines_select` (V39) is
-- `USING (helio_can_access_pipeline(id))`, and that function (V39:38-45)
-- reads `current_setting('app.current_user_id', true)` with `missing_ok =
-- true` and returns FALSE — not an error — when that setting is unset, which
-- it always is on Flyway's own connection. So an un-bracketed read of
-- `pipelines` returns ZERO ROWS, SILENTLY. The INSERT then has nothing to
-- insert, the statement still reports "0 rows affected" as unremarkable
-- success (an INSERT...SELECT with zero source rows is not an error), and a
-- later step in this SAME file drops `pipelines.source_data_source_id` — at
-- which point every pipeline in the database has permanently lost its
-- source, and nothing failed loudly to say so. Local dev, CI and prod-dump
-- replay all connect as superuser, bypass RLS unconditionally, and would
-- show this migration as perfectly green.
--
-- This is a STRICTLY WORSE failure mode than the one that broke the v0.7.9/
-- v0.7.10 deploys (HEL-943, see V94's own header): those failed LOUDLY
-- (42704 / RLS-violation errors that stopped the deploy). A silent, reports-
-- success, superuser-invisible data loss is worse than a loud failure with
-- the exact same root cause (an unbracketed FORCE-RLS table read/write on
-- Flyway's own non-superuser connection).
--
-- ── The bracket: five tables, two different failure reasons ─────────────────
--
-- `pipelines`     — bracketed because it is READ (the trap above). Fails
--                    SILENTLY: `pipelines_select`'s `helio_can_access_pipeline`
--                    uses `missing_ok = true` and returns FALSE on an unset
--                    setting, so an unbracketed read is invisible — no error,
--                    just zero rows.
-- `pipeline_steps`— bracketed because it is WRITTEN (root_id backfill). Fails
--                    LOUDLY: `pipeline_steps_owner` (V35) still uses the bare
--                    `current_setting('app.current_user_id')` form with NO
--                    `missing_ok`, which RAISES (SQLSTATE 42704) on Flyway's
--                    connection rather than silently filtering to zero rows.
-- `outputs`, `node_snapshots`, `binary_refs` — bracketed because they are
--                    WRITTEN (R12 root_id rebind, section below). All three
--                    use the `missing_ok = true` form (like `pipelines`), so
--                    an unbracketed write here fails the same way the v0.7.10
--                    incident did: "new row violates row-level security
--                    policy", not silence, but still a failure this bracket
--                    is what prevents.
--
-- Same bracket mechanism (`NO FORCE` around the mutating transaction,
-- `FORCE` restored at the end — copied from V94:122-131 / V94:1309-1316),
-- two different reasons per table, and the table with the MORE carefully
-- secured policy (`pipelines`, sharing-aware, fail-closed-to-false) is the
-- MORE dangerous one to omit, precisely because omitting it fails silently
-- instead of loudly.

ALTER TABLE pipelines      NO FORCE ROW LEVEL SECURITY;
ALTER TABLE pipeline_steps NO FORCE ROW LEVEL SECURITY;
ALTER TABLE outputs        NO FORCE ROW LEVEL SECURITY;
ALTER TABLE node_snapshots NO FORCE ROW LEVEL SECURITY;
ALTER TABLE binary_refs    NO FORCE ROW LEVEL SECURITY;

-- ── 1. pipeline_roots table ──────────────────────────────────────────────────
--
-- One row per (pipeline, root). `position` orders roots within a pipeline
-- (R3's cross-root tiebreak); `data_source_id` is the root's bound source.
-- No `owner_id` column — ownership is always resolved through the parent
-- pipeline (RLS policies below join through `pipeline_id`), exactly like
-- `pipeline_steps`.

CREATE TABLE pipeline_roots (
    id            TEXT PRIMARY KEY,
    pipeline_id   TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    data_source_id TEXT NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
    position      INTEGER NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (pipeline_id, position)
);

CREATE INDEX idx_pipeline_roots_pipeline_id ON pipeline_roots(pipeline_id);

-- ── 2. Backfill: one root per existing pipeline, position = 0 ───────────────
--
-- Root id is derived deterministically from the pipeline id (rather than a
-- fresh random uuid) so this INSERT is naturally idempotent — a second run
-- of this migration (or of just this DML, task 3.3) always computes the
-- SAME root id for the same pipeline and collides on the primary key /
-- `WHERE NOT EXISTS` guard instead of minting a second root. Using the
-- pipeline's own id (a single root is currently 1:1 with its pipeline) keeps
-- the derivation trivial and legible; a pipeline that later grows a SECOND
-- root (post-migration, via the application) gets a fresh random uuid from
-- the service layer, not this scheme — this scheme exists only to make the
-- backfilled root's id reproducible.

INSERT INTO pipeline_roots (id, pipeline_id, data_source_id, position)
SELECT p.id, p.id, p.source_data_source_id, 0
FROM pipelines p
WHERE NOT EXISTS (
  SELECT 1 FROM pipeline_roots r WHERE r.pipeline_id = p.id
);

-- ── 3. pipeline_steps.root_id ────────────────────────────────────────────────
--
-- Every parentless step (`parent_step_id IS NULL`, i.e. a trunk root today)
-- is attached to its pipeline's (backfilled) root. `CHECK ((parent_step_id
-- IS NULL) = (root_id IS NOT NULL))` is DB-enforced, not just the one-shot
-- guard below (section 6) — without it, a later parentless step written with
-- a NULL root_id (e.g. `POST /api/pipelines/:id/steps`, if it forgot to set
-- one) is invisible to a root-scoped `childrenOf` walk and silently dropped,
-- rather than rejected at write time.

ALTER TABLE pipeline_steps ADD COLUMN root_id TEXT REFERENCES pipeline_roots(id) ON DELETE CASCADE;

UPDATE pipeline_steps
SET root_id = pipeline_id
WHERE parent_step_id IS NULL AND root_id IS NULL;

ALTER TABLE pipeline_steps
  ADD CONSTRAINT pipeline_steps_root_id_matches_parentless
  CHECK ((parent_step_id IS NULL) = (root_id IS NOT NULL));

-- ── 4. R12 rebind: outputs / node_snapshots / binary_refs get root_id ───────
--
-- An Output/snapshot/ref bound to `node_step_id IS NULL` meant "the
-- pipeline's raw source" under the single-root model. Under multi-root that
-- is ambiguous (there is no longer exactly one "the source") — it must name
-- WHICH root. `outputs`/`binary_refs` get a real FK to `pipeline_roots`
-- (`ON DELETE CASCADE`, mirroring their existing FK shape); `node_snapshots`
-- gets a bare `TEXT NULL`, deliberately NOT an FK — an FK there makes
-- `node_snapshots` FK-reachable from `users`, and Postgres's
-- `TRUNCATE ... RESTART IDENTITY CASCADE` (used by twelve existing specs to
-- reset `users` between tests) transitively cascades through any
-- FK-reachable table and then requires OWNERSHIP of that table's identity
-- sequence to restart it — a privilege the non-superuser test role does not
-- have via GRANT alone (V94:261-280 records this exact landmine for the
-- SAME table, empirically). Do not "fix" this asymmetry; it is intentional.

ALTER TABLE outputs        ADD COLUMN root_id TEXT REFERENCES pipeline_roots(id) ON DELETE CASCADE;
ALTER TABLE node_snapshots ADD COLUMN root_id TEXT NULL;
ALTER TABLE binary_refs    ADD COLUMN root_id TEXT REFERENCES pipeline_roots(id) ON DELETE CASCADE;

UPDATE outputs
SET root_id = pipeline_id
WHERE node_step_id IS NULL AND root_id IS NULL;

UPDATE node_snapshots
SET root_id = pipeline_id
WHERE node_step_id IS NULL AND root_id IS NULL;

UPDATE binary_refs
SET root_id = pipeline_id
WHERE node_step_id IS NULL AND root_id IS NULL AND pipeline_id IS NOT NULL;

-- ── 5. Dispose of unrebindable rows BEFORE the CHECK ────────────────────────
--
-- Two populations cannot be rebound by the UPDATEs above because their
-- `pipeline_id` does not resolve to a live root:
--   (a) `node_snapshots` rows whose `pipeline_id` matches no `pipelines` row
--       at all — nothing deletes `node_snapshots` when a pipeline is deleted
--       (only two DELETE sites exist in the app, both scoped to a live
--       pipeline's own node), so stale orphans can and do accumulate.
--   (b) `binary_refs` rows with `pipeline_id IS NULL` — V94:793-797 never
--       rekeyed refs whose owning `data_type_id` had no owning pipeline
--       (V94 section 10 recorded 77 such `data_types`); those `binary_refs`
--       rows were left with `pipeline_id IS NULL` and can never be rebound.
-- Counts are measured and logged (never assumed zero) BEFORE the delete —
-- adding the CHECK first, on a real dump, aborts the deploy on exactly these
-- rows.

CREATE TABLE hel913_migration_counts (
  step  TEXT PRIMARY KEY,
  count INT NOT NULL
);

INSERT INTO hel913_migration_counts (step, count)
SELECT 'node_snapshots_orphaned_no_pipeline_deleted', count(*)
FROM node_snapshots ns
WHERE NOT EXISTS (SELECT 1 FROM pipelines p WHERE p.id = ns.pipeline_id);

DELETE FROM node_snapshots ns
WHERE NOT EXISTS (SELECT 1 FROM pipelines p WHERE p.id = ns.pipeline_id);

INSERT INTO hel913_migration_counts (step, count)
SELECT 'binary_refs_orphaned_null_pipeline_id', count(*)
FROM binary_refs
WHERE pipeline_id IS NULL;

DELETE FROM binary_refs
WHERE pipeline_id IS NULL;

-- ── 6. CHECK: every root-node row (node_step_id IS NULL) now names a root ───

ALTER TABLE outputs
  ADD CONSTRAINT outputs_root_id_matches_node_step_id
  CHECK ((node_step_id IS NULL) <> (root_id IS NULL));

ALTER TABLE node_snapshots
  ADD CONSTRAINT node_snapshots_root_id_matches_node_step_id
  CHECK ((node_step_id IS NULL) <> (root_id IS NULL));

-- Section 5 above already deleted every `pipeline_id IS NULL` binary_refs
-- row, so every surviving row has a real pipeline_id and the same
-- two-state CHECK as `outputs`/`node_snapshots` applies without a
-- pipeline_id escape hatch.
ALTER TABLE binary_refs
  ADD CONSTRAINT binary_refs_root_id_matches_node_step_id
  CHECK ((node_step_id IS NULL) <> (root_id IS NULL));

-- ── 7. node_snapshots unique-index recreate (two roots' row 0 collide) ──────
--
-- `idx_node_snapshots_root_unique` (V94:294-296) was `UNIQUE (pipeline_id,
-- row_index) WHERE node_step_id IS NULL` — correct under one root per
-- pipeline, but under multi-root two different roots' row 0 would collide
-- on the same (pipeline_id, row_index) pair. Recreated keyed by root_id too.
--
-- The COMPLEMENT index, `idx_node_snapshots_keyed_unique` (V94:291-293,
-- `WHERE node_step_id IS NOT NULL`), was checked and is DELIBERATELY left
-- unchanged: a keyed (non-root) node's uniqueness is already scoped by
-- `node_step_id`, which is already root-specific (each step belongs to
-- exactly one root via its own trunk), so no two roots' non-root nodes can
-- ever collide on it. Do not "tidy" it to also include root_id.

DROP INDEX idx_node_snapshots_root_unique;

CREATE UNIQUE INDEX idx_node_snapshots_root_unique
  ON node_snapshots(pipeline_id, root_id, row_index)
  WHERE node_step_id IS NULL;

-- ── 8. Fail loudly if the backfill silently missed anything ─────────────────
--
-- This is the single most important statement in this migration: it converts
-- the "READ returns zero rows, silently" failure mode described at the top
-- into a HARD MIGRATION FAILURE. The section-6 CHECK constraints are NOT a
-- substitute for this — if the bracket were wrong for, say, `pipelines`,
-- section 2's INSERT would silently insert nothing, and every check in
-- section 6 would still pass (vacuously — there would be no rows to
-- violate them). Only an EXPLICIT count-based assertion catches "the
-- backfill ran and touched zero rows it should have touched".
--
-- KNOWN LIMIT (found empirically by a mutation test, `V98PipelineRootsMigrationSpec`, that
-- removed the `pipelines` bracket and ran the resulting script as a genuine non-superuser
-- role): this guard is NOT a complete substitute for the bracket on `pipelines` specifically,
-- because its own `SELECT ... FROM pipelines` below is gated by the SAME RLS state the
-- backfill's read was. If the `pipelines` bracket (section 0) is missing, `pipelines` stays
-- FORCE for the ENTIRE transaction, including this guard — `helio_can_access_pipeline` fails
-- CLOSED-to-false with no context set, so this guard's own COUNT(*) FROM pipelines ALSO sees
-- zero rows, `pipelines_without_root` computes as 0 (not "N pipelines lack a root" but "zero
-- pipelines are visible to check at all"), and the migration reports SUCCESS having silently
-- dropped the real pipeline's source — worse than merely "the guard didn't fire", the guard
-- provides false confidence in exactly the scenario it exists to catch. This is NOT a gap in
-- `pipeline_steps`' coverage (its policy fails LOUD — see the header above — so a missing
-- bracket there raises 42704 long before this guard runs, never reaching this vacuous-pass
-- state) — it is specific to the fail-SILENT tables (`pipelines`, and by the same mechanism
-- `outputs`/`node_snapshots`/`binary_refs`). The actual, necessary backstop for a missing
-- bracket on one of THOSE tables is `FlywayNonSuperuserMigrationSpec` (task 3.1/3.2): its
-- pre-migration pipeline count is captured over a SEPARATE superuser connection, immune to
-- this migration's RLS state entirely, and compared against the post-migration
-- `pipeline_roots` count. That external comparison is where "the bracket is necessary, not
-- decorative" is actually proven for these tables — this guard converts every OTHER failure
-- mode (a real coding mistake in the backfill's WHERE clause, a partial roll-forward, etc.)
-- into a loud one, but a missing bracket on a fail-silent table is the one shape it cannot
-- self-detect by construction.

DO $$
DECLARE
  pipelines_without_root       INT;
  parentless_steps_without_root INT;
  outputs_null_null            INT;
  snapshots_null_null          INT;
  refs_null_null               INT;
BEGIN
  SELECT count(*) INTO pipelines_without_root
  FROM pipelines p
  WHERE NOT EXISTS (SELECT 1 FROM pipeline_roots r WHERE r.pipeline_id = p.id);

  IF pipelines_without_root > 0 THEN
    RAISE EXCEPTION 'HEL-913 V98 guard: % pipeline(s) have no pipeline_roots row after backfill -- the bracket is wrong or the backfill did not run', pipelines_without_root;
  END IF;

  SELECT count(*) INTO parentless_steps_without_root
  FROM pipeline_steps
  WHERE parent_step_id IS NULL AND root_id IS NULL;

  IF parentless_steps_without_root > 0 THEN
    RAISE EXCEPTION 'HEL-913 V98 guard: % parentless pipeline_steps row(s) have no root_id after backfill', parentless_steps_without_root;
  END IF;

  SELECT count(*) INTO outputs_null_null
  FROM outputs WHERE node_step_id IS NULL AND root_id IS NULL;
  IF outputs_null_null > 0 THEN
    RAISE EXCEPTION 'HEL-913 V98 guard: % outputs row(s) have both node_step_id and root_id NULL', outputs_null_null;
  END IF;

  SELECT count(*) INTO snapshots_null_null
  FROM node_snapshots WHERE node_step_id IS NULL AND root_id IS NULL;
  IF snapshots_null_null > 0 THEN
    RAISE EXCEPTION 'HEL-913 V98 guard: % node_snapshots row(s) have both node_step_id and root_id NULL', snapshots_null_null;
  END IF;

  SELECT count(*) INTO refs_null_null
  FROM binary_refs WHERE node_step_id IS NULL AND root_id IS NULL;
  IF refs_null_null > 0 THEN
    RAISE EXCEPTION 'HEL-913 V98 guard: % binary_refs row(s) have both node_step_id and root_id NULL', refs_null_null;
  END IF;
END $$;

-- ── 9. Drop the retired column ───────────────────────────────────────────────
--
-- No deprecation, no alias, no compatibility view (design.md decision 11) —
-- every reader of `pipelines.source_data_source_id` is rewired onto
-- `pipeline_roots` in this same change (§4 Model and persistence).

ALTER TABLE pipelines DROP COLUMN source_data_source_id;

-- ── 10. Restore FORCE ROW LEVEL SECURITY on all five bracketed tables ───────
--
-- Enumerated explicitly, all five — "both tables" (an earlier-cycle mistake
-- on a prior migration, V94's own header notes the same risk) would leave
-- three of these permanently `NO FORCE`, a durable RLS weakening on
-- sharing-aware tables shipped by a migration whose whole thesis is RLS
-- care.

ALTER TABLE pipelines      FORCE ROW LEVEL SECURITY;
ALTER TABLE pipeline_steps FORCE ROW LEVEL SECURITY;
ALTER TABLE outputs        FORCE ROW LEVEL SECURITY;
ALTER TABLE node_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE binary_refs    FORCE ROW LEVEL SECURITY;

-- ── 11. pipeline_roots RLS: per-command policies, enabled AFTER the backfill ─
--
-- A single all-commands sharing-aware policy would be a PRIVILEGE ESCALATION:
-- Postgres reuses a permissive `USING` clause as the `WITH CHECK` for INSERT
-- when none is given, so a grantee of a SHARED pipeline (sharing-aware SELECT
-- via `helio_can_access_pipeline`) could then INSERT/UPDATE/DELETE that
-- pipeline's roots — a write privilege they hold on neither `pipelines` nor
-- `pipeline_steps` today. V39 deliberately split SELECT (sharing-aware) from
-- INSERT/UPDATE/DELETE (owner-only) for exactly this reason; mirrored here.
-- `pipeline_roots` has no `owner_id` column of its own, so owner-only is
-- expressed as a join through `pipelines.owner_id`.

ALTER TABLE pipeline_roots ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_roots FORCE ROW LEVEL SECURITY;

CREATE POLICY pipeline_roots_select ON pipeline_roots
  FOR SELECT
  USING (helio_can_access_pipeline(pipeline_id));

CREATE POLICY pipeline_roots_insert ON pipeline_roots
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM pipelines p
      WHERE p.id = pipeline_roots.pipeline_id
        AND p.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY pipeline_roots_update ON pipeline_roots
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM pipelines p
      WHERE p.id = pipeline_roots.pipeline_id
        AND p.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );

CREATE POLICY pipeline_roots_delete ON pipeline_roots
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM pipelines p
      WHERE p.id = pipeline_roots.pipeline_id
        AND p.owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    )
  );
