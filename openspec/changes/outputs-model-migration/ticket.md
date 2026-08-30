# HEL-904: P1.1 — Outputs model + migration: outputs, node_snapshots, parent_step_id; drop data_types + metrics

## Description

Row **P1.1** of the Pipelines & Outputs remodel (HEL-903). Spec (SOURCE OF TRUTH,
wins over this ticket wherever they disagree): `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md`
— sections *Concept model*, *Data model & migration*, *Authorization & RLS*, *Retirements*,
decisions 1, 2, 4, 9, 11, 13, 17.

Today a pipeline mints exactly one `DataType` at creation
(`backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineRepository.scala:208-238`),
panels bind to it via `panels.type_id` + `field_mapping` (+ optional `metric_id`, V76),
every source auto-creates a companion type (`DataSourceService.upsertSourceDataType`,
and a second upsert in `SourceService`), and `metrics` (V75) name a measure over a type.
This ticket replaces all of that with **Outputs** attached to pipeline nodes and **Panels**
as placements — and deletes the retired structures outright (decision 11: no shims, no
`@deprecated`, no dual-read paths).

**Delivery strategy (decision 17):** P-tickets merge to `main` sequentially; no release
tag is cut until P1.7. The backend must compile and `sbt test` must be green at the end
of this ticket, which means every consumer of the deleted repositories/services is deleted
or rewired *here* (~78 backend files referencing them, including routes, `Main.scala`,
and `DemoData`). New Output routes come in P1.3; this ticket only removes. The web app is
knowingly non-functional on `main` from P1.3 until P1.6; the Concertino UI gate is **N/A
for this row** (backend-only).

## Scope

### Flyway migration (V94 or next available)

1. `pipeline_steps`: add `parent_step_id TEXT NULL REFERENCES pipeline_steps(id)` (NULL =
   child of the source root). No `ON DELETE CASCADE` — deletion splices (repository
   semantics below). Backfill `parent_step_id` from today's `position` order so every
   existing pipeline is a pure trunk. Do NOT reset `position` — reads still order by it
   until the tree-ordered read lands in the same ticket; there is no
   `UNIQUE(pipeline_id, position)` and the linear engine (`PipelineStepRepository.scala:43,150`
   sort by `position`) would silently reorder steps. New semantics: `position` = sibling
   order among children of the same parent; for a migrated trunk that is the existing
   sequence, unchanged.
2. New `outputs`: `id, pipeline_id (FK CASCADE), node_step_id (FK CASCADE, NULL = root),
   owner_id, name, kind, config JSONB, schema JSONB, position, tag, created_at, updated_at`.
   `kind ∈ {metric, chart, table, collection, timeline, markdown}`. RLS: sharing-aware,
   mirroring `pipelines` (V39 `helio_can_access_pipeline`) — not `pipeline_steps`, which is
   owner-only (V35).
3. New `node_snapshots`: today's `data_type_rows` (V29, one row per record, overwritten per
   run) re-keyed by `(pipeline_id, node_step_id NULL-able)`. Replace-per-run, latest only —
   no `run_id`, same retention as today. RLS mirrors `outputs`.
4. `panels`: add `kind TEXT` (`output | text | markdown | image | divider`) as nullable,
   backfill it from `type` for every row, then `SET NOT NULL` (a bare `NOT NULL` add fails
   on a populated table); add `output_id TEXT NULL REFERENCES outputs(id) ON DELETE CASCADE`.
   Drop `type, type_id, field_mapping, aggregation, metric_id, metric_label, metric_unit,
   chart_options, collection_options, timeline_options, column_widths, table_density,
   column_order, chart_annotation` (verify the full current column list against
   `PanelRepository.scala:348-387` / `PanelRowMapper.scala` before writing the migration —
   `table_display_config` does NOT exist). Content panels keep `content`, `image_*`,
   `divider_*`.
5. `data_sources`: add `inferred_schema JSONB`.
6. `alert_rules` (V60): `target_data_type_id` → `target_output_id TEXT NOT NULL REFERENCES
   outputs(id) ON DELETE CASCADE`; `alert_events` (V61) follows. An alert targets an Output
   and is evaluated against that Output's node snapshot; the rule's `measureField`/conditions
   are unchanged.
7. `binary_refs` (V46): re-key `data_type_id` → `data_source_id` (binary refs belong to
   uploaded source content; confirm by inspecting the dev DB that no ref points at a
   pipeline-output type — if any do, key those by `(pipeline_id, node_step_id)` instead and
   say so in the PR). Rewrite its RLS policy body (`V46:37-41` selects from `data_types`,
   which would block the DROP).
8. Computed fields (`data_types.computed_fields`, V12): each computed field on a
   pipeline-output type becomes a `compute` step appended to the end of that pipeline's
   trunk (before any tail); computed fields on companion types become a `compute` step
   inserted at the head of every pipeline reading that source (count in the dev DB first;
   if zero, say so and skip). The `computed_fields` concept is deleted.
9. Patch-set journal: entries whose target kind is `dataType` or `metric`
   (`patch-set.schema.json:68`, `PatchSetProtocol.scala:60,125`) are deleted by the
   migration (single user, decision 11); the persisted enum loses those values.
10. Data moves, in order: (a) companion types → `data_sources.inferred_schema`, companion
    rows deleted; (b) each bound panel → an Output on its pipeline's last trunk step (root
    if zero steps), `kind = panel.type` (data-bound `text` panels become `markdown` Outputs;
    literal text/markdown/image/divider panels become content panels), `config` lifted
    from the dropped columns, `name = panel.title`; if the panel had HEL-292 `aggregation`
    or a `metric_id`, create a tail (`aggregate`, or `groupBy` + `aggregate`, with
    `parent_step_id` = last trunk step, `position` = next free sibling index) and attach
    the Output there, carrying the metric's `format` into `config.format`; panel →
    `output_id`, `kind = output`. While lifting `fieldMapping`, drop any key that is not a
    valid slot for the kind and log it (HEL-892 AC 6 — prod has panels bound with
    `{"x","y"}`; P1.3's strict validation must not brick them on read); (c) unbound data
    panels (no `type_id`; DemoData seeds four, `PanelRowMapper.scala:15-18`) are deleted,
    count logged; (d) every remaining pipeline-output type with no panel → one `table`
    Output named after the type on the last trunk step (decision 9); (e) `data_type_rows`
    → `node_snapshots` under the last trunk step; migration-created tails get no snapshot
    (decision 13); (f) alert rules → `target_output_id` = the lowest-position Output on the
    rule's type's node (all Outputs on a node share rows); (g) drop `metrics`, `data_types`,
    `data_type_rows`, `pipelines.output_data_type_id`.

### Domain, repositories, services — delete every consumer

* `domain/model/model.scala`: remove `DataType`, `DataField`-on-type, `ComputedField`,
  `MetricDefinition`, `MetricUsage*`, `MetricFormat`, `DataTypeId`, `MetricId`; add
  `Output`, `OutputId`, `OutputKind`, `NodeRef` (root | step id); `Pipeline` loses
  `outputDataTypeId`; `DataSource` gains `inferredSchema: Vector[SchemaField]`; `AlertRule`
  gains `targetOutputId`.
* `domain/model/PipelineStep.scala`: add `parentStepId: Option[PipelineStepId]`.
* `domain/model/Panel.scala` + `domain/panels/*Panel.scala` + `package.scala`'s
  `dataTypeIdFormat`: bound kinds (`MetricPanel`, `ChartPanel`, `TablePanel`,
  `CollectionPanel`, `TimelinePanel`, data-bound `TextPanel`/`MarkdownPanel`) collapse to
  `OutputPanel(outputId, title, appearance)`; content kinds unchanged. `PanelBindingSpec`
  becomes `OutputBindingSpec` keyed by `OutputKind` (same slot/eligibility logic) —
  consumed by P1.3's capabilities-at-node.
* New `OutputRepository`, `NodeSnapshotRepository` (replacing `DataTypeRowRepository`);
  `PipelineStepRepository` gains tree-ordered reads (`trunkOf`, `childrenOf`, `tailsOf`;
  `list` returns trunk order by walking `parent_step_id` so the still-linear engine is
  unaffected), sibling-scoped `insert`/`insertAtInternal`/`reorderInternal` (`:70,166,220-245`
  are pipeline-scoped today), and splice-on-delete: deleting a step re-parents its
  position-0 child to the deleted step's parent and deletes its other children (tails) and
  any Outputs on them; returns the placement count removed so P1.3 can warn.
* `PipelineRepository.create` no longer mints a type; `PipelineService.create` drops
  `outputDataTypeName`.
* Alerts: `AlertRuleService` (`:18,56` takes `DataTypeRepository`) validates
  `targetOutputId` via `OutputRepository`; `AlertEvaluationService.evaluateForDataType`
  (`:96`) becomes `evaluateForOutput`, invoked from the run path
  (`PipelineRunService.scala:649`) for every Output of every materialized node.
* Delete: `DataTypeRepository`, `DataTypeRowRepository`, `DataTypeService`,
  `MetricRepository`, `MetricService`, `api/protocols/pipelines/DataTypeProtocol`,
  `api/protocols/metrics/*`, `DataTypeRoutes` (incl. `GET /api/types/:id/panel-capabilities`,
  `/validate-expression`, `/assertion-status` — P1.3 re-adds the last two on Outputs),
  `MetricRoutes`, their wiring in `ApiRoutes.scala` (`:267,699,702,747`) and `Main.scala`,
  `DataSourceService.upsertSourceDataType` and `SourceService`'s upsert +
  `CreateSourceEnvelope` (both replaced by `upsertInferredSchema` writing
  `data_sources.inferred_schema`), `BoundPanelService` (whole file),
  `PanelServiceHelpers.withMaterializedMetric`, `PanelService` binding resolution
  (`:103-179`, `:139,175`), `WorkspaceSearchService`'s DataType/Metric composition
  (`:30,32`; searches Outputs instead), `WorkspaceTeardownRepository`'s
  `resourceKind = "data_type"` branch (`:32,121-179`; teardown covers Outputs via their
  pipeline), `DashboardContentsService` (`:36,41,61` → Outputs), `AssistantToolExecutor`
  (`:149-167` → Outputs), `ExpressionEvaluator`'s type-bound entry points,
  `PatchSetApplyService` (`:51-75`) and the other patch-set files' `dataType` targets,
  `BinaryRefRepository` (`:31,49,56` re-keyed), `DemoData` (reseed: one source → one
  pipeline → three Outputs, no unbound panels), the backend specs for all of the above
  (absorbs HEL-654 — `MetricRoutesSpec`, `PanelMetricBindingRoutesSpec`,
  `MetricRepositorySpec` are deleted, not split).
* `RlsPolicyGuardSpec` gains `outputs` and `node_snapshots` and loses `data_types`,
  `data_type_rows`, `metrics` (`:57,60,78`); HEL-842 has already added `audit_events` +
  `connector_credentials`.
* Split the pipeline service files while they are open (absorbs HEL-689) —
  behaviour-preserving apart from the changes above. Do NOT touch
  `WorkspaceContextService.asNumeric`'s single-exit-filter structure or its
  `BigDecimal.setScale` rounding (HEL-631's caution, settled after four HEL-373 rounds);
  moving code is fine, altering it is not.
* Contracts this ticket MUST own to keep the pre-commit gate green: `.husky/pre-commit`
  runs `check:schemas`, which requires every schema title under `schemas/` to resolve to a
  case class under `api/protocols/**`, and `scripts/check-schema-drift.mjs:205` hard-exits
  if `PanelType.fromString` has fewer than 8 arms. Deleting `MetricProtocol`/`DataTypeProtocol`
  and collapsing the panel kinds therefore breaks the gate unless the same commit also:
  deletes `schemas/metrics/` and `schemas/data-types/` (moving `data-type-assertion-status`
  to `schemas/outputs/output-assertion-status.schema.json` now, so the contract is not
  lost), reshapes `schemas/panels/panel.schema.json` + `create-panel-request` + batch
  request/response schemas to the placement model (`kind`/`outputId`) and deletes
  `bound-panel-request/response`, `panel-capabilities-response`, `panel-query`,
  re-targets `schemas/alerts/*` to `targetOutputId`, updates `scripts/check-schema-drift.mjs`
  (and its hardcoded file list, `:20-32`) for the new `OutputKind`/panel-kind set, and
  updates the OpenSpec specs those schemas back. P1.3 then adds the Output request/response
  schemas and the single-call `create-pipeline-request`; it does not delete. `check:schemas`,
  `check-schema-drift.mjs`, `check:openspec` green at the end of this ticket.
* OpenSpec: every capability spec under `openspec/specs/` that defines
  DataType/Metric/companion-type/`panel-capabilities`/`assertion-status`-on-types behaviour
  is deleted or rewritten here (this ticket owns the backend-facing ones, P1.3 the
  contract-facing ones, P1.5/P1.6 the UI ones). `check:openspec` and
  `check:openspec:selftest` green.

Absorbed tickets (substance is AC here): HEL-689, HEL-615, HEL-864, HEL-642, HEL-654, and
the backend halves of HEL-631 (caution only) and HEL-892 (AC 6).

## Acceptance criteria

- [ ] Backend compiles and `sbt test` is green at the end of this ticket — proven by CI on
  the PR, not asserted.
- [ ] Red-first migration test against a fixture produced by `pg_dump --data-only` of the
  local dev DB (`DATABASE_URL` in `backend/.env`; 285 types / 533 dashboards, richer than
  prod) restricted to the affected tables. The fixture must contain, and the test must
  assert on: every panel kind; ≥ 1 panel with HEL-292 `aggregation`; ≥ 1 panel with
  `metric_id`; ≥ 1 data-bound text panel; ≥ 1 unbound data panel; ≥ 1 orphan output type;
  ≥ 1 companion type; ≥ 1 computed field; ≥ 1 alert rule; ≥ 1 binary ref; ≥ 1 panel with an
  invalid `fieldMapping` slot. If the dev DB lacks any of these, the test seeds it.
  Assertions: panel count = bound + content panels (unbound deleted, count matches the
  log), every `kind = output` panel resolves `output → node → pipeline`, one tail per
  aggregation/metric panel with the expected step config, invalid slots dropped and
  logged, alert rules resolve to an Output on the right node, row-for-row `node_snapshots`
  equality with the pre-migration `data_type_rows`. The test fails against the
  pre-migration schema (proof), then passes.
- [ ] Step order preserved: for every migrated pipeline, `trunkOf` returns the steps in
  the exact pre-migration `position` order; a test seeds a 5-step pipeline, migrates, and
  compares.
- [ ] RLS smoke with a real mechanism: the test connects as (or `SET ROLE`s to) a
  non-superuser, non-`BYPASSRLS` role created by the test setup, proves owner read /
  grantee read / other-tenant denial on `outputs` and `node_snapshots`, and proves itself
  red by temporarily dropping a policy (the dev/CI parity gap means a superuser test is
  vacuous).
- [ ] Splice-on-delete test: deleting a mid-trunk step re-links its child; deleting a step
  with a tail deletes the tail and its Outputs; the returned placement count is correct.
  Sibling-scoped insert/reorder tests.
- [ ] `grep -rn "com\.helio\..*DataType\|DataTypeId\|DataTypeRepository\|DataTypeService\|MetricDefinition\|MetricId\|MetricRepository\|MetricService\|output_data_type_id\|data_type_rows\|computed_fields" backend/src`
  returns nothing except migration files (`spark/SparkJobSubmitter.scala` imports Spark
  SQL's own `org.apache.spark.sql.types.DataType` — not a hit, stays); `grep -rn
  "DataType\|Metric" openspec/specs` returns nothing except specs P1.3/P1.5/P1.6
  explicitly own (list them in the PR). No `@deprecated`, alias, or compatibility shim
  anywhere.
- [ ] `check:scala-quality` clean; no inline FQNs (CONTRIBUTING.md).

## Out of scope

New Output routes and the new Output/create-pipeline schemas (P1.3), helio-mcp (P1.4),
frontend (P1.5+). Schema/OpenSpec deletions and reshapes needed to keep the gate green are
in scope here (see Contracts above). The engine still runs the trunk linearly (via
`trunkOf`) until P1.2; migration-created tails are inert until then — expected, stated in
the PR. The frontend still calls `/api/types` after this merges and is non-functional
until P1.6 (decision 17).

## Dependencies

Blocked by HEL-330 (`PipelineExecutionBackend` extraction, MERGED) and HEL-842
(`RlsPolicyGuardSpec` audit_events/connector_credentials, MERGED). Blocks P1.2 (HEL-905).

## Orchestrator run parameters (not part of ticket content — operational notes)

- Agent-merge ENABLED: after PR creation, spawn concertino-auditor; merge on green CI
  yourself (squash-merge after `gh pr checks` reaches terminal state). Never
  `gh pr merge --auto`. NOTE: `check-merge-readiness.sh` may false-positive on the SKIPPED
  Dependabot-only `label-update-type` workflow — verify with
  `gh pr view --json statusCheckRollup` before treating a SKIPPED check as blocking.
- Models: executor=sonnet, evaluator=opus, skeptic=opus, auditor=sonnet (pass `model`
  explicitly on every Agent spawn).
- Weight review gates heavily given size/irreversibility: prefer an extra design round
  over a fast start; skeptic must verify the migration against a real database (forward
  migration AND every data-preservation path), not just by reading SQL.
- ESCALATE (do not guess) on: a data-loss risk with no clean migration path, a spec
  ambiguity about what a deletion should do to existing user data, or a decision expensive
  to reverse after merge.
- Shared dev Postgres DB across worktrees: if `flyway_schema_history` looks poisoned by
  another branch's migration, diagnose that before assuming this change is broken. Do not
  leave the shared dev DB in a state that breaks other branches.
