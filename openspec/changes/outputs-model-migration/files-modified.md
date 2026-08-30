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
