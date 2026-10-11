## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: cd0910fe9910fe149efb08bc30235abd3ec05bc8. Base (live-resolved via resolve-review-base.sh, exit 0):
590ac4575ad42010e322a527fdf296e6cea77213.

### What I verified (with evidence)

- **Diff scope.** `git diff 590ac4575...HEAD`: the only code change is
  `backend/src/test/scala/com/helio/services/pipelines/OutputHistoryRetentionInFlightSpec.scala`, with 3 lines changed
  (:51 doc comment, :57 `thinPass` stub, :61 `purge` stub). Everything else is openspec change artifacts. There is no
  production code change. I grepped the added backend lines for `com.`/`scala.`/`java.` qualified names and found
  none, so there are no inline FQNs.
- **Every racy read is closed.** I classified the counter reads myself from the spec and from
  `OutputHistoryRetentionService.scala:73-131`. `thinPass` runs on the pool inside `Future.delegate` (service :92).
  Before the fix, :75, :80 and :96 read `historyCalls` with only the `historyReached` promise as a happens-before
  edge, and the increment came after that edge. With the fix, the increment is sequenced before `trySuccess`, so the
  `Await` at :74/:94 publishes it. The other reads follow an `await` on a pass future, which completes only after the
  stub has returned. :119 is ordered by the `flatMap` chain, and :140 by `secondReached` completing inside
  `history(n)` after `n` is evaluated. No test reads `payloadCalls`, so the payload reorder only keeps the two stubs
  consistent.
- **I reproduced the red myself.** The evaluator noted that the mutant source behind the red had not been saved, so I
  did not rely on it. On the worktree I swapped the committed `thinPass` stub for the pre-fix order with a widened
  window, `{ historyReached.trySuccess(()); Thread.sleep(500); history(historyCalls.incrementAndGet()) }`. The mutant
  source is saved at `.concertino/runs/HEL-1499/evidence/hel1499-skeptic-red-mutant.scala`. Running
  `nice -n 19 sbt -batch -Dsbt.server.autostart=false "testOnly ...OutputHistoryRetentionInFlightSpec"` produced
  `hel1499-skeptic-red.log`:
  `0 was not equal to 1 (OutputHistoryRetentionInFlightSpec.scala:75)`, `0 was not equal to 1 (...:96)`,
  `[hel1468-guard] ScalaTest summary: failed=2 aborted=0 unreadable=0`. These are assertion failures for the race,
  not timeouts. The `set current project` line names this worktree's `backend/`. I then reverted with `git checkout`.
- **Same delay on the fixed order stays green.** I ran
  `{ val n = historyCalls.incrementAndGet(); historyReached.trySuccess(()); Thread.sleep(500); history(n) }`. The
  source is `hel1499-skeptic-fixed-mutant.scala` and the log is `hel1499-skeptic-fixed-mutated.log`:
  `[hel1468-guard] ... failed=0 aborted=0`, 5 succeeded. I reverted again. So the same widening is red before the fix
  and green after it, which isolates the ordering property.
- **Committed code is green.** `testOnly OutputHistoryRetentionInFlightSpec OutputHistoryRetentionServiceSpec`
  (`hel1499-skeptic-committed.log`): `[hel1468-guard] failed=0 aborted=0 unreadable=0`, 17 succeeded, 0 failed. I
  judged it by the ScalaTest output, per C1. The evaluator's pasted `testFull` (`failed=0`, 6923 succeeded) is
  unambiguous, and the change is test-only in one spec, so I relied on it rather than re-running the full suite.
- **The service is race-free for this concern.** The guard is taken by CAS before `claim` (:74). Every path that
  starts no pass releases it: the not-due path (:79) and a synchronous throw (:87). A started pass releases it via
  `andThen` on the returned future (:81). `andThen`'s future completes only after the callback, which runs after the
  `nextDue` CAS rewrite inside the `flatMap`. `claim`'s CAS uses the exact reference it read. I found no real race,
  so nothing needs to be filed. That agrees with `hel1499-notes.md`, which I verified independently.
- **The worktree is left clean.** `git status` shows only the untracked `evaluation-1.md` (the evaluator's) and this
  report, and HEAD is unchanged at cd0910fe9. No sbt server was started (`-batch`, `server.autostart=false`), and
  MemAvailable was about 55 GB before the runs.
- **Sibling pattern.** I grepped `backend/src/test` for the `trySuccess(()); ...incrementAndGet` pattern and found
  no hits after the fix.

### Verdict: CONFIRM

### Non-blocking notes
- At `OutputHistoryRetentionInFlightSpec.scala:57/:61`, the local `val n: Int` shadows the unused `n: Instant`
  parameter. It is legal, and neither scalac nor the quality check flags it, but renaming it to `call` would read
  more clearly. This is cosmetic.
- No UI changes, so the design review was skipped.
