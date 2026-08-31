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
--
-- HEL-904 binding ruling (2026-08-31, from the human user directly, not a
-- design-gate round -- see design.md's "position renumbering ruling"
-- decision for the full writeup): `position` is NOT left untouched anymore.
-- The narrower, correct constraint is: chain ORDER is carried by
-- `parent_step_id`, never by the raw `position` number, so `position` is
-- free to be renumbered WITHIN a sibling group as long as it does not
-- change WHICH step is whose parent/child. Immediately below, every
-- non-root step (still a pure one-child-per-parent chain at this point --
-- no tail has been attached yet) is renumbered to `position = 0`, which is
-- exactly what "the position-0 child is the trunk continuation" requires:
-- the OLD linear positions (0, 1, 2, ... N inherited from the pre-migration
-- index) told `trunkOf` nothing about trunk-vs-tail once a tail could be
-- attached at any node, and left every trunk step's position ambiguous
-- with a tail's the moment migration-created tails were added at
-- position >= 1 later in this file. Renumbering here, once, up front, before
-- any tail exists, makes every trunk step's position exactly 0 and leaves
-- every migration-created tail (position >= 1, forced explicitly at each of
-- this file's attachment sites) unambiguous relative to it --
-- `PipelineStepRepository.trunkOf` is updated in the same commit to require
-- an EXACT `position = 0` match (not merely "lowest position among
-- siblings") so this distinction is actually load-bearing.

ALTER TABLE pipeline_steps ADD COLUMN parent_step_id TEXT NULL REFERENCES pipeline_steps(id);

UPDATE pipeline_steps AS child
SET parent_step_id = parent.id
FROM pipeline_steps AS parent
WHERE parent.pipeline_id = child.pipeline_id
  AND parent.position = child.position - 1;

CREATE INDEX idx_pipeline_steps_parent_step_id ON pipeline_steps(parent_step_id);

-- Normalize EVERY step's `position` to 0 (see the ruling above) -- root
-- steps included, not only non-root ones: real dev data confirms
-- pipelines whose original linear index starts at 1, not 0 (a root step
-- with parent_step_id IS NULL but position = 1), so a root step cannot be
-- assumed to already sit at position 0 pre-migration. At this point every
-- step is still the SOLE child of its parent (pure linear trunk, one step
-- per generation -- no tail has been attached yet, and each pipeline has
-- exactly one root), so this UPDATE cannot collide two siblings onto the
-- same position; it only disambiguates trunk-vs-tail for the
-- tail-attachment DML later in this file. Step ORDER is unaffected -- it
-- is carried by `parent_step_id`, set immediately above, not by this
-- value.
UPDATE pipeline_steps
SET position = 0;

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
-- `markdown` follows the identical text/type_id rule (a data-bound markdown
-- row also collapses to 'output'; a literal one keeps kind='markdown') --
-- only `image`/`divider` map straight through unconditionally (content
-- panels, never data-bound).
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
  WHEN type IN ('text', 'markdown') AND type_id IS NOT NULL THEN 'output'
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

-- Task 3.4 (`BinaryRefRepository` rewire): the moment its writer
-- (`PipelineRunService.onUnblockedRunSuccess`) stopped populating the
-- legacy `data_type_id` column, every new write started failing outright
-- against V46's original `NOT NULL` constraint on that column -- caught by
-- a full `sbt test` run, same class of gap as `panels.kind`/
-- `target_data_type_id` above. Relaxed here, same additive-relaxation-
-- ahead-of-the-real-drop pattern; the legacy column stays in place,
-- unpopulated by new writes, until task 2.10 drops it alongside the rest of
-- the DataType infrastructure.
ALTER TABLE binary_refs ALTER COLUMN data_type_id DROP NOT NULL;

-- ── 8. Data migration step 2.9(a): companion types -> inferred_schema ──────
--
-- A "companion type" is a `data_types` row that is bound directly to a
-- `data_sources` row (`source_id IS NOT NULL`) and is NOT any pipeline's
-- `output_data_type_id` -- i.e. it exists purely to describe that source's
-- schema, never to carry pipeline-run rows. Ticket.md 2.9(a): fold each
-- companion type's `fields` (`DataField {name, displayName, dataType,
-- nullable}`, JSON-encoded TEXT) into its owning `data_sources` row's new
-- `inferred_schema` column, in the domain's `SchemaField {name, type}`
-- shape (`PipelineAnalyzeService.SchemaField`, NOT `DataField` -- these are
-- different wire shapes, `type` <- `DataField.dataType`), then delete the
-- companion row. A `data_types` row that IS a pipeline's output type is
-- left completely untouched here -- that is step 2.9(b)-(d)'s job.
--
-- `jsonb_array_elements(...) WITH ORDINALITY` + `jsonb_agg(... ORDER BY
-- ord)` preserves the original field order (no reason to assume `fields`
-- is already order-stable through a bare `jsonb_agg`).

-- `hel904_migration_counts` is created here (rather than at section 10,
-- where it originally first appeared) because this section is now also a
-- destructive step that needs to log a count: the pre-existing
-- `alert_rules.target_data_type_id`/`alert_events` FK to `data_types` is
-- `ON DELETE CASCADE` (verified against the live V93 schema), so the
-- `DELETE FROM data_types` below silently cascade-deletes any alert
-- rule/event pointing at a companion type. Every other destructive step in
-- this file logs a count here; this one previously didn't.
CREATE TABLE hel904_migration_counts (
  step  TEXT PRIMARY KEY,
  count INT NOT NULL
);

INSERT INTO hel904_migration_counts (step, count)
SELECT 'alert_rules_cascade_deleted_companion_type', count(*)
FROM alert_rules ar
JOIN data_types dt ON dt.id = ar.target_data_type_id
WHERE dt.source_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM pipelines p WHERE p.output_data_type_id = dt.id);

UPDATE data_sources ds
SET inferred_schema = agg.schema
FROM (
  SELECT dt.source_id AS source_id,
         jsonb_agg(
           jsonb_build_object('name', elem.value ->> 'name', 'type', elem.value ->> 'dataType')
           ORDER BY elem.ord
         ) AS schema
  FROM data_types dt,
       LATERAL jsonb_array_elements(dt.fields::jsonb) WITH ORDINALITY AS elem(value, ord)
  WHERE dt.source_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM pipelines p WHERE p.output_data_type_id = dt.id)
  GROUP BY dt.source_id
) agg
WHERE agg.source_id = ds.id;

DELETE FROM data_types dt
WHERE dt.source_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM pipelines p WHERE p.output_data_type_id = dt.id);

-- ── 9. Data migration step 2.9(b): bound panels -> Outputs ──────────────────
--
-- Every panel bound to a pipeline-output type (`type IN (metric, chart,
-- table, collection, timeline)`, or `type IN ('text', 'markdown') AND type_id IS NOT NULL`)
-- becomes an `outputs` row on its pipeline's LAST TRUNK STEP (root, i.e.
-- `node_step_id IS NULL`, if the pipeline has zero steps). A data-bound
-- `text` OR `markdown` panel's Output kind is `markdown` (`outputs.kind`
-- has no `text` value, and design.md explicitly folds both into the
-- `markdown` Output kind -- "today's data-bound text AND markdown panels",
-- `TextPanel` carries dataTypeId/fieldMapping "exactly like" MarkdownPanel);
-- every other kind maps straight through.
--
-- **`panels.aggregation` (HEL-292) shape, resolved empirically this cycle**
-- (not guessed) by querying every non-null value in the shared dev DB
-- (`SELECT id, type, aggregation FROM panels WHERE aggregation IS NOT NULL
-- OR metric_id IS NOT NULL`, 14 live rows, 2026-08-30): the blob is
-- consistently one of exactly two shapes, keyed by panel `type`:
--   - `metric`/`collection`: `{"agg": <fn>, "value": <fieldName>}`
--   - `chart`: `{"agg": <fn>, "yField": <fieldName>, "groupBy": <fieldName>}`
-- (`timeline` never carries `aggregation` in the live data -- not handled
-- here; would fall through to the no-aggregation path if it ever did).
-- This is a DIFFERENT shape from the pipeline engine's `AggregateStep.
-- AggregateConfig` (`backend/.../domain/steps/AggregateStep.scala`):
-- `{"groupBy":[{"name","type"}],"aggregations":[{"alias","fn","field"}]}`.
-- Translation used here: the aggregated column's `alias` is the SAME NAME
-- as the source field (`value`/`yField`) -- not a synthesized name -- so
-- that the panel's already-recorded `field_mapping` (which names that exact
-- field, e.g. `{"value":"profit"}`) continues to resolve correctly against
-- the tail step's OUTPUT rows without any field_mapping rewrite. `groupBy`
-- entries' `type` hint is set to `'string'` unconditionally: confirmed by
-- reading `AggregateStep.apply` that the engine only ever compares group
-- keys by raw value (`groupByFields.map(name => row.getOrElse(name, null))`)
-- -- `AggregateField.type` is documented in its own scaladoc as "informational
-- only", never read by the engine, so a fixed placeholder cannot cause a
-- behavioral difference.
--
-- **`metric_id` (HEL-292 `metrics` table) takes priority over the panel's
-- own `aggregation` blob when both are present** -- confirmed against a
-- real dev-DB row (a chart panel with both a `metric_id` AND its own
-- `aggregation`, whose `metrics.measure_field` differs from the panel's own
-- `yField`) that `metrics` is the newer, authoritative source once set: the
-- tail's `aggregations[0]` is built from `metrics.measure_field` (alias AND
-- field) + `metrics.aggregation` (fn), and `metrics.format` is carried into
-- the new Output's `config.format`. The panel's own `aggregation.groupBy`
-- (chart's x-axis grouping -- `metrics` has no groupBy concept of its own)
-- is still honored for the tail's `groupBy` array in this case, since it is
-- an orthogonal axis-binding concern, not part of "which measure to
-- aggregate".
--
-- Tail step: appended as a new sibling-scoped child of the last trunk step
-- (or of the root if the pipeline has zero steps) -- reusing this ticket's
-- own 1.6 sibling-scoping semantics (`position` = next free index among
-- steps sharing that `parent_step_id`, scoped by `pipeline_id`). Migration-
-- generated ids are deterministic (`'hel904-tail-' || panel.id` / '
-- 'hel904-output-' || panel.id`) so this DML is idempotent/debuggable and
-- collision-free (`panels.id` is already unique).
--
-- `config` is built from the panel's per-kind dropped columns (ticket.md
-- scope item 4's drop list), plus `fieldMapping` -- filtered to the valid
-- slot set for the panel's kind (`PanelBindingSpec.allSlots`, HEL-892 AC 6):
-- `metric`/`collection` -> {value, label, unit}; `chart` -> {xAxis, yAxis,
-- series, annotation}; `timeline` -> {time, event}; `table`/data-bound
-- `text` have no fixed slot list (`PanelBindingSpec.Table`'s empty
-- `allSlots`, and data-bound text/markdown is not in `PanelBindingSpec.
-- DataBindable` at all) -- every key is kept unfiltered for those two
-- kinds. Any dropped key is appended to a genuine (non-temporary)
-- `hel904_dropped_field_mapping_slots` audit table -- a session-scoped
-- `TEMPORARY` table would vanish the instant Flyway's own migration
-- connection closes, making it unobservable by anything that runs
-- afterward (including this file's own test suite, which inspects it on a
-- separate connection) -- so a real table is the only shape that actually
-- satisfies HEL-892 AC 6's "log it" requirement. One-time migration
-- artifact; safe to drop once its contents have been reviewed (left for a
-- human/task-2.10 cleanup step, not this migration).

CREATE TABLE hel904_dropped_field_mapping_slots (
  panel_id   TEXT NOT NULL,
  panel_kind TEXT NOT NULL,
  slot_key   TEXT NOT NULL,
  slot_value TEXT NOT NULL,
  logged_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Snapshot every pipeline's last-trunk-step BEFORE any tail steps are
-- inserted below. This must be computed ONCE, up front, not re-derived
-- per-panel inside the loop: once the FIRST aggregation/metric panel on a
-- pipeline appends a tail, that tail becomes the deepest node reachable
-- from the root -- a per-panel recursive walk would then (incorrectly)
-- treat a PRIOR panel's own private aggregate tail as "the trunk" and
-- chain every subsequent panel on that same pipeline behind it, corrupting
-- which node's rows they actually bind to. A real regression, caught by
-- this cycle's own multi-panel-per-pipeline test fixture (not by any
-- single-panel-per-pipeline fixture, which cannot expose this ordering
-- bug at all).
CREATE TEMPORARY TABLE hel904_original_trunk_last (
  pipeline_id  TEXT PRIMARY KEY,
  step_id      TEXT NULL -- NULL = pipeline has zero steps (root)
) ON COMMIT DROP;

INSERT INTO hel904_original_trunk_last (pipeline_id, step_id)
SELECT pl.id, (
  SELECT t.id
  FROM (
    WITH RECURSIVE trunk AS (
      SELECT id, 0 AS depth FROM pipeline_steps
      WHERE pipeline_id = pl.id AND parent_step_id IS NULL
      UNION ALL
      SELECT c.id, tr.depth + 1
      FROM pipeline_steps c
      JOIN trunk tr ON c.parent_step_id = tr.id
    )
    SELECT id, depth FROM trunk ORDER BY depth DESC LIMIT 1
  ) t
)
FROM pipelines pl;

DO $$
DECLARE
  panel_row       RECORD;
  metric_row      RECORD;
  pipeline_row    RECORD;
  trunk_last_id   TEXT;
  target_node_id  TEXT;
  new_step_id     TEXT;
  new_output_id   TEXT;
  next_position   INT;
  out_kind        TEXT;
  valid_slots     TEXT[];
  raw_fm          JSONB;
  filtered_fm     JSONB;
  agg_blob        JSONB;
  agg_fn          TEXT;
  agg_alias       TEXT;
  agg_field       TEXT;
  group_by_field  TEXT;
  step_config     JSONB;
  out_config      JSONB;
  fm_key          TEXT;
  fm_val          JSONB;
BEGIN
  FOR panel_row IN
    SELECT p.id, p.title, p.type, p.type_id, p.owner_id, p.field_mapping, p.aggregation,
           p.metric_id, p.metric_label, p.metric_unit, p.chart_options, p.chart_annotation,
           p.column_widths, p.table_density, p.column_order, p.collection_options,
           p.timeline_options
    FROM panels p
    WHERE p.type IN ('metric', 'chart', 'table', 'collection', 'timeline')
       OR (p.type IN ('text', 'markdown') AND p.type_id IS NOT NULL)
    -- ORDER BY added this cycle (task 2.9 c-h): makes per-node Output
    -- `position` assignment deterministic across runs for panels that share
    -- a target node -- required so step (f) below ("lowest-position Output
    -- on the rule's type's node") resolves to a REPRODUCIBLE Output, not
    -- whatever order Postgres happened to return rows in. Purely additive
    -- to this loop's own behavior (an explicit tie-break where none existed
    -- before, not a change to which Output any panel gets).
    ORDER BY p.id
  LOOP
    -- Resolve the owning pipeline (1:1: each pipeline mints exactly one
    -- output type today, `PipelineRepository.create`).
    SELECT id, owner_id INTO pipeline_row FROM pipelines WHERE output_data_type_id = panel_row.type_id;
    CONTINUE WHEN NOT FOUND;

    -- Last-trunk-step resolution: looked up from the ONE-TIME pre-loop
    -- snapshot above (`hel904_original_trunk_last`), NOT re-walked here --
    -- see that snapshot's own comment for why a per-panel walk would be
    -- wrong once any earlier panel in this same loop has appended a tail.
    SELECT step_id INTO trunk_last_id FROM hel904_original_trunk_last WHERE pipeline_id = pipeline_row.id;

    -- Valid fieldMapping slots per kind (HEL-892 AC 6) -- table/data-bound
    -- text have no fixed slot list, so NULL here means "keep everything".
    valid_slots := CASE panel_row.type
      WHEN 'metric'     THEN ARRAY['value', 'label', 'unit']
      WHEN 'collection' THEN ARRAY['value', 'label', 'unit']
      WHEN 'chart'      THEN ARRAY['xAxis', 'yAxis', 'series', 'annotation']
      WHEN 'timeline'   THEN ARRAY['time', 'event']
      ELSE NULL
    END;

    raw_fm := CASE WHEN panel_row.field_mapping IS NOT NULL THEN panel_row.field_mapping::jsonb ELSE '{}'::jsonb END;
    IF valid_slots IS NULL THEN
      filtered_fm := raw_fm;
    ELSE
      filtered_fm := '{}'::jsonb;
      FOR fm_key, fm_val IN SELECT * FROM jsonb_each(raw_fm) LOOP
        IF fm_key = ANY(valid_slots) THEN
          filtered_fm := filtered_fm || jsonb_build_object(fm_key, fm_val);
        ELSE
          INSERT INTO hel904_dropped_field_mapping_slots(panel_id, panel_kind, slot_key, slot_value)
          VALUES (panel_row.id, panel_row.type, fm_key, fm_val::text);
        END IF;
      END LOOP;
    END IF;

    -- Aggregation/metric tail step (ticket.md 10(b)): only for panels
    -- carrying HEL-292 `aggregation` and/or a `metric_id`. `metric_id`
    -- wins for the measure/fn (see file-header note above); the panel's
    -- own `aggregation.groupBy` (chart axis binding) is honored regardless.
    target_node_id := trunk_last_id;
    out_config := '{}'::jsonb;

    IF panel_row.aggregation IS NOT NULL OR panel_row.metric_id IS NOT NULL THEN
      agg_blob := CASE WHEN panel_row.aggregation IS NOT NULL THEN panel_row.aggregation::jsonb ELSE NULL END;
      group_by_field := NULLIF(agg_blob ->> 'groupBy', '');

      IF panel_row.metric_id IS NOT NULL THEN
        SELECT measure_field, aggregation, format INTO metric_row FROM metrics WHERE id = panel_row.metric_id;
        agg_alias := metric_row.measure_field;
        agg_field := metric_row.measure_field;
        agg_fn    := metric_row.aggregation;
        out_config := out_config || jsonb_build_object('format', metric_row.format);
      ELSE
        agg_fn    := agg_blob ->> 'agg';
        agg_alias := COALESCE(agg_blob ->> 'value', agg_blob ->> 'yField');
        agg_field := agg_alias;
      END IF;

      step_config := jsonb_build_object(
        'groupBy',
          CASE WHEN group_by_field IS NOT NULL
               THEN jsonb_build_array(jsonb_build_object('name', group_by_field, 'type', 'string'))
               ELSE '[]'::jsonb
          END,
        'aggregations', jsonb_build_array(jsonb_build_object('alias', agg_alias, 'fn', agg_fn, 'field', agg_field))
      );

      new_step_id := 'hel904-tail-' || panel_row.id;

      -- This step must land on a TAIL, never the trunk: the trunk/tail
      -- invariant (design spec `pipeline_steps` row; PipelineStepRepository
      -- .trunkOf/.tailsOf) says at most one position-0 child per node is the
      -- trunk continuation, all others (position >= 1) are tails. The
      -- trunk-last step has no existing children, so a bare
      -- `COALESCE(MAX(position)+1, 0)` falls through to 0 and would silently
      -- put this per-panel aggregation on the trunk itself. Force >= 1.
      SELECT GREATEST(COALESCE(MAX(position) + 1, 0), 1) INTO next_position
      FROM pipeline_steps
      WHERE pipeline_id = pipeline_row.id
        AND ((parent_step_id IS NULL AND trunk_last_id IS NULL) OR parent_step_id = trunk_last_id);

      INSERT INTO pipeline_steps (id, pipeline_id, parent_step_id, position, op, config, enabled, created_at, updated_at)
      VALUES (new_step_id, pipeline_row.id, trunk_last_id, next_position, 'aggregate', step_config::text, true, now(), now());

      target_node_id := new_step_id;
    END IF;

    -- Per-kind config, lifted from the dropped columns (ticket.md scope
    -- item 4's drop list), merged with the (possibly slot-filtered)
    -- fieldMapping and (for aggregation/metric panels) `config.format`.
    out_config := out_config || jsonb_strip_nulls(jsonb_build_object(
      'fieldMapping',       filtered_fm,
      'metricLabel',        panel_row.metric_label,
      'metricUnit',         panel_row.metric_unit,
      'columnWidths',       CASE WHEN panel_row.column_widths IS NOT NULL THEN panel_row.column_widths::jsonb END,
      'tableDensity',       panel_row.table_density,
      'columnOrder',        CASE WHEN panel_row.column_order IS NOT NULL THEN panel_row.column_order::jsonb END,
      'chartOptions',       CASE WHEN panel_row.chart_options IS NOT NULL THEN panel_row.chart_options::jsonb END,
      'collectionOptions',  CASE WHEN panel_row.collection_options IS NOT NULL THEN panel_row.collection_options::jsonb END,
      'timelineOptions',    CASE WHEN panel_row.timeline_options IS NOT NULL THEN panel_row.timeline_options::jsonb END,
      'chartAnnotation',    panel_row.chart_annotation
    ));

    out_kind := CASE WHEN panel_row.type IN ('text', 'markdown') THEN 'markdown' ELSE panel_row.type END;
    new_output_id := 'hel904-output-' || panel_row.id;

    SELECT COALESCE(MAX(position) + 1, 0) INTO next_position
    FROM outputs
    WHERE pipeline_id = pipeline_row.id
      AND ((node_step_id IS NULL AND target_node_id IS NULL) OR node_step_id = target_node_id);

    INSERT INTO outputs (id, pipeline_id, node_step_id, owner_id, name, kind, config, position, created_at, updated_at)
    VALUES (new_output_id, pipeline_row.id, target_node_id, pipeline_row.owner_id, panel_row.title, out_kind, out_config, next_position, now(), now());

    UPDATE panels SET output_id = new_output_id, kind = 'output' WHERE id = panel_row.id;
  END LOOP;
END $$;

-- ── 9a. Data migration: binary_refs backfill (task 2.9 remediation) ────────
--
-- Section 7 above added `binary_refs.pipeline_id`/`node_step_id` nullable
-- but never backfilled them for pre-existing rows -- a gap surfaced by
-- cycle 10's own task 3.4 work (BinaryRefRepository re-keyed to read/write
-- exclusively by these new columns) and flagged there rather than fixed,
-- since it needs `hel904_original_trunk_last` (built just above, in section
-- 9) to resolve each ref's node. Fixed here, now that dependency exists.
--
-- Every existing `binary_refs` row is keyed by `data_type_id`, which (per
-- section 7's own dev-DB inspection) always resolves to a pipeline's
-- `output_data_type_id` -- i.e. the pipeline's produced type, which lived on
-- the pipeline's last trunk step at the time this migration ran. Re-key:
-- `pipeline_id` = the owning pipeline, `node_step_id` = that pipeline's
-- ORIGINAL last-trunk-step (NULL for a zero-step pipeline), from the SAME
-- one-time snapshot section 9 uses -- not re-walked here, for the identical
-- reason section 9's own comment gives (a later section may have appended
-- tail steps by the time this runs, which must not affect this resolution).
UPDATE binary_refs br
SET pipeline_id = pl.id,
    node_step_id = htl.step_id
FROM pipelines pl
JOIN hel904_original_trunk_last htl ON htl.pipeline_id = pl.id
WHERE pl.output_data_type_id = br.data_type_id
  AND br.pipeline_id IS NULL;

-- ── 10. Data migration step 2.9(c): unbound / stranded data panels deleted ──
--
-- Originally scoped as "a visualization-kind panel with `type_id IS NULL`
-- was never actually bound to data" (DemoData seeds four such rows --
-- `PanelRowMapper.scala:15-18`'s comment documents this exact shape as an
-- intentionally-tolerated read-path case, not a real binding). Broadened
-- this cycle (evaluation-1.md Critical Path item 1, a real data-loss defect
-- caught on the dev DB) to cover the STRICT SUPERSET this ticket actually
-- needs: any panel section 4 marked `kind = 'output'` that section 9/9a
-- above did NOT resolve to an Output. `type_id IS NULL` is one way that can
-- happen; a NON-NULL `type_id` pointing at a `data_types` row that no
-- pipeline claims (measured: 58 real panels across ~30 dashboards on the
-- shared dev DB -- 77 `data_types` rows have no owning pipeline, see
-- section 13's mirror note below) is the other, and the original predicate
-- silently missed it: those panels kept `kind = 'output'` from section 4
-- forever with `output_id` NULL, a state `OutputPanelConfig` has no
-- representation for. `kind = 'output' AND output_id IS NULL`, evaluated
-- immediately after section 9/9a have had their one chance to populate
-- `output_id`, is the exact predicate for "reached section 4's backfill but
-- was never actually given an Output" -- it is a superset of, and replaces,
-- the original `type_id IS NULL` check (every `type_id IS NULL` visual-kind
-- panel already has `kind = 'output'` from section 4 and `output_id IS
-- NULL` since section 9's loop finds no pipeline for a NULL `type_id`).
-- These have no Output to attach to and are deleted outright; the count is
-- logged to a genuine (non-temporary) audit table for the same
-- observability reason as `hel904_dropped_field_mapping_slots` above -- a
-- session-scoped TEMP table would vanish before this file's own test suite
-- could inspect it.

-- `hel904_migration_counts` was already created back in section 8, since
-- that section also became a destructive step this cycle (see its comment).

INSERT INTO hel904_migration_counts (step, count)
SELECT 'stranded_output_panels_deleted', count(*)
FROM panels
WHERE kind = 'output' AND output_id IS NULL;

DELETE FROM panels
WHERE kind = 'output' AND output_id IS NULL;

-- Fails the migration loudly, instead of silently corrupting a row, if any
-- future write path (or a bug in a later section of this same file) ever
-- again produces a `kind = 'output'` panel with no Output attached --
-- exactly the class of gap this section exists to close.
ALTER TABLE panels
  ADD CONSTRAINT panels_output_kind_requires_output_id
  CHECK (kind IS DISTINCT FROM 'output' OR output_id IS NOT NULL);

-- ── 11. Data migration step 2.9(e): data_type_rows -> node_snapshots ───────
--
-- `data_type_rows` (V29) is always written keyed by a pipeline's OWN output
-- type (`PipelineRunService.scala:640`, the sole writer, always keys by
-- `outputDataTypeId`) -- so every row here maps 1:1 to a pipeline via
-- `pipelines.output_data_type_id`, onto that pipeline's node_snapshots
-- entry for its ORIGINAL last-trunk-step (`hel904_original_trunk_last`,
-- the SAME frozen, pre-loop snapshot used by section 9 above -- this
-- section deliberately runs BEFORE section 12 (task 2.9(g), computed
-- fields) precisely so it reads the untouched original node, never a
-- migration-created tail: decision 13 ("migration-created tails get no
-- snapshot") applies to computed-field compute steps exactly as it does to
-- the aggregate tails in section 9 -- a synthesized node has no real
-- engine-run rows to backfill, and `data_type_rows`'s stored data never
-- included computed-field columns anyway (`computedFields` is confirmed,
-- by grep across `backend/src/main/scala`, to be schema/capability
-- metadata only -- no code path ever evaluates it into row data), so
-- copying it onto the original node is not a lossy simplification, it is
-- an exact, row-for-row-equal copy of what that node's data already was.
--
-- Row-for-row equality (`row_index`, `data`) is preserved by a straight
-- `INSERT ... SELECT` -- no transformation of `data` itself.

INSERT INTO node_snapshots (pipeline_id, node_step_id, row_index, data)
SELECT p.id, htl.step_id, dtr.row_index, dtr.data
FROM data_type_rows dtr
JOIN pipelines p ON p.output_data_type_id = dtr.data_type_id
JOIN hel904_original_trunk_last htl ON htl.pipeline_id = p.id;

-- ── 12. Data migration step 2.9(g) / ticket.md scope item 8: computed
--       fields -> compute steps ───────────────────────────────────────────
--
-- Dev-DB count (2026-08-30): 5 pipeline-output types carry non-empty
-- `computed_fields` (each a single field, e.g. `{"name":"doubled",
-- "displayName":"Doubled","expression":"amount * 2","dataType":"number"}`);
-- 0 companion types do. Per the ticket's own "count first ... if zero, say
-- so and skip" instruction, only the pipeline-output-type case has real
-- DML below. The companion-type case (ticket.md: "inserted at the head of
-- every pipeline reading that source") is a DELIBERATE, DOCUMENTED NO-OP
-- this migration: zero rows exist anywhere to derive or verify a shape
-- against, and inventing one would be exactly the "evidence-shaped
-- non-evidence" this project's own standards warn against.
--
-- SEQUENCING NOTE (honest, not silently left): ticket.md's scope item 8
-- conceptually precedes item 10(a)'s companion-type deletion (section 8
-- above, landed cycle 5) -- a companion type that carried computed fields
-- would need them migrated here BEFORE that DELETE runs. Confirmed
-- empirically (2026-08-30) that zero companion types carry computed
-- fields today, so this ordering gap is real in the general case but
-- inert for the one dataset this migration will ever be applied to;
-- flagged here for whoever next touches this file if that ever changes,
-- rather than silently reordering already-tested section 8 code for a
-- case that cannot currently occur.
--
-- PLACEMENT DECISION (evidence-based, not the literal "ancestor of every
-- tail" reading of ticket.md's "appended to the end of the trunk before
-- any tail"): the new compute step(s) attach as a SIBLING child of the
-- pipeline's ORIGINAL last-trunk-step (`hel904_original_trunk_last`) --
-- the SAME attachment point and sibling-scoped-position pattern as section
-- 9's aggregate tails -- rather than being spliced in as a literal
-- ancestor of any pre-existing tail. Two things make sibling-attachment
-- the correct choice here, not just the simpler one: (1) `computedFields`
-- is confirmed (by grep) to have NEVER been evaluated into row data by any
-- existing code path, so no pre-existing Output/aggregate-tail-config in
-- this same file could possibly already depend on seeing a computed
-- column -- there is no live behavioral requirement for ancestor
-- placement; (2) making this section instead REDEFINE "the pipeline's
-- current last-producing node" for sections 13/14 below (by updating
-- `hel904_original_trunk_last` in place) was tried and rejected: section
-- 9's pre-existing Outputs for a panel-bound pipeline are already
-- committed against the ORIGINAL node, so retargeting "the node" after
-- the fact would make section 14's alert-rule resolution silently miss
-- them (a real, verified contradiction, not a hypothetical) -- keeping
-- "the node" single-valued and frozen for the whole file is what section
-- 9 assumed and section 14 requires; sibling-attachment here preserves
-- that invariant.

DO $$
DECLARE
  cf_row        RECORD;
  cf_elem       RECORD;
  chain_parent  TEXT;
  next_position INT;
  new_step_id   TEXT;
  step_config   JSONB;
  seq           INT;
BEGIN
  FOR cf_row IN
    SELECT dt.id AS data_type_id, p.id AS pipeline_id, dt.computed_fields::jsonb AS fields
    FROM data_types dt
    JOIN pipelines p ON p.output_data_type_id = dt.id
    WHERE dt.computed_fields <> '[]'
    ORDER BY dt.id
  LOOP
    SELECT step_id INTO chain_parent FROM hel904_original_trunk_last WHERE pipeline_id = cf_row.pipeline_id;
    seq := 0;

    FOR cf_elem IN
      SELECT value FROM jsonb_array_elements(cf_row.fields) WITH ORDINALITY AS t(value, ord) ORDER BY ord
    LOOP
      step_config := jsonb_build_object(
        'column', cf_elem.value ->> 'name',
        'expression', cf_elem.value ->> 'expression',
        'type', cf_elem.value ->> 'dataType'
      );
      new_step_id := 'hel904-compute-' || cf_row.data_type_id || '-' || seq;

      -- HEL-904 binding ruling (2026-08-31): the FIRST compute step in this
      -- chain (seq = 0) attaches directly to `chain_parent`, which at that
      -- point is the pipeline's ORIGINAL trunk-last step -- exactly the
      -- same "no existing children" trap section 9's aggregate tail already
      -- guards against. Force it off position 0 (`GREATEST(...,1)`) so
      -- `PipelineStepRepository.trunkOf`'s exact `position = 0` match never
      -- mistakes it for a trunk continuation. Later hops (seq > 0) attach
      -- to a step this SAME migration just created a moment ago, which is
      -- never a real trunk node regardless of its own position -- no guard
      -- needed there, and requiring one would only make the chain harder
      -- to read for no correctness gain.
      SELECT (CASE WHEN seq = 0 THEN GREATEST(COALESCE(MAX(position) + 1, 0), 1)
                   ELSE COALESCE(MAX(position) + 1, 0) END) INTO next_position
      FROM pipeline_steps
      WHERE pipeline_id = cf_row.pipeline_id
        AND ((parent_step_id IS NULL AND chain_parent IS NULL) OR parent_step_id = chain_parent);

      INSERT INTO pipeline_steps (id, pipeline_id, parent_step_id, position, op, config, enabled, created_at, updated_at)
      VALUES (new_step_id, cf_row.pipeline_id, chain_parent, next_position, 'compute', step_config::text, true, now(), now());

      chain_parent := new_step_id;
      seq := seq + 1;
    END LOOP;
  END LOOP;
END $$;

INSERT INTO hel904_migration_counts (step, count)
SELECT 'computed_fields_migrated_pipeline_output', count(*)
FROM data_types dt
JOIN pipelines p ON p.output_data_type_id = dt.id
WHERE dt.computed_fields <> '[]';

INSERT INTO hel904_migration_counts (step, count)
SELECT 'computed_fields_migrated_companion', count(*)
FROM data_types dt
WHERE dt.source_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM pipelines p WHERE p.output_data_type_id = dt.id)
  AND dt.computed_fields <> '[]';

-- ── 13. Data migration step 2.9(d): orphan pipeline-output types -> table
--       Output (decision 9) ────────────────────────────────────────────────
--
-- "Remaining" = a pipeline-output type with no bound panel left after
-- section 9's panel->Output migration (panels' own `type`/`type_id`
-- columns are untouched by section 9 -- only `output_id`/`kind` are set --
-- so this NOT-EXISTS check against `panels` is still meaningful here).
-- Attaches to the pipeline's ORIGINAL last-trunk-step, exactly like every
-- other Output-creating section in this file, so alert-rule resolution
-- (section 14) finds it on the same node as any panel-derived Output for
-- that pipeline would have been.
--
-- Mirror of section 10's fix (evaluation-1.md Critical Path item 1): this
-- INSERT joins `data_types` to `pipelines` on `output_data_type_id`, so a
-- `data_types` row with NO owning pipeline (77 such rows on the dev DB --
-- the same root cause as the 58 stranded panels section 10 now deletes:
-- `source_id IS NULL` companion-shaped rows or pipeline-output types whose
-- owning pipeline was itself deleted) correctly gets no `table` Output
-- here, same as it correctly gets no panel-derived Output in section 9.
-- Logged below (not silently skipped) for the same observability reason as
-- every other count in this file.

INSERT INTO hel904_migration_counts (step, count)
SELECT 'orphan_data_types_no_pipeline_skipped', count(*)
FROM data_types dt
WHERE NOT EXISTS (SELECT 1 FROM pipelines p WHERE p.output_data_type_id = dt.id);

INSERT INTO hel904_migration_counts (step, count)
SELECT 'orphan_output_types_backfilled', count(*)
FROM data_types dt
JOIN pipelines p ON p.output_data_type_id = dt.id
WHERE NOT EXISTS (
  SELECT 1 FROM panels pnl
  WHERE pnl.type_id = dt.id
    AND (pnl.type IN ('metric', 'chart', 'table', 'collection', 'timeline')
         OR (pnl.type IN ('text', 'markdown') AND pnl.type_id IS NOT NULL))
);

DO $$
DECLARE
  orphan_row    RECORD;
  trunk_last_id TEXT;
  next_position INT;
  new_output_id TEXT;
BEGIN
  FOR orphan_row IN
    SELECT dt.id AS data_type_id, dt.name AS type_name, p.id AS pipeline_id, p.owner_id AS owner_id
    FROM data_types dt
    JOIN pipelines p ON p.output_data_type_id = dt.id
    WHERE NOT EXISTS (
      SELECT 1 FROM panels pnl
      WHERE pnl.type_id = dt.id
        AND (pnl.type IN ('metric', 'chart', 'table', 'collection', 'timeline')
             OR (pnl.type IN ('text', 'markdown') AND pnl.type_id IS NOT NULL))
    )
    ORDER BY dt.id
  LOOP
    SELECT step_id INTO trunk_last_id FROM hel904_original_trunk_last WHERE pipeline_id = orphan_row.pipeline_id;

    SELECT COALESCE(MAX(position) + 1, 0) INTO next_position
    FROM outputs
    WHERE pipeline_id = orphan_row.pipeline_id
      AND ((node_step_id IS NULL AND trunk_last_id IS NULL) OR node_step_id = trunk_last_id);

    new_output_id := 'hel904-orphan-output-' || orphan_row.data_type_id;

    INSERT INTO outputs (id, pipeline_id, node_step_id, owner_id, name, kind, position, created_at, updated_at)
    VALUES (new_output_id, orphan_row.pipeline_id, trunk_last_id, orphan_row.owner_id, orphan_row.type_name, 'table', next_position, now(), now());
  END LOOP;
END $$;

-- ── 14. Data migration step 2.9(f): alert rules/events -> target_output_id
--       ────────────────────────────────────────────────────────────────────
--
-- "The rule's type's node" = the pipeline owning `target_data_type_id`'s
-- ORIGINAL last-trunk-step (same frozen snapshot every other section uses).
-- "Lowest-position Output on that node" is resolved with `ROW_NUMBER()
-- ... ORDER BY position ASC` rather than a bare `MIN(position)` subquery so
-- the winning Output's `id` (not just its position) is picked in one pass.
-- `alert_events` follows its own `alert_rule_id`'s resolved
-- `target_output_id` rather than independently re-resolving from its own
-- `target_data_type_id` -- the two columns are expected to always agree
-- (an event is always created against its rule's own target), and
-- following the rule avoids a second, redundant resolution.

WITH rule_node AS (
  SELECT ar.id AS rule_id, p.id AS pipeline_id, htl.step_id AS node_step_id
  FROM alert_rules ar
  JOIN pipelines p ON p.output_data_type_id = ar.target_data_type_id
  JOIN hel904_original_trunk_last htl ON htl.pipeline_id = p.id
),
rule_output AS (
  SELECT rn.rule_id, o.id AS output_id,
         ROW_NUMBER() OVER (PARTITION BY rn.rule_id ORDER BY o.position ASC, o.id ASC) AS rk
  FROM rule_node rn
  JOIN outputs o
    ON o.pipeline_id = rn.pipeline_id
   AND ((o.node_step_id IS NULL AND rn.node_step_id IS NULL) OR o.node_step_id = rn.node_step_id)
)
UPDATE alert_rules ar
SET target_output_id = ro.output_id
FROM rule_output ro
WHERE ar.id = ro.rule_id AND ro.rk = 1;

UPDATE alert_events ae
SET target_output_id = ar.target_output_id
FROM alert_rules ar
WHERE ae.alert_rule_id = ar.id AND ar.target_output_id IS NOT NULL;

-- ── 14a. Data migration: quarantine alert rules/events left with no
--        target_output_id (task 2.9(f) completion) ─────────────────────────
--
-- The retarget above only resolves rules whose `target_data_type_id`
-- both (a) is some pipeline's `output_data_type_id` AND (b) has a
-- resolvable Output on that pipeline's original-trunk-last node. A rule
-- targeting a type with NO owning pipeline (companion type already
-- deleted by section 8's cascade, or -- pre-that-delete -- a type nobody
-- ever wired to a pipeline) falls through with `target_output_id` still
-- NULL. Ticket scope item 6 and the design spec both require
-- `target_output_id NOT NULL`; leaving such a row in place would make it
-- permanently unrepresentable once `target_data_type_id` is dropped
-- (section 20) -- `AlertRuleRepository`/`AlertEventRepository` both throw
-- `IllegalStateException` reading a NULL `target_output_id`. Same
-- destructive-with-a-logged-count pattern as every other DELETE in this
-- file (e.g. section 10's `stranded_output_panels_deleted`).

INSERT INTO hel904_migration_counts (step, count)
SELECT 'alert_rules_deleted_unresolvable_target', count(*)
FROM alert_rules
WHERE target_output_id IS NULL;

INSERT INTO hel904_migration_counts (step, count)
SELECT 'alert_events_deleted_unresolvable_target', count(*)
FROM alert_events
WHERE target_output_id IS NULL;

DELETE FROM alert_events WHERE target_output_id IS NULL;
DELETE FROM alert_rules WHERE target_output_id IS NULL;

ALTER TABLE alert_rules ALTER COLUMN target_output_id SET NOT NULL;
ALTER TABLE alert_events ALTER COLUMN target_output_id SET NOT NULL;

-- ── 15. Patch-set journal cleanup (ticket.md scope item 9) ─────────────────
--
-- `patch_set_applications.edits` is a JSON array of edit-journal entries
-- (`{index, targetKind, op, ...}`, distinct from the wire `EditTarget`
-- shape -- see `PatchSetApplyService.scala:163`). Any entry whose
-- `targetKind` is `dataType` or `metric` is removed from its array; if
-- that empties an application's `edits` entirely, the whole row is
-- deleted (an application with zero surviving edits has nothing left for
-- `/undo` to act on). Dev-DB count (2026-08-30): 0 entries match either
-- kind (all 14 live applications are `panel`/`dashboard` edits) -- unlike
-- section 12's computed-fields case, this DML is fully general/mechanical
-- (not derived from an ambiguous opaque shape), so it is still implemented
-- generically here rather than skipped, per the same "count first" spirit.
-- The app-level `recognizedKinds` enum (`PatchSetProtocol.scala:60`) and
-- `patch-set.schema.json`'s `EditTarget.kind` enum still list `dataType`
-- today -- narrowing those is section 3/4's consumer-rewire job (task
-- 2.10-adjacent, decision 1e), not this migration's.

INSERT INTO hel904_migration_counts (step, count)
SELECT 'patch_set_journal_entries_removed', count(*)
FROM patch_set_applications, jsonb_array_elements(edits) elem
WHERE elem ->> 'targetKind' IN ('dataType', 'metric');

UPDATE patch_set_applications
SET edits = COALESCE(
  (SELECT jsonb_agg(elem) FROM jsonb_array_elements(edits) elem WHERE elem ->> 'targetKind' NOT IN ('dataType', 'metric')),
  '[]'::jsonb
)
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(edits) elem WHERE elem ->> 'targetKind' IN ('dataType', 'metric'));

DELETE FROM patch_set_applications WHERE edits = '[]'::jsonb;

-- ── 15. alert_rules.target_data_type_id relaxed to NULLable (task 3.1) ──────
--
-- Task 3.1 rewires `AlertRuleService`/`AlertEvaluationService` to
-- `targetOutputId` exclusively and removes `AlertRule.targetDataTypeId`
-- from the domain model entirely -- no code path populates this column on
-- INSERT any longer. Every EXISTING row was already backfilled with a
-- `target_output_id` by section 14's DML above, so `target_data_type_id`
-- is now purely legacy-read-only data, kept in place (not dropped -- that
-- is task 2.10's job, still blocked on decision 1e) until the whole
-- DataType/Metric infrastructure comes out together. Relaxing NOT NULL is
-- required now, not deferred to 2.10, because it would otherwise block
-- every new alert-rule INSERT the moment 3.1's code lands (`AlertRuleRow`
-- no longer supplies a value for it) -- same shape as V94's earlier
-- `panels.kind` NOT-NULL deferral (task 3.6's own note, cycle 3).

ALTER TABLE alert_rules ALTER COLUMN target_data_type_id DROP NOT NULL;

ALTER TABLE alert_events ALTER COLUMN target_data_type_id DROP NOT NULL;

-- ── 16. pipelines.output_data_type_id relaxed to NULLable (task 3.5) ────────
--
-- Task 3.5 makes `PipelineRepository.create` stop minting a DataType for
-- every new pipeline (design.md "Output model" -- a pipeline's
-- panel-bindable output is now an explicit Output row, created separately,
-- not an implicit DataType at pipeline-creation time). `pipelines.
-- output_data_type_id` stays in place and readable (task 2.10 / section 4
-- still owns the eventual drop) so every pre-existing pipeline's legacy
-- DataType binding keeps working -- this section only relaxes the NOT NULL
-- constraint so a newly-created pipeline can leave it unset. Same shape as
-- section 15's `alert_rules`/`alert_events` NOT-NULL deferral above.

ALTER TABLE pipelines ALTER COLUMN output_data_type_id DROP NOT NULL;

-- ── 17. panels.kind SET NOT NULL (task 2.10 prerequisite) ───────────────────
--
-- Section 4's `type_id` retirement (task 4.1) already removed every write
-- path that could leave `kind` unset: `PanelRowMapper.domainToRow` now sets
-- `kind` from the panel's own discriminator (`output | text | markdown |
-- image | divider`) on EVERY insert, matching the CHECK constraint added in
-- section 4 above verbatim. Every pre-existing row was already backfilled
-- by that same section. This closes the gap section 4's own comment flagged
-- ("SET NOT NULL deferred to land in the same commit as task 3.6") -- it
-- never actually landed with 3.6, so it lands here, immediately before the
-- `type`/`type_id` columns it fully supersedes are dropped below.

ALTER TABLE panels ALTER COLUMN kind SET NOT NULL;

-- ── 18. Drop `panels`' retired columns (task 2.10) ──────────────────────────
--
-- `type`/`type_id` are the last two of task 2.1's cited column list still
-- read/written by application code (`PanelRowMapper.rowToDomain`'s
-- text/markdown/image/divider dispatch) -- both are now fully superseded by
-- `kind` (section 17 above) and dropped here alongside the twelve columns
-- section 9's per-kind `config` JSON already absorbed the values of
-- (`field_mapping`, `aggregation`, `metric_id`, `metric_label`,
-- `metric_unit`, `chart_options`, `collection_options`, `timeline_options`,
-- `column_widths`, `table_density`, `column_order`, `chart_annotation`) --
-- none of these twelve have been read OR written by any application code
-- since task 3.6/4.1 landed (`PanelRowMapper.domainToRow` always wrote
-- `None`); `hel904_dropped_field_mapping_slots` (section 9) already
-- preserves anything section 9's per-kind config extraction couldn't place.

ALTER TABLE panels
  DROP COLUMN type,
  DROP COLUMN type_id,
  DROP COLUMN field_mapping,
  DROP COLUMN aggregation,
  DROP COLUMN metric_id,
  DROP COLUMN metric_label,
  DROP COLUMN metric_unit,
  DROP COLUMN chart_options,
  DROP COLUMN collection_options,
  DROP COLUMN timeline_options,
  DROP COLUMN column_widths,
  DROP COLUMN table_density,
  DROP COLUMN column_order,
  DROP COLUMN chart_annotation;

-- ── 19. Drop `pipelines.output_data_type_id` (task 2.10) ────────────────────
--
-- Every reader/writer of this column was removed in section 4
-- (`PipelineRepository`/`PipelineRunRepository`'s legacy accessor methods,
-- both dead -- zero production callers survived task 4.1's DataType-service
-- deletion). Section 16 above already relaxed it to NULLable so no new
-- pipeline needed to populate it; this drops it outright.

ALTER TABLE pipelines DROP COLUMN output_data_type_id;

-- ── 20. Drop `alert_rules`/`alert_events.target_data_type_id` (task 2.10) ───
--
-- `alert_rules.target_data_type_id` (V60) FK-references `data_types(id) ON
-- DELETE CASCADE` -- design.md decision 2 is explicit that "alert rules
-- retarget must precede dropping the target_data_type_id FK", and that
-- retarget (section 14's DML onto `target_output_id`) is long done. Dropping
-- the table below would otherwise fail outright ("cannot drop table
-- data_types because other objects depend on it"). Section 3.1 already
-- removed every application-code reader/writer of both columns
-- (`AlertRule`/`AlertRuleRepository`/`AlertEventRepository` are fully
-- `target_output_id`-only) -- dropping the columns outright, not just the
-- FK, mirrors `pipelines.output_data_type_id`'s identical treatment two
-- sections above; `alert_events.target_data_type_id` has no FK but is
-- equally dead, dropped alongside it for the same reason.

ALTER TABLE alert_rules DROP COLUMN target_data_type_id;
ALTER TABLE alert_events DROP COLUMN target_data_type_id;

-- ── 21. Drop `metrics`, `data_type_rows`, `data_types` (task 2.10) ──────────
--
-- Drop order matters: `data_type_rows.data_type_id` and `metrics.data_type_id`
-- both FK-reference `data_types.id`, so the referencing tables must go
-- first. `binary_refs.data_type_id` (V46) is the one other FK into
-- `data_types` -- section 8 already added the replacement
-- `pipeline_id`/`node_step_id` columns and every production write path
-- was re-keyed onto them (task 2.8); the legacy `data_type_id` column
-- itself is dropped here alongside its target table (it was never read by
-- any surviving code path once `data_types` itself is gone).

-- `binary_refs_owner` (V46) is a USING clause keyed on `data_type_id ->
-- data_types.owner_id` -- Postgres refuses to DROP COLUMN/TABLE while a
-- policy still references them, so the policy must be replaced FIRST, with
-- one keyed on the same `pipeline_id`/`helio_can_access_pipeline` pattern
-- as `outputs`/`node_snapshots` above (section 2.3/2.4). Functionally inert
-- either way -- `BinaryRefRepository` is exclusively accessed via
-- `withSystemContext` (privileged bypass, this file's own header note on
-- V46) -- but must stay valid SQL referencing only surviving columns.
DROP POLICY binary_refs_owner ON binary_refs;
CREATE POLICY binary_refs_owner ON binary_refs
  USING (pipeline_id IS NOT NULL AND helio_can_access_pipeline(pipeline_id));

ALTER TABLE binary_refs DROP COLUMN data_type_id;
DROP TABLE metrics;
DROP TABLE data_type_rows;
DROP TABLE data_types;
