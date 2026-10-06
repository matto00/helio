## Evaluation Report — Cycle 2 (evaluation-2.md)

**Reviewed HEAD:** `1d31abf3c4d61c83cea3eb09a77b38a40e79a917`. The review base, `5a914c75cc74ddbaf98e0047b01d2ca0dad86efa`, was resolved live with `resolve-review-base.sh`.

**Spawn-cwd guard:** re-run on resume, result `READY`.

**Scratch logs:** cited logs are in `/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/`, which is shared with other lanes. I re-checked every cited file against this worktree.

### Phase 1: Spec Review — PASS

#### Escalation and C5

- **The escalation is recorded.** `.concertino/runs/HEL-1344/events.jsonl` has `escalation.raised` at 05:12:08 PDT and `escalation.answered` at 10:25:37 PDT. The answer is `answer:"proceed-with-documented-non-repro"`, with `answer_source:"human"`, `resolution_channel:"chat"` and escalation_id `HEL-1344-1791288728100-91200a`.
- **The escalation came after P4.** It was raised after P4 finished (the watcher log ends at 05:09:12), so the owner ruled with the full probe set in front of them.
- **C5 is in tasks.md and is binding.** AC1 is now met by a documented non-reproduction at the worker cap, with honest H1/H2/H3 status. My cycle-1 ruling stands as the pre-escalation reading and is now resolved by the owner.

#### CR1: the P4 phase-boundary probe ran as specified

I verified this from the raw logs, not from the executor's summary.

- **Runs:** there are 21 `hel1344-p4-r*.log` files and 63 `P4 <kind> before p50=… after p50=…` lines. All 21 runs show `succeeded 3, failed 0`.
- **Inversions:** `inversion=true` appears 0 times, so the result is 0/63.
- **Smallest gap:** I recomputed after-p50 minus before-p50 for every line. The smallest gap is -2ms, on appendFormRow with before 112 and after 110. That line is the only one under +39ms. The after samples on it, `498,346,801,1385,1167,757,547,92,…`, match probe.md.
- **Pinning:** every one of the 21 logs contains `affinity mask` lines (63 in total). The only value is `3`, meaning CPUs 0 and 1, which are the same CPUs the burners are pinned to.
- **Burner kills:** `hel1344-watcher.log` shows 63 `start burners` entries and 63 `boundary killed` entries. Each kill names the recorded PIDs; `hel1344-watcher.sh` uses `kill ${PIDS[@]}` on its own array. There are 3 burners plus the nice'd sbt run, so **C2 holds**.
- **H3 evidence:** the logs contain 0 `triggerAutoRun failed` lines. The `afterDenied` counts are 1260 entries, every one equal to 2 (21 runs × 3 tests × 20 writes).

#### CR2 and CR3: probe.md and proposal.md are honest under C5, and their numbers match the logs

| Claim in probe.md / proposal.md | Source | Matches |
| --- | --- | --- |
| P1b smallest gap +51ms | p1b report lines (51 replaceRows, then 53 patchRow) | yes |
| 0/26 whole-spec runs | P1 6 + P1b 20 | yes |
| 0/63 at phase boundary | as above | yes |
| 0/30 in-JVM repeats | `p3-burst0/1.log` | yes |
| Unloaded p50 11/34, 6/25, 6/22 ms | `p0-warm.log` | yes |
| P2 baseline 31-37, swap 14-25, interleave 29-33 ms | `p2-summary.txt` | yes |
| About 1500 awaited writes, 0 degraded | 1260 (P4) + 234 (modified spec) | yes |

- **No overclaiming.** Neither document claims a reproduction or a proven cause. H2 is "supported but unconfirmed", H1 is "not the cause alone", and H3 is "cannot be excluded for the lost HEL-1333 transcript".
- **The probe's limit is disclosed.** probe.md says plainly that pinning also slows the after path, so the worker cap could not produce a quiet, fast after phase. That is the honest limit of P4.
- **Skeptic-design-1 note 6 is closed.**

#### Remaining checklist

- **AC2, AC3 and AC4 still PASS.** The spec file is unchanged since cycle 1: `git diff 45c6e61db HEAD -- <spec>` is empty.
- **Scope is clean.** The three-dot diff against the base touches only the spec and the change dir. The changes to `.gitignore`, `ci.yml` and `playwright.config.ts` between the old base and HEAD come from main via the merge (`9b2c6f1cd`), not from this branch. **C4 holds.**
- **C1 holds:** no wall-clock value decides pass/fail.
- **C3 holds:** no probe variant is in the tree (the only `*Probe*Spec` is the pre-existing `SseReconnectGapProbeSpec`), and probe.md contains distilled numbers only.
- **workflow-state.md** is still uncommitted; it is ignored through `.git/info/exclude`.
- **evaluation-1.md** is committed in the change dir, which follows archive convention.

### Phase 2: Code Review — PASS

#### Gates, run fresh on the merged HEAD

- **Command:** `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19 sbt testFull`.
- **Result:** exit 0, `Tests: succeeded 6081, failed 0, canceled 4`. The log is `eval1344-c2-testFull.log`.
- **The 4 canceled tests:**
  - 3 are this spec's `HELIO_MEASURE=1` report tests.
  - 1 is HEL-1326's `OutputFilteredMetricMeasurementSpec` ("should add no more than 500 ms"), which came in from main and is gated the same way.
- **No FirstRunRoutesSpec timeout or failure. "Java heap space" count: 0.**
- **The spec is correct on the merged base.**
  - Main changed `PipelineService`, `OutputService` and `OutputHistory*`, but not `DataSourceService` or `AutoRunTriggerService`. The D2 assertions passed in the full run.
  - The executor's own targeted post-merge run, `hel1344-postmerge.log`, gave `succeeded 3, canceled 3`.

#### `HELIO_MEASURE` after the merge

HEL-1326 independently introduced the same env-var name with the same semantics: `sys.env.get("HELIO_MEASURE").contains("1")` plus `assume`. The two are consistent and do not collide.

#### Unchanged since cycle 1

The cycle-1 code review stands, because the code did not change: D2 is deterministic, D3 is report-only, and the scaladoc documents the `sbt --client` limitation.

#### Pre-commit helio-mcp typecheck

I did not re-verify this. Only the executor's account exists, because the failing log was overwritten. The fix it describes, a worktree-local `npm ci` for `helio-mcp`, touches no tracked files. `.npm-cache/` is ignored through `.git/info/exclude:22`.

### Phase 3: UI Review — N/A

This is a backend test-only change. None of the UI triggers match.

### Overall: PASS

### Non-blocking Suggestions

- **design.md D3 is stale after the merge.** It says "`HELIO_MEASURE` does not exist anywhere in the repo yet". HEL-1326 has since shipped the same name on main. Consider a one-line note at archive time.
- **Carried over from cycle 1:**
  - `DatasetWriteSubmitLatencySpec.scala:160` has an inline `java.time.Instant`. Import it at the top instead.
  - `:27` has an unused `ExecutionContext` import, which predates this change.
- **Shared exclude file.** `.git/info/exclude:22` (`.npm-cache/`) applies to every worktree of the repo. It is harmless, but it is shared state the executor added outside this worktree.
