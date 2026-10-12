## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD: `1866b07305eb36091bc05d26937153c31c4131f1` (merge of origin/main `b5b5558bc`, HEL-1514).
Base: `b5b5558bc59e612179e1af4f4cf921a9b84da882`. I resolved it live with `resolve-review-base.sh` (exit 0) and diffed with `git diff $BASE...HEAD`.
I started cold. I read the evaluator's and executor's reports as claims to check, not as facts.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/editor-run-baseline-statuses/HEL-1503`.

**Diff scope.** The production diff touches 6 backend files: PipelineRepository, PipelineRunRepository, DataSourceRepository, PipelineRunExecutor, PipelineRunService (the constructor line only) and PipelineRunSucceededWrites. It touches 3 test files and 3 synced specs. It adds no migration, makes no protocol or JSON change, and touches nothing under `frontend/**`.

**HEL-1514 merge has no interaction with this change.**
- Upstream's backend surface is only `PipelineStepWrites.scala` and `DuplicateStepReferenceChecksSpec.scala`. Neither references `PipelineRunExecutor`, `ConcurrencyCapResult`, `updateLastSourceSchema`, `findByIdOwnedByInternal` or `PipelineRunRepository` (grep returned 0 hits).
- `git diff 2c53d3b55 1866b0730` over `PipelineRun*.scala` and `infrastructure/` is empty.
- `git merge-tree 2c53d3b55 b5b5558bc` merges clean.

**AC1: an editor's real run writes the baseline.**
- `PipelineRunSucceededWrites.scala:252` now reads the source with `findByIdOwnedByInternal(sourceDataSourceId, pipelineOwnerId)` on both branches.
- `:256-257` branches the write: if `ownerRun`, it calls `updateLastSourceSchema`; otherwise it calls `updateLastSourceSchemaInternal`.
- `pipelineOwnerId` is threaded from `executeRun` (`PipelineRunExecutor.scala:344`), so the owner is the pipeline's owner, not the submitter.
- Owner runs: the read filter is `id && owner_id == pipeline owner`, which for an owner run equals the old `findByIdOwned(.., user)`. Behaviour is unchanged, and the `[regression pin]` test passes.
- Dry runs and failed runs never reach this method, as before.

**AC2: a pipeline deleted mid-submit answers 404, never 5xx.**
- `PipelineRunRepository.scala:243-247`: `keyShareOwnerAction` is a plain-SQL `SELECT owner_id::text … FOR KEY SHARE` (`pipelines.id` is TEXT, V22). Both admission paths run it before the advisory lock.
- Owner path (`:152-161`): no row → `PipelineGone`; a different owner → `NotAuthorized`.
- Grantee path (`:226-235`): no row → `PipelineGone`.
- `PipelineRunExecutor.scala:181-182` maps `PipelineGone` to `NotFound("Pipeline not found: …")`.
- The empty-roots branch (`:54-61`) runs a privileged existence check: a missing pipeline → 404; a root-less pipeline that still exists → 422 (unchanged).
- Deadlock check: `pipeline-run-concurrency:` is used only by `concurrencyLockAction`, which is called only by the two admission paths (grep). Both take the locks in the same order, so there is no lock cycle with DELETE.

**AC3: a dry run re-checks access before it executes.**
- `PipelineRunExecutor.scala:184-193` calls `checkRunAuthorizationInternal` for every dry run.
- It runs after the rate-limit check and before the `queued`/`running` publishes and `backend.execute` (`:195-217`).
- `NotAuthorized` → 403; `PipelineGone` → 404.

**AC4: spec text.**
- `openspec/specs/pipeline-run-guard/spec.md`: the requirement is renamed to "…enforces the pipeline owner's concurrency cap", and the Purpose is rewritten.
- `pipeline-run-execution/spec.md`: the Purpose is written; `grep TBD` finds 0 hits in either spec.
- `pipeline-schema-drift` and `pipeline-run-execution` carry the new requirements and scenarios, and they match the code paths above.

**AC5.** The repository was not split, and no API or protocol exposes `triggered_by_user_id` (the diff has no protocol or route files).

**AC6.** No migration. The red run, mutations and green runs are recorded in `red-run.md`.

**RLS realism.**
- The spec runs on `VerifiedEmbeddedPostgres.start` as a `NOSUPERUSER NOBYPASSRLS` role that owns the tables.
- `pipelines` has `FORCE ROW LEVEL SECURITY` (V35:29, re-asserted in V94:1309), so owner-path RLS really applies. That includes the owner-context `FOR KEY SHARE` read, which `(e)`'s owner case exercises.

**Privileged-write and privileged-read safety.**
- `updateLastSourceSchemaInternal` is keyed on the pipeline id. It is reached only when `!ownerRun`, i.e. for an editor run admitted through `insertGranteeRunIfUnderOwnerCap`'s in-transaction re-authorization.
- `findByIdOwnedByInternal` keeps an explicit owner filter, so it shows no more than the owner's own view.
- `checkRunAuthorizationInternal` is read-only.
- Every new `withSystemContext` site has its inline justification comment.

**404/403/422 boundaries.** Each boundary is pinned by a test that passed when I ran it:
- 404 for S1 and S2, owner and editor, real and dry.
- 403 for a revoked editor's dry run.
- 422 for a root-less pipeline that exists.
- The inverted test in `PipelineRunEditorPersistenceSpec`: a missing pipeline is `PipelineGone` on both paths (inverted, not deleted).
- `ExistenceNotLeakedRoutesSpec`: the Forbidden-producer count for the executor goes from 1 to 2, with the new producer classified in design.md D4.

**Gates I re-ran myself at HEAD, in WORKTREE_PATH.**
- Before running, MemAvailable was about 49 GB and no other sbt was running.
- Command: `nice -n 19 sbt -J-Xmx3g "testOnly Hel1503EditorRunGapsSpec PipelineRunEditorPersistenceSpec ExistenceNotLeakedRoutesSpec PipelineRunRepositorySpec"`. Exit 0.
- `Suites: completed 4, aborted 0`; `Tests: succeeded 134, failed 0`.
- `[info] [hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`.
- I did not run a full testFull. The evaluator's evaluation-3 pastes a testFull at this same HEAD: 7354 succeeded, 0 failed, with the guard line present.

**Independent mutation, new and not in red-run.md.** The point was to test whether the lock-order claim in D3 is actually pinned.
- I exported HEAD's `backend/` and `schemas/` with `git archive` into a scratch dir: `scratchpad/HEL-1503-skeptic-final-2/mut`. The worktree was not modified.
- Mutation: on the owner path, take `concurrencyLockAction` BEFORE `keyShareOwnerAction`, and drop the later lock.
- I ran `Hel1503EditorRunGapsSpec` against it. sbt compiled 522 main and 588 test sources fresh, then exited 1:
  - `should hold a key-share lock on the pipeline row while the OWNER path waits for the advisory lock *** FAILED ***`
  - `Expected exception java.sql.SQLException to be thrown, but no exception was thrown (Hel1503EditorRunGapsSpec.scala:324)`
  - `[hel1468-guard] ScalaTest summary: failed=1`; succeeded 12.
- So the lock order is pinned, not just whether a key-share lock is present. The mutation broke exactly the one test it should.
- The sbt process exited; I left no server running.

**Red-first.** `red-run.md` shows 10 of 13 tests red on unchanged main, each for the intended reason:
- the baseline was NULL;
- 422 instead of 404;
- 403 for S2;
- the dry run executed;
- DELETE was not blocked.

The 3 tests that pass on main are labelled truthfully as pins. Mutations M1–M7 each name the test they broke. The new tests exercise the fixed paths through the real `PipelineRunService.submit`, with a spy backend counting executions.

### Verdict: CONFIRM

### Non-blocking notes
- `evaluation-3.md` is untracked in the archive directory (`git status`: `??`). It and this report need committing to the branch along with the other archive artifacts.
- The `pipeline-run-guard` spec sync moved the renamed requirement to the end of the file. The "uniform trigger" and "Limits configurable" requirements, unchanged, now sit above it. The text is identical; only the order changed.
- A revoked editor's step *preview* (`PipelineRunPreview`, not a dry run) still executes. That is outside item 5 as ruled; a possible follow-up if the owner wants parity.
- If `findByIdInternal` itself throws in the empty-roots branch, the error surfaces as a failed Future, which matches the failure semantics of the repository calls around it.
