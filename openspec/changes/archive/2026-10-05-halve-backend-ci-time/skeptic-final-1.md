## Skeptic Report — final gate (round 1, skeptic-final-1.md), head e764ee4f7020602f8a3cc5415253b76a237b06f3

### What I verified (with evidence)
- Diff vs live base 9c247cf6: ci.yml, build.sbt, TestShards.scala, weights, .gitignore, MISTAKES.md, 2 test files, docs. HelioRouteTest and RouteTestBaseGuardSpec are not in the diff (untouched). Commits after 47f581f0 touch only design.md/profile.md/evaluation-*.md (git diff --stat).
- Root cause: `sbt "show Global/concurrentRestrictions"` locally: unset env -> `Limit forked-test-group to 1` (default unchanged); HEL924_TEST_GROUP_CONCURRENCY=2 -> only `to 2`. Claim holds; local default intact.
- Concurrency block: PR -> group by PR number, cancel true; push to main -> group by run_id, cancel false. Correct; main runs never cancel. Live proof (37400092850 cancelled) recorded.
- Compile cache: key hashes src/build files; tests always re-run; restore everywhere, save main/shard 0/non-exact-hit only; zinc probes P1-P5 recorded incl. deleted-source cleanup. Stale-class pass is not plausibly produced (exact hit = same sources; partial = zinc invalidation). Partial-hit on CI is unmeasured (stated). Unbounded growth of ~/.cache/sbt across chained main entries is a non-blocking note.
- Coverage: removal of DateBucketStepSpec test is a byte-identical duplicate; survivor at line 98 confirmed identical in the base file. Counts 5957 = 5954+4-1 and per-leg sums (1251+1481+1409+1816 etc.) reconcile in profile.md. Exactly-once guard recomputes all shards and names offenders; recorded red present (profile.md "Guard red"). Note: the guard is trivially true for LPT and can't see cross-leg input drift; acceptable.
- ci-complete needs [frontend, backend, security, e2e]; fail on failure/cancelled preserved. Matrix 4 legs (C6 ok), job-total-derived count.
- profile.md/MISTAKES.md: cold vs warm numbers labelled honestly; post-merge median stated unmeasured. No overclaim found.

### Verdict: REFUTE

### Change Requests
1. backend/src/test/scala/com/helio/spark/SparkJobSubmitterSpec.scala:336-341 (`awaitTerminalRunStatus`) introduces a race, i.e. new flakiness, in the two tests it was wired into (lines ~387 and ~424). It polls `pipelines.lastRunStatus` for terminal. In SparkJobSubmitter.scala (lines 90-93 success; 113-114 failure) `pipelineRepo.updateLastRunInternal` is committed BEFORE `pipelineRunRepo.updateRunTerminalInternal`. A poll landing between the two writes returns early, and the following `runs.head.status shouldBe Succeeded/Failed`, `rowCount`, `errorLog` assertions can read the still-Running run row. The old fixed 3 s sleep did not have this window. This violates the ticket AC ("known flake classes must not get worse") and C2's spirit. Fix: poll the run record itself (`pipelineRunRepoForSubmit.listByPipeline(...)` having a head with terminal status) and keep the later assertions unchanged, or revert to the sleep. Re-run `testOnly com.helio.spark.SparkJobSubmitterSpec` locally under C1 and update profile.md's long-runner row if wording changes. Docs-only scope of cycle 4 does not cover this; the owner needs to allow a one-test code touch (it does not alter CI timing meaningfully).

### Non-blocking notes
- Cold PR runs 6:21-6:27 > 5.5; owner ruling accepts if honest; PR text must repeat cold/warm split and "post-merge median unmeasured".
- ~/.cache/sbt in the saved entry may accumulate across generations of main entries; watch size under HEL-1299.
