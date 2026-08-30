- `backend/src/main/scala/com/helio/domain/model/model.scala` — add `Output`/`OutputId`/`OutputKind`/`NodeRef` (task 1.1), add `AlertRule.targetOutputId` additively (task 1.4)
- `backend/src/main/scala/com/helio/domain/model/DataSource.scala` — add `inferredSchema: Vector[SchemaField]` to the `DataSource` trait and all 7 source subtypes (task 1.3)
- `backend/src/main/scala/com/helio/domain/model/PipelineStep.scala` — add `parentStepId: Option[PipelineStepId]` to the `PipelineStep` trait (task 1.2)
- `backend/src/main/scala/com/helio/domain/steps/*.scala` (23 files) — add `parentStepId: Option[PipelineStepId] = None` to every step-kind case class (task 1.2)
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala` — `rowToDomain`'s 23 constructor calls updated to pass `enabled = row.enabled` by name so the new trailing `parentStepId` param isn't misassigned
- `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineSpec.scala` — add `parentStepId = None` override to an anonymous `PipelineStep` test fixture so it still compiles against the widened trait
- `openspec/changes/outputs-model-migration/tasks.md` — mark tasks 1.1–1.4 done (cycle 1), 1.5/1.6(partial)/1.7(partial) done (cycle 2)
- `openspec/changes/outputs-model-migration/execution-progress.md` — scratch progress/handoff note for the next executor cycle, updated each cycle

## Cycle 2 additions

- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputRepository.scala` — new (task 1.5): `outputs` persistence, mirrors `DataTypeRepository`'s ACL-bypassing-internal pattern (`listByNodeInternal`, `listByPipelineInternal`, `findByIdInternal`, `insertInternal`, `deleteInternal`, `deleteByNodeInternal`). Compiling scaffolding — no `outputs` table exists yet (lands in task 2.3), no runtime DB test yet.
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/NodeSnapshotRepository.scala` — new (task 1.5): `node_snapshots` persistence, mirrors `DataTypeRowRepository`'s overwrite/list-rows pattern, keyed by `(pipeline_id, node_step_id)`. Compiling scaffolding — no `node_snapshots` table exists yet (lands in task 2.4), no runtime DB test yet.
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala` — add `trunkOf`/`childrenOf`/`tailsOf` pure functions over `Vector[PipelineStep]` (task 1.6, partial — DB-backed sibling-scoped insert/reorder/splice-on-delete deferred to task 2.2, see execution-progress.md)
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepositoryTreeOrderingSpec.scala` — new (task 1.7, partial): 8 unit tests for `trunkOf`/`childrenOf`/`tailsOf`, no DB required
- `openspec/changes/outputs-model-migration/files-modified.md` — this file, updated for cycle 2

## Cycle 3 additions (this cycle, task 2 — V94 migration, additive slice)

- `backend/src/main/resources/db/migration/V94__outputs_model.sql` — new: `pipeline_steps.parent_step_id` + position-order backfill (2.2), `outputs` table + sharing-aware RLS (2.3), `node_snapshots` table + RLS (2.4), `panels.kind`/`output_id` with backfill (2.5, `SET NOT NULL` deliberately deferred — see the file's own comment), `data_sources.inferred_schema` default (2.6). Does NOT yet include 2.7 (alert retarget), 2.8 (binary_refs re-key), 2.9 (data migration), or 2.10 (drops) — grows across future cycles per the file's header note.
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/V94OutputsMigrationSpec.scala` — new: red-first migration test (migrate to V93, seed fixture, assert pre-migration absence, migrate to V94, assert backfills), step-order-preservation test (2.12), RLS smoke test on `outputs` using a real non-superuser `SET ROLE` role with a red-then-green policy-drop proof (2.13, partial — `node_snapshots` RLS not yet covered, no writer path populates it yet).
- `openspec/changes/outputs-model-migration/tasks.md` — mark 2.1-2.6, 2.11-2.13 done/partial
- `openspec/changes/outputs-model-migration/execution-progress.md`, `openspec/changes/outputs-model-migration/files-modified.md` — updated for cycle 3

## Cycle 4 additions (this cycle — tasks 2.7/2.8, then the deferred DB-backed remainder of 1.6/1.7)

- `backend/src/main/resources/db/migration/V94__outputs_model.sql` — added `alert_rules`/`alert_events.target_output_id` (nullable FK to `outputs`, task 2.7) and `binary_refs.pipeline_id`/`node_step_id` (nullable, task 2.8) alongside their untouched legacy columns. Records the dev-DB-inspection finding that motivated keying `binary_refs` by `(pipeline_id, node_step_id)` instead of `data_source_id` (the ticket's own documented fallback) — the sole live `binary_refs` row points at a pipeline-output type, and `PipelineRunService` is the only writer, always keyed by a pipeline's output type.
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/V94OutputsMigrationSpec.scala` — added coverage for 2.7 (`target_output_id` nullable, populatable via a real Output FK) and 2.8 (`pipeline_id`/`node_step_id` nullable, populatable).
- `backend/src/test/scala/com/helio/infrastructure/persistence/BinaryRefsMigrationSpec.scala` — updated the hardcoded expected-column-set assertion to include the two new columns (real regression caught by the full `sbt test` run; fixed at the root — the test's own literal set, not the migration).
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepository.scala` — DB-backed remainder of task 1.6: `PipelineStepRow`/`PipelineStepTable` now read/write the real `parent_step_id` column (previously unread — every domain `PipelineStep.parentStepId` silently decoded `None` regardless of the DB value); `rowToDomain` wires it through for all 23 step kinds; new `siblingsQuery` helper scopes `insertInternal`/`insertAtInternal`'s position computation/renumbering to the sibling group sharing `parentStepId` (both gained an optional `parentStepId` param, default `None` preserving today's behavior); `deleteInternal` now performs splice-on-delete (re-parents the deleted step's position-0 child, deletes every other child's full subtree) and changed its return type from `Future[Boolean]` to `Future[Option[Int]]` (`None` = not found, `Some(removedTailStepCount)` on success) to carry the ticket's "returns the placement count removed" requirement.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala` — `deleteStep`'s sole call to `pipelineStepRepo.deleteInternal` updated to match the new `Option[Int]` return shape (behavior-preserving for this caller: only presence/absence is consumed, not the count).
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/PipelineStepRepositorySpliceSpec.scala` — new (task 1.7 DB-backed remainder): 5 tests covering sibling-scoped `insertInternal` position isolation across groups, sibling-scoped `insertAtInternal` splicing without disturbing other groups, splice-on-delete re-parenting (trunk stays connected, proved via `trunkOf`), splice-on-delete's full-subtree tail deletion with the correct removed count, and the not-found `None` case.
- `openspec/changes/outputs-model-migration/tasks.md` — mark 2.7/2.8 done (partial: schema-only, DML deferred to 2.9/2.10), 1.6/1.7 fully done (DB-backed remainder landed).
- `openspec/changes/outputs-model-migration/execution-progress.md`, `openspec/changes/outputs-model-migration/files-modified.md` — updated for cycle 4.

## Cycle 5 additions (this cycle — task 2.9 step (a) only: companion types → inferred_schema)

- `backend/src/main/resources/db/migration/V94__outputs_model.sql` — added section 8: DML folding each companion type's `fields` (`DataField`) into its owning `data_sources.inferred_schema` (`SchemaField {name,type}` shape, order-preserving via `WITH ORDINALITY`), then deleting the companion `data_types` row. Explicitly scoped to exclude any type that is a pipeline's `output_data_type_id`.
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/V94OutputsMigrationSpec.scala` — added a companion-type fixture (`companion-src`/`dt-companion`), a red-first pre-migration existence assertion, and 3 post-migration assertions (schema folded correctly, companion row deleted, pipeline-output type `dt-1` and its source's `inferred_schema` left untouched — the negative-space proof the DML's scoping is correct).
- `backend/src/test/scala/com/helio/infrastructure/persistence/PipelineOnlyPanelBindingMigrationSpec.scala` — real regression fix: pinned the staged-migration's stage-2 `Flyway.target(...)` to `"93"` (was unpinned-to-latest) so this V41-focused spec's own unbound-companion fixture isn't deleted out from under it by V94's new, unrelated 2.9(a) behavior. Root-caused via a full `sbt test` run + isolated re-run confirming it was real, not HEL-924 flakiness.
- `backend/src/test/scala/com/helio/infrastructure/persistence/ResourceTagMigrationSpec.scala` — same fix, same reasoning, for this V73-focused spec's companion-type fixture.
- `openspec/changes/outputs-model-migration/tasks.md` — 2.9 marked partial (step (a) only, (b)-(h) not started).
- `openspec/changes/outputs-model-migration/execution-progress.md`, `openspec/changes/outputs-model-migration/files-modified.md` — updated for cycle 5.

## Cycle 6 (this cycle — investigation only, zero-diff on source/migration/test files)

No source, migration, or test file was changed this cycle. Only
`openspec/changes/outputs-model-migration/execution-progress.md` was updated, recording a
from-source schema investigation of everything step (b) depends on (`panels`/`pipeline_steps`/
`metrics` real column shapes, `AggregateStep`'s wire config shape, `PanelBindingSpec`'s
authoritative valid-slot-name list per kind) and one genuinely open question flagged for the
next cycle to resolve empirically before writing DML: `panels.aggregation` (HEL-292) is an
opaque, undocumented-shape `JsObject` at the domain layer with no established translation to
the pipeline engine's `AggregateConfig` shape. See execution-progress.md's "Cycle 6" section for
the full reasoning on why no DML was landed this cycle.

## Cycle 7 (this cycle — task 2.9 step (b): bound panels → Outputs)

- `backend/src/main/resources/db/migration/V94__outputs_model.sql` — added section 9: for every
  panel bound to a pipeline-output type, inserts an `outputs` row on that pipeline's last trunk
  step (root if zero steps), mapping `text`→`markdown` kind; lifts `config` from the dropped
  per-kind columns plus `fieldMapping` filtered to the valid slot set per kind (HEL-892 AC 6),
  logging dropped keys to a new, genuinely persistent `hel904_dropped_field_mapping_slots` audit
  table (a session-scoped `TEMPORARY` table would vanish before any later connection — including
  this file's own test suite — could inspect it); for panels carrying HEL-292 `aggregation` or a
  `metric_id`, appends an `aggregate` tail step (sibling-scoped per this ticket's own 1.6 fix) and
  attaches the Output there instead, with `metric_id` taking priority over the panel's own
  `aggregation` blob for the measure/fn (empirically confirmed against a real dev-DB row carrying
  both, with differing measure fields) and `metrics.format` carried into `config.format`. Also adds
  a one-time pre-loop snapshot table (`hel904_original_trunk_last`, `ON COMMIT DROP`) capturing
  every pipeline's last-trunk-step BEFORE any tail steps are inserted — a real ordering bug (caught
  by this cycle's own multi-panel-per-pipeline fixture) where a per-panel recursive re-walk would
  otherwise treat an EARLIER panel's own private aggregate tail as "the trunk" once it existed,
  chaining every subsequent panel on that pipeline behind it.
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/V94OutputsMigrationSpec.scala`
  — `panel-bound` fixture given a real `type_id` (previously unset, only used for the kind-backfill
  assertion — 2.9(b) needed a genuinely resolvable bound panel); added 4 new fixtures (`panel-metric-agg`,
  `panel-chart-agg-invalid-fm`, `panel-metric-with-metricid`, `panel-table-plain`) plus a `metrics`
  row, all shapes derived from the real dev-DB `panels.aggregation`/`metrics` values queried this
  cycle (`SELECT id, type, aggregation FROM panels WHERE aggregation IS NOT NULL OR metric_id IS NOT
  NULL`); added a red-first pre-migration step-count assertion and 6 new post-migration tests
  (Output→node→pipeline resolution, tail-step creation + `AggregateConfig` shape for a plain
  aggregation panel, invalid-slot drop+log for a chart panel, `metric_id`-over-`aggregation` priority
  + `config.format` carry-through, table panel's fully-unfiltered `fieldMapping`, and the pre-existing
  trunk steps' `position` values staying untouched). Also fixed the pre-existing cycle-3
  "position order preserved" test to exclude the new `hel904-tail-*` rows it wasn't scoped for.
- `openspec/changes/outputs-model-migration/tasks.md` — 2.9 step (b) marked done (steps (c)-(h) still
  not started).
- `openspec/changes/outputs-model-migration/execution-progress.md`, this file — updated for cycle 7.

## Cycle 8 (this cycle) — task 2.9 steps (c)-(h)

- `backend/src/main/resources/db/migration/V94__outputs_model.sql` — added `ORDER BY p.id` to
  section 9's panel loop (determinism fix, required by step (f)'s "lowest-position Output"
  resolution); added six new sections: (10) unbound data panels deleted + `hel904_migration_counts`
  audit table (step c); (11) `data_type_rows` → `node_snapshots` under each pipeline's ORIGINAL
  frozen last-trunk-step (step e, run before section 12 so it never sees a migration-created node);
  (12) computed fields → `compute` pipeline steps for pipeline-output types, attached as a sibling
  child of the original last-trunk-step (step g; companion-type case is a documented no-op, 0 rows
  in the dev DB); (13) orphan pipeline-output types (no bound panel) → one `table` Output named
  after the type on the last-trunk-step (step d); (14) alert rules/events → `target_output_id`
  resolved to the lowest-position Output on the rule's type's frozen last-trunk-step (step f);
  (15) patch-set journal cleanup — removes `dataType`/`metric`-targeted edit entries from
  `patch_set_applications.edits`, deleting the whole row if that empties it (step h).
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/V94OutputsMigrationSpec.scala`
  — added fixtures for all six steps (an unbound panel; a zero-panel `pipeline-orphan`/`dt-orphan`
  pair carrying both the orphan-type case and a computed field; `data_type_rows` for both dt-1 and
  dt-orphan; two new alert rules + one alert event; two `patch_set_applications` rows exercising
  both the partial-filter and the empty-row-deleted cases), red-first pre-migration assertions for
  each, and 13 new post-migration tests (one per assertion named in the resume brief, including the
  row-for-row `node_snapshots` equality check and the exact deleted/logged counts).
- `openspec/changes/outputs-model-migration/tasks.md` — 2.9 steps (c)-(h) marked done; 2.10 (the
  drops) still explicitly not started (blocked on sections 3/4's consumer rewires, decision 1e).
- `openspec/changes/outputs-model-migration/execution-progress.md`, this file — updated for cycle 8.

## Cycle 9 (this cycle) — task 3.1: AlertRuleService/AlertEvaluationService rewired to Outputs

- `backend/src/main/scala/com/helio/domain/model/model.scala` — `AlertRule.targetDataTypeId`
  removed, replaced by non-`Option` `targetOutputId: OutputId`; `AlertEvent.targetDataTypeId`
  removed, replaced by `targetOutputId: OutputId`.
- `backend/src/main/resources/db/migration/V94__outputs_model.sql` — two new additive statements:
  `alert_rules.target_data_type_id`/`alert_events.target_data_type_id` DROP NOT NULL (task 3.1's
  code no longer populates them on insert; every existing row was already backfilled with
  `target_output_id` by cycle 8's step (f) DML — the legacy columns stay in place, read-only, until
  task 2.10 drops them alongside the rest of the DataType/Metric infrastructure).
- `backend/src/main/scala/com/helio/infrastructure/persistence/alerts/AlertRuleRepository.scala` —
  `AlertRuleRow`/`AlertRuleTable` re-keyed from `target_data_type_id` to `target_output_id`;
  `listEnabledByDataTypeInternal` → `listEnabledByOutputInternal`.
- `backend/src/main/scala/com/helio/infrastructure/persistence/alerts/AlertEventRepository.scala` —
  same re-key for `AlertEventRow`/`AlertEventTable`/`upsertFiringInternal`'s parameter.
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/OutputRepository.scala` —
  added `findByIdOwned(id, user)`, an owner-scoped (not merely sharing-aware) read mirroring
  `DataTypeRepository.findByIdOwned`'s explicit `ownerId` filter — used by `AlertRuleService.create`
  to validate a rule's `targetOutputId` before persisting (existence-not-leaked ACL semantics
  preserved exactly as before the migration).
- `backend/src/main/scala/com/helio/services/alerts/AlertEvaluationService.scala` —
  `evaluateForDataType` → `evaluateForOutput`.
- `backend/src/main/scala/com/helio/services/alerts/AlertRuleService.scala` — takes
  `OutputRepository` instead of `DataTypeRepository`; resolves `targetOutputId` via
  `outputRepo.findByIdOwned` instead of `dataTypeRepo.findByIdOwned`.
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` — added
  `outputRepo`/`nodeSnapshotRepo` nullable-default constructor params (task 3.1/3.14): the
  `onUnblockedRunSuccess` alert-evaluation hook now lists every Output on the pipeline
  (`outputRepo.listByPipelineInternal`) and calls `evaluateForOutput` once per Output (per-Output
  isolation mirrors `AlertEvaluationService`'s own per-rule isolation) instead of the retired
  single `evaluateForDataType` call; a new `nodeSnapshotUpsert` dual-writes `node_snapshots`
  (keyed by the pipeline's trunk-last step, resolved via `pipelineStepRepo.trunkOf`) alongside the
  still-live `dataTypeRowRepo` write (both stay live until section 4 deletes the old route/table).
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala` — added `outputRepoOpt`/
  `nodeSnapshotRepoOpt` (built from the existing nullable `dbContext` param, no new constructor
  param needed); `pipelineRunService` now threads them through; `alertRuleServiceOpt` now requires
  BOTH `alertRuleRepo` and an `OutputRepository` to mount `/api/alert-rules`.
- `backend/src/main/scala/com/helio/api/protocols/alerts/AlertRuleProtocol.scala`,
  `AlertEventProtocol.scala` — wire field `targetDataTypeId` → `targetOutputId` on
  `AlertRuleResponse`/`AlertEventResponse`/`CreateAlertRuleRequest`.
- `schemas/alerts/alert-rule.schema.json`, `alert-event.schema.json`,
  `create-alert-rule-request.schema.json` — `targetDataTypeId` → `targetOutputId` (keeps the
  schema-drift gate's JSON Schema in sync with the renamed protocol field).
- Nine test files rewired to build a real source → pipeline → Output chain (via
  `DataSourceRepository`/`PipelineRepository`/`OutputRepository`, or equivalent raw SQL for the
  route-level specs) in place of the retired bare-DataType fixture, and to use
  `targetOutputId`/`evaluateForOutput`/`listEnabledByOutputInternal` throughout:
  `AlertRuleRepositorySpec.scala`, `AlertEventRepositorySpec.scala`, `AlertEvaluationServiceSpec.scala`,
  `AlertEventServiceSpec.scala`, `AlertRuleServiceSpec.scala`, `AlertEventRoutesSpec.scala`,
  `AlertRuleRoutesSpec.scala`, `AlertEventStateMachineSpec.scala` (pure field rename, no DB),
  `PipelineRunRoutesSpec.scala` (also rewires `makeRoutes`'s `outRepo` param and the
  `listEnabledByOutputInternal` override in its `failingRuleRepo` fixture).
- `openspec/changes/outputs-model-migration/tasks.md` — task 3.1 marked done.
- `openspec/changes/outputs-model-migration/execution-progress.md`, this file — updated for cycle 9.

## Cycle 10 additions (this cycle — task 3.4: BinaryRefRepository re-key; 3.13/3.14 verified)

- `backend/src/main/scala/com/helio/domain/model/model.scala` — `BinaryRef` re-keyed:
  `dataTypeId: String` → `pipelineId: String, nodeStepId: Option[String]`.
- `backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/BinaryRefRepository.scala`
  — `overwriteForDataType`/`findByDataTypeId`/`findByDataTypeIdAndRow` renamed to
  `overwriteForNode`/`findByNode`/`findByNodeAndRow`, all keyed by `(pipelineId, nodeStepId)`
  against the `pipeline_id`/`node_step_id` columns V94 already added (task 2.8); the legacy
  `data_type_id` column is left in place, unpopulated, per decision 1e.
- `backend/src/main/resources/db/migration/V94__outputs_model.sql` — added
  `ALTER TABLE binary_refs ALTER COLUMN data_type_id DROP NOT NULL` (real regression found via
  `sbt test`: the legacy column was still `NOT NULL` from V46, so the moment the rewired writer
  stopped populating it, every new write failed outright — same additive-relaxation-ahead-of-
  the-real-drop pattern as `panels.kind`/`target_data_type_id` in earlier cycles).
- `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala` —
  `extractBinaryRefs` re-keyed to `(pipelineId, nodeStepId)`; the trunk-last-step resolution
  previously private to the `node_snapshots` dual-write (task 3.14, cycle 9) is now shared
  (computed once as `trunkLastStepIdFut`) between the `node_snapshots` write and the re-keyed
  `binaryRefsUpsert`.
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/BinaryRefRepositorySpec.scala`
  — rewritten: seeds a real `users`/`data_sources`/`data_types`/`pipelines`/`pipeline_steps`
  fixture (both new columns are FK-backed, not opaque strings, unlike the old free-standing
  `dtId` literals) and exercises `overwriteForNode`/`findByNode`/`findByNodeAndRow`, including a
  new case distinguishing `nodeStepId = None` (trunk root) from a real step id.
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineRunRoutesSpec.scala` — the three
  `findByDataTypeId(dtId)` binary-ref assertions updated to `findByNode(pid.value, None)` (these
  fixtures never seed `pipeline_steps`, so the trunk resolves to `None`/root).
- `openspec/changes/outputs-model-migration/tasks.md` — task 3.4 marked done; 3.13/3.14 marked
  done (already landed in cycle 9, re-verified this cycle by grep — no code change needed for
  either).
- `openspec/changes/outputs-model-migration/execution-progress.md`, this file — updated for
  cycle 10.

## Cycle 11

- `backend/src/main/resources/db/migration/V94__outputs_model.sql` — added a new section 9a: a
  DML backfill of pre-existing `binary_refs` rows' `pipeline_id`/`node_step_id` from
  `data_type_id` (via `pipelines.output_data_type_id`) and `hel904_original_trunk_last`, closing
  the gap cycle 10 flagged (columns added nullable in section 7, never backfilled).
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/V94OutputsMigrationSpec.scala`
  — added a pre-existing `binary_refs` fixture row keyed only by `data_type_id`, a red-first
  pre-migration assertion (`pipeline_id` column doesn't exist yet), and a post-migration
  assertion that it backfills to `(pipelineId, stepIds.last)` — proven red before the fix (failed
  with a duplicate-key error until the fixture's `row_index`/`field_name` were made unique from
  the existing `ref-1` fixture, then genuinely red against pre-fix SQL, then green).

## Cycle 12 — begin task 3.6 (additive-only increment; cluster continues)

- `backend/src/main/scala/com/helio/domain/model/model.scala` — fixed `OutputKind`: the
  task-1.1 version shipped with only 3 values (`table`/`metric`/`time_series`), but
  ticket.md:42 and design.md:76 both specify the real Phase-1 set of 6 (`metric, chart, table,
  collection, timeline, markdown`) — caught while sizing `OutputBindingSpec`, which must be
  keyed by the real kind set. Fixed inline as an ordinary implementation bug (not a design
  question — the design docs were already unambiguous and consistent with each other; only the
  already-committed Scala enum was wrong). Verified safe: every existing usage of `OutputKind.*`
  in the tree (main + 8 spec files) only ever constructs `OutputKind.Table`, so this is a
  backward-compatible correction, not a breaking rename.
- `backend/src/main/scala/com/helio/domain/panels/OutputBindingSpec.scala` (new) — task 3.6's
  `PanelBindingSpec` → `OutputBindingSpec` successor, keyed by `OutputKind` instead of
  `PanelType`. Carries over all five of `PanelBindingSpec`'s slot/eligibility specs verbatim
  (Metric/Chart/Table/Collection/Timeline), plus a new `Markdown` entry (vacuously bindable, no
  slots — a markdown Output binds via a row-interpolated template, not a fieldMapping slot).
  Added additively alongside `PanelBindingSpec` (not yet deleted) — `PanelCapabilityService`
  (§3.11) is not rewired onto it yet; that is the next increment.
- `backend/src/main/scala/com/helio/domain/panels/OutputPanel.scala` (new) — task 3.6's
  collapsed replacement for the five bound `*Panel.scala` subtypes (`MetricPanel`/`ChartPanel`/
  `TablePanel`/`CollectionPanel`/`TimelinePanel`): `OutputPanelConfig(outputId: OutputId)` is the
  placement's entire config — everything those five configs used to carry (`fieldMapping`,
  `aggregation`, `chartOptions`, `columnWidths`/`density`/`columnOrder`, `timelineOptions`,
  `metricId`, `label`/`unit`) now lives on the Output itself (`outputs.config`, confirmed by
  reading `OutputRepository`, already landed additively in task 1.5). Not yet registered in
  `Panel.Registry`/`PanelKind` — that requires `CreatePanelRequest`/`PanelProtocol`'s wire
  dispatch to accept `type: "output"`, which belongs to the `PanelService`/proposal-layer
  (§3.8/3.9/3.10) increment, not this one.
- `backend/src/main/scala/com/helio/domain/panels/package.scala` — added `outputIdFormat`
  (mirrors `dataTypeIdFormat`/`metricIdFormat`), needed by `OutputPanelConfig`'s
  macro-derived `jsonFormat1`.
- `backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRepository.scala` —
  added `outputId`/`kind` columns to `PanelRow`/`PanelTable` (both map to real, already-existing
  V94 columns `panels.output_id`/`panels.kind` — task 1.1/2.9's additive schema, never
  previously read by application code). Both default to `None` on the case class so the sole
  existing construction site (`PanelRowMapper.domainToRow`'s `base`) needed only an explicit
  `None` for clarity, not a forced signature break elsewhere (verified no other call site exists
  via grep).
- `backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRowMapper.scala` —
  `rowToDomain` now checks `row.kind.contains("output")` FIRST and decodes to `OutputPanel` on
  that branch (falling through to the existing `row.panelType` dispatch otherwise) — additive
  and currently dead in practice, since no write path sets `kind = "output"` yet (confirmed:
  `domainToRow`'s `OutputPanel` branch is the only writer, and nothing in `PanelService`/
  `PanelRepository.insert` constructs an `OutputPanel` yet). `domainToRow` gained the
  symmetric `case op: OutputPanel => ...` branch and a new private `outputConfig` reader,
  completing the round-trip for when the next increment wires a real writer.
- Full `sbt -batch test`: **3899/3899 passing** (unchanged count — no new spec files landed this
  increment; existing suite re-confirms zero regressions from the `OutputKind` fix and the
  additive `PanelRow`/`PanelRowMapper` changes), exit code 0, 247 suites.
- `openspec/changes/outputs-model-migration/execution-progress.md` — cycle 12 section added.

## Cycle 13 (this cycle)

- `backend/src/main/scala/com/helio/domain/model/Panel.scala` — registered `OutputPanel.Kind ->
  OutputPanel.companion` in `Panel.Registry`, and added `PanelKind.Output` alongside the
  existing 9 constants. `OutputPanel`/`OutputPanelConfig`/`OutputBindingSpec` were already
  landed additively in cycle 12 but not yet registered — this is the actual cutover of the
  Registry (the single source of truth every protocol/repo/service dispatcher derives from),
  making `"output"` a real, parseable `PanelKind` for the first time. Still no write path
  constructs one (`PanelService.create`/`ProposalPanelSupport` etc. are unchanged this cycle) —
  registering only makes reads/round-trips (already wired in `PanelRowMapper` in cycle 12) live;
  a POST with `type: "output"` is not yet reachable from any real client path.
- `backend/src/test/scala/com/helio/domain/model/PanelSpec.scala` — updated the kind-set parity
  test (`"be the single source of truth for all 9 panel kinds"` → `10`) to include
  `OutputPanel.Kind` in both the `Panel.Registry.keySet` assertion and the canonical
  kind-string assertion. This is exactly the "stale hardcoded expectation surfaces as a real
  regression" case flagged in the resume brief — the test was asserting the literal old set,
  which is correct test behaviour (it exists to catch exactly this kind of unregistered-kind
  drift), not a defect in the test itself.
- Full `sbt -batch test`, run twice (once before this cycle's edits as a fresh baseline, once
  after): **3899/3899 both times**, exit code 0, 247 suites — no regressions, no net-new tests
  (the parity test's assertion body changed but its count and pass/fail status did not).
- Deliberately NOT done this cycle (unchanged remainder from cycle 12's own list): no write path
  constructs `OutputPanel` yet (`PanelService.create`/`update`/`CreatePanelRequest` protocol
  decoding); the five old bound `*Panel.scala` files are not deleted; `PanelCapabilityService`
  (§3.11) still reads `PanelBindingSpec`/`DataTypeRepository`; `ProposalPanelSupport`/
  `DashboardProposalService`/`PipelineProposalService` (§3.8/3.9/3.10/3.10a) untouched;
  `Pipeline.outputDataTypeId` (§3.5) untouched; `WorkspaceContextService` (§3.12) untouched.
  Given the size of the remaining write-path/service-layer cutover (confirmed via grep: `Metric
  Panel`/`ChartPanel`/`TablePanel` are referenced across `PanelService.scala`,
  `PanelServiceHelpers.scala`, `ProposalPanelSupport.scala`, `DashboardProposalService.scala`,
  `PanelRoutes.scala`, and the `patchsets` package), this cycle stopped at a real, small,
  fully-compiling-and-green Registry-cutover checkpoint rather than attempting the write-path
  rewire and risking an uncommitted stop mid-way through a much larger, more coupled change.

## Cycle 15 — task 3.6 write-path increment (additive `PanelType.Output`, not the full collapse)

- `backend/src/main/scala/com/helio/domain/model/model.scala` — `PanelType` gains `Output`/
  `"output"` as a 10th valid value (additive; see the file's own new doc comment for why the
  full 5-value collapse was sized and deferred this cycle).
- `backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala` — `OutputCreate`
  added to the `CreateConfig` ADT; `decodeCreateConfig`/`encodeConfig`/`applyConfigPatchUnsafe`
  all gained an `"output"`/`OutputPanel` case. `encodeConfig` in particular was a real,
  previously-latent gap: any panel row already backfilled to `kind = 'output'` by the V94
  migration (task 2.5) would `deserializationError` on GET without this case, once
  `PanelRowMapper` (already wired cycle 12/13) decoded it into a real `OutputPanel`.
- `backend/src/main/scala/com/helio/services/panels/PanelServiceHelpers.scala` —
  `buildNewPanel` gained the `OutputCreate` case, constructing a real `OutputPanel`.
  `dataTypeIdFromCreateConfig`/`metricIdFromCreateConfig` already fell through to `None` for
  unmatched kinds, so no change needed there — `rejectCompanionBinding`/
  `rejectUnresolvableMetric` correctly no-op for Output panels.
- `backend/src/main/scala/com/helio/infrastructure/persistence/dashboards/
  DashboardSnapshotRepository.scala` — the dashboard-duplicate/import snapshot path's own
  `CreateConfig` match (separate from `PanelServiceHelpers.buildNewPanel`, same ADT) gained the
  `OutputCreate` case; the compiler's own non-exhaustive-match warning caught this second call
  site.
- `backend/src/test/scala/com/helio/domain/model/PanelTypeSpec.scala` — added `"output"`
  parse/serialize/round-trip coverage (mirrors the existing per-value test shape for every other
  `PanelType` member).
- `backend/src/test/scala/com/helio/services/panels/PanelServiceBuildAllForCreateSpec.scala` —
  added a real create-path test asserting `type: "output"` actually builds an `OutputPanel`
  (not just that `PanelType.fromString` accepts the string) — exercises the specific new
  scenario (`PanelServiceHelpers.buildNewPanel`'s new `OutputCreate` arm) per the reviewer
  scenario-coverage checklist.
- `schemas/panels/create-panel-request.schema.json`, `schemas/panels/panel.schema.json`,
  `schemas/panels/update-panels-batch-request.schema.json` — added `"output"` to the `type`
  enum (additive; no new `oneOf` branch for the Output config shape — not runtime-validated
  against real requests today, confirmed by grep: no test/route wires AJV validation against
  these files, they exist for `check-schema-drift.mjs`'s cross-surface parity and as
  documentation).
- `schemas/dashboards/dashboard-proposal.schema.json` — added `"output"` to
  `$defs.ProposalPanel.properties.type.enum` (the `agentFacingPanelTypes` surface,
  divider-excluded set).
- `helio-mcp/src/tools/proposal.ts` — added `"output"` to `PANEL_TYPES` (same agent-facing
  surface, kept in parity with the schema above per `check-schema-drift.mjs`'s
  `panelTypeSurfaces` check).

**Deliberately NOT done this cycle** (documented in tasks.md 3.6's own note): the five old
bound `*Panel.scala` files (`MetricPanel`/`ChartPanel`/`TablePanel`/`CollectionPanel`/
`TimelinePanel`) are not deleted; `PanelType`'s eventual 5-value collapse (dropping those five
entirely) is deferred to land with tasks 3.9/3.10/3.10a/4.1 per cycle 14's sizing; `DataPanelKinds`
(task 3.10) untouched; `ProposalPanelSupport`/`DashboardProposalService`/
`PipelineProposalService`/`PanelCapabilityService` untouched; `panels.kind` `SET NOT NULL`
(task 2.5's deferred piece) still deferred — only the new `OutputPanel` write path populates
`kind` on insert, the other 9 kinds still leave it `NULL`.

**Verification (fresh, exit codes read directly):**
- `sbt -batch compile` — clean (one pre-existing-shape non-exhaustive-match warning surfaced and
  fixed at `DashboardSnapshotRepository.scala`, not a new defect — the compiler caught the
  second `CreateConfig` match site this cycle's `OutputCreate` addition needed).
- `sbt -batch Test/compile` — clean.
- `sbt -batch test` (full suite) — **3902/3902**, exit code 0, 247 suites (3899 baseline + 3 new
  assertions across `PanelTypeSpec`/`PanelServiceBuildAllForCreateSpec`).
- `node scripts/check-scala-quality.mjs` — clean (2 inline-FQN violations in the new test file
  found and fixed with top-of-file imports before this was clean).
- `node scripts/check-schema-drift.mjs` — clean ("panel-type enums in sync ... 7 surfaces
  checked").
- `npm run check:helio-mcp-types` — clean.
- `node scripts/check-openspec-hygiene.mjs` — clean ("openspec/ is clean").

## Cycle 16 — completed task 3.6's full PanelType/Panel-kind collapse (5-value
## set), plus tasks 3.9/3.10/3.10a; main sources compile clean; test-source
## rewiring still in progress (see execution-progress.md)

- `backend/src/main/scala/com/helio/domain/model/model.scala` — `PanelType` collapsed from
  10 to 5 values (`Text|Markdown|Image|Divider|Output`); `Default` now `Output`.
- `backend/src/main/scala/com/helio/domain/model/Panel.scala` — `Panel.Registry`/`PanelKind`
  collapsed to the same 5 kinds; `PanelKind.Default` now `Output`.
- `backend/src/main/scala/com/helio/domain/panels/MetricPanel.scala`,
  `ChartPanel.scala`, `TablePanel.scala`, `CollectionPanel.scala`, `TimelinePanel.scala`,
  `PanelBindingSpec.scala` — deleted outright (collapsed into `OutputPanel`/
  `OutputBindingSpec`).
- `backend/src/main/scala/com/helio/domain/panels/OutputBindingSpec.scala` — gained
  `SlotEligibility` (moved here from the deleted `PanelBindingSpec.scala`, same three-value
  contract).
- `backend/src/main/scala/com/helio/domain/panels/PanelConfigCodec.scala` — dropped the 5 old
  kinds' `CreateConfig` variants/decode/encode/patch cases.
- `backend/src/main/scala/com/helio/services/panels/PanelServiceHelpers.scala` — dropped
  `buildNewPanel`'s 5 old cases, `dataTypeIdFromCreateConfig`'s old cases (Text/Markdown only
  remain), and ALL metric-binding-resolution + scatter/aggregation-conflict helpers
  (`metricIdFromCreateConfig`/`metricIdFromConfigPatch`/`metricIdOf`/`withMetricCleared`/
  `withMaterializedMetric`/`validateScatterAggregationConflict`/
  `validateBatchAggregationConflict`/`aggregationPresenceFromConfigPatch`).
- `backend/src/main/scala/com/helio/services/panels/PanelService.scala` — `resolveBindingsForRead`/
  `resolveOne`/`resolveSingleBinding` simplified to dataType-only (metric half removed);
  `rejectUnresolvableMetric` removed + its call sites in `create`/`update`; scatter-aggregation
  call sites removed from `update`/`batchUpdate`.
- `backend/src/main/scala/com/helio/services/panels/BoundPanelService.scala` — deleted outright
  (design.md P1.1 row lists this explicitly; forced by the `PanelBindingSpec`/`PanelType`
  collapse — its `/api/panels/bound` route depended on both).
- `backend/src/main/scala/com/helio/api/routes/panels/BoundPanelRoutes.scala`,
  `backend/src/main/scala/com/helio/api/protocols/panels/BoundPanelProtocol.scala` — deleted
  alongside `BoundPanelService`.
- `backend/src/main/scala/com/helio/api/ApiRoutes.scala`, `JsonProtocols.scala`,
  `package.scala` — removed `BoundPanelService`/`BoundPanelRoutes`/`BoundPanelProtocol`
  wiring/aliases.
- `backend/src/main/scala/com/helio/services/panels/PanelCapabilityService.scala` — rewired
  from `PanelBindingSpec.DataBindable`/`PanelType` onto `OutputBindingSpec.All`/`OutputKind` —
  a mechanical spec-source swap (same string keys, same `DataTypeRepository`-based column
  source); does NOT yet do task 3.11's deeper "resolve against a pipeline node's Outputs
  instead of a DataType" semantic rewire (no `GET /api/pipelines/:id/capabilities` route or
  Output-schema-resolution plumbing exists yet to receive it — flagged as real remaining scope
  for task 3.11, not silently skipped).
- `backend/src/main/scala/com/helio/services/panels/PanelPacker.scala` — `Bounds` map's
  `Metric`/`Chart`/`Table`/`Collection` entries collapsed onto one `PanelKind.Output` entry
  (merged to `Chart`'s widest bound as a placeholder — see file's own doc comment).
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetUndoInverse.scala`,
  `PatchSetApplyRollback.scala` — `optionalConfigFieldNames`'s Metric/Chart/Table/Collection
  cases removed (Image/Divider remain).
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetPreviewProjection.scala` —
  `withTitleAndAppearance`'s dispatch collapsed to the 5 kinds;
  `validateScatterAggregationConflict` call removed from `panelUpdateAfter`.
- `backend/src/main/scala/com/helio/services/patchsets/PatchSetApplyResolvers.scala` —
  `validatePanelBindingRefs`/`rejectCompanionBinding` calls no longer take a `metricId`;
  `rejectUnresolvableMetric` removed.
- `backend/src/main/scala/com/helio/services/proposals/DashboardProposalService.scala` —
  task 3.10: `DataPanelKinds` retargeted `Set("metric","chart","table","collection","timeline")`
  → `Set("output")`; `MetricKind`/`TimelineKind`/`MetricIdSupportedKinds` deleted (3.10a); the
  dead `applyAppearance`/`hasChartAppearanceFields`/`buildChartAppearance` chart-panel-appearance
  follow-up removed (unreachable now that `ChartPanel` doesn't exist).
- `backend/src/main/scala/com/helio/services/proposals/ProposalPanelSupport.scala` — task 3.10a:
  the chart/timeline/metric kind-valued predicates in `validatePanel` deleted;
  `validateMetricBinding`/`preValidateBindings`'s `metricRepo` param removed; `buildDataConfig`'s
  Metric/Timeline literal-folding branches removed (dataTypeId/fieldMapping only remain — a real
  Output `outputId` composition for proposal panels is NOT yet wired, flagged as task 3.8/3.10
  remaining scope).
- `backend/src/main/scala/com/helio/services/dashboards/DashboardServiceValidation.scala`,
  `DashboardContentsService.scala` — `ChartPanel`-specific scatter/aggregation import-time check
  removed; `preValidateBindings` call site updated (no `metricRepo` arg).
- `backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRowMapper.scala` —
  `rowToDomain`/`domainToRow` dispatch collapsed to the 5 kinds (unknown/legacy bound-kind rows
  fall back to `OutputPanel`, matching the V94 backfill); all 5 old per-kind config-rebuild
  helpers + their column serializers deleted.
- `backend/src/main/scala/com/helio/infrastructure/persistence/dashboards/DashboardSnapshotRepository.scala` —
  snapshot-import panel-construction match collapsed to the 5 kinds.
- `backend/src/main/scala/com/helio/app/DemoData.scala` — all 4 seed panels rewritten as
  placeholder unbound `OutputPanel`s (empty `outputId`) — a REAL Source→Pipeline→Output reseed
  (task 3.7) is NOT done; flagged as remaining scope, not silently skipped.
- `backend/src/main/scala/com/helio/api/http/RequestValidation.scala` — `validateTimelineSort`
  deleted (no remaining caller; `TimelineOptions` no longer exists).
- Test files: `PanelSpec.scala` rewritten to the 5-kind set (all Metric/Chart/Table/Collection/
  Timeline-specific sections deleted); `PanelTypeSpec.scala`, `PanelPackerSpec.scala` updated to
  the 5-value `PanelType`/`PanelKind` set; `PanelRowMapperSpec.scala` trimmed to Text/Markdown/
  Image round-trips; `PanelServiceCompanionBindingGuardSpec.scala`,
  `PanelServiceResolveBindingsSpec.scala`, `WorkspaceTeardownServiceSpec.scala` rewired from
  `MetricPanel`/`MetricPanelConfig` fixtures onto `TextPanel`/`TextPanelConfig`;
  `PatchSetUndoInverseSpec.scala` rewired from Metric's aggregation fields onto Divider's
  weight/color; `PatchSetApplyServiceSpec.scala`, `PatchSetPreviewServiceSpec.scala` — dropped
  metricId-binding-rejection and scatter-aggregation-conflict tests (retired features), retargeted
  `seedPanel`'s default type; `RefinementEditShapeSpec.scala` — dropped the panel-update/-create
  worked-example test blocks (their `*PanelConfig` subjects deleted; `RefinementEditShape.scala`'s
  own prompt-example strings are UNCHANGED and now untested — flagged as a real gap for a future
  cycle's Output-oriented prompt rewrite); `CombinedProposalServiceValidateSpec.scala` — sentinel
  panel type retargeted `"metric"` → `"output"`.
- Deleted specs (subject fully retired): `BoundPanelRoutesSpec.scala`,
  `PanelMetricBindingRoutesSpec.scala`, `PanelBindingSpecSpec.scala`,
  `PanelServiceMetricBindingSpec.scala`, `PanelServiceScatterAggregationSpec.scala`.
- **Still failing `Test/compile`** at commit time: `MetricRoutesSpec.scala`,
  `MetricRepositorySpec.scala` (both construct a `MetricPanel` fixture incidentally — `/api/metrics`
  itself is untouched, only their panel fixture needs retargeting). Next cycle should fix these
  two files first, then run the full suite and classify failures per HEL-924.

### Cycle 16 addendum — schema-drift gate fix required to commit (task 5.4(a)/(b) piece)

- `scripts/check-schema-drift.mjs` — the panel-type-enum arm-count guard's threshold moved from
  `< 8` to `< 5` (the collapsed set's own final size), per the resume brief's explicit
  authorization to do this minimal script fix inline rather than defer entirely to section 5.
- `schemas/panels/bound-panel-request.schema.json`, `bound-panel-response.schema.json` — deleted
  (their `BoundPanelRequest`/`BoundPanelResponse` case classes no longer exist).
- `schemas/panels/create-panel-request.schema.json`, `panel.schema.json`,
  `update-panels-batch-request.schema.json`, `schemas/dashboards/dashboard-proposal.schema.json` —
  `type` enum lists narrowed to the 5-value set (dropped `metric`/`chart`/`table`/`collection`/
  `timeline`). `panel.schema.json`'s per-kind `allOf` conditional `config` subschemas for the 5
  retired kinds (`MetricConfig`/`ChartConfig`/etc.) are UNCHANGED — now permanently unreachable
  dead branches (the `type` enum can never validate as those consts again) rather than deleted
  outright; flagged as real schema-cleanup debt for a future cycle, not silently left unnoted.
- `helio-mcp/src/tools/proposal.ts` — `PANEL_TYPES` narrowed to `text|markdown|image|output`
  (agent-facing surface excludes `divider`, matching the pre-existing convention).
- `helio-mcp/src/tools/proposalValidation.ts` — `DATA_PANEL_TYPES` retargeted `Set(["output"])`
  (was the 5 old bound kinds); `METRIC_ID_SUPPORTED_TYPES` and its metricId-specific validation
  logic UNCHANGED (not schema-drift-checked) — now dead/unreachable since no proposal panel type
  can carry a functioning `metricId` anymore; flagged as cleanup debt, not silently left unnoted.
- `frontend/src/features/proposals/ui/CombinedProposalReview.tsx`,
  `frontend/src/features/dashboards/ui/ProposalReview.tsx` — `DATA_PANEL_TYPES` retargeted
  `Set(["output"])` to match.
- Verified fresh after this fix: `node scripts/check-schema-drift.mjs` clean (7 panel-type
  surfaces checked), `sbt -batch compile` clean, `npm --prefix helio-mcp run typecheck` clean,
  `npm --prefix frontend run typecheck` clean.

### Cycle 16 continuation — test-fixture retargeting fallout from the PanelType collapse (158 -> 81 failures)

- Deleted (subject entirely retired): `DashboardApplyProposalAggregationSpec.scala`,
  `DashboardContentsReplaceAggregationSpec.scala`, `DashboardApplyProposalTimelineSpec.scala`,
  `DashboardApplyProposalMetricBindingSpec.scala`.
- `DashboardSnapshotValidationSpec.scala`, `DashboardApplyProposalConfigSpec.scala`,
  `PatchSetUndoServiceSpec.scala`, `CombinedApplyProposalRollbackSpec.scala` — individual retired-
  feature test cases removed (scatter+aggregation import validation, collection/chart/table
  config-passthrough, metric-bound raw-override conflict, chart-scatter-chartType rejection
  retargeted to an output-missing-dataTypeId trigger).
- `MetricRoutesSpec.scala`, `MetricRepositorySpec.scala` — `seedBoundPanel` rewritten as a direct
  raw-SQL insert (no surviving `Panel` subtype writes `metric_id` anymore); the still-live
  `GET /metrics/:id/usage`/`X-Unbound-Panel-Count` read paths remain covered.
- `RefinementRoutesSpec.scala`, `RefinementServiceSpec.scala`, `PatchSetPreviewRoutesSpec.scala`,
  `PatchSetUndoServiceSpec.scala` (again), `ApiRoutesSpec.scala` (10 sites) — `Some("output"),
  None` panel-creation fixtures retargeted to `Some("divider"), None` (an empty-config `output`
  panel is now invalid — `validateConfig` requires a non-empty `outputId`, a real forcing
  distinction from the old always-valid-empty `metric` default); `ApiRoutesSpec.scala`'s one test
  that specifically asserts `type == "output"` was instead given a real `outputId` in its config.
- `CombinedApplyProposalDanglingRefSpec.scala` — a `DataPanelKinds` example retargeted `"chart"` →
  `"output"`.
- `AuditMutationInstrumentationSpec.scala`, `AssistantToolExecutorSpec.scala`,
  `AssistantServiceSpec.scala`, `DashboardProposalServiceValidateSpec.scala`,
  `DashboardSnapshotValidationSpec.scala`, `ApiRoutesSpec.scala`, plus 8 further proposal/
  batch-create spec files (`DashboardApplyProposalMetricBindingSpec` before its deletion,
  `CombinedApplyProposalRegressionSpec`, `DashboardApplyProposalSpec`,
  `DashboardApplyProposalBindingSpec`, `CombinedApplyProposalSpec`, `DashboardAuthoringRoutesSpec`,
  `DashboardContentsReplaceSpec`, `PanelBatchCreateSpec`, `DashboardApplyProposalConfigSpec`,
  `DashboardAuthoringServiceSpec`, `AuthoringTelemetrySpec`) — mechanical `"type":"metric"` /
  `` `type` = "metric" `` fixture retargeting to `"output"`.
- `AutoLayoutRouteSpec.scala` — `"chart"`-typed fixture panels retargeted to `"divider"`
  (`PanelPacker` behavior beyond its `Bounds` lookup is kind-agnostic; already covered by
  `PanelPackerSpec`).
- **Two root causes remain, both precisely diagnosed (not vague), affecting 81 tests across 6
  suites — see execution-progress.md's cycle-16-continuation section for the full detail**:
  (1) `ApiRoutesSpec.scala` still carries dozens of test cases exercising fully-retired
  ChartPanel/CollectionPanel/TimelinePanel/TablePanel-specific behavior with no Output-kind
  equivalent yet (a large single-file cleanup, explicitly deferred); (2) `ProposalPanelSupport.
  buildDataConfig`'s interim `{dataTypeId, fieldMapping}` config shape (this cycle's own
  documented placeholder) doesn't satisfy `OutputPanelConfig.decodeCreate`'s `outputId`
  requirement, so every proposal/batch-create test path exercising a data-bound `"output"` panel
  fails with `"outputId is required"` — this is task 3.8's real scope, not a further test patch.
