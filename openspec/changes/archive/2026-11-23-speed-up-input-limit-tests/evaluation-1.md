## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `872f32d663de8ed767d81d9cc800810cebc00456` against the live-resolved review base
`286d6f4d53df940fcacf1ccfdba49ec8da92f9a2` (`resolve-review-base.sh`, exit 0).

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (same assertions, each test still proves its limit): the backend diff is limited to the two helper bodies
  (`AssistantServiceFailureBudgetSpec.scala:176-189`, `AssistantConversationRoutesTierSpec.scala:148-161`). No line
  with `should`, `shouldBe`, `assert` or `===` was added or removed. Four mutation reds are committed, and I
  reproduced one of them myself (see Phase 2).
- AC2 (before and after durations, measured the same way): both are local `testOnly` runs of the full spec files,
  with per-test JUnit times. FailureBudget went from 72.461 s to 0.603 s. Tier went from 73.384 s to 0.826 s.
- AC3 (optional weights regeneration): explicitly out of scope, and tasks 3.3 notes it for the PR.
- Tasks 1.1 to 3.3 are all `[x]` and match the commits. No scope creep: only two test files and the change dir are
  touched.
- C1 holds: `git diff <base> -- backend/src/main` is empty, and no assertion changed. C2 holds: commit `98e0a3791`
  (before timings and helper-alone timings) comes before the helper change in `773646a6f`.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates I ran myself:
- `nice -n 19 sbt -J-Xmx3g -batch -Dsbt.server.autostart=false "testOnly ...AssistantServiceFailureBudgetSpec
  ...AssistantConversationRoutesTierSpec"` (with the HEL-1831 DB env and an empty `ANTHROPIC_API_KEY`) printed
  `Tests: succeeded 17, failed 0, canceled 0, ignored 0, pending 0`. Both input-limit tests are listed as passing.
- I did not run full `sbt testFull`, because driver constraints C4 and C5 call for one `testOnly` per spec within a
  600 s tool timeout. The change touches only these two test files, so no other suite's behavior can be affected
  beyond test compilation, and test compilation succeeded.
- `npm run check:scala-quality`: clean. The 295 soft warnings are pre-existing file-size budgets and none come from
  this diff.
- Prettier check on the change's `.md` files: clean. OpenSpec hygiene: clean.

Mutation spot-check, which I re-applied myself: M2, off-by-margin. Both `estimated > config.maxInputTokens` checks
in `ClaudeRequestBuilder.scala:99,107` became `> config.maxInputTokens + 100`, and the result was
`Tests: succeeded 15, failed 2`:
- the Tier test failed at `200 OK was not equal to 422 Unprocessable Content (AssistantConversationRoutesTierSpec.scala:174)`
- the FailureBudget test failed at `"[final]" was not equal to "[input_budget]" (AssistantServiceFailureBudgetSpec.scala:193)`

Both failures match `mutation-red-margin.txt` line for line. I reverted with `git checkout --`. After that,
`git diff <base> -- backend/src/main` is 0 lines and `git status --short` is empty.

Code checks:
- The bisection is correct. It keeps the invariant `total(lo) <= target < total(hi)`, checks the seed loudly with
  `require`, and checks the boundary after the loop. That gives the same contract the old walk guaranteed by
  construction.
- `equivalence-probe.txt` shows identical `k` and totals for all four targets.
- There are about 17 to 19 estimates per call instead of about 2,510, which matches the measured drop.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` change. Dev servers were not started.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `mutation-red-disable.txt`, `mutation-red-margin.txt` and `mutation-red-midturn.txt` end at `[error] Failed tests:`
  without the failing-suite lines that follow it (`mutation-red-firstreq.txt` includes them). The `*** FAILED ***`
  test names and the summary line are already present, so this is cosmetic.
- The bisection body is now duplicated across the two specs. The near-identical linear walk was also duplicated
  before, so this is not a regression. A shared test helper could be considered if a third caller appears.
