## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 590ac4575ad42010e322a527fdf296e6cea77213 (change dir is untracked planning artifacts only).

### What I verified (with evidence)

- **Driver's cause reading: confirmed from the code.** `OutputHistoryRetentionInFlightSpec.scala:57`
  `{ historyReached.trySuccess(()); history(historyCalls.incrementAndGet()) }` and `:61` (payload, same shape).
  `OutputHistoryRetentionService.scala:92` runs `repo.thinPass(...)` inside `Future.delegate`, so the stub body runs on
  `ExecutionContext.global` (spec line 27), not the test thread. The promise completion is the only
  happens-before edge with the test thread; `incrementAndGet` comes after it, so the test-thread read after
  `await(historyReached.future)` can see 0. Line 96 is the CI failure: line 95's `purgeIfDue(laterAt)` returns
  `Future.successful(None)` synchronously (service line 74, guard busy), so no time passes between the await at 94 and
  the read at 96. That fits the reported `0 was not equal to 1 (...:96)`.
- **Every counter read in the spec, classified** (did the plan miss one?):
  - :75: racy (the await at 74 is the only edge). Covered by the fix.
  - :80: **also racy on unfixed code, and the design does not list it.** The `await` at 79 is on an already-completed
    `Future.successful(None)` and creates no edge with the pool thread. It is covered by the same reorder, since
    after the fix the edge at :74 already publishes the increment. No extra change is needed (see notes).
  - :96: racy. Covered by the fix.
  - :87, :99, :100, :108, :109, :123, :128, :131: ordered. Each follows an `await` on a pass future that can only
    complete after the stub body has returned, and the body's argument `incrementAndGet()` runs before
    `history(...)`. `Future.delegate`'s result completes only after the body returns.
  - :119: ordered, as the design says. `purgePayloads` is entered in `flatMap` after the history future (built after
    the history increment) completes, so `payloadReached` happens after the history increment.
  - :140/:142: ordered, as the design says. `secondReached.trySuccess` is inside `history(n)`, after `n` is evaluated.
  - **No test reads `payloadCalls` at all** (grepped the spec: only declarations and the stub). So the payload-stub
    reorder is consistency-only, as the design's Risks section says.
- **Does the mutation discriminate? Yes, for history.** Unfixed + `Thread.sleep(500)` between `trySuccess` and
  `incrementAndGet` means the test thread wakes within microseconds and reads 0 at :75 (test 1) and :96 (test 2).
  Fixed (`increment; signal; sleep; history(n)`) means the increment is published by the promise edge, so :75, :80
  and :96 read 1. The delay only postpones `held.future`'s linking, and the 10 s `await` bound absorbs it. The
  other tests also pass under the fixed-order sleep: test 3 throws after the sleep, and test 5's `secondReached`
  is inside `history(n)`. So the same sleep position, red before and green after, isolates exactly the ordering
  property. **For payload the mutation discriminates nothing**, because no read depends on `payloadReached` →
  `payloadCalls`.
- **Service is not implicated by this failure.** The guard is set and released correctly
  (`compareAndSet`, `andThen` release on the returned future at :81, the not-due path releases at :79). The failure
  is fully explained by the stub ordering. Task 1.4 keeps the deeper review as an executor deliverable, which matches
  the AC.
- **ACs → tasks:** AC1 → 1.1. AC2 → 1.2 + 1.3. AC3 → 1.4 (Decision 3 names the checks). AC4 → 1.5 + Planner Notes.
  The `[hel1468-guard]` marker exists (`backend/project/ScalaTestSummaryGuard.scala:78`). No scope drift, and no
  contract/schema change is needed (test-only, `skip_specs: true` is right).
- **Design's JMM claim** (increment, then CAS-complete the promise, then `Await` on the test thread gives
  happens-before) is correct.

### Verdict: CONFIRM

### Non-blocking notes (executor should honour these; the evaluator should check them)

1. **Judge red and green runs by ScalaTest output, not the exit code.** MISTAKES.md ("sbt 2 can exit 0 and print
   `[success]` while ScalaTest says `*** N TESTS FAILED ***`") applies to `testOnly`. For 1.1, the evidence must show,
   for each of the 3 runs, the `[hel1468-guard] ScalaTest summary: failed=N` line with N ≥ 1, and the `*** FAILED ***`
   lines for **tests 1 and 2 specifically**: "not start a second pass..." failing at :75, and "release the guard when
   the history part fails with a future..." failing at :96, each with `0 was not equal to 1`. A red from any other
   cause (timeout, abort, embedded-Postgres start) does not count as reproducing this race. For 1.3, show `failed=0`.
   Also do the project-path check (both `loading project definition` and `set current project` lines name this
   worktree) and use the MISTAKES.md invocation `nice -n 19 sbt -batch -Dsbt.server.autostart=false "testOnly
   com.helio.services.pipelines.OutputHistoryRetentionInFlightSpec"`.
2. **Do not claim the payload mutation proves anything.** If the executor also puts the sleep into `purge`, the
   evidence must say it is unobserved (no `payloadCalls` read exists). The proof rests on the `thinPass` mutation.
3. **Record line :80 in the evidence** as a third racy read that the same reorder fixes. It is masked on unfixed
   code because :75 fails first in the same test.
4. **Delay placement in 1.3:** "after the signal, before `history(n)`", meaning `val n = incrementAndGet();
   trySuccess; sleep; history(n)`. A sleep placed between increment and signal would not widen the window the reads
   race against, and would prove nothing.
5. **Optional:** the HeldRepos doc comment (spec :51) could say the counter is incremented before the hand-off
   promise is completed, so a future editor does not swap them back. Keep it to one line, no ticket ref.
6. **Housekeeping:** `workflow-state.md` has `TICKET_TYPE: feature`, but this is a bug fix. This does not affect
   the design.
