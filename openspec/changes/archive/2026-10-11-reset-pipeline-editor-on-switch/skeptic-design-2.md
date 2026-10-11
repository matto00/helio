## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `bc8ccac45160dbd5ddc6a4043bc07055e5c09c39`. The change dir is untracked and there is no code diff yet.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/pipeline-switch-stale-steps/HEL-1483`.

### What I verified (with evidence)

**Round-1 CR1 (stale-cache seed) is addressed by D2a, task 2.2a, task 1.3a(i) and the spec "Browser back" scenario.**
- I re-confirmed the premise against the tree.
  - `usePipelineDetailPage.ts:96` reads `persistedSteps = reduxSteps[id]`.
  - `:228-238` seeds once when `!stepsInitialized && persistedSteps.length > 0`.
  - The only writer of `state.steps[pid]` is `pipelinesSlice.ts:484` (`fetchPipelineSteps.fulfilled`), checked by grepping `state.steps[` across `features/pipelines/state`.
- D2a's suggested mechanism is feasible: `stepsStatus` is per-id (`pipelinesSlice.ts:98`, set at `:479/485/490`).
- The design is internally consistent with the seedToken (F-105) logic. The seed already lands after the mount-time analyze on a cold open, so D2a makes a warm revisit behave like today's cold open.

**Round-1 CR2 (URL-scoped assertion) is addressed.**
- D3's rule and spec scenario 3 now assert "no request carries any of A's step ids in URL or body".
- The analyze thunk takes only a pipeline id (`pipelinesSlice.ts:322-329`, `analyzePipeline(pipelineId)`), so no analyze body can carry stale step ids.
- AC4 is therefore really about the client mapping B's analyze result onto stale A cards. That is covered by the scenario "B's step cards render B's analyze result".

**Round-1 CR3 (singleton leaks) is addressed by D5a/b/c and task 2.2b.**
- (a) The failed-load latch is real: `usePipelinePageLoad.ts:45` skips while the status is `failed`/`loading`. D5a scopes the status to an id. The design keeps the constraint that no guard may leave the status stuck at "loading", and that constraint is correct. With a remount, `lastFetchedIdRef` is fresh, so when the status settles the effect re-runs (the status is in its deps at `:57`).
- (b) The late run result leak is real: `submitPipelineRun.fulfilled` (`pipelinesSlice.ts:560-569`) writes unconditionally. `submitPipelineRun`'s arg carries `pipelineId` (`:262`), so a `meta.arg` owner check is implementable.
- (c) The header flash is real: `PipelineDetailPage.tsx:150` shows loading only when `currentPipeline === null`.

**D6 covers the other switch sites from the round-1 non-blocking note** (create modal, `?outputId=` deep link, source-conflict link). Task 1.3a(v) probes them.

**Probe-first ordering holds.** Tasks 1.1-1.4 and 1.3a come before 2.x, and every 2.x item is marked red-first.

**D2a judged: an in-scope, reversible implementation choice, not a new product call.**
- AC2 requires the editor to show "exactly [the] persisted steps" on browser back/forward. D2a is the minimal mechanism that makes that true.
- It is frontend-only, touches no data, and changes no contract.
- The only user-visible effect is that a revisit shows the same loading interval a cold open already shows.
- It also fixes the same staleness on pipeline -> other page -> pipeline revisits. That is the same defect class under AC2, not new scope, but the PR should disclose it.
- `ASSUMED_PRODUCT_CALLS` does not need an entry.

**Nothing blocking remains.** I found no placeholders or TBDs. Every AC (1-7) maps to a task: AC1 -> 1.1-1.4, AC2 -> 2.1/2.2a/3.2/D6, AC3 -> D3/2.3, AC4 -> 1.3 and the spec analyze scenario, AC5 -> 2.2 enumeration and D5, AC6 -> 1.4/3.1/3.3, AC7 -> 3.4. The proposal and design do not contradict each other.

### Verdict: CONFIRM

### Non-blocking notes

1. **Test-vs-route seam (risk of evidence-shaped non-evidence).**
   - Every existing harness mounts `<Route path="/pipelines/:id" element={<PipelineDetailPage />} />` directly. Examples: `PipelineDetailPage.reorderGuard.test.tsx:141`, `.runHistory.test.tsx:136`, `.outputSwap.test.tsx:147`, `.draftCreate.test.tsx:188`.
   - Suppose D2's key lives in a new wrapper used only by `AppRoutes.tsx:115`, and the regression test renders that wrapper. The test can then go green while proving nothing about `AppRoutes` (or the reverse).
   - Prefer putting the key inside the exported `PipelineDetailPage` (outer component keyed around an inner one), so every mount path gets it. Otherwise the regression test must render the exact element `AppRoutes` uses.
   - Task 3.2's running-app re-check is the backstop.
2. **A's error briefly showing during B's load.** The error branch (`PipelineDetailPage.tsx:126`) takes priority over loading, and `fetchPipelineById.pending` deliberately keeps the old error (`pipelinesSlice.ts:458-464`). The D5a id-scoping should therefore also scope the error *render* to the current id. Otherwise A's "Couldn't load" can stay on screen while B loads, even though the end state ends up correct.
3. **Empty-state flash under D2a.** Between `currentPipeline` (B) landing and this mount's steps fetch fulfilling, the editor renders zero steps. If that shows an "add your first step" empty state rather than a loading treatment, it is misleading. The same thing happens on a cold open today. Check this in 3.2, and gate on `stepsStatus[id]` if the flash shows.
4. **`clearRunState` misses two fields.** `clearRunState` (`pipelinesSlice.ts:410-424`) does not reset `runStepRowCounts`/`runSourceRowCount`.
   - `runStepRowCounts` is looked up by step id (`LaneColumn.tsx:230`, `PipelineRiverView.tsx:389`), so A's counts cannot match B's steps.
   - I found no UI reader of `runSourceRowCount` beyond the hook's return value.
   - So this is not visible today. If D5b adds a run-owner field anyway, clearing these two fields alongside it is cheap.
5. The structural refetch `syncStepsFromServer` (`usePipelineStepStructure.ts:57-71`) also dispatches `fetchPipelineSteps(id)`. D2a's "this mount's fetch" marker should be tied to the page-load dispatch or to the first fulfilment after mount. Either works, since `stepsInitialized` still gates the seed to once.
