## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed against the live tree at HEAD `a6ac494b47f756d38520e17b4fb5aeab898ace6b` (the change dir is untracked, with no code changes yet).

### What I verified (with evidence)

- **Caller enumeration is correct.** `grep -rn findActiveRunInternal` over backend main+test, helio-mcp and docs (archive excluded) finds the definition (PipelineRunRepository.scala:642) and one call site, `HookTriggerService.collapseIntoActiveRun` (HookTriggerService.scala:59). Nothing in the tests calls the repository method directly. The only path in is `hasActiveRunInternal == true` (HookTriggerService.scala:52-53).
- **The current query has no ORDER BY**: `runsTable.filter(pipelineId === p && completedAt.isEmpty).result.headOption` (:642-645). The doc comment's "at most one run ... null completed_at" claim (:636-641) is stale.
- **Overlap is reachable.** `PipelineRunService.submit` (PipelineRunService.scala:175-200) checks owner/editor and nothing else. No per-pipeline open-run check.
- **The dry-run exclusion holds.** `dryRunRowAction` writes `completedAt = Some(startedAt)` (PipelineRunRepository.scala:469-480), so the `completedAt.isEmpty` predicate already excludes dry runs. `recordUnrunnable` inserts an open row and then makes it terminal, which leaves only a transient open window. That is harmless.
- **Indexes**: V24 `pipeline_runs_pipeline_id_idx` and V136 `pipeline_runs_pipeline_started_idx` exist. V147 is the max migration, so V148 is the next free number. D4 is sound.
- **The spec delta** is a full MODIFIED requirement that keeps the original scenario. "Greater id" is TEXT comparison (V24 `id TEXT PRIMARY KEY`), the same basis HEL-1626 and the reaper (:389, :422) already use.
- **The red-ability of the D3 repository cases holds up.** An un-ordered query returns heap or index insertion order. Seeding both insertion orders makes the unchanged code wrong in one of them for (a) and (b). In (c), the newer COMPLETED run makes "drop the completedAt filter" red under DESC. `startedAt.asc` goes red on (a). "Drop id.desc" goes red on (b) in one insertion order, though that relies on planner tie order rather than being guaranteed. The repeated calls plus both orders make it practically reliable.
- **Test fixture.** `PipelineRunOrderTiebreakSpec` / `TwoUserRlsApiFixture` exist and seed runs by privileged insert, as D3 says. The existing hook collapse test is `HookRoutesSpec.scala:292`. It seeds one run via `insertRunInternal` and asserts the response `runId`.
- **D1 (newest-first vs oldest-first) tested.** See Change Request 3. The design misses one structural fact: the hook only *starts* a run when `hasActiveRunInternal` is false. So in the spec's own named scenario ("Retry while a triggered run is still executing"), the run the original trigger started is the OLDEST open run, apart from the check-then-act race. Any other open run was started later by a manual, editor, PAT or MCP submit. Newest-first therefore hands a retrying caller a run its first attempt did not start, while oldest-first returns its own run. There is a counter-argument the design also omits: an orphaned open run (dead server) stays open until the HEL-1511 reaper fires (`PIPELINE_RUN_STALE_AFTER_SECONDS`, default 600 s). Oldest-first would report that dead run over a live newer one, and newest-first avoids it. Freshness and agreement with `runs/latest` also favour newest. Newest-first is still defensible, but the design reached it without weighing the case its own spec scenario names.

### Verdict: REFUTE

### Change Requests

1. **The hook-level proof (D3 last sentence, tasks 3.2) can pass vacuously.** As written it does not say how the two open runs are seeded. If the newer run is inserted first, the unchanged code already returns it and the hook case is green before the fix. Specify both of these:
   - put the case in `HookRoutesSpec`, beside the existing collapse test at :292, which already builds the route fixture with `insertRunInternal`;
   - seed the newer open run LAST, or both insertion orders.

   Also require 3.3's `red-run.txt` to show this hook case failing on its own, not just the spec file as a whole being red.
2. **Task 3.5's regression set omits `HookRoutesSpec`.** It is the only existing spec that exercises `collapseIntoActiveRun` (:292). Add it alongside `PipelineRunGuardIntegrationSpec` and `ExistenceNotLeakedRoutesSpec`.
3. **D1's rationale must engage the retry case and the orphan case** before the rule is fixed. Either switch to oldest-first, or keep newest-first and state:
   - (a) the hook starts a run only when none is open, so a retrying hook caller's own run is the oldest open run, and under newest-first it may get a different `runId` than its first attempt's run;
   - (b) why that is acceptable, for example that orphaned open runs persist up to the reaper's stale window and newest-first never reports a dead run over a live one.

   Add (a) to Risks/Trade-offs as an observable consequence. The current Risks line says only "now always gets the newer one". The PR's overlap answer should carry the same point.

### Non-blocking notes

- `docs/agent-native.md:103-106` says the hook "returns the in-flight run's `runId`/status" (singular). One clause naming which run is returned when several are open would keep the external doc in step with the spec delta.
- Task 1.3 is likely a no-op: HookTriggerService.scala's comments make no single-open-run claim. The "vanishingly unlikely" comment at :61-64 concerns the exists/read race and stays true.
- `ExistenceNotLeakedRoutesSpec` counts `Forbidden` producers per file (`HookTriggerService.scala -> 1`, :547). A comment-only edit must not add that token.
- The "drop id.desc" mutation's red depends on planner tie order. If it comes out green, record the plan rather than reshuffling seeds until it goes red.
