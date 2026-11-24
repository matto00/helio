## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 286d6f4d53df940fcacf1ccfdba49ec8da92f9a2 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/speed-up-input-limit-tests/HEL-1831`.
- Ticket citations hold against the live tree:
  - `backend/src/test/scala/com/helio/services/assistant/AssistantServiceFailureBudgetSpec.scala:176` is `def sized(target: Int)`.
    It starts at `k = target`, steps down by 1 while `total(k) > target`, then up by 1 while `total(k + 1) <= target`. Every
    step calls `ClaudeTokenEstimator.estimate` over `AssistantSystemPrompt.text` plus `"word " * n` (about 100k tokens).
    Call sites are `:185` (`maxInputTokens - 5`) and `:194` (`maxInputTokens + 50`).
  - `backend/src/test/scala/com/helio/api/routes/assistant/AssistantConversationRoutesTierSpec.scala:148` is `def sizedMessage`,
    with the same walk. Call sites are `:166` (`+ 50`) and `:172` (`- 5`).
  - The number of steps is roughly the size of the system prompt in tokens, and each step tokenizes the whole string. That is
    the O(n^2) shape the ticket describes. D1 still requires measuring it before any change, which is correct: this is the
    ticket's claim, not a fact.
- The design's view of the estimator is correct. `ClaudeTokenEstimator.estimate` (main/.../ai/ClaudeTokenEstimator.scala:22)
  is `messages.map(m => encoding.countTokens(m.content)).sum` (o200k_base). That is deterministic and practically monotonic in
  `n` for `"word " * n`. D3's boundary `require` and D4's probe cover the non-monotonic risk.
- The mutation targets in D5 exist:
  - `ClaudeRequestBuilder.guardrailRejectTool` (main/.../ai/ClaudeRequestBuilder.scala:95) and `guardrailReject` (:105) both
    compare `estimated > config.maxInputTokens`.
  - The mid-turn stop is `ClaudeClient.scala:106-110`: `Some(_) if request.stopOnInputBudget && hopsUsed >= 1` returns
    `InputBudgetExhausted`, which `AssistantService.scala:173-175` maps to `input_budget`.
  - Disabling `guardrailRejectTool` defeats both halves of each test. Without it, the near case reaches the second scripted
    `finalTextResponse("never")` and stops with `final`, and the over case calls the transport instead of returning
    `GuardrailExceeded`/422. D5's "at least one mutation per test, both paths covered" is therefore achievable and checkable.
- AC coverage:
  - AC1 (assertions unchanged, and each test fails under a mutation) is covered by C1, D5 and task 3.1.
  - AC2 (before and after durations measured the same way) is covered by D6 and tasks 1.2 and 3.2. They choose local runs for
    both, which the AC permits.
  - AC3 is optional and is explicitly a non-goal (task 3.3).
- Scope: the change is test-only (C1, and task 3.1 checks that `git diff backend/src/main` is empty), with no contract, schema
  or spec delta. `skip_specs` is justified.
- No TODO or TBD placeholders. Proposal, design and tasks do not contradict each other.

### Verdict: CONFIRM

### Non-blocking notes

1. D6's JUnit path is stale for sbt 2. Reports are written under `backend/target/out/**/test-reports/*.xml`, per the CI
   upload glob `backend/target/**/test-reports/*.xml` (`.github/workflows/ci.yml:363`) and the exclusions at `ci.yml:294,345`.
   They are not at `backend/target/test-reports`. Use the glob.
2. For every `testOnly` run cited as evidence (the timings, the mutation reds and the after-run being "all green"), use the
   MISTAKES.md invocation:
   `nice -n 19 sbt -J-Xmx3g -batch -Dsbt.server.autostart=false "testOnly <FQN>"`.
   Then read ScalaTest's summary (`Tests: succeeded N, failed M`, plus the failing test names), not `$?`. sbt 2 can exit 0
   with `[success]` while tests failed (HEL-1468, MISTAKES.md), which would make a red look green. Also run the project-path
   and non-zero-count checks from MISTAKES.md on each captured log.
3. D4 says the probe code "lives in scratch and is removed before commit". To compile, the probe has to sit under
   `backend/src/test/scala` temporarily. Keep the canonical copy in `.concertino/scratch/HEL-1831/`, and confirm that
   `git status` shows no stray probe file before committing.
4. In D2, seed `hi` so that `total(hi) > target` is checked, not assumed. If it does not hold, fail loudly rather than
   widening it silently.
5. Optional but cheap: in D5, record one red run with the mutation set to an off-by-margin (for example `> maxInputTokens + 100`)
   as well as full removal. That shows the +50/-5 offsets still discriminate with the new helpers.
