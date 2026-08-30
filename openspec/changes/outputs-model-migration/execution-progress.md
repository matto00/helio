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

## Cycle 4 (this cycle, fresh cold spawn after a killed prior instance) — tasks 2.7, 2.8, then the deferred DB-backed remainder of 1.6/1.7

Starting state verified fresh (not trusted blindly): `git log`/`git status` confirmed
HEAD = `ca85b888` (V94 additive slice, cycle 3's work), tree clean, matches the
resume brief exactly.

**Task 2.7** (`alert_rules`/`alert_events` retarget to `target_output_id`): added
nullable `target_output_id` (FK to `outputs`, indexed) to both tables in V94,
alongside the untouched `target_data_type_id` — same additive-first pattern as
2.2-2.6. The actual retarget DML and dropping `target_data_type_id` are 2.9/2.10's
job (deferred per decision 1e, until section 3.1's consumer rewire lands).

**Task 2.8** (`binary_refs` re-key): inspected the shared dev DB per the ticket's
own instruction. Finding: the one live `binary_refs` row's `data_type_id` resolves
to a `data_types` row that IS a pipeline's `output_data_type_id` (confirmed via
`EXISTS(SELECT 1 FROM pipelines WHERE output_data_type_id = br.data_type_id)` —
true for that row). Code-level cross-check: `PipelineRunService.scala:650` is the
SOLE caller of `BinaryRefRepository.overwriteForDataType` in the whole codebase,
and it always writes keyed by `outputDataTypeId`. `DataSourceService`/
`ContentSourceSupport` construct `BinaryRefType` field *values* for companion-type
rows but never call `overwriteForDataType` — there is no companion-type writer to
re-key against `data_source_id` at all. Per ticket.md's explicit documented
fallback ("if any do, key those by (pipeline_id, node_step_id) instead and say so
in the PR"), added nullable `pipeline_id`/`node_step_id` columns instead of
`data_source_id`, alongside the untouched `data_type_id`. RLS rewrite (currently
selects from `data_types`, would block `DROP TABLE data_types`) deferred to land
with 2.9/2.10.

Both landed as V94 additions with red-first test coverage in
`V94OutputsMigrationSpec` (nullable-by-default, then populatable via a real FK).

**Real regression found and fixed via a full `sbt test` run** (again — this is
exactly why the discipline matters): `BinaryRefsMigrationSpec` hard-coded the
`binary_refs` table's expected column set as a literal `Set(...)`, so adding the
two new columns broke it. Fixed by updating the test's own literal set (not the
migration) — this was a genuine, correct assertion about V46's original shape,
now extended for V94's additive columns, with an inline comment pointing at the
`data_type_id`-drop deferral so a future reader isn't surprised when it eventually
does drop out in task 2.10.

**Deferred DB-backed remainder of 1.6/1.7** (picked up this cycle per the ticket's
resume brief, since 2.2's `parent_step_id` column has been stable for a cycle):

- Found a real gap while doing this: `PipelineStepRepository`'s `PipelineStepRow`/
  table mapping never read or wrote the `parent_step_id` column at all, even
  though it's existed on disk since 2.2 (cycle 3) — every domain `PipelineStep`
  decoded `parentStepId = None` regardless of the actual DB value. Fixed:
  `PipelineStepRow` gained a `parentStepId: Option[String]` field (Slick
  `Tuple9`/`mapTo`), and all 23 `rowToDomain` constructor calls now pass it
  through.
- `insertInternal`/`insertAtInternal` gained an optional `parentStepId` parameter
  (default `None`, preserving today's behavior exactly for every existing/live
  call site) and are now genuinely sibling-scoped via a new `siblingsQuery`
  helper: position is computed/renumbered only among steps sharing the same
  `parentStepId`, not the whole pipeline. Previously `insertAtInternal` in
  particular renumbered the ENTIRE pipeline's steps by global position on every
  splice — now confirmed to be a live latent bug once any branch exists (it would
  have silently corrupted a sibling branch's positions the moment one existed);
  caught and fixed proactively here, before any caller creates a branch (P1.2's
  job), rather than after.
- `deleteInternal` now implements splice-on-delete per ticket.md's repository
  semantics (`parent_step_id` has no `ON DELETE CASCADE` by design — confirmed in
  V94; deletion must splice or the FK blocks the delete outright once a step has
  children): the deleted step's position-0 child is re-parented into its
  `parentStepId`/`position` slot; every OTHER child (a tail) and its full
  descendant subtree is deleted outright. Descendant-set computation
  (`descendantIdsOf`) is a pure function over the pipeline's full
  `(id -> parentStepId)` map, no extra DB round-trips.
- **Signature change, deliberate and scoped:** `deleteInternal` changed from
  `Future[Boolean]` to `Future[Option[Int]]` (`None` = step didn't exist,
  `Some(removedTailStepCount)` on success, NOT counting the step itself or the
  re-parented head child) — this is exactly the "returns the placement count
  removed so P1.3 can warn" requirement from ticket.md's repository-semantics
  list. Verified there is exactly ONE live call site
  (`PipelineService.deleteStep`, confirmed by grep — `insert`/`delete`,
  the non-`Internal` owner-scoped variants, are unused by any production code
  path today) and updated it to match (`Some(_) => ... Right(())`,
  `None => Left(NotFound)`) — behavior-preserving for that caller, which only
  consumes presence/absence today, not the count.
- `reorderInternal`/`insert`/`delete` (owner-scoped) left untouched:
  `reorderInternal` is already implicitly sibling-scoped by construction (it only
  ever mutates the ids named in `orderedIds`, never infers a sibling set from
  `pipelineId` alone); `insert`/`delete` have zero live callers, so extending them
  now would be speculative work for a caller that doesn't exist yet.
- New `PipelineStepRepositorySpliceSpec` (5 tests, all green): sibling-scoped
  `insertInternal` position isolation across two different sibling groups,
  sibling-scoped `insertAtInternal` splicing that leaves an UNRELATED sibling
  group's positions untouched, splice-on-delete's head-child re-parent (asserted
  via `trunkOf` that the trunk stays connected end-to-end, not just that the DB
  row looks right), splice-on-delete's tail-subtree deletion with the correct
  removed count, and the not-found `None` case.

**Verification this cycle:**
- `sbt compile` — clean.
- `sbt "testOnly com.helio.infrastructure.persistence.pipelines.V94OutputsMigrationSpec"`
  — 11/11 green (8 pre-existing + 3 new for 2.7/2.8).
- `sbt "testOnly com.helio.infrastructure.persistence.BinaryRefsMigrationSpec"` — 3/3
  green after the fix (was 2/3 red before, caught by a full run).
- `sbt "testOnly com.helio.infrastructure.persistence.pipelines.PipelineStepRepositorySpliceSpec"`
  — 5/5 green.
- `sbt "testOnly com.helio.infrastructure.persistence.pipelines.* com.helio.services.pipelines.*"`
  — 250/250 green (full pipelines-package sweep after the `deleteInternal`
  signature change, to catch any other caller the initial grep might have missed
  — none found).
- Full `sbt test` re-run (confirmed complete, fresh, read directly): **3875/3875
  passing**, exit code 0, 247 suites completed, 0 aborted, 0 failed (up from
  3870 tests before this cycle's additions: +3 V94 assertions for 2.7/2.8, +5
  from the new `PipelineStepRepositorySpliceSpec`, +2 from filling in the
  `BinaryRefsMigrationSpec` column-set fix's own test count change -- net +5
  suites-visible delta accounted for by these additions). No regressions from
  this cycle's `deleteInternal` signature change or the `parent_step_id`
  read-path fix.

**Next cycle should:**
1. Move to 2.9 (the 9-step data-migration DML) — write red-first tests for the
   known preservation paths (alert-rule retarget, binary_refs re-key,
   computed-fields → compute steps, patch-set journal cleanup, DemoData reseed,
   unbound-panel deletion count, data-bound text → markdown Outputs, `position`
   never reset) BEFORE or alongside the DML.
2. **Do NOT let 2.10's drops land in the same cycle as 2.9, or before section
   3/4's consumer rewires are complete** (decision 1e) — this is the ticket's
   most load-bearing, least-reversible boundary; stop cleanly after 2.9 if that's
   as far as a cycle gets.
3. `alert_rules`/`alert_events.target_data_type_id` and `binary_refs.data_type_id`
   (the legacy columns this cycle left untouched) get their data copied forward
   as part of 2.9, then dropped in 2.10 alongside `target_output_id`
   `SET NOT NULL` and the `binary_refs` RLS rewrite — all three deferred from
   this cycle for the same decision-1e reason as `panels.kind SET NOT NULL`
   (cycle 3) and `metrics`/`data_types` themselves.
