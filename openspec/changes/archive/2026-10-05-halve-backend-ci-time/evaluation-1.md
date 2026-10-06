## Evaluation Report — Cycle 1 (evaluation-1.md), head 4bff9a36bbf1d568d5a1f1415dba3829274cbed5

### Phase 1: Spec Review — PASS
- Spec requirements (exactly-once partition, every shard gates, ledgered removals, CI-measured profile) are implemented. `ci-complete` unchanged and still `needs: backend`; a matrix under one job id aggregates, `fail-fast: false`. C4 respected (only `backend` job touched; `.sbtopts` untouched; e2e untouched). C2 respected: only one test removed, ledgered; `HelioRouteTest`/`RouteTestBaseGuardSpec` absent from the diff. No test removed/weakened for flakiness (the ConnectorCompletionServiceSpec flake was handled by returning concurrency to 2, test untouched).
- Ledger row 1 verified: survivor `DateBucketStepSpec.scala:98` has identical rows, identical `evaluate(...)` call, identical assertions (lines 104-105) to the removed test.
- Planning artifacts reflect the implemented behaviour (profile.md, tasks.md); D4 comment correction done; D7 cache key widened.
- Not-yet-verifiable ACs are listed under Pending CI.

### Phase 2: Code Review — PASS
- Concurrency claim verified locally: `sbt show Global/concurrentRestrictions` with env unset prints `Limit forked-test-group to 1` only (build.sbt's old `limit(...,4)` is gone, so effective behaviour identical to main, where both limits applied and 1 won); with `HEL924_TEST_GROUP_CONCURRENCY=2` it prints only `Limit forked-test-group to 2`. Mechanism confirmed; unset default is unchanged. Unsharded grouping branch is textually the original hash groupBy.
- TestShards.scala: pure, deterministic (name/index tie-breaks), exactly-once verified over all shards each run, loud invalid-env failures (red transcripts in profile.md), empty groups dropped. build.sbt shard dumps for 8 shards run fine.
- .gitignore: only `backend/project/{target,project,.bloop,.bsp}/` ignored; `git check-ignore` confirms target/ and project/project/ ignored, TestShards.scala and weights tsv not. `git ls-files backend/project` = build.properties, plugins.sbt, TestShards.scala, gen script, weights tsv only; no generated output committed.
- SparkJobSubmitterSpec: sleep(3000) -> poll (50 ms, 30 s deadline) on terminal status; the following assertions are untouched and would still fail if the status never settles. Acceptable.
- Weights file: 416 suites + header. Per-leg test counts in profile.md sum to 5958 (checked).
- Spot-checked CI: run 37367715773 per-leg wall times (285/246/294/345/289/261/296/225 s) and run 37352303257 job duration (17:57:24-18:15:54 = 18m30s, profile says 18m28s step-level) match the profile.
- Did not run the full local suite (executor's 6.1 recorded 5958 green pre-removal); shard dumps and restriction probes only.

### Phase 3: UI Review — N/A (CI/test-infra only; no dev servers started)

### Overall: PASS

### Non-blocking Suggestions
- Risk to the AC: the only full 8-leg run shows slowest leg 345 s (5:45, leg 2, 939 tests); median <= 5.0 min / <= 5.5 min on main is not yet demonstrated. profile.md notes weights were refreshed locally but "not pushed"; consider committing the rebalanced weights so leg 2 is not the long pole. (Head already contains a weights file; confirm it is the refreshed one before the final-head runs.)
- MISTAKES.md says "a leg takes ~5 min"; measured slowest was 5:45. Tighten once final-head runs exist.
- profile.md "Before" job total 18m28s vs gh 18m30s (step vs job span); trivial.

### Pending CI (paused)
- Task 3.4: `ci-complete` aggregate behaviour on a real run.
- Task 6.2: >= 3 green final-head runs, slowest-leg median <= 5.0 min, per-leg test counts summing to 5957 (5958 minus 1 removed), final After top-20.
- Task 6.3 CI half: RouteTestBaseGuardSpec and FirstRunRoutesSpec confirmed in a final-head CI leg.
- Post-merge: median of 5 main runs <= 5.5 min; flake rate report.
