# HEL-904 execution progress (scratch, executor-internal)

## Cycle 1 — done (commit 212c4fd1)

Section 1 (Domain model + new repositories, additive) — pure domain-model
sub-tasks:

- [x] 1.1 `Output`, `OutputId`, `OutputKind`, `NodeRef` added to
      `domain/model/model.scala`.
- [x] 1.2 `parentStepId: Option[PipelineStepId] = None` added to
      `PipelineStep` trait and all 23 step-kind case classes.
- [x] 1.3 `inferredSchema: Vector[SchemaField] = Vector.empty` added to
      `DataSource` trait and all 7 source-kind case classes.
- [x] 1.4 `targetOutputId: Option[OutputId] = None` added to `AlertRule`.

## Cycle 2 (this cycle, cold spawn) — done

- [x] 1.5 `OutputRepository`, `NodeSnapshotRepository` added
      (`backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/{OutputRepository,NodeSnapshotRepository}.scala`).
      Both are compiling scaffolding: `OutputRepository` mirrors
      `DataTypeRepository`'s ACL-bypassing-internal-variant pattern (list by
      node/pipeline, findById, insert, delete, delete-by-node for the
      splice-cascade); `NodeSnapshotRepository` mirrors
      `DataTypeRowRepository`'s overwrite/list-rows pattern, keyed by
      `(pipeline_id, node_step_id)` where `node_step_id = None` = pipeline
      root. **Neither has a runtime DB test** — the `outputs`/`node_snapshots`
      tables don't exist yet (land in the V94 migration, tasks 2.3/2.4).
      Scoping call: DB-integration tests for these two repos are deferred to
      land alongside 2.3/2.4, not this task — a Slick `TableQuery` compiles
      fine against a table that doesn't exist yet; only a runtime query would
      fail, and I'm not writing runtime tests for code with no schema to hit.
- [x] 1.6 (partial) `PipelineStepRepository` gained `trunkOf`/`childrenOf`/
      `tailsOf` as **pure functions over an already-fetched
      `Vector[PipelineStep]`**, walking `parentStepId` (added in 1.2). These
      do not touch the DB — they're safe to call today, and since every real
      row currently decodes `parentStepId = None` (no DB column exists yet),
      `trunkOf` correctly degrades to "first root-position step only" rather
      than looping or throwing.
      **NOT done in 1.6**: sibling-scoped `insert`/`insertAtInternal`/
      `reorderInternal` and splice-on-delete. These are inherently DB-backed
      (they read/write `position` scoped to *siblings under a parent*, and
      splice-on-delete re-parents a real row) and require the actual
      `parent_step_id` column, which doesn't exist until task 2.2's migration
      adds it. Implementing "sibling-scoped" semantics against a column that
      isn't there yet isn't possible without inventing a shadow/in-memory
      representation of ownership the DB doesn't enforce — that would be
      exactly the kind of shim design.md's decision 11 rules out ("no shims,
      no dual-read paths"). **Scoping decision: this half of 1.6, plus all of
      1.7's splice-on-delete/sibling-insert-reorder tests, move to land
      together with task 2.2** (the migration commit), where the real column
      exists and the DB-backed methods can be written and tested for real
      instead of against a fiction. This is an implementation-sequencing
      call, not a design deviation — the "correct" scope of 1.6/1.7 per
      design.md's decision 1a ("all additive... nothing deleted yet") is
      satisfied by what's landed; the DB-dependent remainder simply cannot be
      done before 2.2 without violating decision 11.
- [x] 1.7 (partial) `PipelineStepRepositoryTreeOrderingSpec` — 8 unit tests
      for `trunkOf`/`childrenOf`/`tailsOf` (empty pipeline, pure trunk,
      branch-point tail-ignoring, pre-backfill degrade-to-root-list, sibling
      ordering by position, multi-tail depth-first expansion). All pass, no
      DB required (constructs `PipelineStep` values directly). Splice-on-
      delete / sibling-insert-reorder tests deferred alongside 1.6's
      DB-backed remainder (see above) — not written this cycle.

Verification this cycle:
- `sbt compile` — clean (only pre-existing warnings).
- `sbt test -- testOnly PipelineStepRepositoryTreeOrderingSpec` — 8/8 passing.
- Full `sbt test` — kicked off, running in background at end of this cycle
  (>120s, did not complete within this turn's window) — **result not yet
  confirmed as of this note; the next resume must check the background job's
  output before assuming green, per verification-before-completion.md.** No
  reason to expect a regression (only new files + additive pure-function
  methods added, nothing existing changed except adding two new files), but
  this has NOT been confirmed with fresh evidence yet.
- No commit made yet this cycle — pending full `sbt test` confirmation.

## NOT done — everything else in tasks.md

Sections 1.6 (DB-backed half)/1.7 (DB-backed half)/2/3/4/5/6 remain, per the
original scope note (unchanged from cycle 1): V94 migration (the largest,
most load-bearing single piece — DDL, full data migration in the ticket's
9-step order, red-first migration test derived from a real `pg_dump`
fixture, RLS smoke test with a real non-superuser `SET ROLE`, step-order-
preservation test), then rewiring ~15 live consumers, then deleting
DataType/Metric/BoundPanelService and their routes/protocols, then the
71-file OpenSpec capability delta pass, then the 5-piece schema-drift-script
fix. None of this is started.

Next cycle should:
1. First confirm the backgrounded `sbt test` from this cycle is green (or
   fix any regression it surfaces) before adding anything new.
2. Commit this cycle's 1.5/1.6/1.7-partial work as its own commit if not
   already committed.
3. Move to task 2: read `PanelRepository.scala:348-387`/`PanelRowMapper.scala`
   for the exact current `panels` column list (2.1), then write the V94
   migration DDL (2.2-2.8) — at which point the deferred DB-backed
   `PipelineStepRepository` sibling-scoped insert/reorder/splice-on-delete
   methods (1.6 remainder) and their tests (1.7 remainder) should land
   *together with* 2.2, per the scoping note above, before proceeding to the
   data-migration steps (2.9) and the red-first tests (2.11-2.13).

## Cycle 3 (this cycle) — task 2 (V94 migration), additive slice

Landed `backend/src/main/resources/db/migration/V94__outputs_model.sql`
(grows across future cycles per its own header note) covering ticket.md
scope items 1-5 (tasks 2.2-2.6), plus a red-first migration test
(`V94OutputsMigrationSpec`) covering 2.11 (partial, hand-built fixture not
yet a real `pg_dump`), 2.12 (step-order preservation), and 2.13 (partial,
`outputs` RLS smoke test with a real `SET ROLE` non-superuser role and a
red-then-green policy-drop proof; `node_snapshots` RLS not yet smoke-tested
since nothing writes to it yet).

Two real regressions were found and fixed via a full `sbt test` run (NOT
skipped — this is exactly why 1b's "additive, nothing breaks" framing
matters):

1. **`panels.kind SET NOT NULL` broke every panel-insert path.** Originally
   followed ticket.md's literal "nullable -> backfilled -> SET NOT NULL"
   sequence. A full `sbt test` run showed 11 failures (500s on every
   panel-creation code path) because no current write path (PanelRepository,
   PanelService, proposal-apply) populates `kind` yet — that's task 3.6's
   job. **Fix:** deferred `SET NOT NULL` to land in the same commit as 3.6;
   kept a nullable CHECK constraint in the meantime. Documented inline in
   the migration file at that exact line.
2. **`node_snapshots`'s FKs made it TRUNCATE-CASCADE-reachable, and its
   BIGSERIAL identity column then broke `RESTART IDENTITY`.** A full `sbt
   test` run showed `BetaAccessRoutesSpec` failing with `must be owner of
   sequence node_snapshots_id_seq`. Root cause (probe-confirmed, not
   guessed): `BetaAccessRoutesSpec.afterEach` runs `TRUNCATE TABLE ...,
   users RESTART IDENTITY CASCADE`; `users -> pipelines -> node_snapshots`
   (via my new FKs) put `node_snapshots` in that cascade; Postgres's
   `RESTART IDENTITY` requires *ownership* of the identity sequence (not
   satisfiable via `GRANT UPDATE`, which is all the test harness's
   `helio_privileged` role has). `data_type_rows` (the table `node_snapshots`
   replaces) has the exact same BIGSERIAL shape but was deliberately built
   with **no FK** for this exact reason (V46's own comment: "matching the
   existing data_type_rows precedent"). **Fix:** dropped the FK constraints
   on `node_snapshots.pipeline_id`/`node_step_id` (referential integrity
   stays an application-level contract via
   `NodeSnapshotRepository.overwriteRows`'s delete-then-insert, same as
   `data_type_rows` today) — documented at length inline in the migration
   file so a future reader doesn't "helpfully" re-add the FK.

Both fixes are the kind of thing task 2.9/3.x work will keep surfacing —
every new table/column added ahead of its consumers needs this same
"does a full `sbt test` still pass" check, not just the new spec's own
green.

**Verification this cycle (confirmed, fresh):** `V94OutputsMigrationSpec`
8/8 green after both fixes. Full `sbt test` re-run: **3867/3867 passing**
(was 3859 before this cycle's migration work; +8 new), exit code 0,
confirmed by reading the actual completed run output — no regressions from
the two fixes above.

**Next cycle should:**
1. Confirm the full `sbt test` re-run above is green (or fix whatever it
   surfaces) before committing this cycle's work.
2. Commit section 2's additive slice (2.1-2.6, 2.11-2.13 partial) as its own
   commit.
3. Continue with 2.7 (alert_rules/alert_events retarget to
   `target_output_id`) and 2.8 (binary_refs re-key to `data_source_id` --
   inspect the dev DB first for any ref pointing at a pipeline-output type,
   per the ticket) — both are destructive/NOT-NULL-shaped changes, so apply
   the same "full `sbt test` before declaring done" discipline, and expect
   they may also need a deferred-NOT-NULL or FK-shape workaround if a
   pre-existing consumer isn't ready yet.
4. Then 2.9 (the 9-step data migration DML) and 2.10 (drops) — these are the
   ticket's most load-bearing, least-reversible pieces; do not rush them.
   2.10's drops in particular must not land before section 3/4's consumer
   rewires are complete (decision 1e) -- almost certainly a later cycle's
   work, not this migration file's next edit.
5. Deferred DB-backed remainder of 1.6/1.7 (sibling-scoped insert/reorder,
   splice-on-delete, and their tests) can land once 2.2's `parent_step_id`
   column is stable (it is, as of this cycle) -- worth picking up alongside
   or shortly after finishing section 2's DDL, per the earlier cycle's note.
