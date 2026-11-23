## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 943b5dd734715271eb0cc5110cb79a96bc172540. The change dir is untracked, so no artifact diff exists. I read ticket.md, proposal.md, design.md, tasks.md and .openspec.yaml.

### What I verified (with evidence)
- **Shard wiring.** `backend/build.sbt:220-221`: `groupCount` comes from `HEL924_TEST_GROUP_COUNT` and defaults to 8. `:236-252` LPT-selects and then calls `groupWithinShard`. `ci.yml:219` has `shard: [0, 1, 2, 3]`, and `:226-227` sets concurrency 2 and group count 4. The design's Context, D3 and D4 now match this. Round 1's CR1 is resolved: tasks 2.1 and 3.3 set `HEL924_TEST_GROUP_COUNT=4`.
- **`TestShards.scala`.** `select` recomputes every shard and verifies an exact partition. An unknown suite gets the median weight. With the current tsv (714 rows), the median is 1.287 s, which matches the design.
- **Missing rows confirmed.** None of the 8 HEL-1803 classes has a row. The 3 parents sit at 1.780, 4.386 and 3.729 s. `LocalFileSystemAtomicWriteSpec`, `LocalFileSystemFromEnvSpec` and `LocalFileSystemPruneSpec` (from HEL-1817) also have no row. The design names them generically ("any other suite added since"), and D2's no-unweighted-suite check covers them.
- **Procedure.** `gen-test-suite-weights.py` takes repeated `<label>=<dir>` arguments, unions dirs within a run, averages across runs and adds 1.0 s. `extract-fresh-junit.py` filters by zip mtime against the step window. D1 and D2 match both scripts. D1 keeps the content-based guard (kept sum == discovered suite count) and labels it as such.
- **Input runs.** 45099529907 (032321ada), 45098330154 (b44a2d81c) and 45088334635 (d350dd7ae) are main push runs with conclusion success. `git merge-base --is-ancestor 0954ea735` holds for all three. Run 45099529907's four `backend-junit-reports-shard-*` artifacts exist and have not expired. The failed run 45023531045 (07a118001) is conclusion=failure, and the design excludes it as an input. Its artifact 14755031576 is `sbt-diagnostics-backend-shard-1`, not expired.
- **Stale comments.** `ClaudeClient.scala:26` reads "`guardrailReject` above". `ClaudeRequestBuilder.scala:105` has `guardrailReject` and `:95` has `guardrailRejectTool`, and D7 tells the executor to check which applies. In the fixture: :131 says "below", but userA is defined at :72. :214 points at "`findInput` below", while `findInput` is defined in TurnSpec:128 (a val, used at :130/:132) and in TierSpec:128 (a def, used at :135/:137 and :161/:162). :225 and :237 say "tests below". Round 1's CR2 is resolved: D7 now rewords :214 so it points at neither file.
- **Budget.** The D5 budget (heaviest-leg prediction + 161 s <= 480 s, with 4 groups LPT-packed onto 2 slots) matches the archived HEL-1758 design.md:146-154.
- **Spec.** `openspec/specs/backend-ci-test-execution/spec.md:95-104` is the requirement being applied. `skip_specs: true` is consistent with that.
- **AC coverage.**
  - AC1 (a measured row for each of the 8 classes) is covered by D2 and task 3.2.
  - AC2 (longest and mean, from one source, before and after) is covered by D4 and task 3.4.
  - AC3 (comments) is covered by D7 and tasks 1.1-1.3.
  - The ticket's "one leg?" question is covered by D4's 11-suite leg placement.
  - The CI-run cap is covered by D8.
- **Scope.** Only the tsv, comments and evidence change. No script, workflow, timeout or leg change. I found no placeholders or TBDs.

### Verdict: CONFIRM

### Non-blocking notes
- D4 says "no backend test file changed between 07a118001 and HEAD". That is literally false: `git diff --stat 07a118001 HEAD -- backend/` shows `ApiRoutesSpec.scala` +64 lines (d350dd7ae, HEL-1615). The diff adds no `class` or `object` lines, so the discovered suite set is unchanged. The partition depends only on suite names and weights, so the conclusion still holds (the before plan is the failed run's real partition). In `evidence/before-shard-plan.txt`, state the check as "same discovered suite set" (and show that check), not "no test file changed".
- At execution, re-list the newest green main push runs. 943b5dd73 (HEL-1826) may have produced a newer green run. If one is used, record the substitution in `regeneration.txt`.
- Nothing in the artifacts depends on mtime ordering, other than `extract-fresh-junit.py`'s own filter, which D1 already discloses and guards with the kept-sum check.
