## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 14c08def8a69f78fe1f81fcb86a7a3d928d06ab3. The change directory holds untracked planning artifacts
only. `openspec validate editor-pipeline-root-writes --strict` reports "Change 'editor-pipeline-root-writes' is valid".

### What I verified (with evidence)

- **Round-2 CR1 (shared remove transaction): addressed.**
  - I checked the four hand-built compositions myself (grep for `removeRootCascadeAction`):
    - `DraftSaveRaceSpec.scala:142-144` and `DraftSaveDeadlockSpec.scala:82-83` compose cascade, `removeAction` and
      `compactPositions` on `runTransactionally(userA)`.
    - `PipelineCascadeLockOrderRaceSpec.scala:85-87` and `OutputDeleteRacesPanelCreateSpec.scala:126-128` compose
      cascade and `removeAction` only, on `runTransactionally(pipelineOwner)`.
  - Production composes the same transaction at `PipelineRootWrites.scala:211-216`.
  - D4 now requires ONE shared privileged method that `removeRoot` and all four specs call. Task 2.2 creates it,
    task 2.2a repoints the specs, and task 3.1 adds the runner mutation. The defect I raised is closed.
  - Production has exactly one caller of each path (`PipelineRoutes.scala:99/107` → `PipelineService:145/148` →
    `PipelineRootWrites`; `pipelineRootRepo.add` only at `PipelineRootWrites:141`). No other writer is left on the
    old path.
- **D2 cycle-guard behaviour change: correct.** `checkAddReadAction` (PipelineCycleGuard) reads
  `findUpsertWriteEdges` (PipelineStepRepository:185-200).
  - That query filters explicitly by owner-or-grantee visibility. Under user context it is also AND-ed with
    `pipeline_steps` owner-only RLS, so an editor sees none of the owner's `upsertsource` steps.
  - On the privileged pool the explicit filter alone applies. The new 400 is real, and task 1.3 tests it.
  - The explicit filter also prevents over-visibility on the privileged pool: invisible pipelines contribute no
    edges, so no false cycle and no leaked pipeline name.
- **D2 statement scoping.**
  - `add`: the source lock filters by `id`; `pipelineNameQuery` and `nextPositionQuery` filter by `pipelineId`.
  - remove: `removeRootCascadeAction` (PipelineStepRepository:1277-1295) filters every read and delete by
    `pipelineId`, and the step delete uses ids derived from those rows. `compactPositions` filters by `pipelineId`.
    `removeAction` (`rootId` only, PipelineRootRepository:155) gains a `pipelineId` filter under D2.
- **Precedent claim (privileged write after a service-level check): true.**
  - `DraftSaveService.scala:95/105` runs HEL-1629's save through `runPrivileged` after the access check.
  - `runPrivileged` is `ctx.withSystemContext` (PipelineRepository:311).
  - `runTransactionally` is `withUserContext` (PipelineRepository:527).
- **D1:** an accurate delegated-decision statement with consequences (a)-(c). Task 4.1 carries it into the PR body.
  The ticket explicitly delegates the rule, so this is not an escalation.
- **D6 / proposal consistency.**
  - Proposal Impact now says "a grant migration only if the D6 check shows…", which is consistent with D6.
  - D6 scope includes `data_sources` UPDATE, for the `FOR KEY SHARE`.
  - The harness exists: `ProductTelemetryDbHarness.scala:60-68` migrates as `helio_migration_test NOSUPERUSER
    NOBYPASSRLS`, and its privileged pool `SET ROLE helio_privileged` (:80).
  - The fixture's blanket grant hides a missing grant, as D6 says (`TwoUserRlsApiFixture` `GRANT ... ON ALL TABLES ...
    TO helio_privileged`).
- **The NOBYPASSRLS fixture proves the RLS half.**
  - `TwoUserRlsApiFixture` migrates as `postgres`, so `postgres` owns the tables, and the app pool is
    `helio_app_test NOSUPERUSER NOBYPASSRLS`.
  - The C5 tests being replaced (`DraftSaveRlsSpec.scala:57-88`) assert exactly the ticket's 500 and no-op 200.
- **AC coverage.**
  - Red-first editor add and remove on the fixture: tasks 1.1, 2.1 and 2.2, with red output recorded, plus the
    3.1 mutations.
  - Viewer and stranger refusal: task 1.2 and the spec scenarios.
  - Never a 500 and never a false 200: D5, task 2.3 and the spec requirement "success means removed".
  - (e): `DraftSaveRlsSpec:14-48`, plus the evaluator's UI check. I found no placeholders or TBDs, and no
    contradiction between the proposal, design, tasks and spec.

### Verdict: CONFIRM

### Non-blocking notes

- **D5 seam: only one of the two named options works.** The other is infeasible. `pipeline_steps.root_id REFERENCES
  pipeline_roots(id) ON DELETE CASCADE` (V98:119), so deleting the root row beforehand also deletes its steps, and the
  cascade then has nothing left to delete. Use the in-transaction hook between the cascade and `removeAction`, for
  example an optional hook DBIO on the shared method, in the style of `DraftSaveHooks`. It deletes the root row
  in-transaction after the cascade, so `removeAction` gets 0 rows and the restored steps and snapshots prove the
  rollback is real. A hook on another connection would block on the step rows the transaction has already deleted.
- **Mutation 3.1 depends on the runner being swappable.** "Point the shared method at the user-context runner"
  needs a user id. The shared method should take the acting user, or a runner seam, so the mutation can be applied
  without a different code shape.
- **The race harness may expose D6 early.** The four repointed specs use `LockRaceSupport.racePool(Some("SET ROLE
  helio_privileged"))` after a `flyway(None)` migrate. A permission error there is a real grant signal, not test
  flakiness.
- **Pre-existing and out of scope:** grant revocation between the service-level editor check and the privileged
  transaction is not re-checked in-transaction. This matches the draft save and step writes.
- **Still open (pre-existing, race-only):** `add`'s `pipelineNameQuery.result.head` throws a 500 when the pipeline
  is deleted mid-flight (already noted in Planner Notes).
