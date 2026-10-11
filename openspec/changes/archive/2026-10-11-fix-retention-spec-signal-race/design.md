## Context

`HeldRepos` (OutputHistoryRetentionInFlightSpec.scala lines 55-62) overrides `thinPass` as
`{ historyReached.trySuccess(()); history(historyCalls.incrementAndGet()) }` and `purge` likewise for payload. The
service invokes `thinPass` on the pool via `Future.delegate` (OutputHistoryRetentionService.scala line 92). The test
thread `await`s `historyReached.future` and then reads `historyCalls` (lines 75 and 96). Promise completion is the only
happens-before edge; the increment is sequenced after it, so the read can observe 0.

## Goals / Non-Goals

**Goals:** make every counter read that follows a `*Reached` await observe the increment; prove the race and the fix
deterministically.

**Non-Goals:** service changes; other specs; changing assertions.

## Decisions

1. **Increment, then signal, then build.** `val n = historyCalls.incrementAndGet(); historyReached.trySuccess(());
   history(n)`; same for payload. Promise completion publishes the prior increment (JMM happens-before via the
   promise's volatile/CAS completion and `Await`). Alternative (poll the counter with `eventually`) rejected: it hides
   the ordering bug and adds timing to a test whose header promises "never a sleep".
2. **Deterministic proof by mutation, not by re-running.** Temporarily insert a delay (e.g. `Thread.sleep(500)`)
   between the signal and the increment on the UNFIXED order: lines 75/96 must fail every run. Then apply the same
   delay at the equivalent position in the FIXED order (after the signal, before `history(n)`): the spec must pass.
   Neither mutation is committed; logs persist to the run evidence dir.
3. **Service review.** Confirm the guard is released only by the returned future (`andThen`), that `claim` runs only
   under the guard, and that the `nextDue` CAS rewrite precedes guard release. Record the finding in evidence; a real
   race becomes a separate ticket.

## Risks / Trade-offs

- [Risk] Line 119 reads `historyCalls` after `payloadReached`: already ordered by the service's future chain
  (history completes, then `flatMap` starts payload). The payload reorder is for consistency. → Note in evidence.
- [Risk] Line 135's `secondReached` is completed inside the `history` function whose argument (`incrementAndGet`) is
  evaluated first, so it is already safe. → No change.

## Planner Notes

- Self-approved: test-only bug fix, no escalation needed. `skip_specs: true` (no behaviour contract change).
- Run `sbt "testOnly com.helio.services.pipelines.OutputHistoryRetentionInFlightSpec"` (nice -n 19); the
  `[hel1468-guard]` marker must appear in output; shut the sbt server down afterwards.
