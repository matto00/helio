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
