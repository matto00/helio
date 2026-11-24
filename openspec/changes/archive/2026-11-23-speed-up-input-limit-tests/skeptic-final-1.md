## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 872f32d663de8ed767d81d9cc800810cebc00456 against live-resolved base 286d6f4d53df940fcacf1ccfdba49ec8da92f9a2 (origin/main).

### What I verified (with evidence)

- **Scope, no app code:** `git diff BASE...HEAD -- backend` touches only two test files, and only the bodies of
  `sized` (AssistantServiceFailureBudgetSpec.scala:176-189) and `sizedMessage`
  (AssistantConversationRoutesTierSpec.scala:148-161). No `src/main` change.
- **AC1, assertions unchanged:** no assertion line appears in the diff. The only additions are bisection plus two
  `require` guards: one checks the bracket `total(0) <= target < total(target+1)`, the other the boundary
  `total(k) <= target < total(k+1)`. The second guard enforces the old loop's postcondition at runtime, so a
  non-monotone estimator would fail loudly rather than mis-size the input.
- **AC1, the tests still catch a broken limit (my own mutation, not one the evaluator ran):** I changed both
  `ClaudeRequestBuilder.scala:99,107` checks to `estimated > config.maxInputTokens - 10`, ran both specs with the
  new helpers, then reverted.
  - The run ended `Tests: succeeded 15, failed 2`, and both input-limit tests failed.
  - FailureBudget: `GuardrailExceeded(Estimated input tokens (99995) ...)`. That shows the bisected input lands
    exactly at target 99995 (limit minus 5), not just somewhere under the limit.
  - Tier: `422 ... was not equal to 200 OK (AssistantConversationRoutesTierSpec.scala:181)`.
  - After the revert, `git status` shows only the pre-existing untracked evaluation-1.md.
  - Log: main-checkout `.concertino/scratch/HEL-1831/skeptic-mut-minus10.log`.
- **The committed mutation reds (M1-M4)** are consistent with what I reproduced. Between them they cover the
  first-request refusal and the mid-turn stop, which together with my -10 mutation gives a tight bracket on both
  sides of the limit.
- **Equivalence:** equivalence-probe.txt reports old k equal to new k for all four (helper, target) pairs. I did
  not re-run the probe. Instead, the runtime boundary `require` proves the same property on every test run, since
  the largest k with total(k) <= target is unique when total is monotone.
- **AC2, timing, re-run fresh (same local method as before):**
  - FailureBudgetSpec: `Tests: succeeded 11, failed 0`. The input-limit test took 0.62 s in JUnit, against 72.461 s
    before.
  - TierSpec: `Tests: succeeded 6, failed 0`. The input-limit test took 0.769 s, against 73.384 s before.
  - These results are not a cache replay, even though sbt printed "cache 100%". Each JUnit XML had an mtime within
    seconds of the run, and its times differ from the committed timing-after.txt (0.603/0.826).
  - The before figures are from the evaluator's timing-before.txt. I did not re-run the old helpers, but
    helper-timing-before.txt (about 2510 estimate calls at about 40 s per call) agrees with them.
- **AC3 (optional weights regeneration):** this was not done. That is acceptable: the ticket marks it optional and
  says to do it once main runs include the fix.
- No UI change, so there is no design review.

### Verdict: CONFIRM

### Non-blocking notes
- The two helpers now duplicate the same 9-line bisection. A shared test utility could hold it, but the design
  scoped this to minimal helper-body changes, so this note is optional polish.
