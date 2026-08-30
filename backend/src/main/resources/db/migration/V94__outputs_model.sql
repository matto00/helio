-- HEL-904: Outputs model + migration (P1.1 of the Pipelines & Outputs
-- remodel, HEL-903). See design.md decisions 1-2 for the sequencing/
-- single-file rationale: this migration file is grown across the ticket's
-- execution and is NOT yet complete -- it currently contains only the
-- additive schema steps (ticket.md scope items 1-7). The destructive
-- pieces (binary_refs/alert_rules/alert_events data retarget + old-column
-- drops, the full 9-step data-migration DML, and the DROP of
-- metrics/data_types/data_type_rows/pipelines.output_data_type_id) land in
-- a later cycle's edit to this SAME file, per decision 2 ("migration is one
-- Flyway file, not split across several" -- data-migration step order is a
-- strict dependency chain that would half-apply if split). Nothing in this
-- file has been applied to any persisted (non-ephemeral-test) database yet.
--
-- Safe to land standalone: every statement below is additive (new tables,
-- nullable/backfilled columns) or a same-shape backfill that does not touch
-- any existing column an existing consumer reads. No existing repository/
-- service code path is rewired by this migration -- that is section 3's job.

-- ── 1. pipeline_steps.parent_step_id (ticket.md scope item 1) ───────────────
--
-- NULL = child of the source root. Backfilled from today's `position` order
-- so every existing pipeline becomes a pure trunk: each step's parent is the
-- step immediately before it in position order (or NULL for position 0).
-- `position` itself is NOT reset or touched -- PipelineStepRepository still
-- reads/orders by it (`list`, `insert*`) until the DB-backed tree-ordered
-- reads land (task 1.6's deferred remainder); there is no
-- UNIQUE(pipeline_id, position), so resetting it here would risk silently
-- reordering pipelines the still-linear engine reads.

ALTER TABLE pipeline_steps ADD COLUMN parent_step_id TEXT NULL REFERENCES pipeline_steps(id);

UPDATE pipeline_steps AS child
SET parent_step_id = parent.id
FROM pipeline_steps AS parent
WHERE parent.pipeline_id = child.pipeline_id
  AND parent.position = child.position - 1;

CREATE INDEX idx_pipeline_steps_parent_step_id ON pipeline_steps(parent_step_id);

-- ── 2. outputs (ticket.md scope item 2) ──────────────────────────────────────
--
-- An Output is a panel-bindable projection of a single pipeline node
-- (pipeline_id + node_step_id, NULL node_step_id = the pipeline's raw
-- source). Sharing-aware RLS mirroring `pipelines` (V39
-- helio_can_access_pipeline) -- an Output is visible to anyone who can see
-- its parent pipeline, not just the pipeline owner (unlike `pipeline_steps`,
-- which is owner-only per V35 -- see design.md's RLS decision).

CREATE TABLE outputs (
    id            TEXT PRIMARY KEY,
    pipeline_id   TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
    node_step_id  TEXT NULL REFERENCES pipeline_steps(id) ON DELETE CASCADE,
    owner_id      UUID NOT NULL REFERENCES users(id),
    name          TEXT NOT NULL,
    kind          TEXT NOT NULL CHECK (kind IN ('metric', 'chart', 'table', 'collection', 'timeline', 'markdown')),
    config        JSONB NOT NULL DEFAULT '{}'::jsonb,
    schema        JSONB NOT NULL DEFAULT '[]'::jsonb,
    position      INT NOT NULL DEFAULT 0,
    tag           TEXT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_outputs_pipeline_id ON outputs(pipeline_id);
CREATE INDEX idx_outputs_node_step_id ON outputs(node_step_id);
CREATE INDEX idx_outputs_owner_id ON outputs(owner_id);

ALTER TABLE outputs ENABLE ROW LEVEL SECURITY;
ALTER TABLE outputs FORCE ROW LEVEL SECURITY;

CREATE POLICY outputs_select ON outputs
  FOR SELECT
  USING (helio_can_access_pipeline(pipeline_id));

CREATE POLICY outputs_insert ON outputs
  FOR INSERT
  WITH CHECK (owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY outputs_update ON outputs
  FOR UPDATE
  USING (owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

CREATE POLICY outputs_delete ON outputs
  FOR DELETE
  USING (owner_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- ── 3. node_snapshots (ticket.md scope item 3) ──────────────────────────────
--
-- Replaces `data_type_rows` (V29): today's per-DataType row snapshot,
-- re-keyed by (pipeline_id, node_step_id). Replace-per-run, latest only --
-- no run_id, same retention as today. RLS mirrors `outputs` (sharing-aware
-- via the parent pipeline), not `data_type_rows`'s owner-only V35 policy.
--
-- No FK from pipeline_id/node_step_id -> pipelines/pipeline_steps --
-- matching the existing `data_type_rows` precedent exactly (V46's own
-- comment: "matching the existing data_type_rows precedent (V29)"). This is
-- not just precedent-following: verified empirically this cycle that a real
-- FK here breaks a real thing -- `node_snapshots` has a BIGSERIAL identity
-- column, and Postgres's `TRUNCATE ... RESTART IDENTITY CASCADE` (used by
-- several existing specs, e.g. `BetaAccessRoutesSpec`, to truncate `users`
-- between tests) transitively cascades through any FK-reachable table and
-- then requires *ownership* of that table's identity sequence to restart it
-- -- a privilege `helio_privileged`'s GRANT-based setup (UPDATE only, not
-- ownership) does not satisfy, and cannot satisfy via GRANT alone. `outputs`
-- has no identity column so it does not hit this landmine even though it
-- does carry a real FK; `node_snapshots` would, so it stays FK-less, exactly
-- like the table it replaces. Referential integrity is instead the
-- application's job (`NodeSnapshotRepository.overwriteRows`'s
-- delete-then-insert contract), same as `data_type_rows` today.

CREATE TABLE node_snapshots (
    id            BIGSERIAL PRIMARY KEY,
    pipeline_id   TEXT NOT NULL,
    node_step_id  TEXT NULL,
    row_index     INT NOT NULL,
    data          JSONB NOT NULL
);

-- A partial-unique-index pair (rather than a single UNIQUE(pipeline_id,
-- node_step_id, row_index)) because Postgres UNIQUE treats NULL as distinct
-- from every other NULL -- two rows with the same (pipeline_id, row_index)
-- and node_step_id IS NULL would NOT collide under a plain UNIQUE
-- constraint, silently allowing duplicate root-node snapshots.
CREATE UNIQUE INDEX idx_node_snapshots_keyed_unique
  ON node_snapshots(pipeline_id, node_step_id, row_index)
  WHERE node_step_id IS NOT NULL;
CREATE UNIQUE INDEX idx_node_snapshots_root_unique
  ON node_snapshots(pipeline_id, row_index)
  WHERE node_step_id IS NULL;

CREATE INDEX idx_node_snapshots_pipeline_id ON node_snapshots(pipeline_id);

ALTER TABLE node_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE node_snapshots FORCE ROW LEVEL SECURITY;

CREATE POLICY node_snapshots_select ON node_snapshots
  FOR SELECT
  USING (helio_can_access_pipeline(pipeline_id));

CREATE POLICY node_snapshots_insert ON node_snapshots
  FOR INSERT
  WITH CHECK (helio_can_access_pipeline(pipeline_id));

CREATE POLICY node_snapshots_update ON node_snapshots
  FOR UPDATE
  USING (helio_can_access_pipeline(pipeline_id));

CREATE POLICY node_snapshots_delete ON node_snapshots
  FOR DELETE
  USING (helio_can_access_pipeline(pipeline_id));

-- ── 4. panels.kind / panels.output_id (ticket.md scope item 4, partial) ────
--
-- `kind` added nullable, backfilled from the existing `type` column, then
-- SET NOT NULL (a bare NOT NULL add fails on a populated table). Backfill
-- rule: the five bound-visualization kinds (metric/chart/table/collection/
-- timeline) always collapse to 'output' -- every row of that `type` is, by
-- construction, bound to a DataType/Metric today. `text` is the one
-- ambiguous case (HEL-... data-bound vs. literal text panel): a `text` row
-- with `type_id` set is data-bound and becomes an 'output' kind; a `text`
-- row with `type_id` NULL is a literal content panel and keeps kind='text'.
-- markdown/image/divider map straight through (content panels, never
-- data-bound).
--
-- `output_id` is added now (nullable FK, CASCADE) but is NOT populated here
-- -- that only happens once real Output rows exist for bound panels, which
-- is task 2.9's data-migration job (deferred to a later cycle's edit of
-- this file). Old panel columns (`type_id`, `field_mapping`, `aggregation`,
-- `metric_id`, etc.) are NOT dropped here -- see the file header note.

ALTER TABLE panels ADD COLUMN kind TEXT NULL;
ALTER TABLE panels ADD COLUMN output_id TEXT NULL REFERENCES outputs(id) ON DELETE CASCADE;

UPDATE panels
SET kind = CASE
  WHEN type IN ('metric', 'chart', 'table', 'collection', 'timeline') THEN 'output'
  WHEN type = 'text' AND type_id IS NOT NULL THEN 'output'
  ELSE type
END;

-- NOT set to NOT NULL yet, despite ticket.md scope item 4's final target
-- shape ("nullable -> backfilled -> SET NOT NULL") -- every current
-- panel-insert code path (PanelRepository, PanelService, proposal-apply
-- paths) does not populate `kind` at all, since section 3.6 (which rewires
-- the Panel domain model to always carry it) has not landed yet. Verified
-- empirically this cycle: adding `SET NOT NULL` here immediately 500s every
-- existing panel-creation code path (confirmed via a full `sbt test` run --
-- 11 spec failures, all panel/proposal-apply INSERTs violating the NOT NULL
-- constraint) -- exactly the "nothing existing breaks" violation design.md
-- decision 1b rules out for this stage of the ticket. `SET NOT NULL` moves
-- to land in the SAME commit as task 3.6's Panel-model rewire, once every
-- write path is guaranteed to populate it.
ALTER TABLE panels ADD CONSTRAINT panels_kind_check CHECK (kind IS NULL OR kind IN ('output', 'text', 'markdown', 'image', 'divider'));

CREATE INDEX idx_panels_output_id ON panels(output_id);

-- ── 5. data_sources.inferred_schema (ticket.md scope item 5) ────────────────
--
-- Nullable JSONB, defaulted to an empty array so every pre-existing row
-- reads back as `Vector.empty` (matches the domain model's default added in
-- task 1.3) without a backfill pass -- companion-type-derived schema
-- population is task 2.9's job (deferred), not a mechanical default.

ALTER TABLE data_sources ADD COLUMN inferred_schema JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ── 6. alert_rules / alert_events target_output_id (ticket.md scope item 6,
--       task 2.7) ────────────────────────────────────────────────────────────
--
-- Added nullable alongside the existing `target_data_type_id` -- same
-- additive-first shape as every other column in this file so far. The
-- actual retarget (populating `target_output_id` from each rule's current
-- `target_data_type_id`'s Outputs) is task 2.9's DML; dropping
-- `target_data_type_id` and its NOT NULL/FK-to-data_types shape is task
-- 2.10's job, which per design.md decision 1e cannot land before section
-- 3/4's consumer rewires (`AlertRuleService`/`AlertEvaluationService`,
-- task 3.1) are complete. `AlertEvaluationService.evaluateForDataType`
-- still reads `target_data_type_id` today -- unchanged by this file.

ALTER TABLE alert_rules ADD COLUMN target_output_id TEXT NULL REFERENCES outputs(id) ON DELETE CASCADE;
CREATE INDEX idx_alert_rules_target_output_id ON alert_rules(target_output_id);

ALTER TABLE alert_events ADD COLUMN target_output_id TEXT NULL REFERENCES outputs(id) ON DELETE CASCADE;
CREATE INDEX idx_alert_events_target_output_id ON alert_events(target_output_id);

-- ── 7. binary_refs re-key prep (ticket.md scope item 7, task 2.8) ───────────
--
-- ticket.md's default target shape is `data_type_id` -> `data_source_id`
-- ("binary refs belong to uploaded source content"), with an explicit
-- fallback instruction: "confirm by inspecting the dev DB that no ref
-- points at a pipeline-output type -- if any do, key those by
-- (pipeline_id, node_step_id) instead and say so in the PR."
--
-- Inspected the shared dev DB (2026-08-30, one live `binary_refs` row):
-- the row's `data_type_id` resolves to a `data_types` row that IS a
-- pipeline's `output_data_type_id` (a pipeline-output type), not a
-- companion type reachable only via `data_sources`. This is also the only
-- write path in the codebase today -- `PipelineRunService.scala:650` is the
-- SOLE caller of `BinaryRefRepository.overwriteForDataType`, and it always
-- writes keyed by `outputDataTypeId` (a pipeline's produced type).
-- `DataSourceService`/`ContentSourceSupport` construct `BinaryRefType`
-- *field values* for companion-type rows but never call
-- `overwriteForDataType` themselves -- there is no companion-type writer
-- to re-key against `data_source_id` at all.
--
-- Per the ticket's own fallback: key by (pipeline_id, node_step_id)
-- instead of data_source_id. Both columns added nullable alongside the
-- existing `data_type_id` (additive-first, same as scope item 6 above);
-- populating them and dropping `data_type_id` + its RLS policy (which
-- selects from `data_types` and would otherwise block `DROP TABLE
-- data_types`) are deferred to tasks 2.9/2.10 respectively, alongside
-- `BinaryRefRepository`'s rewire (task 3.4).

ALTER TABLE binary_refs ADD COLUMN pipeline_id TEXT NULL REFERENCES pipelines(id) ON DELETE CASCADE;
ALTER TABLE binary_refs ADD COLUMN node_step_id TEXT NULL REFERENCES pipeline_steps(id) ON DELETE CASCADE;
CREATE INDEX idx_binary_refs_pipeline_node ON binary_refs(pipeline_id, node_step_id);
