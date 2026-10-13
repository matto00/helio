## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `70c3bf17b0774a29410ccefccf43b9210395f703`. The review base was resolved live with `resolve-review-base.sh` and gave `f3490d1d8` (the merge-base). `origin/main` is now `fe63a2518`. The two newer main commits (HEL-1525 panel layoutVersion, HEL-1535 patch-set preview) touch none of the files in this change, and `git merge-tree --write-tree origin/main HEAD` merges cleanly.

### What I verified (with evidence)

**AC1: deleted pipeline answers 404; reaped run still answers 409.**
- `PipelineRunExecutor.onRunSuccess` now reads `runStateInternal`, which returns `Open | Terminal | Missing`.
- `lateFinisher` handles the three states as follows:
  - `Missing` → privileged `findByIdInternal`. If that returns `None`, the answer is `Left(pipelineGone(pid))`, which is the existing `NotFound("Pipeline not found: <id>")`. If it returns `Some`, the answer is a neutral 409.
  - `Terminal` → today's 409 text, unchanged.
- The same mapping is applied in two more places:
  - through `.recoverWith { case RunNoLongerOpen(state) => ... }` for guard trips;
  - through `failIfLostTerminalWrite` (D7) when the run's own `succeeded` write loses.
- Tests that cover this: `LateFinisherRunSpec` "answer 404 when its pipeline was deleted while it executed", "still answer 409 when its run was reaped", and the two D7 cases.

**AC2: the open-check runs inside each node's write transaction and holds the run row.**
- `runGuardAction` takes `SELECT 1 FROM pipelines ... FOR KEY SHARE` and then `SELECT status, completed_at IS NULL FROM pipeline_runs ... FOR SHARE`.
- It is composed as the first action of `overwriteRowsAction` (`guard.fold(action)(g => g.andThen(action)).transactionally`).
- `withSystemContext` wraps the whole action, including the history/payload `andThen`, in one `.transactionally` (DbContext.scala:63-64), so the guard, the replace, and the history and payload inserts share one transaction.
- Both node-write paths (`overwriteRows` and `overwriteRowsWith`) pass the guard. Backfill and other callers default to `None`, so they are unchanged (N1).

**AC3: privileged-call comments.** I read each one in the diff:
- `OrphanedRunReaper.reap`
- `PipelineRunExecutor.runState`
- `PipelineRunRepository.runStateInternal`
- the Missing-case `findByIdInternal`
- the guard construction in `PipelineRunSucceededWrites`

Each explains why bypassing RLS is correct at that call site. `isRunOpenInternal` was removed, and `grep -rn isRunOpenInternal backend docs openspec/specs` returns 0 hits, so there are no dead callers.

**Concurrency: lock order, analysed against the code I read.**
- `PipelineRepository.delete` (lines 486-497) does three things in one user-context transaction: an unlocked owner read, then `PanelRowLocks.lockForDeletion` (V129/V130: panels, then dashboards), then `DELETE pipelines`.
- The guard never touches panels or dashboards, and the delete takes no lock on outputs, runs or history before it has the pipeline row (cascades follow the parent delete). Whichever side gets the pipeline row first wins, and the other waits holding nothing the winner needs, so there is no cycle.
- The node transaction's later FK locks are KEY SHARE on `outputs` (from the history insert) and on `pipelines` (from the payload insert, already held).
- There are no triggers on `node_snapshots`, `output_snapshot_history`, `node_payload_history`, `pipeline_runs` or `pipelines`. I checked the `CREATE TRIGGER` list: V91, V99, V122, V127, V128.
- Payload and history trims use `pg_try_advisory_xact_lock*`, which never waits.
- The reaper CTE takes NO KEY UPDATE on the run row (conflicts with FOR SHARE, so the reap waits) and on the pipeline row (compatible with KEY SHARE).
- Heartbeat stamping and the run's own `updateRunTerminalInternal` are single-table non-key UPDATEs. They wait for at most one node transaction and hold nothing that transaction needs.
- `helio_privileged` is BYPASSRLS (DbContext doc) and holds UPDATE on all tables via V38:19/27, which is the privilege `FOR SHARE`/`FOR KEY SHARE` require.

**Healthy runs are not broken (C1).**
- The guard accepts `status = 'succeeded'`. The only writers of `succeeded` to a run row are this chain (`PipelineRunSucceededWrites:241`) and the dormant `SparkJobSubmitter:96`, which finalizes its own run id. I re-grepped this myself.
- `won = false` only happens when `updateRunTerminalInternal` matches no row with `completed_at IS NULL`. For a healthy run, nothing else finalizes the row: the reaper needs a heartbeat older than the stale bound, and the blocked path is exclusive with this one. So the D7 branch is not reachable by a healthy run.
- The positive-control test forces the run's own `succeeded` to commit before node 1 and asserts that all of these are written: 6 snapshots across 2 nodes, 3 history rows, 1 payload, a `succeeded` event, `Right`, and status `succeeded`.
- `LiveRunTracker` deregisters on any outcome (PipelineRunExecutor:205).

**The tests can actually fail.**
- I did not mutate code myself (this role is read-only). `mutation-evidence.md` records M1–M6, each with a named failing assertion. M3 records a real `deadlock detected` when the pipeline-row lock is removed.
- My reading of the tests agrees: `awaitAnyLockWait` refuses to pass vacuously, the parked transaction signals from inside the transaction, and the D6(c) fixture includes the FK-bearing payload and history inserts.

**Gates I re-ran myself** (foreground, `HELIO_TEST_JVM_XMX=3g`, `-J-Xmx3g`, `nice -n 19`):

| What I ran | Result |
|---|---|
| `testOnly LateFinisherRunSpec PipelineRunServiceTerminalOrderingSpec LiveRunReaperSpec OrphanedRunReaperSpec *RunReaperConcurrencySpec` | `Tests: succeeded 36, failed 0`; `[hel1468-guard] failed=0 aborted=0 unreadable=0`; EXIT=0 |
| `testOnly LateFinisherRunSpec`, run twice in a row | both runs `Tests: succeeded 10, failed 0`, with all 10 test names listed; stable |
| `testOnly com.helio.services.pipelines.* com.helio.services.hooks.*` | `Total 605, Suites: completed 78, aborted 0, Tests: succeeded 605, failed 0, canceled 1` |
| `testOnly com.helio.infrastructure.persistence.pipelines.* com.helio.services.hooks.* com.helio.api.routes.pipelines.*` | `Total 899, Suites: completed 63, aborted 0, Tests: succeeded 899, failed 0` |
| `npm run check:scala-quality` | `clean (250 soft warning(s))` |
| `openspec validate late-finisher-404-reap-window --strict` | valid |
| `check-openspec-hygiene.mjs` | clean |

- I did not re-run the full suite. Code has not changed since `326bf324b` (`git diff --stat 326bf324b 70c3bf17b -- backend` is empty), and evaluation-2 pastes a per-batch table totalling 7754 passed / 0 failed, with suite coverage cross-checked.

**`PipelineRunServiceTerminalOrderingSpec` edit.**
- The stage-1 `awaitBlockedBy(tableLock)` assertion moved to stage 2, which already existed. This follows from the real change: the node transaction now waits on the run row before it reaches the `node_snapshots` table lock.
- The invariant under test (no terminal event before the writes are durable) is still asserted at both stages, so the test was not weakened.

**Debugging law.** For item 1, the red-on-main output is recorded (`Left(Conflict(...)) was not equal to Left(NotFound(...))`). For item 2, the reap-in-window case returned `Right(...)` on main.

**UI.** There is no UI change; the diff is backend and openspec only. I started no servers.

### Verdict: CONFIRM

### Non-blocking notes
- **Product-visible changes beyond the pinned 409→404 (named per the overnight rule):**
  - (a) A run reaped after its last node write, or whose run row was pruned mid-chain, used to answer 200 and publish `succeeded`. It now answers 409 and publishes nothing (D7). This follows the existing HEL-1511 requirement that a late finisher answers 409, so I do not treat it as a new product call.
  - (b) Missing-run-with-pipeline-present now uses new 409 text: "Run record no longer exists; its outcome was discarded" (design-gate N3).
- **Spec tension.** The base requirement's sentence "SHALL NOT overwrite ... alert state" sits next to the new paragraph saying alerts are protected only by the early check. The new paragraph qualifies the sentence, and HEL-1541 tracks the residual. A future spec pass could reword it.
- **Evidence location.** Task 2.6's `succeeded`-writer grep and the D3 grant check are recorded in evaluation-1.md, not in `mutation-evidence.md`. Both premises hold; I re-verified them.
- **File size.** `LateFinisherRunSpec.scala` is about 350 lines, over the 250-line soft budget. The evaluator already noted this.
