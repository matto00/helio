## 1. Backend — Reproduction (spec-under-contention)

- [x] 1.1 Run `PipelineRunGuardIntegrationSpec` in a loop bounded to **up to 40 iterations OR 20
      minutes wall-clock, whichever comes first**, as ONE `sbt` OS-level invocation chaining
      repeated `testOnly com.helio.services.pipelines.PipelineRunGuardIntegrationSpec` commands
      in a single session (reusing the same sbt-launcher + forked test JVM across iterations,
      never relaunching a fresh `sbt` process per iteration). Concurrently, run at most 2
      additional separate `sbt testOnly` OS-level invocations as contenders (e.g.
      `PipelineRunServiceSpec`, `PipelineRunRepositorySpec`) — **at most 3 concurrent `sbt`
      OS-level invocations total (1 loop + up to 2 contenders), never more**, all under
      `nice -n 19`. Verify: at least one failure is observed within the stated bound, OR the
      bound (40 iterations or 20 minutes) is reached with 0 failures (recorded either way, with
      the actual iteration count / elapsed time noted).
- [x] 1.2 For every failure observed in 1.1, copy `backend/target/test-reports/*` for the
      failing run into `openspec/changes/pipeline-guard-flake-repro/repro-evidence/<n>/` and
      record the exact test name + assertion message verbatim in `repro-findings.md`, BEFORE the
      next iteration or any cleanup. Verify: `repro-findings.md` has one dated entry per failure
      with a verbatim assertion message and a reference to its copied XML.

## 2. Backend — Reproduction (full-suite loop, only if 1.1 found nothing)

- [x] 2.1 (N/A — task 1.1 found a failure within its own budget: 33/40 iterations, 159s/1200s.
      Design.md Decision 1 only escalates to the full-suite loop "only if (1) doesn't reproduce
      within its own budget." Skipped.)

## 3. Backend — Diagnosis

- [x] 3.1 For each captured failure, classify it against hypothesis 1 (`4 != 3`/count mismatch),
      hypothesis 2 (latch timeout, "N of the burst's submissions never settled"), or hypothesis 3
      (a different test in the spec) using the verbatim assertion message from `repro-findings.md`.
      Verify: `repro-findings.md` states the classification for every captured failure with the
      quoted text that supports it. **Result: Hypothesis 3** — see `repro-findings.md`.
- [x] 3.2 (N/A — the captured failure classified as hypothesis 3, not hypothesis 2, so no
      `deleteOldRuns`/settlement-latch instrumentation applies. See `repro-findings.md`'s own
      probe for H3's root cause instead.)
- [x] 3.3 (N/A — task 1.1 reproduced a failure within budget; the "nothing reproduces" branch
      does not apply.)

## 4. Backend — Fix (branch on task 3's finding; skip whichever branches don't apply)

- [x] 4.1 (N/A — hypothesis 1 was not confirmed; the concurrency-cap test itself passed in the
      reproducing run. No escalation needed on this branch.)
- [x] 4.2 (N/A — hypothesis 2 was not confirmed; `awaitAllSettled` and the settlement latch are
      unrelated to the confirmed failure and are left untouched.)
- [x] 4.3 [H3 branch] If hypothesis 3 is confirmed: fix that specific test's own defect (no
      changes to `awaitAllSettled` or the settlement-latch coordination). Verify: red-before/
      green-after against the specific failing assertion. **Done** — see `files-modified.md` and
      `repro-findings.md`'s "Fix" section.
- [x] 4.4 Add the Decision 4 guardrail (`withClue` on the concurrency-cap test's admitted/
      rejected count assertions reporting the actual observed breakdown) regardless of which
      branch above applied. Verify: temporarily mutate the guard/test to force a mismatch and
      confirm the `withClue` text actually appears in the failure output, then revert the
      mutation.

## 5. Tests

- [x] 5.1 Run `PipelineRunGuardIntegrationSpec` in isolation, 10/10 green. Verify: `sbt
      "testOnly com.helio.services.pipelines.PipelineRunGuardIntegrationSpec"` x10, all green.
      **Done** — 10/10 iterations green, 100/100 individual tests passed. See
      `repro-evidence/task5-1-isolation.log` and `repro-findings.md`'s Task 5 section.
- [x] 5.2 Re-run whichever reproduction method (task 1 or 2) originally found the failure, at
      least 3x post-fix, to confirm it no longer reproduces under the SAME load shape. Verify:
      0 failures across the re-runs, recorded in `repro-findings.md`. **Done** — 3 rounds,
      40/40 iterations each, 0 failures, under the same 3-way contention as the original repro.
      See `repro-evidence/task5-2-round{1,2,3}-*.log` and `repro-findings.md`.
- [x] 5.3 Run the full backend suite once (`sbt test`) and confirm no regression elsewhere.
      Verify: pass count matches or exceeds the pre-change baseline, with 0 new failures.
      **Done** — 4883 tests, 0 failed, 0 canceled, matches pre-change baseline exactly. See
      `repro-evidence/task5-3-full-suite.log` and `repro-findings.md`.

## Standing Constraints

- [C1] Hardware cap: at most 3-4 concurrent workers total, everything under `nice -n 19`, never
  sized to core count (6c/12t desktop). Never write a loop that relaunches faster than it can be
  stopped.
- [C2] Any test failure seen in any gate anywhere gets its test name + assertion message
  recorded verbatim before cleanup. "Flaky, re-ran green" is not a finding.
- [C3] Never loosen an assertion, add retries/sleeps, or raise a timeout without probe-confirmed
  evidence that the timeout IS the mechanism (e.g. failure log naming the latch message + proof
  the settled count was still climbing).
- [C4] If hypothesis 1 (`4 != 3` again) is confirmed, STOP and escalate before touching
  `PipelineRunRepository.insertRunIfUnderConcurrencyCap` (production guard shipped in v0.8.4)
  rather than self-approving a production fix.
- [C5] Budget exhaustion (bounded-investigation budget, `EXECUTION_CYCLES`,
  `SKEPTIC_*_ROUNDS`, `DEBUG_ATTEMPTS`) is a MANDATORY escalation, never a self-approval,
  including the post-final-REFUTE re-eval loop.
- [C6] Any commit after a final-gate CONFIRM (including a merge from main) needs a fresh
  final-gate verdict before delivery.
