## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD: ac5d1e6be868d83f2709d04d25a88ae56a70843e (planning artifacts are uncommitted files in the change dir)

### What I verified (with evidence)
- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/cycle-detection-write-back/HEL-1101`.
- Read the revised design.md, tasks.md and specs/pipeline-cycle-detection/spec.md in full, plus skeptic-design-1.md.
- Checked the restructuring claims against the code:
  - `DbContext.scala`: `withUserContext` runs on the app pool with `SET LOCAL app.current_user_id`, so RLS applies. `withSystemContext` runs on the **privileged pool (`helio_privileged`, BYPASSRLS)** and takes no user id.
  - `PipelineRootRepository.list` gets its sharing-aware visibility **only from RLS**. It has no explicit owner/grant join (`rootsTable.filter(_.pipelineId === ...)` under `withUserContext`). V98:353 `USING (helio_can_access_pipeline(pipeline_id))`.
  - `PipelineRootRepository.add` is one `withUserContext` flatMap chain, so moving the lock and check into it is feasible. CR1 is resolved for addRoot.
  - `PipelineRepository.create` (simple path) runs `DBIO.seq(pipelinesTable += ..., rootsTable ++= ...)` under one `withUserContext`. Prepending there is feasible, so CR4 is resolved. `createTransactional` is one composed DBIO.
  - `PipelineStepRepository.updateInternal` (:308-327) and `spliceInsertAtInternal` (:448-503) both run `ctx.withSystemContext(action.transactionally)` and take no `AuthenticatedUser`. `attachTailInternal` (:549) does the same. `PipelineService.persistNewStep` (:1815-1916) calls only splice and attachTail, so the paths are enumerated correctly.
  - `validateStepKinds` (PipelineService:1495) rejects `upsertsource` in every create request.
- CR2 (editor grantees): resolved in principle. The graph is the caller's visible graph and a single fixed lock key is used. A spec requirement and scenario were added. See CR-A below for the part that does not hold on the step paths.
- CR5 (three-colour DFS, and a diamond test that fails under the two-colour bug): resolved in task 2.1 and in the spec scenario.
- CR6 (multigraph edge labels, deterministic tie-break): resolved in Decision 6 and task 2.2.
- Concurrency on the lock-first paths: under READ COMMITTED, each statement after the lock gets a fresh snapshot, so graph reads that follow `pg_advisory_xact_lock` see a concurrent writer's committed edge. The single-key approach is sound **where it is actually composed** (the create paths and addRoot).

### Verdict: REFUTE

### Change Requests
1. **Step paths: the caller-visible graph cannot be built inside `withSystemContext` as designed (Decision 2, Decision 4 third bullet, tasks 1.2 and 3.4). This was left open from round-1 CR1: "which context the combined transaction uses, and why RLS is still correct there".**
   - Decision 4 splices the graph reads into `spliceInsertAtInternal`/`attachTailInternal`/`updateInternal`'s existing DBIO. That DBIO runs on the BYPASSRLS privileged pool.
   - Decision 2 and task 1.2 rely on the "same sharing-aware visibility" that the non-Internal methods get. That visibility is RLS, and RLS is skipped on this pool.
   - As written, the step-path graph would contain **every tenant's** roots and upsert edges. The cycle message could then name another tenant's pipeline or source, which breaks the spec requirements "Cycle graph is scoped to the caller's own visible resources" and "An editor grantee's write ... SHALL NOT reveal".
   - These methods also do not receive the acting user today.
   - Pick one of these and state it:
     - (a) Make the edge queries apply explicit visibility. Pass the acting user id into the Internal methods and filter with `helio_can_access_pipeline`-equivalent SQL that takes an explicit user argument, not the `app.current_user_id` GUC. Cite the function signature from V39 to show it can take an explicit id.
     - (b) Move the step writes for these calls to `withUserContext` and explain why the owner-only write RLS still works for editor grantees.
   - Add a task 1.2/3.4 test that runs the step path with an other-tenant writer edge present and asserts that edge is excluded.
2. **Task 3.2 and the spec scenario "Creating a pipeline with a self-cycle is rejected" still cannot be done (round-1 CR3, not fully fixed).**
   - A create request cannot carry an `upsertsource` step (`validateStepKinds`, :1495).
   - A repository-seeded step cannot belong to a pipeline that does not exist until this create commits.
   - So task 3.2's "creating a pipeline with a root reading S and an upsertsource step targeting S inserted via the repository-level test seam" is impossible as written.
   - Rewrite task 3.2 as a read-edge test: a `createTransactional` request with ordinary steps, whose roots close a cycle against a **different, pre-seeded** writer pipeline.
   - Mark the spec's same-request self-cycle scenario as owned by HEL-1100, or reword it. Right now the spec requires a scenario that 5.1's sign-off can never honestly tick.
3. **Record the HEL-1100 handoff as a named task, not just prose (round-1 CR3 option b).**
   - The design says "HEL-1100 is responsible for adding its own end-to-end addStep-with-upsertsource test".
   - Add a task in tasks.md to write that requirement into HEL-1100's ticket, as a comment or AC. Without it nothing binds HEL-1100 to it.
   - Also add a test in task 3.4 that goes through the actual restructured repository method, not only through the validator. Otherwise the wiring inside `spliceInsertAtInternal`/`attachTailInternal`/`updateInternal` ships with no test at all. One option is a repository-level test that calls the restructured method with an `upsertsource` kind string directly, which bypasses the service allow-list.

### Non-blocking notes
- Task 3.1's verification text contradicts itself ("no added query when there is nothing to check — N/A here ... so instead assert query count is O(1)"). Reduce it to the one assertion it means.
- Spec, editor-grantee requirement: a real cycle that runs through resources the editor cannot see is accepted and will loop at run time. That is an accepted consequence of the tenancy choice. Consider recording it as a Risk and pointing to HEL-1100's engine for a run-time guard.
