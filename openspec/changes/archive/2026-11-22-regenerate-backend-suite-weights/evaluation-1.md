## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: ffb69068ead01f7c84e392365d707de70657e8e3 (commits 88c8d68e6, ffb69068e). Base: 943b5dd73, resolved live with resolve-review-base.sh.
Evaluator scratch: /home/matt/Development/helio/.concertino/scratch/HEL-1821/eval1/

### Phase 1: Spec Review — PASS
- AC1, a measured row for each of the 8 classes: PASS. All 8 HEL-1803 classes have rows in the committed tsv
  (ClaudeClientFailureBudgetSpec 1.022, ToolLoopSpec 1.492, ToolRequestSpec 1.018, AssistantServiceFailureBudgetSpec 153.437,
  PromptHistorySpec 1.114, SearchRepairSpec 1.752, AssistantConversationRoutesTierSpec 178.283, TurnSpec 1.287).
  TurnSpec's 1.287 matches the old median exactly, so I checked it. It is a real measurement: the JUnit times are
  0.281/0.218/0.363 s, mean 0.287 s, plus 1.0 s. Beyond the AC, every one of the 775 discovered suites has a row, and no row
  names a suite that is no longer discovered. Before this change, 61 suites had no row.
- AC2, before/after balance from one source: PASS. Both partitions are valued with the regenerated weights S. I reproduced
  the numbers independently (below).
- AC3, both comments correct: PASS. `ClaudeRequestBuilder.guardrailReject` is called by `send` (ClaudeClient.scala:44) and
  `stream` (:67), and `guardrailRejectTool` by `sendWithTools` (:106). The comment now says exactly that. In the fixture,
  `routesForWithChatAccess` and `chatAccessServiceWithLimit` have their only callers in AssistantConversationRoutesTierSpec.
  `userA` is defined above, at :72. Both TurnSpec:128 and TierSpec:128 define `findInput`. Each changed comment matches the code.
- Driver claim "stalled in an assistant spec": the executor checked it against the thread dump and found it does not hold.
  The last running suite was a patchsets spec. The evidence says the leg was overloaded, not hung, and that the missing
  weights did not put the assistant specs in one leg. That answers both ticket questions.
- Tasks: 1.x to 3.x are done and match the diff. 4.1 (the PR CI leg durations) is left to the orchestrator at Delivery, as
  the task text says.
- Scope: only the tsv, comments and change artifacts changed. No script, workflow, TestShards.scala, app code or migration.
- C12 honoured: commit 88c8d68e6 carries the comments and before-shard-plan.txt. The tsv only changes in ffb69068e.
- CONSTRAINTS C1 to C15: no violation found in the diff.
- Owner rulings (recorded escalation.answered): the after plan misses HEL-1758's 480 s headroom target by 22.7 s
  (502.7 s predicted). Under the owner's commit-and-ship ruling this is stated, not blocked. The after longest leg is
  113.2 s better than before. The two slow input-limit tests are follow-up HEL-1831 and out of scope.

### Phase 2: Code Review — PASS
Verification I ran myself (not taken from the executor's report):
1. **The weights come from the documented procedure.**
   - I re-ran `extract-fresh-junit.py` on all 12 zips into a fresh directory, using the "Compile and test" windows taken
     from jobs-<run>.json. Every window matches regeneration.txt. Kept counts per leg were 178/199/199/199 for each of the
     3 runs, and `diff -r` against the executor's junit dirs found no difference.
   - Each zip's byte size equals its artifact id's `size_in_bytes`, and each artifact's `workflow_run.id` is the stated run.
   - All 3 runs are green main push runs whose heads (032321ada, b44a2d81c, d350dd7ae) contain 0954ea735.
   - Re-running `gen-test-suite-weights.py` with the same 12 `<run>=<dir>` arguments gives a tsv BYTE-IDENTICAL to the
     committed `backend/project/test-suite-weights.tsv` (775 rows plus the header).
2. **The partition gate passes** for 4 shards with HELIO_TEST_SHARD_INDEX=0..3, HELIO_TEST_SHARD_COUNT=4 and
   HEL924_TEST_GROUP_COUNT=4. It ran with `sbt -J-Xmx3g` under `nice -n 19`, and every shard exited 0.
   - `Test / testGrouping` is `Def.uncached` (build.sbt:219), so the "cache 100%" line cannot hide a stale plan.
   - 775 suites are placed, each exactly once.
   - My group output is identical to the executor's after-sbt-shard*.out for all 4 shards.
   - Because testGrouping needs Test/definedTests, these runs also compiled main and test, which is the compile proof for
     the comment edits.
   - No sbt process was left running for the worktree afterwards.
3. **The balance numbers reproduce.**
   - I wrote my own Python mirror of TestShards.lpt and groupWithinShard (eval1/mirror.py, scratch only).
   - With the new tsv, it matches my sbt output exactly on all 4 shards and their groups.
   - With main's old tsv (`git show 943b5dd73:backend/project/test-suite-weights.tsv`), it matches the executor's
     before-sbt output exactly. So the before partition really came from the old weights.
   - Valued with S, the results equal after-shard-plan.txt to 0.1 s:
     - BEFORE: leg sums 515.4/725.9/777.6/531.7 (longest 777.6, mean 637.7); makespans 296.8/428.8/454.9/266.1 (longest
       454.9, mean 361.6).
     - AFTER: every leg sum is 637.7; makespans 341.7/331.1/319.0/318.8 (longest 341.7, mean 327.6).
4. Repo checks on the tree: `npm run check:scala-quality` is clean (only existing soft warnings, none in the changed
   files), `check:openspec` is clean, and `format:check` is clean. No TODO/FIXME was added.
5. `sbt testFull` was not run locally. The local run is serial and takes far longer than the 600 s tool cap (C5), and the
   change cannot affect it: the code changes are comments only, and the tsv is read only when HELIO_TEST_SHARD_* is set.
   This follows design D8. The PR's 4 CI backend legs are the real test run.

CONTRIBUTING [mechanical] rules: there is no line-width rule and no scalafmt config, so the long comment lines are not a
violation (see the suggestions below).

### Phase 3: UI Review — N/A
No frontend/**, ApiRoutes.scala, schemas/** or openspec/specs/** change.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- AssistantConversationRoutesFixture.scala:214 is 195 characters, and the other rewritten comment lines (:132, :204, :225,
  :237, and ClaudeClient.scala:25-26) run to 135-152. Rewrapping them to the surrounding width of about 100 would match
  the file.
- before-shard-plan.txt, the thread-dump paragraph: it says the dump was taken at 12:52:25Z and that beforeAll "started 1 s
  earlier at 12:52:26". That is one second AFTER the dump. Correct whichever timestamp is wrong. No conclusion depends on it.
- Run 45105409485 (943b5dd73) was in progress when the executor ran and has since finished green. Design D1 allowed it to
  replace the oldest input but did not require it. Not needed.
