## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD ffb69068ead01f7c84e392365d707de70657e8e3. The base came from `resolve-review-base.sh` (exit 0): 943b5dd734715271eb0cc5110cb79a96bc172540.
The cwd guard returned READY. I ran no servers (C15). All my scratch output is in `.concertino/scratch/HEL-1821/skeptic/`.

### What I verified (with evidence)

**Scope of the diff.** `git diff --stat 943b5dd73...HEAD` lists these files:
- `backend/project/test-suite-weights.tsv`
- comment lines in `ClaudeClient.scala` (scaladoc only), `AssistantConversationRoutesFixture.scala`, `AssistantConversationRoutesTurnSpec.scala` and `AssistantServiceTestSupport.scala`
- openspec artifacts

I read the full `backend/src` diff. Every changed line is inside a `//` or `/** */` comment. There is no app code, no migration, no script change and no workflow change.

**Inputs are the claimed artifacts.**
- I computed sha256 for 4 of the 12 zips. Each matches the GitHub `digest` of the artifact id in the saved `arts-<run>.json`: shard-1 of 45099529907, shard-3 of 45098330154, and shards 0 and 2 of 45088334635.
- All 12 zip sizes match `size_in_bytes`.
- I took the step windows from the saved `jobs-<run>.json` "Compile and test" steps. All 12 match `regeneration.txt`, and every input leg concluded `success`.

**The tsv is the documented script's output.**
- I wrote my own windows file from the jobs JSON.
- I re-ran `extract-fresh-junit.py` per leg into a fresh directory. The kept counts were 178/199/199/199 for each run, with 472/490/499/490 skipped as stale.
- I re-ran `gen-test-suite-weights.py` over those 12 dirs. Its output is **byte-identical** to the committed tsv, header included (`diff` printed nothing). The file has 775 rows plus the header.

**Freshness is backed by content, not only by mtime.**
- The extractor filters on zip mtime. I also checked each kept report's own `<testsuite timestamp=...>`.
- In all three runs, all 775 kept reports have their timestamp inside that leg's step window (0 outside).
- Each run has 775 distinct suite names.
- So the evidence does not depend on mtime ordering.

**Every discovered suite has a measured row.**
- I ran the partition gate myself: real sbt (`-J-Xmx3g`, `nice -n 19`) with `HELIO_TEST_SHARD_INDEX=0..3`, `HELIO_TEST_SHARD_COUNT=4` and `HEL924_TEST_GROUP_COUNT=4`, printing `Test / testGrouping`. All 4 shards exited 0, so `TestShards.select`'s exact-partition check passed.
- The result is 4 groups per leg and 193/193/194/195 suites per leg: 775 placed, 775 distinct.
- The discovered set equals the kept-report set in both directions.
- 0 discovered suites lack a row, and 0 rows name an undiscovered suite.

**AC1: the 8 HEL-1803 classes have measured rows.**

| Class | Weight (s) |
|---|---|
| ClaudeClientFailureBudgetSpec | 1.022 |
| ClaudeClientToolLoopSpec | 1.492 |
| ClaudeClientToolRequestSpec | 1.018 |
| AssistantServiceFailureBudgetSpec | 153.437 |
| AssistantServicePromptHistorySpec | 1.114 |
| AssistantServiceSearchRepairSpec | 1.752 |
| AssistantConversationRoutesTierSpec | 178.283 |
| AssistantConversationRoutesTurnSpec | 1.287 |

All 8 are fully qualified rows in the tsv. Met.

**AC2: before and after balance from one source reproduces.**
- I wrote a Python mirror of `TestShards.lpt`/`groupWithinShard`. With the new tsv it reproduces my real-sbt output exactly (all 4 legs, group contents and order).
- With main's tsv (`git show 943b5dd73:backend/project/test-suite-weights.tsv`) it reproduces the executor's `before-sbt-shard*.out` exactly, over the same 775-suite set. The before plan is therefore confirmed independently.
- Under the old weights, the old plan's legs each sum to 519.5 s. That matches `before-shard-plan.txt`.

Both plans valued with the new weights S:

| Plan | Leg sums (s) | Longest / mean (s) | Makespans, 4 groups on 2 slots (s) | Longest / mean (s) |
|---|---|---|---|---|
| Before | 515.4 / 725.9 / 777.6 / 531.7 | 777.6 / 637.7 | 296.8 / 428.8 / 454.9 / 266.1 | 454.9 / 361.6 |
| After | 637.7 on every leg | 637.7 / 637.7 | 341.7 / 331.1 / 319.0 / 318.8 | 341.7 / 327.6 |

These are identical to `after-shard-plan.txt`. Met.

**Where the 11 assistant and ClaudeClient suites land.** The before → after leg/group table in `after-shard-plan.txt` matches the real sbt output for all 11. The ticket asked whether the missing weights put the assistant specs in one leg. They did not: the before plan spreads them over legs 0 to 3, and leg 1 holds only AssistantServiceFailureBudgetSpec.

**Failed run 45023531045.**
- From the saved jobs JSON, the "Compile and test" durations are 540 s (leg 0), 664 s (leg 1, failed), 655 s (leg 2) and 530 s (leg 3). These match the evidence.
- `diag-1.zip` contains `threads-31406.txt`, which references `PatchSetUndoLaneDescendantsSpec`. This is consistent with the "load, not a hang; last suite was a patchsets spec" reading.
- `git diff 07a118001 943b5dd73 -- backend/project/` is empty, and no class or object was added or removed in `backend/src`. So the before plan is that failed run's real partition.

**D5 headroom miss is stated honestly.** `after-shard-plan.txt` says "AFTER 341.7 + 161 = 502.7 s -> over 480 by 22.7 s". It also records the owner ruling: commit-and-ship, and HEL-1831 for the slow input-limit tests. The ruling is in `.concertino/runs/HEL-1821/events.jsonl` as `escalation.answered` with `sub_answers ["commit-and-ship","standalone"]` and `answer_source "human"`. Per that ruling, I do not treat the miss as a refute.

**AC3: both named comments are correct.**
- `ClaudeClient.scala:25-26` now names `ClaudeRequestBuilder.guardrailReject` "which `send` and `stream` call, and `guardrailRejectTool` for `sendWithTools`". I checked against `ClaudeClient.scala`: lines 44 and 67 call `guardrailReject` inside `send` (:43) and `stream` (:66), and line 106 calls `guardrailRejectTool` inside `sendWithTools` (:91). Both methods are defined in `ClaudeRequestBuilder.scala` (:95 and :105). Correct.
- In the fixture, the tier-gating and beta-cap references now name `AssistantConversationRoutesTierSpec`. TierSpec does use `routesForWithChatAccess` and `chatAccessServiceWithLimit` (:137, and the routes at :162).
- "userA/userB fixtures above" is correct.
- The `findInput` reference names both TurnSpec (:128) and TierSpec (:128). Both define `findInput` and call `assistantServiceWithSearch`.
- The TurnSpec and TestSupport rewrites are scope-only rewordings and are accurate.

**Compile.** Comment-only changes. `testGrouping` depends on `Test / definedTests`, so Test/compile succeeded in my 4 sbt runs. No sbt process from this worktree was left running.

### Verdict: CONFIRM

### Non-blocking notes
- `AssistantConversationRoutesFixture.scala:204-205` says no `find` tool_use "is ever scripted in the fake responses the `AssistantConversationRoutes*Spec` suites script". Read literally, that is false: TierSpec :135/:161 and TurnSpec :130 script `find`, through `assistantServiceWithSearch`. The intended claim is about `assistantServiceWith`'s null collaborators, and that claim holds. The original pre-split sentence ("this file's fake responses") was equally false, because the original file also scripted `find` at :528/:711/:737. So this is a pre-existing imprecision, not one the split or this ticket introduced. A future tidy could say "via `assistantServiceWith`".
- `after-shard-plan.txt` says that applying the model's 15–25 % over-prediction puts the after plan "near 430 s". This is an estimate, not a measurement. The PR's 4 backend-leg CI timings at Delivery are the real after measurement and should be checked to be under 660 s.
