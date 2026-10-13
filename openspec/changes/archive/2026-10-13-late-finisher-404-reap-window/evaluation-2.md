## Evaluation Report — Cycle 2 (evaluation-2.md)

**What was reviewed:** commit `326bf324be884055ea45fabf09a6478014f6a091`, compared against cycle 1's commit `d52f81853`. The base was re-resolved live and is `f3490d1d8`.

### Phase 1: Spec Review — FAIL

**Cycle-1 change requests:**
- **CR1 (fixed in code).** `failIfLostTerminalWrite` is at `PipelineRunSucceededWrites.scala:299-309`. It runs after the chain's writes. When the run's own `succeeded` write loses (`won = false`) and a run repository is wired, it reads `runStateInternal`. A `Missing` or `Terminal` state fails the chain with `RunNoLongerOpen`, so `succeeded` is not published, and the existing executor `recoverWith` maps the failure to a 404 or 409.
  - I re-ran the cycle-1 probe as its own committed test: delete before the Output list is read → 404, nothing written, no `succeeded`.
- **CR2 (fixed).** Two red-first D7 tests were added. Mutation M6 in `mutation-evidence.md` records both going red as `Right(...)`.
- **CR3 (done by the orchestrator).** The follow-up is filed as HEL-1541 and task 4.1 is ticked.
- **CR4 (fixed).** The grep evidence is recorded in `mutation-evidence.md`.

**D7 judgment: accept.** D7 says a reap after the last node write answers 409 with no `succeeded` event. That is sound for three reasons:
- It is what first-terminal-write-wins means.
- The reaper has already published `failed`. Before D7, the late finisher would also have published `succeeded`, giving two contradictory terminal events for one run. D7 removes that.
- It matches the existing scenario "Stalled instance finishes after its run was reaped → 409".

Node writes that committed while the run was open are kept, as HEL-1511 Q6 accepts. The new scenario (spec.md, "Reap lands after the last node's write") does not claim otherwise.

I also checked that no healthy run can hit `won = false`:
- The only other writer of `succeeded` is `SparkJobSubmitter`. It is dormant, has no route caller, and finalizes its own run id.
- The full suite passes, so no existing fixture trips the new failure.

**Issue (blocking): the amended spec scenario claims something the implementation does not do.**

The scenario is "Pipeline deleted while its run executes", at `specs/pipeline-run-reaper/spec.md:48-52`. It now says that "no snapshot, history or write-back row is written by that execution, whether the deletion lands before the early open-check, before the Output list is read, between node writes, or after the last node write". Two parts of that are false:

1. **Snapshot rows survive a later deletion.** `node_snapshots` has no foreign key (V94: `pipeline_id TEXT NOT NULL`, with no REFERENCES clause), and `PipelineRepository.delete` never deletes from it. So if the pipeline is deleted between node writes or after the last node write, the rows that node writes already committed stay as orphans.
   - **Probe:** I ran this in a throwaway detached worktree at the reviewed SHA and removed it afterwards. The test was a copy of the D7 reap-after-last-node test with the reap replaced by `deletePipeline`. Output:
     `PROBE res=Left(NotFound(Pipeline not found: 2d405138-...))`
     `PROBE node_snapshots=6 history=0 payload=0`
     `PROBE events=Vector(queued, running, node-progress, node-progress)`
   - So the 404 and the missing `succeeded` event are correct, but 6 snapshot rows written by that execution remain. History and payload rows are removed because their tables cascade on delete.
2. **Write-back rows survive too.** Write-backs (`applyPendingWriteBacks`) are applied after the early open-check and before the Output list is read. A deletion "before the Output list is read" can therefore land after write-back dataset rows have committed. Those rows live in a separate dataset and are not removed by the cascade.

The code behaves correctly here. Leaving the orphan snapshots is how any pipeline delete already works on main. The problem is the normative text: it will be archived into `openspec/specs/pipeline-run-reaper` as a false SHALL.

**Other Phase 1 checklist items:** pass.
- The scope is unchanged.
- Constraint C1 is honoured. The positive control still passes, and M1 shows it goes red against a guard keyed on `completed_at IS NULL` alone.

### Phase 2: Code Review — PASS

**Gates:** I ran these myself, in the foreground, in `WORKTREE_PATH`, each batch under 600 s, with `HELIO_TEST_JVM_XMX=3g`, `-J-Xmx3g` and `nice -n 19`. Nothing was backgrounded.

| Batch (`sbt testOnly`) | Succeeded | Failed | Canceled | Guard summary |
|---|---|---|---|---|
| `com.helio.services.pipelines.*` | 605 | 0 | 1 | `failed=0 aborted=0 unreadable=0` |
| the other `com.helio.services.*` subpackages plus top-level services suites | 1382 | 0 | 3 | `failed=0 aborted=0` |
| `com.helio.api.*`, `spark.*`, `testkit.*`, `testsupport.*` | 2282 | 0 | 0 | `failed=0 aborted=0` |
| `com.helio.infrastructure.*`, `com.helio.domain.*` | 3470 | 0 | 0 | `failed=0 aborted=0` |
| default package (`DevEnvSpec`, `ScalaTestSummaryGuardSpec`) | 15 | 0 | 0 | — |

- **Totals:** 7754 succeeded, 0 failed. This matches the executor's figure.
- **Canceled tests:** all 4 are opt-in measurement specs gated on `HELIO_MEASURE=1`: `OutputFilteredMetricMeasurementSpec` once and `DatasetWriteSubmitLatencySpec` three times.
- **Coverage:** I compared the suite headers across all five logs with every Spec class under `src/test/scala`. None are missing.
- **Limitation:** this is not a single `sbt testFull` invocation. One run does not fit within the 600 s tool limit, so the suite was split as above.

**Other checks:**
- `npm run check:scala-quality`: clean. There are 250 soft warnings, all of the soft-budget kind.
- `check-openspec-hygiene.mjs`: clean.

**Code:**
- `failIfLostTerminalWrite` is small, private and has a scaladoc. It leaves `Open` as a no-op, keeps the fixture rule (`pipelineRunRepo == null`), and adds no new exception type.
- It runs after `baselineUpsert`, so the baseline and alert writes still go through in the residual window. Design Non-Goals and HEL-1541 already cover that.
- The edit to the test hook is minimal. The old hook comment that suggested full coverage has been corrected.

### Phase 3: UI Review — N/A
The change is backend-only, and none of the triggers match. The only client-visible effect is the HTTP status code.

### Overall: FAIL

### Change Requests
1. **Fix the wording of the "Pipeline deleted while its run executes" scenario** in `openspec/changes/late-finisher-404-reap-window/specs/pipeline-run-reaper/spec.md:48-52` so that it matches the behaviour shown above. Suggested replacement:
   - **WHEN** a real run is admitted, its pipeline is deleted (cascading the run row), and the execution then succeeds
   - **THEN** it answers 404 `Pipeline not found: <id>` and publishes no `succeeded` event, wherever the deletion lands
   - **AND** when the deletion lands before the early open-check, no snapshot, history or write-back row is written by that execution
   - **AND** when it lands later, no node is written after the deletion. Node snapshots and write-back rows committed before it remain, exactly as for any pipeline delete; history and payload rows go with the cascade.

   If you prefer, D7's own text in `design.md` can state the same limit as well. This is a wording-only change. Do not "fix" it by adding `node_snapshots` cleanup to the delete path; that would be scope creep, and if wanted it belongs in its own ticket.

### Non-blocking Suggestions
- `LateFinisherRunSpec.scala` is now about 350 lines, over the 250-line soft budget. Consider moving the D3 lock-behaviour cases into their own spec.
- Consider recording `node_snapshots` not being cleaned up on pipeline delete (it is FK-free and nothing deletes it) on HEL-1541 or a new follow-up. The leftover orphan rows are a separate concern.
