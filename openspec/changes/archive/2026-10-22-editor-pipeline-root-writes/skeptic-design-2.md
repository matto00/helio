## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 14c08def8a69f78fe1f81fcb86a7a3d928d06ab3. The change directory holds untracked planning artifacts
only. `openspec validate editor-pipeline-root-writes --strict` reports the change as valid.

### Round-1 change requests: re-verified against the code

- **CR1 (C5 tripwire and race certification): partly addressed.**
  - Task 1.1 replaces the two C5 tests (`DraftSaveRlsSpec.scala:58-88`, confirmed: they assert 500 and an `OK` no-op).
  - D4 states that W29/W30's "no editor race" is now false.
  - Tasks 3.2 and 3.3 add an editor root-add race case and run the race and deadlock specs.
  - **But D4's central claim is false for remove.** See new CR1 below.
- **CR2 (cycle guard): addressed.**
  - D2 documents the behaviour change. I confirmed it in the code:
    - `checkAddReadAction` (PipelineCycleGuard:117-136) reads `findUpsertWriteEdges` (PipelineStepRepository:185-200).
    - That query joins `pipeline_steps`. Under user context `pipeline_steps` is owner-only, so the check passes vacuously for an editor.
  - Task 1.3 tests it. Reachability caveat in the notes.
- **CR3 (restate D1): addressed.**
  - D1 records the decision as delegated and newly effective in prod.
  - It cites the HEL-913 "privilege escalation" framing.
  - It lists consequences (a), (b) and (c) for the PR body.
- **CR4 (production grant): addressed.**
  - D6 and task 2.5 plan the grant check.
  - The named harness exists: `ProductTelemetryDbHarness.scala:57-68`. It migrates as `helio_migration_test NOSUPERUSER NOBYPASSRLS`, has no blanket post-migrate grant, and its privileged pool runs `SET ROLE helio_privileged`. A `has_table_privilege` check there is feasible and meaningful.
- **CR5 (D5 seam; mutation of both verbs): addressed.**
  - D5 names where the 0-row case becomes a 404: before the generic `.recover { case ex => Left(classifyDbError(ex)) }` at PipelineRootWrites:219.
  - D5 names the test seams.
  - Task 3.1 requires both mutations.

### Other checks

- `DbContext.withSystemContext` is `privilegedDb.run(action.transactionally)` (DbContext:63-64), and `withUserContext` is transactional too (:50-51). Moving `add`'s chain to the system context keeps it atomic: the source `FOR KEY SHARE`, the cycle-guard advisory lock, `hel1629_lock_pipelines` and the insert stay in one transaction.
- `hel1629_lock_pipelines` is `SECURITY DEFINER`, `row_security = off`, and owned by `helio_privileged` (V137:42-71). The privileged pool (role `helio_privileged`) owns it, so it can execute it. D3 holds.
- Editor step delete already runs privileged: `deleteInternal` → `ctx.withSystemContext` (PipelineStepRepository:1033-1035). D2's precedent holds.
- No live spec conflicts with the new capability:
  - `pipeline-multi-root`, `pipeline-root-editor-ui`, `mcp-pipeline-root-tools` and `pipeline-zero-root-db-guard` contain no owner-only or grantee rule for root writes.
  - "Modified Capabilities: none" is correct.
- AC coverage:
  - Editor add and remove: tasks 1.1, 2.1 and 2.2.
  - Viewer 403 and stranger 404: task 1.2.
  - Never a 500 and never a false 200: D5 and task 2.3.
  - (e): DraftSaveRlsSpec:14-48 covers editor draft save on NOBYPASSRLS, plus the evaluator UI check. HEL-1631 is Done; it is draft mode and Save & run, which use HEL-1629's save.

### Verdict: REFUTE

### Change Requests

1. **D4/3.3 would certify the new remove path with specs that never run it. Route the remove transaction through one
   shared method that production and the race specs both call.**

   Four specs compose the remove transaction themselves and run it on the **user-context** runner:
   - `DraftSaveRaceSpec.scala:142-146` (`h.pipelineRepo.runTransactionally(userA)(removeRootCascadeAction andThen removeAction andThen compactPositions)`)
   - `DraftSaveDeadlockSpec.scala:81-83` (same composition)
   - `PipelineCascadeLockOrderRaceSpec.scala:85-87`
   - `OutputDeleteRacesPanelCreateSpec.scala:126-128`

   None of them goes through `PipelineRootWrites.removeRoot`. After D2 switches removeRoot to a privileged runner and D5
   adds the 0-row abort inside the service-composed action, those four specs still exercise the old
   `withUserContext` composition. D4's statement that "the owner-actor race/deadlock specs … exercise the editor's path
   too" is therefore false for root remove. Task 3.3 would report green output that measures code production no longer
   runs.

   The root-add writers (`DraftSaveRaceSpec:139-141`, `DraftSaveDeadlockSpec:215`) do call `rootRepo.add` directly, so
   they will exercise D2's change. Remove is the only gap.

   Required revisions:
   - **Shared method.** Have the design extract the phase-2 remove transaction into a single method that both
     `removeRoot` and the race specs call, so test and production composition cannot drift. Put it in the repository
     or the service. It covers the cascade, the `pipelineId`-scoped `removeAction` with the D5 0-row abort, and
     `compactPositions`, all run privileged.
   - **Spec updates.** Add a task to change all four specs to call that method.
   - **Revised D4.** State that the remove race and deadlock specs now run the production composition.
   - **Mutation check.** Add one: point the shared method back at `runTransactionally(user)` and show that an
     editor-actor remove case (or the editor-remove API test) goes red. This proves the race specs and the production
     path share the runner.

### Non-blocking notes

- **Task 1.3: reachability of the cycle.** The obvious construction is unreachable through the API. "P reads S and P writes S" needs S owned by the editor (root sources are `findByIdOwned` by the actor, PipelineRootWrites:138) and by the pipeline owner (upsert targets are checked against the pipeline OWNER, PipelineServiceSupport:184-198).
  - A reachable cycle is longer. Owner A holds an editor grant on B's pipeline Q and adds A's dataset T as a root of Q (this change's editor add). Q upserts into B's dataset S. A's pipeline P upserts into T. B, as an editor on P, adds S as a root of P. The cycle is P→T→Q→S→P, and the edge P→T is visible to B only on the privileged pool.
  - Seeding the edges by SQL still exercises the mechanism. Say which one the test does, so the evaluator does not read a seeded but unreachable state as product behaviour.
- **D6 scope.** On the privileged pool the add chain also runs `SELECT … FROM data_sources … FOR KEY SHARE` (PipelineRootRepository:93). Postgres requires UPDATE privilege for row-locking selects, and this is the first privileged-pool row lock on `data_sources` in main. V38's blanket grant covers it. Including `UPDATE` on `data_sources` in the same `has_table_privilege` check costs nothing.
- **D5 rollback assertion.** Calling the DBIO with a nonexistent root id makes "full rollback" trivially true, because the cascade also deletes nothing. The more meaningful variant leaves steps under the root whose row has already gone, if V98's FK allows that, or deletes the root between phase 1 and phase 2. Prefer the variant where the cascade deletes something.
- **Proposal Impact vs D6.** Proposal Impact says "no migration", while D6 allows a grant migration if the check is red. Keep the two consistent if the check does go red.
- **PR body.** No task covers the D1 consequences in the PR body; it is left to delivery. The orchestrator should carry it.
- Previous non-blocking note still open: `add` on a pipeline deleted mid-flight gives a 500 (`pipelineNameQuery.result.head`). This is pre-existing and race-only.
