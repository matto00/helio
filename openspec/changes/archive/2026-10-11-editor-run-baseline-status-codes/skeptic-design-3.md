## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 60bcd8646f30a8c840048b1bbc24231d7df57ad0. The change dir is untracked; I reviewed the artifacts as they sit on disk. All findings come from reading the code, plus one `openspec validate`. No live probes were run.

### What I verified (with evidence)

- **cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/editor-run-baseline-statuses/HEL-1503`.
- **`openspec validate editor-run-baseline-status-codes --strict`:** printed `Change 'editor-run-baseline-status-codes' is valid`.
  - The RENAMED FROM title matches `openspec/specs/pipeline-run-guard/spec.md:34` exactly.
  - The MODIFIED title matches `pipeline-schema-drift/spec.md:9`.
  - `pipeline-run-execution/spec.md:4` is the TBD Purpose that task 5.2 replaces.

#### Round-2 CR1 (deletion before root resolution answered 422): fixed

- `runPipeline` (`PipelineRunExecutor.scala:52-56`) returns 422 when the root list is empty.
  - D3 now adds a privileged existence check in that branch: gone → 404, present → the existing 422.
  - Task 3.2 carries it. `PipelineRepository.findByIdInternal` exists (:59).
  - No test or main code matches on the string "DataSource not found for pipeline" from this site. The only other copies are in `PipelineRunPreview.scala:143,172`, which this change does not touch. So nothing depends on the old 422 for a deleted pipeline.
- **Seam S1 (owner):** `findByIdShared` override, then roots cascade (V99), then the empty-roots branch, then 404. On main this answers 422, so the case is red. The named mutation (drop the existence check) fails it.
- **Seam S1 (editor):** `submit`'s second ACL read is `findGrantRole` (`PipelineRepository.scala:180-191`). It reads `resource_permissions` only.
  - `PipelineService.delete` and `PipelineRepository.delete` do not remove grants.
  - So an editor whose pipeline was deleted at S1 still passes `submit` and reaches the 404 branch. D6(g)'s editor S1 case is reachable as designed.
- **Seam S2:** `PipelineStepRepository` is a non-final class (`:32`), and `listByPipelineInternal` (:346) is called after roots resolve and before `executeRun`. So the wrapper is buildable.
  - On main, S2 answers 403 on both real paths (`NotAuthorized`), and a dry run executes. So D6(d) and D6(g) are red.

#### Round-2 CR2 (D2 read view): fixed

- Capture and compare now use the same view:
  - Compare: `PipelineAnalyzeReads.scala:74-77` reads each root through `findByIdOwned(dsId, user)` and takes the primary root (`rootSchemas.headOption`).
  - Capture: `PipelineRunSucceededWrites.scala:247` reads `roots.head._2.id`, the same position-ordered primary root.
  - D2's `findByIdOwnedByInternal(id, pipeline.ownerId)` reproduces the owner's `findByIdOwned` filter (`DataSourceRepository.scala:178-183`: `id && owner_id`). Owner runs are unchanged by construction.
- The Context bullet, the ticket's AC1 and the schema-drift delta are all reworded to "as the pipeline owner sees it".
- The mutations that now distinguish the cases:
  - A read keyed to the submitter fails (a) and (b).
  - The `findByIdInternal` mutation fails (b).
- The owner id needs threading: `onRunSuccess` already receives `pipelineOwnerId` (`PipelineRunExecutor.scala:303`). Threading it into `onUnblockedRunSuccess` (:323) is a parameter addition.

#### Round-2 non-blocking notes: addressed

- **D6(e) synchronisation:** now uses `pg_locks` polling instead of `Thread.sleep`.
- **D4 result type:** a separate `RunAuthorization` ADT is named, so `ConcurrencyCapResult` gains only `PipelineGone`.
- **Existing pin:** the `PipelineRunEditorPersistenceSpec.scala:427-432` inversion is named. I read the lines and they are the "NotAuthorized for a pipeline that no longer exists" case.
- **Mutations:** one mutation is listed per case.

#### Re-checked for new defects

- **D3 lock order:** the key-share row lock is taken before the advisory lock on both paths. Both transactions are wrapped in `.transactionally` (`DbContext.scala:50-51,63-64`).
  - `PipelineRepository.delete` (:482-487) takes no advisory lock, so no cycle is possible.
  - `pipelines` is FORCE RLS (V35:29, re-forced at V94:1309 and V98:330). So under the NOBYPASSRLS harness the owner path's `FOR KEY SHARE` really is evaluated against the policies, which is what task 3.3 needs.
- **`PipelineRunRepositorySpec.scala:629` stays valid:** that harness is superuser (`new DbContext(db, db)`, :37), so the non-owner still sees the row and the result stays `NotAuthorized`.
- **D4 producer count:** `ExistenceNotLeakedRoutesSpec.scala:521-537` pins `PipelineRunExecutor.scala -> 1`, counted per line containing `ServiceError.Forbidden(` (:491). D4's arm makes it 2, as task 3.4 says.
- **D4 does not contradict existing behaviour:**
  - The existing revoked-mid-run dry-run test (`PipelineRunEditorPersistenceSpec.scala:468-479`) revokes after `entered`, i.e. after D4's check, so it stays green. `insertGranteeDryRun`'s post-check is kept.
  - Every `PipelineRunService` test fixture I found constructs a real `PipelineRunRepository(ctx)`. None stubs it in a way an extra pre-execute read would break.
- **Scope:** item 2 and item 3 are untouched, per the owner rulings. There is no migration and no `schemas/` change.

### Verdict: CONFIRM

The plan can be executed as written. Both round-2 blockers are fixed in design.md, tasks.md, ticket.md and the deltas. The remaining items below are implementation-level and do not block.

### Non-blocking notes

1. **Spec overclaim (`specs/pipeline-run-execution/spec.md`, scenario "A deletion that races an admission never surfaces as a server error").**
   - The THEN says the admitted branch "is never answered with a `5xx` status". But once admission commits, the `DELETE` proceeds while the run executes.
   - The success chain's `materializedWrites` (`PipelineRunSucceededWrites.scala:77-`) is not `recoverWith`-wrapped. A history or snapshot insert racing that cascade can fail and surface as a failed Future.
   - That is the pre-existing in-flight-deletion race. Nothing in D6 tests it, and D3 does not claim to fix it.
   - Recommend narrowing the THEN before archive, e.g. "...or is admitted (the deletion then waits for admission to commit) and its run record is removed with the pipeline; the admission itself never fails with a server error". Otherwise this archives as an unverified SHALL.
2. **`PipelineRunExecutor` has no `pipelineRepo`.**
   - Its constructor (`PipelineRunExecutor.scala:22-33`) takes `pipelineStepRepo`/`dataSourceRepo`/... but not `PipelineRepository`. Only `PipelineRunSupport` holds one, as a private constructor param.
   - Task 3.2 needs either a new constructor parameter (wired at `PipelineRunService.scala:151`) or a `support` method.
   - Also, `PipelineRepository.findByIdInternal`'s doc (:53-58) says "Do not call from a request-bound service method". Add this caller to its permitted-callers list, with the D3 justification, rather than leaving the doc contradicted.
3. **D6(e) DELETE session.**
   - Run the third-session `DELETE` through the BYPASSRLS privileged role (or with `app.current_user_id` set to the owner).
   - In the mutation run, assert it deleted exactly 1 row. `pipelines` is FORCE RLS, so a `DELETE` that RLS filters to 0 rows never waits on the row lock. A green "DELETE succeeded" would then not prove the mutation was caught.
4. **Task 1.2 labelling of (b).**
   - On main, an editor's baseline write touches 0 rows, so `last_source_schema` stays NULL. If (b) asserts the literal `[]`, it is red on main, not a pin.
   - Either is fine: its guard value comes from the `findByIdInternal` mutation. But label it correctly in red-run.md, or make (b) compare against a preceding owner run's stored value as D6 phrases it.
5. **Schema-drift delta, scenario "Baseline written on an editor grantee's successful run".**
   - Consider saying "a source owned by the pipeline's owner".
   - The requirement body already resolves this, but the scenario on its own reads as if any source's schema is captured.
