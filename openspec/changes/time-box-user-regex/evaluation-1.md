## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed head: db36fb4ec8df65702c390336acd2ff05b076ae69 (base 538a867d7, resolved live via resolve-review-base.sh).

### Phase 1: Spec Review — PASS
Issues: none.
- AC1 (bounded end with a step error naming the step): `UserRegexTimeBoxSpec` asserts `StepExecutionException` with `stepId`/`stepKind` and "regex time budget" in under 5 s for stringops and assert, on the real run path (`RunBackendFixture.runOver`).
- AC2 (both draft-preview slots free afterwards): `DraftPreviewRegexTimeBoxSpec` runs two catastrophic drafts at once (`maxInFlight = 2`). Each ends with an `error` line naming `rx`. Then two concurrent requests both return 200.
- AC3 (test fails first; normal regexes unchanged): red1.log shows 4/5 `UserRegexTimeBoxSpec` cases red on the unfixed code (10 s bounded TimeoutException). `RegexTimeBoxCorpusSpec` compares wrapped and plain matching (find/start/end/groups) over 20 patterns x 20 inputs. The existing StringOps/Assert/engine specs pass unchanged.
- Constraints: C1 holds. `StepBudget` is a fixed 2 s constant, and no env var is read. One `Deadline` per `StringOpsStep.apply`/`evaluateRules` call is shared across rows and rules. C2 holds: there is no frontend diff, no RE2/J and no validation-time rejection.
- Tasks are all ticked and match the code. Scope: I grepped `Pattern.compile`/`.r` under `domain`, and the only user-supplied regex sites are `StringOpsStep.scala:165` and `AssertStep.scala:256`, so no site was missed.

### Phase 2: Code Review — PASS
Gates I ran myself on db36fb4ec (nice -n 19, HELIO_TEST_JVM_XMX=2g, targeted testOnly, because the executor's full.log already shows testFull green on this head: 9384 succeeded, 0 failed):
- UserRegexTimeBoxSpec, RegexTimeBoxCorpusSpec, DraftPreviewRegexTimeBoxSpec, AssertStepSpec: 46 succeeded, 0 failed.
- InProcessPipelineEngineSpec, FatalErrorHandlingSpec, StringBudgetSpec, StepConfigErrorClassificationSpec: 239 succeeded, 0 failed.
- `npm run check:scala-quality`: clean (no new warnings from the changed files). `check:openspec` and `check:test-temp-dir-hygiene`: clean.
- No `frontend/**` change, so the frontend gates do not apply.

Mutation evidence (executor's logs, reviewed):
- m1, no throw: 4 red.
- m2, per-row deadline: only the accumulation case is red, which shows that test discriminates.
- m3, assert swallow: both assert cases red.

Draft-preview red not shown (orchestrator question): I accept this. The spec asserts `message` includes "regex time budget", text that exists only with the fix. On unfixed code the 40-character walk runs for minutes, so the 30 s `Await` in `bodyText` throws. The test is therefore red by construction. Running it red would leave two JVM threads backtracking for minutes, which the bounded-resource rules argue against. The engine-level mutations already prove that the wrapper is what makes the error appear.

Code notes (none blocking):
- `BoxedInput.subSequence` returns the plain substring, so `group()` text is unchanged.
- The exception skips stack-trace capture (`fillInStackTrace` override), which keeps the hot loop cheap.
- `RegexTimeBudgetExceeded extends IllegalArgumentException`, so the engine's existing catch surfaces the message verbatim.
- The unsynchronised `reads` counter is justified by single-thread step evaluation, and this is documented.

### Phase 3: UI Review — N/A
The diff is backend-only. No trigger paths changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The new spec delta is under `openspec/changes/`, not `openspec/specs/`.

### Overall: PASS

### Non-blocking Suggestions
- `UserRegexTimeBoxSpec.scala:33-36`: on a regression, `timedRun` leaves the 180 s inner `Await` future running on `ExecutionContext.global` after the 10 s bound. That only matters on a red run. It is acceptable, but it could be noted in the doc comment.
- The wall-clock asserts (< 5000 ms, < 15000 ms) leave about 3 s of slack over the 2 s budget. That is fine on the 4-vCPU CI runner, but worth remembering if CI ever reports a timing flake.
