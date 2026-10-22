## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `907235c4e68eb944d099419e5d2809c02a35bf97`. The base was resolved live with `resolve-review-base.sh`: `b0f1c89ab0073b11b8428d5e58a9a4e3c70c7059` (origin/main, which includes HEL-1703). The diff `b0f1c89ab...HEAD` contains only the HEL-1652 changes: 2 main files, 7 test files, and the openspec change dir. The merge brought in no other code.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/editor-pipeline-root-writes/HEL-1652`.
- **Fixture is NOBYPASSRLS:** `DraftSaveApiFixture extends TwoUserRlsApiFixture`, whose app pool is `helio_app_test`, created `NOSUPERUSER NOBYPASSRLS` (`TwoUserRlsApiFixture.scala:126-144`).
- **Targeted suites are green at HEAD.** This was a fresh run: `testOnly DraftSaveRlsSpec PipelineRootRemoveAtomicitySpec PipelineRootWriteGrantsSpec DraftSaveRaceSpec` gave "Tests: succeeded 164, failed 0" across 4 suites.
- **Red-first and the D7 mutations, re-run by me:**
  - I reverted `PipelineRootRepository.add` to `ctx.withUserContext(user.id.value)`.
  - I reverted `PipelineRootWrites.removeRoot` to the old `pipelineRepo.runTransactionally(user)` composition.
  - Result for `DraftSaveRlsSpec`: 6 passed, 3 failed. The failures:
    - editor add: `{"message":"Internal server error"} 500 ... was not equal to 201 Created`. This is the ticket's 500.
    - editor remove: `Vector(ds1, ds2) was not equal to Vector(ds1)`. This is the ticket's false 200 with no change.
    - editor cycle add: 500 instead of 400.
  - Viewer 403 / stranger 404 and owner add/remove stayed green under the mutation, so the refusals do not depend on the privileged path.
  - I restored the code with `git checkout -- backend/src/main`. `git status` shows no source changes.
- **D5 mapping mutation (the evaluator stated it did not run this one):**
  - I deleted the `case PipelineRootRepository.RootAlreadyRemoved(id) => ...NotFound` line at `PipelineRootWrites.scala:215`.
  - `PipelineRootRemoveAtomicitySpec` then failed with `Left(InternalError("Internal server error")) was not equal to Left(NotFound("Root not found: ...-r2"))`. So the 404 test really guards against a 500.
  - The seam test, which checks that the cascade is rolled back, stayed green.
  - Restored.
- **No cross-tenant write from the privileged move.** I read each statement in both chains:
  - **Add (`PipelineRootRepository.scala:81-107`).** The service checks run before any write:
    - `findByIdShared(pipelineId, user)`: a stranger gets 404.
    - The owner-or-`requireEditorAccess` check: a viewer gets 403.
    - `dataSourceRepo.findByIdOwned(dsId, user)` (`DataSourceRepository.scala:180-185`) uses an explicit `owner_id === actor` filter on user context. An editor therefore cannot attach the owner's or a third party's source.
    - The privileged statements are `FOR KEY SHARE` by source id, the pipeline name by id, and the cycle guard. The guard's `findReadEdgesVisibleTo` and `findUpsertWriteEdges` (`PipelineStepRepository.scala:185-204`) use explicit owner-or-grantee joins, not RLS. Then come the advisory lock, `max(position)` filtered by `pipelineId`, and the insert with the authorized `pipelineId`.
  - **Remove.** Phase 1 builds `roots` from `listRootDataSourceIdsInternal(pipelineId)` and returns 404 if `rootId` is not in it, so an editor of P cannot name Q's root. In phase 2:
    - `removeRootCascadeAction` filters steps by `pipelineId`, and both `node_snapshots` deletes are `WHERE pipeline_id = ...`.
    - The step delete uses ids taken from those rows.
    - `removeAction` is now filtered by `id AND pipelineId`.
    - `compactPositions` is filtered by `pipelineId`.
  - Every privileged statement is scoped by an id the service has already authorized. I found no RLS-supplied filter that the move drops.
- **D6 grants:** `PipelineRootWriteGrantsSpec` (inside the 164 that passed) asserts `has_table_privilege('helio_privileged', ...)` on the non-superuser migration-only harness. It covers INSERT/UPDATE/DELETE on `pipeline_roots`, DELETE on `pipeline_steps`/`node_snapshots`, and UPDATE on `data_sources`.
- **Callers:** `removeAction` and `.removeRoot(` have no remaining callers outside the shared method and the service (grep). There is no other path that still uses the old user-context composition.
- **The ACs, one by one:**
  1. Red-first editor add/remove on NOBYPASSRLS: `DraftSaveRlsSpec` "let an editor add..." and "let an editor remove...". Red was reproduced by the mutation above.
  2. Viewer and stranger still refused, with state unchanged: `DraftSaveRlsSpec` "refuse a viewer (403) and a stranger (404)...". It asserts `storedState` is unchanged.
  3. (e) Editor draft flow: the existing `DraftSaveRlsSpec` "let an editor read the pipeline, save it unchanged and get 200..." and "stamp Outputs and steps an editor creates..." both pass at HEAD.
  4. Never a 500 and never a false 200 on either route, for any role:
     - Owner/editor get a real 201/200 with read-back.
     - Viewer gets 403 and stranger gets 404.
     - Editor cycle add gets 400 with nothing written.
     - A racing 0-row remove gets 404 with the rollback proven.
- **Rule decision D1** (editors allowed) is delegated by the ticket and the spec delta matches it. Task 4.1 (the PR body discloses consequences a-c) is still open and belongs to the orchestrator at Delivery.
- **UI:** the diff is backend-only, so the visual judgment step does not apply. No screenshots were taken, so no evidence persistence was needed.
- **Full suite:** I did not re-run `sbt testFull`. The evaluator's cycle-2 report quotes the exit 0 and "succeeded 9433, failed 0" for cf0ca4987. Since then the only change is the HEL-1703 helio-mcp lockfile merge, which touches no backend code.

### Verdict: CONFIRM

### Non-blocking notes
- The diff has no test that an editor adding the owner's own source, or a third party's source, gets 404. It also has none for an editor of P naming Q's root id. Both are enforced by unchanged, explicitly filtered code (`findByIdOwned`, the phase-1 `roots.exists`), and I checked them by reading the code. A NOBYPASSRLS regression test for each would pin the cross-tenant boundary now that the write itself bypasses RLS.
- Task 4.1 must actually land in the PR body. D1 newly lets editors delete the owner's steps/Outputs and unbind panels, and the owner needs consequences (a)-(c) to be able to overturn it.
