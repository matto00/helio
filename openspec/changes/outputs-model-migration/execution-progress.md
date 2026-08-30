# HEL-904 execution progress (scratch, executor-internal)

## Cycle 1 — done

Section 1 (Domain model + new repositories, additive) — only the pure
domain-model sub-tasks landed this cycle:

- [x] 1.1 `Output`, `OutputId`, `OutputKind`, `NodeRef` added to
      `domain/model/model.scala`. `Pipeline.outputDataTypeId` NOT yet
      touched (owned by 3.5).
- [x] 1.2 `parentStepId: Option[PipelineStepId] = None` added to the
      `PipelineStep` trait and all 23 step-kind case classes
      (`backend/src/main/scala/com/helio/domain/steps/*.scala`).
      `PipelineStepRepository.rowToDomain`'s 23 call sites updated to pass
      `enabled = row.enabled` (named arg) so the trailing positional
      `row.enabled` doesn't get misassigned to the new `parentStepId` slot.
      DB column / backfill (task 2.2) NOT done — this is still purely
      in-memory, defaults to `None` for every real row today.
- [x] 1.3 `inferredSchema: Vector[SchemaField] = Vector.empty` added to the
      `DataSource` trait and all 7 source-kind case classes
      (`backend/src/main/scala/com/helio/domain/model/DataSource.scala`).
      DB column / backfill (task 2.6, 2.9) NOT done.
- [x] 1.4 `targetOutputId: Option[OutputId] = None` added to `AlertRule`
      alongside the still-live `targetDataTypeId` (removal is task 3.1's
      job, not this one).

Verification this cycle:
- `sbt compile` — clean (only pre-existing warnings).
- `sbt test` — 3851/3851 passing (one test fixture,
  `InProcessPipelineEngineSpec.scala:2447`'s anonymous `PipelineStep`
  instance, needed a `parentStepId = None` override added to compile —
  no behavior change).
- No Flyway migration written yet, no DB touched, no existing consumer
  rewired — this cycle is a pure additive-compile-only slice, safe to land
  standalone.

## NOT done — everything else in tasks.md

This ticket's true scope (sections 1.5–1.7, 2, 3, 4, 5, 6 — repositories,
the V94 Flyway migration + full data migration, ~15 live-consumer rewires,
deletion of DataType/Metric/BoundPanelService and their routes/protocols,
71 OpenSpec capability deltas, 5-piece schema-drift-script fix, and the
red-then-green migration/RLS/splice/step-order tests that are this ticket's
primary proof artifacts) is NOT started. In particular:

- No `OutputRepository`/`NodeSnapshotRepository` (1.5).
- No `PipelineStepRepository` tree-ordered reads/splice-on-delete (1.6/1.7).
- No V94 migration at all — nothing has touched the shared dev DB.
- No consumer rewiring (section 3) — `AlertRuleService`, proposal services,
  `PanelCapabilityService`, `WorkspaceContextService`, etc. all still work
  against DataType/Metric exactly as before.
- No deletions (section 4) — `DataTypeRepository`/`DataTypeService`/
  `MetricRepository`/etc. all still present and in use.
- No schema/OpenSpec work (section 5).
- No DemoData reseed / oversized-file-split (3.7/4.6).

This ticket is a multi-day migration by its own design.md's estimate (5
rounds of adversarial skeptic review, 115-capability-spec enumeration,
explicit "largest, least-reversible ticket in the whole remodel" framing in
this run's brief). One executor cycle's realistic, safe unit of work is a
verified-compiling additive slice — attempting the DDL/data-migration or
mass consumer-rewire in the same cycle without room to run the red-then-green
migration/RLS proof properly would violate this run's own "weight
correctness over speed" ground rule. Next cycle should continue with 1.5
(repositories) and 1.6/1.7 (tree-ordered reads + splice-on-delete + their
red-first tests) before touching Flyway.
