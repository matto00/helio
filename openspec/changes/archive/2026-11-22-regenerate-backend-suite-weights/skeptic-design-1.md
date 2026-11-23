## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 943b5dd734715271eb0cc5110cb79a96bc172540 (the change dir is untracked, so there is no diff yet).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/regenerate-backend-suite-weights/HEL-1821`.
- **The 8 classes exist and have no tsv row.** `find backend/src/test -name <C>.scala` finds all 8 at the stated packages.
  A grep for each in `backend/project/test-suite-weights.tsv` finds nothing. The 3 parents have rows:
  `ClaudeClientSpec 1.780`, `AssistantServiceSpec 4.386`, `AssistantConversationRoutesSpec 3.729`.
  The tsv has 714 data rows, and the median `TestShards.medianWeight` takes (`sorted(n/2)`) is 1.287 s, so each of
  the 8 is priced at about 1.29 s.
- **The tsv's provenance:** its header names runs 44239430764, 44231635772 and 44218987137. `git merge-base` shows 9054da2a6
  (HEL-1758) comes before 0954ea735 (HEL-1803), and 0954ea735 is an ancestor of HEAD.
- **Mechanism:** `TestShards.scala` contains `lpt`, `medianWeight`, `verifyExactlyOnce`, `select` and `groupWithinShard`
  as the design describes. `build.sbt` calls `select` and then `groupWithinShard(mine, weights, groupCount)`, and
  `groupCount` comes from `HEL924_TEST_GROUP_COUNT`, defaulting to 8.
- **CI config (`.github/workflows/ci.yml`):** the matrix is `shard: [0, 1, 2, 3]` (line 219). The workflow sets
  `HEL924_TEST_GROUP_CONCURRENCY: 2` (226) and **`HEL924_TEST_GROUP_COUNT: 4` (227)**. The deadline is `--deadline 660` (327),
  and the artifacts are named `backend-junit-reports-shard-N` (360).
- **Scripts:** `gen-test-suite-weights.py` takes `<label>=<dir>` arguments, unions a run's dirs, takes the mean over
  runs, adds 1.0 s and writes the header itself. `extract-fresh-junit.py <zip> <start> <end> <out>` filters entries by zip
  mtime against the step window and prints the kept count. D2's command matches.
- **Input runs (`gh run list` / `gh api .../jobs`):**
  - 45099529907 (032321ada), 45098330154 (b44a2d81c) and 45088334635 (d350dd7ae) are main push runs that completed with
    `success`.
  - All 4 backend legs of each run ran, and their "Compile and test" steps succeeded with real windows of about 4 to 9.5 minutes.
  - Their junit artifacts exist and are unexpired (they expire 2026-12-07).
- **Same suite set:** `git diff --diff-filter=ADR 07a118001 HEAD -- backend/src/test backend/project` is empty. The
  input runs, the failed run and HEAD therefore discover the same suites, and the before plan at HEAD is the failed run's
  real partition.
- **Suite counts are in the logs:** leg 0 of 45099529907 logs `Suites: completed 178, aborted 0`. D1's kept-sum check
  can be done.
- **The failed run:** 45023531045, job 137211431117, backend (1). The log contains
  `ci-sbt: sbt did not finish within its 660s in-step deadline; thread dump captured`. Artifact `sbt-diagnostics-backend-shard-1`
  (id 14755031576) exists, so the "if present" branch in Risks applies.
  - Up to 12:52:25 the leg was still starting new suites: Flyway migrations, then the
    `GET /api/pipelines/:id/analyze ... upsert target` tests.
  - The ticket says it "stalled in an assistant spec". The log does not obviously show that; it looks like load.
  - Of the 8 new classes, `AssistantServiceFailureBudgetSpec` ran in this leg (log line 15241).
- **Stale comments:**
  - `ClaudeClient.scala:26` reads "`send`'s `guardrailReject` above". The method is now
    `ClaudeRequestBuilder.guardrailReject` (`ClaudeRequestBuilder.scala:105`), and `sendWithTools` uses `guardrailRejectTool` (:95, called at
    `ClaudeClient.scala:106`). D7's "verify which" is right.
  - In the fixture, :131 says userA/userB are "below", but they are defined at :72-:73, above.
  - :225 and :237: `routesForWithChatAccess` and `chatAccessServiceWithLimit` are called only from `AssistantConversationRoutesTierSpec`.
- **Spec and config:** `openspec/specs/backend-ci-test-execution/spec.md:95` contains the requirement named in the proposal.
  `.openspec.yaml` has `skip_specs: true`, and `.gitignore:27` is `*.log`, which is why D6 uses `.txt`.
- **HEL-1758 archive:** `tasks.md` 2.3 states the model as "groupWithinShard into **4 groups**, LPT onto 2 slots" with
  budget "heaviest + 161 s <= 480 s". `skeptic-design-4.md:46` records `HEL924_TEST_GROUP_COUNT: 4`.

### Verdict: REFUTE

The design is mostly sound and well grounded. Its leg-level wall-time model, though, uses the wrong group count, and
that model feeds the D5 stop rule. One comment target is also wrong.

### Change Requests

1. **D3/D4 use the local default of 8 groups, but CI runs 4 per leg.** `ci.yml:227` sets `HEL924_TEST_GROUP_COUNT: 4`.
   - Design "Context" bullet 1 says "(8 default)". D4 says "that leg's 8 groups from `groupWithinShard`".
   - D3's sbt invocation sets only `HELIO_TEST_SHARD_INDEX/COUNT`, so `Test / testGrouping` would print 8 groups. That is not
     what CI runs.
   - The D5 budget (heaviest + 161 s <= 480 s) was calibrated by HEL-1758 with 4 groups on 2 slots. A makespan computed
     from 8 groups is not comparable to it and is likely optimistic.
   - Fix: state that CI uses 4 groups. In D3, also set `HEL924_TEST_GROUP_COUNT=4` in the sbt testGrouping run, so the
     printed groups are CI's. In D4, model 4 groups LPT-packed onto `HEL924_TEST_GROUP_CONCURRENCY=2` slots. Cite
     `ci.yml:226-227` as the source of both values, and update tasks 2.1 and 3.3 to match.
2. **D7 / Context: the `findInput` target for fixture :214 is incomplete.** The comment documents
   `assistantServiceWithSearch` and its "searchedWithNoResults scenario". That scenario is
   `AssistantConversationRoutesTurnSpec.scala:123-132`, which has its own `val findInput` at :128.
   `AssistantConversationRoutesTierSpec.scala:128` has a separate `def findInput`, also `dataType`-only, used at :137 and :162.
   The design names only TierSpec:128. Fix: name both callers of `assistantServiceWithSearch` (TurnSpec and TierSpec),
   or reword the comment so it does not point at one file's `findInput`. Then grep to confirm.

### Non-blocking notes

- Context says the 3 parents sit at "pre-split (large) weights". They are 1.78 s, 4.39 s and 3.73 s, against a median of 1.29 s.
  "Pre-split" is right; "large" overstates it. Since the 8 children are priced at about the median, the parents'
  over-pricing is part of the before-plan error worth stating in D4.
- `extract-fresh-junit.py` keeps reports by **zip-entry mtime** against the step window. That is evidence based on time
  ordering. D1's per-run check (kept sum == the `Suites: completed` total across 4 legs) is the content-based safeguard:
  keep it, and say so in `evidence/regeneration.txt`.
- For the ticket's "stalled in an assistant spec" question, read the thread dump in artifact 14755031576 (threads-<pid>.txt)
  rather than trusting the ticket. From the log, the leg was still running pipeline-analyze suites at the deadline.
- No backend test files changed between 07a118001 and HEAD. Say so in the before-plan evidence, so the before partition
  is shown to be the failed run's real partition rather than assumed to be.
