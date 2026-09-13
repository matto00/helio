## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `e43ec554ad129535b8a0fad9d122a5c610b6e2fa` against live-resolved base `ac5d1e6be868d83f2709d04d25a88ae56a70843e` (`resolve-review-base.sh`, exit 0).

### What I verified (with evidence)
- **Full backend suite, re-run by me:** `sbt test`, which ended with `Tests: succeeded 4307, failed 0`, `EXIT=0`. The pinned `PipelineCreateTransactionalSpec` case `should reject a 'upsertsource' step with BadRequest (...PipelineStepKind.All does not yet)` passes. `git diff --stat` shows that spec is untouched.
- **No registry or engine scope creep:** the diff touches nothing under `domain/model` (Registry/`PipelineStepKind`) and nothing in the engine. The only codec change is an `encodeConfig` case for `UpsertSourceConfig` (`PipelineStepConfigCodec.scala:+75`). It does not register the step.
- **Graph queries use an explicit userId filter:** `PipelineRootRepository.findReadEdgesVisibleTo` and `PipelineStepRepository.findUpsertWriteEdges` filter on `ownerId === uuid || exists(resource_permissions grantee = uuid)`. Neither uses the GUC. A test runs them under `withSystemContext` and checks that other tenants' rows are excluded.
- **One DBIO per write path, confirmed for the paths that exist:**
  - `PipelineRepository.create`: the guard is joined with `.andThen` to the inserts inside a single `withUserContext` call.
  - `createAction`: the guard is joined with `.andThen`, and the whole action runs inside `runTransactionally`.
  - `PipelineRootRepository.add`: the guard runs inside its `withUserContext` for-comprehension, before `rootsTable += row`.
  - `spliceInsertAtInternal`, `attachTailInternalAction` and `updateInternal`: the guard is the first step of their `withSystemContext(... .transactionally)` chain.
  - `DbContext.withUserContext`/`withSystemContext` both wrap in `.transactionally`, so `pg_advisory_xact_lock` is held until the transaction commits.
- **Three-colour DFS:** `PipelineCycleValidator.findCycle` reports a cycle only when an edge reaches a Gray node (`case Black => ()`). Tracing the diamond test by hand: S1→S2→S4 finishes S4 as Black, then S1→S3→S4 hits Black. Under a two-colour check that second visit would be flagged, so the diamond test does fail if the DFS is reverted.
- **AC tracing:**
  - The validator rejects a direct cycle and a two-pipeline cycle, with exact messages (`PipelineCycleValidatorSpec`).
  - At the persistence layer, the only write paths that can carry a pending write edge are `spliceInsertAtInternal`/`updateInternal`, called directly in tests.
  - The create path does not meet the AC once `upsertsource` becomes creatable. See CR1.

### Verdict: REFUTE

### Change Requests
1. **The create path has no cycle check where a write edge enters, so the direct-cycle AC is unguarded for create.** `PipelineService.buildStepsAction` (`PipelineService.scala:568`) inserts steps with `pipelineStepRepo.insertInternalAction`, and that method does not call `cycleCheckForUpsertAction`. The only create-path check is `checkExistingGraphAction`, which runs *before* the roots and steps exist and adds no pending edge.
   - Once HEL-1100 adds `upsertsource` to `PipelineStepKind.All`, a single `POST /api/pipelines` with root `S` and an `upsertsource` step targeting `S` would persist a direct self-cycle. So would a `PipelineProposalService.apply` or a patch-set replay, since both go through `create`. That is AC1's exact case, on the path most agent-authored pipelines take.
   - This contradicts the spec requirement "creating a pipeline (with its roots and steps)" and design.md's claim that the check is "already live on that same call path with no additional wiring".
   - Fix: run the guard on this path as well. Either route `insertInternalAction` through `cycleCheckForUpsertAction`, or run the guard after `buildStepsAction` in the same DBIO with the new pipeline's roots and upsert targets as the pending edge.
   - Add a repository- or action-level test that composes `createAction` + `insertInternalAction` with an `upsertsource` step writing the pipeline's own root, and asserts rejection. That seam does not need the Registry.
2. **The create-path check blocks unrelated work and its tests don't test what they claim.**
   - `checkExistingGraphAction` (`PipelineCycleGuard.scala:300-305`) adds no pending edge. A new pipeline with roots only has no write edge, so it can never close a cycle. The check can therefore only fail when a cycle *already exists somewhere* in the caller's visible graph. When that happens, every create by that user is rejected, even for unrelated sources, with a message naming someone else's pipelines.
   - A standing cycle can arise without any bug on this path. design.md accepts cycles that close through resources an editor can't see, and a later share grant can make such a cycle visible.
   - The tests "3.1", "3.2" and "3.5" (`PipelineCycleDetectionServiceSpec`: "reject a create whose caller-visible graph already contains a writer-chain cycle", "reject a create whose roots close an existing writer-chain cycle", proposal apply) all seed a complete standing cycle w1↔w2 first. They pass because of that pre-existing cycle, not because the new pipeline's roots close anything. The transactional test's name says otherwise, and so does the spec scenario ("the new pipeline's own downstream write target would complete a cycle").
   - `checkAddWriteAction` and `updateInternal` scan the whole graph too, so a standing cycle also blocks every unrelated upsert write. `checkAddReadAction` does not (its fold starts from `Right`), which leaves the paths inconsistent.
   - Fix: only reject when a cycle passes through the pending edge. For example, search from `writeTarget` back to `readSources` instead of scanning all nodes, or keep only cycles that contain a pending edge. Replace the standing-cycle tests with tests where the pending write itself closes the loop. Add a test that a standing unrelated cycle does not block an unrelated create or addRoot.
3. **The concurrency test (task 4.1) does not reliably fail if the lock is removed.**
   - `PipelineCycleDetectionServiceSpec` "serialize two writes..." fires two `Future`s on the global EC and asserts one success and one rejection.
   - Without `lockAction`, the two transactions may simply run one after the other because of scheduling. The second would then see the first's committed root and get rejected anyway. The test would pass without the lock, so it does not show that the lock serializes anything.
   - Fix: force the interleaving. Open transaction 1, take the lock or run the guard plus insert, and hold it open, for example with a `pg_sleep` or a latch before commit. Then show that transaction 2's guard *blocks* until transaction 1 commits and is then rejected. Also include a variant, or a documented mutation run, showing that with the lock statement removed both writes succeed.

### Non-blocking notes
- `PipelineCycleValidatorSpec` "would wrongly flag the diamond as a cycle under a naive two-colour check" has the same body as the diamond test, so it adds no coverage. Delete it, or make it run an actual two-colour variant.
- `updateInternal` builds the graph with the step's *old* write edge still present while it checks the new target. This is harmless today, but it matters for CR2's pending-edge-only fix: exclude the step being updated from `writeEdges`.
- `checkAddReadAction`'s scaladoc says a pipeline with no write edge "degenerates to checkExistingGraphAction". It doesn't: it returns `Right` with no graph check. Correct the doc or the behaviour, as part of CR2.
- `updateInternal`'s `actingUserId: String = ""` default: a future caller that passes `config` without an id would get `UUID.fromString("")`, which throws a raw exception from inside the transaction. Consider making the parameter required.
