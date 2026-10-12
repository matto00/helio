## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD: 2e02b79511fab222ac2bc73a142fc61e0979f192. This equals origin/main after a fresh fetch. The change dir is untracked planning artifacts only.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/orphaned-run-reaper/hel-1511`.
- **Owner rulings:** I did not reopen them. D1-D4 still map to Q1-Q6 A, and D4 now also covers write-back, which is the Q6 A wording "a newer run's data".
- **R1 (test-clock timeline): resolved in substance.**
  - Design D1 keeps `startAt = Instant.now()` (PipelineRunExecutor:100, confirmed). Every reaper spec starts its fake clock at real `Instant.now()`.
  - So in 4.2 an unregistered run has `heartbeat_at = started_at` at about the real now. Ticks at fakeNow = real now + 10 x 600 s then reap it, and the "skip register" mutation goes red.
  - Task 4.2 requires recording that red.
- **R2 (lock-wait proof): resolved.**
  - Planner Notes give the 5-step protocol: B holds an uncommitted UPDATE; the test polls `pg_stat_activity` for `wait_event_type='Lock'`; B commits; the test asserts 0 rows. It covers both halves (task 4.3).
  - The named mutation works. Under SELECT-then-UPDATE-by-id, the SELECT reads the old committed heartbeat as stale, and the UPDATE waits on B's lock. Once B commits, the UPDATE re-checks only `id`, so it updates the row and returns 1, and the heartbeat half goes red.
  - I checked the migrations: none puts a trigger on `pipeline_runs` (grep over `V*.sql` for `ON pipeline_runs` plus trigger). A 30 s heartbeat UPDATE therefore has no side effects.
- **R3 (late-finisher write-back): resolved in the design.**
  - The open-check is moved BEFORE `applyPendingWriteBacks`. That call is at PipelineRunExecutor:310, inside `onRunSuccess` after the blocked branch at :306.
  - D4 now gives every write in the success chain a disposition: write-backs, snapshots, history and payload history, binary refs, `baselineUpsert`, alerts, assertions, `last_run_*` and the terminal update.
  - The blocked, failure and write-back-failure paths do their terminal update first. `executeRunFailure` (:99-101) and `onWriteBackFailure` (:183-185) are already sequenced. `onBlockedRun` (:215-217) is eager and gets re-sequenced, as D4 states.
  - `Left(ServiceError.Conflict)` is safe for the auto-run firer: `submitAutoRun` maps any non-`TooManyRequests` result to `FireOutcome.Done` (PipelineAutoRunDebounceFirer:123-127), so a late finisher never re-arms.
- **R4 (system context): resolved.**
  - D1 names `stampHeartbeatsInternal` under `ctx.withSystemContext`, gives the RLS rationale, and has the evaluator verify it by reading the code.
  - `DbContext.withSystemContext` exists (:63).
- **R5 (red-first repro): resolved.**
  - The orphan is inserted with raw SQL that does not name `heartbeat_at`.
  - Case (c) uses a different pipeline of the same owner.
  - New config and constructor parameters are defaulted. `PipelineSchedulerService` already uses that pattern, with all-default trailing params (:22-35).
  - The red run must show assertion failures.
  - Case (c) is red for the right reason on main: the firer's cap pre-flight (:106-111) GuardRejects, so no run happens.
- **Feasibility details:**
  - The scheduler can reach `staleRunAfterSeconds` through `pipelineRunService.guardConfig`, the same way the firer does (firer:30).
  - `PipelineRunService.eventRegistry` exists for D3.
  - The highest migration on origin/main is V125, so V126 is free.
- **Non-blocking items from round 1:**
  - Addressed: the legacy reason string, the injected tracker, the D5(ii) in-flight assertion, and `updateMeta` sequencing.
  - Not addressed, and still non-blocking: the deadlock note, and the tick-await window in Risks.

### Verdict: REFUTE

### Change Requests

1. **Task 4.4 (the late-finisher test, which proves R3/Q6 A) can pass vacuously. Pin how it is built and give it a mutation.**
   - **Where the risk comes from.** The task says to reap "a run whose backend Promise is still pending", with an `upsertsource` write-back. The test tree has two precedents for a Promise-blocked backend:
     - `PipelineRunGuardIntegrationSpec.GatedExecutionBackend` (:160) blocks, then returns an EMPTY successful outcome.
     - `PipelineRunServiceTerminalOrderingSpec.GatingBackend` (:203-209) blocks, then delegates to the real in-process engine.
   - **What goes wrong with the first one.** With the empty-outcome backend (and `supportsWriteBack` overridden to pass the PipelineRunExecutor:78 pre-check), the `WriteBackSink` stays empty and `nodeOutcomes` is empty. Every 4.4 assertion then holds, whether or not the open-check exists or where it sits: the target dataset is unchanged and no `node_snapshots` or history rows appear. The test would certify R3 without exercising it.
   - **Required changes to 4.4:**
     - (a) Use a gate that delegates to the real `InProcessExecutionBackend` (the `GatingBackend` shape), so the sink really holds a deferred upsert and the nodes really produce outcomes.
     - (b) Add a positive control: the same fixture, when not reaped, does write the target dataset row and a node snapshot. This proves the negative assertions can fail.
     - (c) Name and record a mutation that must turn 4.4 red: remove the `isRunOpenInternal` check, or move it after `applyPendingWriteBacks`. Add 4.4 to task 6.1's list of recorded mutation runs.

### Non-blocking notes

- The spec's "First terminal write wins" requirement lists what SHALL NOT be overwritten: row, last-run fields, snapshots, history and alert state. It omits the write-back target dataset, which design D4 now protects. Add it so the spec matches the design.
- Case (c)'s fixture is still loose: "orphan plus other in-flight rows". It can only fail safe (it never goes green if the other rows sit on pipeline B), but `maxConcurrent = 1` with only the orphan is simpler and unambiguous.
- `RunHeartbeatActor`'s 30 s timer is verified only by reading the code, because the tests call `stampOnce` directly. Consider one actor-level test with a manual-time or test-probe scheduler.
- Heartbeat stamps use the stamping instance's clock, and the reap uses the reaping instance's clock. Skew is negligible next to the 600 s bound, but say so in Risks, or use DB `now()` in both statements.
- Round-1 notes still open:
  - an `ORDER BY id` lock order, or a documented note about 40P01 deadlocks between reapers;
  - the Risks line saying a single instance does not reap while its tick awaits a long scheduled run.
- Date nit: the proposal and workflow-state say the owner approved on 2026-10-12. Today is 2026-10-11.
