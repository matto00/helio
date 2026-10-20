## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed head: db36fb4ec8df65702c390336acd2ff05b076ae69. Base 538a867d7 was resolved live with resolve-review-base.sh (exit 0).

### What I verified (with evidence)
- **Spawn guard:** assert-cwd.sh returned READY, branch bug/time-box-user-regex/HEL-1676.
- **Owner rulings:** events.jsonl `escalation.answered` (answer_source=human) gives ["time-box (recommended)", "2s fixed, no env var"]. The code matches both. `RegexTimeBox.StepBudget` is `TimeUnit.SECONDS.toNanos(2)`, no env var is read, and the change has no RE2/J and no validation-time rejection.
- **Diff, read in full** (backend main, 3 files):
  - `RegexTimeBox.scala` (new) adds a deadline-checking CharSequence. It checks the clock every 1024 `charAt` reads, and the read counter is kept per step, not per row. `subSequence` and `toString` return the plain underlying string.
  - `StringOpsStep.scala:175-186` creates one deadline per `apply`. `rows.map` over a strict `Seq` evaluates eagerly. The engine passes `currentRows: Seq[Row]` (InProcessPipelineEngine.scala:287-312), and I found no `.view` or `LazyList` in the engine or draftpreview, so the deadline cannot be started early and then consumed lazily by downstream work.
  - `AssertStep.scala:144-148, 251-263` creates one deadline per `evaluateRules`, shared by all regex rules. Only `PatternSyntaxException` is caught, so an expiry propagates.
- **Error surfacing:** `RegexTimeBudgetExceeded extends IllegalArgumentException`. The engine catches synchronous throws from `evaluate` (`case NonFatal(ex) => Future.failed(ex)`, InProcessPipelineEngine.scala:313-321), and `StepExecutionException.from` maps an IAE's message verbatim, keeping the step id and kind (line 58).
- **No other user-regex sites:** I grepped `Pattern.compile` / `.r` / `.matches(` under domain and services/pipelines. Every other regex is a hardcoded constant. No Spark or other engine evaluates `extractRegex` (grep for `extractRegex|regexp_extract|rlike` in main finds only these files and a migration).
- **AC1 (a backtracking pattern ends in bounded time with a step error naming the step):** `UserRegexTimeBoxSpec` runs the real run path (`RunBackendFixture.runOver`). It asserts `StepExecutionException` with stepId `rx1`/`as1`, stepKind `stringops`/`assert`, the message "regex time budget", and a finish under 5 s. I re-ran it: green.
- **AC2 (both draft-preview slots free afterwards):** `DraftPreviewRegexTimeBoxSpec` runs two catastrophic drafts at the same time with maxInFlight=2. Each gets an `error` line with step `rx`, and two follow-up requests both return 200. I re-ran it: green. The test-report XML shows time=3.291 s, which fits a 2 s budget and not the minutes the unfixed code takes.
- **AC3 (a test fails first; normal regexes behave identically):**
  - `.concertino/scratch/HEL-1676/red1.log`: 3 cases fail with 10 s TimeoutException on unfixed code.
  - `m1.log` (throw removed): red. `m2.log` (per-row deadline): only the accumulation case is red. `m3.log` (assert swallows the expiry): both assert cases are red.
  - `RegexTimeBoxCorpusSpec` compares wrapped and plain matching (find/start/end/groups) over 20 patterns x 20 inputs, including `\n` anchors, `\r`/`\u0085`, `\u000B`, lookaround, backreferences and Unicode. Green on my re-run.
- **Gates I re-ran myself** on db36fb4ec (nice -n 19, HELIO_TEST_JVM_XMX=2g, testOnly):
  - UserRegexTimeBoxSpec + RegexTimeBoxCorpusSpec + DraftPreviewRegexTimeBoxSpec + AssertStepSpec: 46 succeeded, 0 failed. The report XML has a fresh mtime (11:16:21), so the run was not served from cache.
  - InProcessPipelineEngineSpec + FatalErrorHandlingSpec + StringBudgetSpec + StepConfigErrorClassificationSpec: 239 succeeded, 0 failed.
  - The executor's `full.log` (testFull on this head): 9384 succeeded, 0 failed. I accept the pasted output; I did not re-run testFull.
- **UI:** none. No `frontend/**` diff, so step 4 is skipped.

### Verdict: CONFIRM

### Non-blocking notes
- In an assert step, the regex deadline starts at `evaluateRules`, before any rules run. Time spent by earlier non-regex rules (for example `unique` over a large frame) therefore counts against the 2 s regex budget. Starting the deadline lazily on the first regex rule would be more precise. This is minor, and it falls within the accepted trade-off that a legitimately heavy step over 2 s now fails (design.md Risks).
- The budget is wall-clock time, so GC pauses and CPU contention on a 1-vCPU Cloud Run instance count toward it. This is acceptable under the owner's fixed 2 s ruling, but it is worth watching if a legitimate large extractRegex starts failing in production.
- The evaluator's notes on the timing-assert slack and on the inner 180 s Await leaking on a red run stand. Neither blocks.
