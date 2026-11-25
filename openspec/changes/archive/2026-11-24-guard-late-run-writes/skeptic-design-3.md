## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 7292f77d60ff9f46cf3fc94ce83c1f110b92139f. The change dir is untracked, so I read the artifacts as they are on disk: ticket.md, proposal.md, design.md, tasks.md, both spec deltas, and skeptic-design-1/2.md. I checked them against the live source and against `docs/live-draft-preview.md` §8.3.1 (Order O*).

### Round-2 change requests: status

- **CR1 (the HEL-1564 test hangs; the spec clause is unreachable): partly resolved.**
  - Resolved: `LateFinisherDeleteAfterWonSpec` "post-fold binary-reference write then fails on the deleted pipeline" (`:128-141`) is now listed and re-expressed (D3, task 3.7a). The delta example is now a node snapshot write.
  - New defect: D3's claim that "HEL-1594 D2" still holds is false. See CR1 below.
- **CR2 (retention tests): resolved.** All five tests are listed (D8, task 3.6). I confirmed that `insertRun` seeds queued rows at `PipelineRunRepositorySpec.scala:158,193,205,338,349`. One residual issue on the `:338` test is under the notes.
- **CR3 (advisory key space, evaluation order): mostly resolved.**
  - The design now uses the two-`int4` key with a dedicated class id. I grepped `backend/src/main`: no other two-argument advisory lock exists, so the key space really is separate.
  - The design now specifies a `CASE` expression. However, it pins only half of the order. See CR3 below.

### What I verified (with evidence)

- **The success chain today** (`PipelineRunSucceededWrites.scala:83-324`):
  - W6 (`updateRun`, `:258`) is an eager val. It races the fold, `binaryRefsUpsert` (`:195`), `alertEvaluation` (`:215`) and `baselineUpsert` (`:297`).
  - W3 runs per node inside the fold, right after that node's replace (`:157-166`).
  - The no-history branch calls `overwriteRows` (`:128`). D2's withdrawal is now correct.
  - `afterTerminalWin` (`PipelineRunTerminalWrites.scala:65-70`) logs one WARN per call.
- **The write-back path** (`PipelineRunExecutor.scala:454-505`): the early check is at `:411`. `applyPendingWriteBacks` runs before `onUnblockedRunSuccess`, and its `NonFatal` arm calls `onWriteBackFailure` (`:459-466`). `applyWriteBacks` recovers only `IllegalStateException` (`DataSourceRepository.scala:584-587`). D5's re-raise arm is therefore necessary, and with `:415-416` it is sufficient.
- **The reaper** (`PipelineRunRepository.scala:391-430`): a single UPDATE whose WHERE has the open-run filter (`completed_at IS NULL AND status <> 'dry_run'`) outside the stale disjunction. The `last_run` CTE is unreferenced.
- **The prune** (`:500-526`): no `completed_at` predicate.
- **Other callers of the prune** (`PipelineRunExecutor.scala:190-191`, `PipelineRunService.scala:236`, `SparkJobSubmitter.scala:72`), and the tests that exercise them:
  - `PipelineRunEditorPersistenceSpec` "prune runs older than 24h ..." seeds `succeeded` rows with `completed_at` set, so it is unaffected.
  - `PipelineRunOrderTiebreakSpec` seeds terminal rows, so it is unaffected.
- **D4 deadlock argument, re-derived.**
  - The write-back takes the shared key first and holds nothing while it waits.
  - The reaper only try-locks the key.
  - A node-guard transaction never takes the key.
  - Read under READ COMMITTED, the plain read after the lock sees a reap that committed first.
  - I found no cycle with Order O* (0)-(5), with the NewSource path's (2)/(3), or with the HEL-1518 node guard.
- **RLS:** `applyWriteBacks` runs under `withUserContext(owner)`, and `pipeline_runs_owner` admits the owner (round 2, V35). C3 requires proof on the RLS-enforcing harness.
- **Harness feasibility** (`LateFinisherSpecBase.scala:44-143`): `terminalGate`, `terminalWritten`, `foldDone`, `afterNodeWrite` and the binary hooks exist. `service()` wires no `alertEvaluationService`, so 3.1's W5 case needs a fixture extension. That is feasible, but the tasks do not say so (see notes).

### Verdict: REFUTE

### Change Requests

1. **D1 does not say what the gated group depends on in the node fold. Under the natural reading, an existing HEL-1594 regression test breaks, and D3 says it does not.**
   - **What D1 and the tasks say.** D1 and task 1.2 say W3's schemas are "collected during the fold and applied after it" inside the single `afterTerminalWin`. They do not say whether the group, which also contains W4, W5 and W10, waits for the fold to SUCCEED or only to SETTLE. They also do not say what happens to collected schemas when the fold fails partway.
   - **The test it breaks.** `LateFinisherDeleteAfterWonSpec.scala:76-106` ("HEL-1594, HEL-1564 D2"):
     - It deletes the pipeline in `beforeNodeFold` after `terminalWritten` (`:83`). W6 has won, and the first node guard then trips `Missing`, so the fold FAILS.
     - It then does `Await.ready(entered.future, 30.seconds)` (`:89`) on the binary write.
     - If the group is sequenced on the fold's success (`materializedWrites.flatMap(...)`, the obvious composition), the binary write never starts. `Await.ready` then throws `TimeoutException` and the test goes red.
     - D3 says "HEL-1594 D2 and the narrowness control gate the binary write on `terminalWritten` and still hold". For HEL-1594 D2 that is wrong: that test gates the NODE FOLD on `terminalWritten` (`:83`), not the binary write.
   - **Production behaviour also changes.** A genuine node-write failure after W6 won, with the pipeline still existing, today still runs W4, W5 and W10 (they are eager). Under "fold success" it would skip them.
   - **Revise:**
     - State in D1 and task 1.2 the exact dependency: for example, "the gated group starts after the fold has settled (success or failure) and W6 has returned; it applies the schemas of the nodes whose write committed".
     - Or, if it runs only after fold success, say so, list the HEL-1594 D2 test as re-expressed with its reason, and state the behaviour change for a node failure after a won W6.
     - Either way, correct D3's sentence about HEL-1594 D2.

2. **The reaper delta's new scenario "Reap lands after the early open-check but before a non-node write" is wrong for one interleaving it covers.**
   - **What it says.** The WHEN is "reaped before its write-back, **or before its own `succeeded` terminal write**". The THEN is "no write-back row ... is written by that execution".
   - **Why that is wrong.** A reap that lands after the write-back transaction committed (while the run was open, which is legitimate under D4) and before W6 satisfies the WHEN. In that case the write-back rows exist. The window is real: W6 starts only after `applyPendingWriteBacks` returns (`PipelineRunExecutor.scala:467-472`).
   - **The risk.** A 3.1/3.2 test written from this scenario would either be wrong or be quietly weakened.
   - **Revise:** split the scenario.
     - Reap before the write-back transaction: no write-back row, and no other writes.
     - Reap after the write-back committed and before W6: the write-back rows committed while the run was open remain. No binary reference, Output schema, alert event or baseline is written. No event. 409.
     - Align tasks 3.1/3.2's assertions with it.

3. **The reaper's `CASE` pins only half the evaluation order (D4, task 2.3).**
   - **What is specified.** `CASE WHEN <existing stale predicate> THEN pg_try_advisory_xact_lock(...) ELSE false END`. In the live statement (`PipelineRunRepository.scala:409-411`), the "stale predicate" is the heartbeat/legacy disjunction. The open-run filter `completed_at IS NULL AND status <> 'dry_run'` is a separate conjunct outside it.
   - **Why that matters.** Every terminal run has an old heartbeat, so it satisfies the stale disjunction. PostgreSQL does not guarantee the order of top-level WHERE conjuncts; it orders them by cost. The design's guarantee ("the try-lock is taken only for otherwise-stale rows") therefore rests on cost ordering, which is exactly the reliance round 2 asked to remove. If the conjunct ordering ever flips, the statement takes one advisory lock per historical run in a single transaction, which can exhaust the shared lock table.
   - **Revise:** put the WHOLE reap predicate inside the `CASE WHEN`: `completed_at IS NULL AND status <> 'dry_run' AND (<heartbeat/legacy stale>)`. State it in D4 and task 2.3 literally.

### Non-blocking notes

- **`PipelineRunRepositorySpec.scala:338` (non-owner no-op) is vacuous today for a second reason.** Its runs start at `Instant.now()`, inside the 24 h window, so nothing is deletable even for the owner. Re-seeding them as terminal (task 3.6) does not make it failable. Also seed them older than 24 h, and confirm with an owner-call control that they would be deleted.
- **AC2 "log one clear line".** A lost W6 already yields three `afterTerminalWin` WARNs (`updateMeta`, `cancelAutoRun`, `assertionsInsert`). The gated group adds a fourth, and `lateFinisher` a fifth. Folding all win-gated work into one `afterTerminalWin` would make the claim literal. Otherwise, state in D9 which line is "the" clear line.
- **Task 3.1 W5 needs an alert-evaluation service** wired into `LateFinisherSpecBase.service()` (today it passes none), with a rule seeded so that firing and resolve actually write. Name this fixture change in the task.
- **The node-snapshot example in "Pipeline deleted while its run executes".** That write does not literally "fail"; the guard trips with `RunNoLongerOpen(Missing)`. The wording is acceptable, but "is refused by the run guard" would be exact.
