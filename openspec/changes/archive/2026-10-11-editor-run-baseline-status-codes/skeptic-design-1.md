## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 60bcd8646f30a8c840048b1bbc24231d7df57ad0. The change dir is untracked, so these are the artifacts as they sit on disk.

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/editor-run-baseline-statuses/HEL-1503`.
- **The deltas are structurally valid:** `openspec validate editor-run-baseline-status-codes --strict` returned "is valid".
  - The RENAMED FROM title matches `openspec/specs/pipeline-run-guard/spec.md:34` exactly ("Pipeline-run submission enforces a per-user concurrency cap"). A delta file that holds only a RENAMED block is valid for archive.
  - The MODIFIED `pipeline-schema-drift` requirement keeps both base scenarios (`openspec/specs/pipeline-schema-drift/spec.md:9-23`) and adds one.
- **Item 1 premise is correct.**
  - `PipelineRunSucceededWrites.scala:247-256` reads with `findByIdOwned(sourceDataSourceId, user)` and writes with `updateLastSourceSchema(.., user)`.
  - `PipelineRepository.scala:552-560` filters on `ownerId === caller` under `withUserContext`, so an editor's run writes 0 rows.
  - The `ownerRun` branch pattern D1 copies exists at `PipelineRunTerminalWrites.scala:59-60` (`updateLastRun` / `updateLastRunInternal`).
  - D1 and D2 together are sound and consistent with HEL-1492 D2 ("authorize at admission", archive design.md:32-50).
- **Item 4 premise is correct.**
  - Owner path: `insertRunIfUnderConcurrencyCap` takes the advisory lock, then runs `pipelineOwnedAction`. `!owned` returns `NotAuthorized`, which becomes 403 at `PipelineRunExecutor.scala:162-165`.
  - Grantee path: it reads `owner_id` unlocked before the advisory lock (`PipelineRunRepository.scala:218-228`).
  - Neither path locks the `pipelines` row. A DELETE that commits between the read and `insertRunRowAction` therefore hits the RI check, raises 23503, and the error is unmapped. The window exists on both paths, not only the grantee path.
  - `PipelineRepository.delete` (:482-487) is a single owner-scoped DELETE that takes no advisory lock, so `FOR KEY SHARE` plus the advisory lock cannot form a deadlock cycle.
- **FOR KEY SHARE under RLS works on both paths.**
  - Grantee path: it runs in `withSystemContext` on the privileged pool (`DbContext.scala:63`, `helio_privileged` BYPASSRLS). V38:19 grants that role UPDATE on all tables, so the lock is allowed.
  - Owner path: under `withUserContext(owner)`, a row-locking SELECT applies `pipelines_select` and `pipelines_update` USING (V39:79-89, `owner_id = current_user_id`). The owner passes both, so the owner path works.
  - The same RLS filtering creates a classification problem, raised in CR2.
- **The 23503 mapping is unnecessary once the lock exists.**
  - With `FOR KEY SHARE` held from the read to the insert in one transaction, a concurrent DELETE either committed earlier (the read returns no row, so `PipelineGone`) or waits for the admission to commit. That makes 23503 on the insert unreachable.
  - The mapping is defence in depth only, which matters for CR3.
- **D4 belongs after the rate-limit check.**
  - It sits in the same position as real-run admission (rate limit, then admission), so it is consistent with real runs. It also keeps the re-check as close as possible to `backend.execute`, which is what the owner ruling and the spec text ("immediately before executing") ask for.
  - The existing `PipelineRunEditorPersistenceSpec` test "write no dry_run row for a revoked editor's dry run" revokes after the backend has entered, so it stays green under D4 (an accepted race).
- **D6 (a) and (b) can fail.** If the read is reverted to `findByIdOwned`, an editor gets `None`, which becomes `[]`. If the write is reverted to `updateLastSourceSchema`, the stored value is `NULL`. Both are fine provided the seeded source is owned by the pipeline owner and has a non-empty `inferredSchema`.
- **The HEL-1492 reference spec does not exist under that name.**
  - `grep -rn "class Hel1492ReproSpec" backend/src/test` returns nothing.
  - `git log -S` shows the name only in HEL-1492's history. The surviving NOBYPASSRLS harness is `backend/src/test/scala/com/helio/services/pipelines/PipelineRunEditorPersistenceSpec.scala`: it creates `NOSUPERUSER ... NOBYPASSRLS` at :62, and a `StaleGrantPipelineRepository` seam at :494.
- **Existing tests D3 changes:**
  - `PipelineRunRepositorySpec.scala:629-637` pins `insertRunIfUnderConcurrencyCap` returning `NotAuthorized` for a non-owner (`otherUser`).
  - `ExistenceNotLeakedRoutesSpec.scala:532` pins `PipelineRunExecutor.scala -> 1` Forbidden producer.
  - `PipelineRunService.submit` (:192-193) already uses `NotFound("Pipeline not found: " + id)`, so D3's message is consistent.

### Verdict: REFUTE

### Change Requests

1. **Fix the reference harness name (design.md D6 and tasks.md 1.1).** `Hel1492ReproSpec` does not exist. Point both artifacts at `backend/src/test/scala/com/helio/services/pipelines/PipelineRunEditorPersistenceSpec.scala`, which has the NOSUPERUSER NOBYPASSRLS role setup at :58-75, the advisory-lock-holder pattern at :442-458, and the `StaleGrantPipelineRepository` seam at :494. As written, the executor's first task points it at a file that is not there.

2. **D3 owner path: specify the lock-read and its classification, and account for `PipelineRunRepositorySpec.scala:629`.**
   - The problem: under `withUserContext(submitter)`, any SELECT of a pipeline the submitter does not own returns no row. For `FOR KEY SHARE` that is the V39 `pipelines_update` USING; for a non-grantee it is also `pipelines_select`. So in the NOBYPASSRLS harness, "row absent → `PipelineGone`" classifies an existing pipeline submitted by a non-owner as Gone.
   - In the superuser harness `PipelineRunRepositorySpec` uses, an id-only read returns the row instead. The same input then classifies differently depending on the harness: the RLS-parity trap MISTAKES.md warns about.
   - "Invert, never delete" would lead the executor to flip the :629 pin to `PipelineGone`, which says a pipeline that exists is gone.
   - Required:
     - (a) State the exact read: plain SQL, e.g. `SELECT owner_id FROM pipelines WHERE id = ? FOR KEY SHARE`. Slick has no key-share lock modifier, and a row lock cannot sit inside the `.exists` wrapper `pipelineOwnedAction` uses.
     - (b) State the result for each case: row with owner == submitter, row with another owner, no row. Say explicitly that on the owner path, under RLS, a non-owner sees no row.
     - (c) Decide the disposition of `:629`. Either pin it as "never `Inserted`, nothing written", accepting the RLS-context result, or make the classification harness-independent. Record that `NotAuthorized` is unreachable on the owner path in production: the executor calls it only when `ownerRun`, and there is no ownership-transfer write anywhere in `backend/src/main/scala`.
     - (d) Replace the D3 fallback sentence. "Take the lock in `pipelineOwnedAction`'s read instead" runs in the same RLS context, so it is no alternative. Record the actual analysis instead: the owner passes `pipelines_update` USING, so `FOR KEY SHARE` works there.

3. **D3/D6(d): resolve the 23503 defence-in-depth, which as written is unreachable and has no defined test.**
   - With the row lock in place, no 23503 can occur, so "a 23503 injected at insert must map to 404" names no way to inject one. Either drop the mapping and its test, or specify both of the following:
     - (i) Where the mapping lives: at the `Future` boundary, i.e. `recover` on `PSQLException` with SQLState 23503 around the `withUserContext`/`withSystemContext` call. Not via `asTry` inside the transaction: the failed statement aborts the transaction, and the following COMMIT can itself throw from pgjdbc, which surfaces as a 500 anyway.
     - (ii) How it is exercised: for example, the named mutation "remove `FOR KEY SHARE` from the grantee path" combined with the advisory-lock-holder interleaving, so the DELETE commits before the insert.
   - Separately, D6 claims every guard can fail under a named mutation, but no deterministic test can fail when `FOR KEY SHARE` is removed from the owner path. The read and the insert are adjacent in one DBIO, and the 23503 mapping would hide a race anyway. Either name a test that does fail, or say plainly in design.md that the owner-path lock is unguarded.

4. **Add a D6 case for AC2's dry-run dimension.** AC2 and the new `pipeline-run-execution` requirement cover "owner or editor, real or dry", but D6 (a)-(f) has no dry run on a pipeline deleted after the ACL read. Add a case (g): a dry run for a pipeline deleted between `submit`'s ACL read and the D4 re-check returns 404, the spy backend never runs, and no row is written. The `StaleGrantPipelineRepository`-style seam makes this deterministic. Name the mutation that fails it, e.g. collapsing `PipelineGone` into `NotAuthorized` in the D4 mapping.

### Non-blocking notes

- **D4 placement.** Say explicitly that the re-check goes inside `preExec`'s dry branch (`PipelineRunExecutor.scala:146-168`), before the HEL-1370 `queued`/`running` publishes. A check placed after them but still "before `backend.execute`" would emit `queued` with no terminal event. Also guard `pipelineRunRepo == null`, as `preExec` already does: many fixtures pass no repository, and an unguarded dry-run call would throw an NPE in them.
- **D6(d) determinism.** The repo's own pattern works here: hold `pg_advisory_lock(hashtext('pipeline-run-concurrency:' || owner))` on a separate connection. The grantee admission then takes the `FOR KEY SHARE` read and blocks on the advisory lock. Run the DELETE on another session with `SET lock_timeout = '500ms'` and assert SQLState 55P03, instead of using a sleep plus an `isCompleted` check.
- **D2 asymmetry.** It is worth calling out, and it is not blocking.
  - The executor already has the authorized, privileged root source in hand: `roots.head._2`, from `resolveAllRootDataSourcesInternal`, passed as `roots.head._2.id`.
  - Reading the baseline through `findByIdInternal` unconditionally, or using `roots.head._2.inferredSchema`, would remove the editor-only branch. It would also fix the owner-side `[]` baseline the Planner Notes defer, for example when an editor added a root bound to their own source.
  - Keeping it owner-scoped is a defensible, behaviour-preserving choice, but the planner should state why it rejected the uniform read.
- **The D4 mapping adds a second `ServiceError.Forbidden(` producer to `PipelineRunExecutor.scala`.** Update `ExistenceNotLeakedRoutesSpec.expectedForbiddenProducers` from 1 to 2, with a classification note, unless the mapping is shared.
- **Existence oracle (owner-ruled, not a defect).** The ruled 403-vs-404 split tells a just-revoked editor whether the pipeline still exists. It is narrow (the race window only) and owner ruling A covers it. Record it in design.md for the existence-leak classification.
- **D6(a)/(b) seeding.** The source must be owned by the pipeline owner, not the editor, or the `findByIdOwned` revert mutation passes vacuously.
