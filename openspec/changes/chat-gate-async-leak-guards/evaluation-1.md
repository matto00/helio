## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `0e4fdc860c040138ef78b4d437af3970a2faebc2`. Diff base was resolved live with `resolve-review-base.sh`: `53e24df5ee24a003e777fa9c8b44abb324537528`.
Diff scope: `backend/src/test/.../ClaudeRoutesChatGateSpec.scala` (+92/-8) plus the change dir only. No production file, no
rendered Concertino file, and no stray tracked or untracked file outside the change dir. `git status` was clean before
and after the review, and every probe edit was reverted with `git checkout backend/src`.

### Phase 1: Spec Review — PASS
- AC1 (each zero-call / count-unchanged guard waits for quiescence): `awaitQuiescence()` now runs before `t.calls.get` at all six
  sites: free :283/:293/:299, beta (before `val before` and before `shouldBe before`), :409 and :421. It is a monitor
  latch bounded at 10 s. The spec has no `Thread.sleep`, `eventually` or retry loop (grep returns nothing). The stub
  transport is `CountingTransport` with a stub key, so no real Anthropic call can happen.
- AC2 (red/green proof). I re-ran the executor's D5 table myself. Every run below came from this worktree's
  `backend/` (sbt printed `.../HEL-1610/backend/` as the build path) and reported a non-zero `Total number of tests run`:
  - Changed spec, no mutation: GREEN, 14/14.
  - Changed spec + M1, 2 runs: RED both times, 12 passed / 2 failed. Failures: buffered authoring `1 was not equal to 0` (:284), and
    beta across both routes `3 was not equal to 2` (:342). This matches evidence.md.
  - BASE spec (`git show 53e24df5e:`) + M1, 2 runs: GREEN 13/13 both times. The old guard is blind, as claimed.
  - Changed spec + M3: RED, 11 passed / 3 failed, at :284, :293 (the streaming guard) and :342. Matches.
  - Changed spec + M2: RED, 12 passed / 2 failed, at refinements :299 (`1 vs 0`) and beta :342 (`4 vs 2`). Matches.
- Design deviation (`implicit val ec: trackedEc.type`): verified by probe. Retyping it to `ExecutionContext = trackedEc`
  turns the D4 positive control RED (`0 was not equal to 1`, :310; 13 passed / 1 failed). This confirms that
  RouteTest's `executor` implicit otherwise wins and the stack runs untracked. The deviation is load-bearing,
  correctly explained in a code comment, and recorded in evidence.md.
- AC3 (test-only): confirmed. The final diff has no `backend/src/main` change.
- tasks.md: every item is checked and matches the implementation. Constraints C1, C2 and C3 are all honored.
- The stated limitation (a regression that materializes a denied stream is not caught) is commented at the streaming
  guard, as design.md requires.

### Phase 2: Code Review — FAIL
Gates (backend only):
- `cd backend && nice -n 19 sbt -J-Xmx3g testFull`: exit 0. 8134 tests run, 619 suites completed, 0 aborted, 0 failed,
  4 canceled. Paths are from this worktree.
- `npm run check:scala-quality`: clean (soft warnings only).

Issues:
1. **Unused import (dead code).** At `ClaudeRoutesChatGateSpec.scala:58`, `ExecutionContext` in
   `import scala.concurrent.{Await, ExecutionContext, ExecutionContextExecutor, Future, Promise}` is no longer
   referenced. Its only use was the `implicit val ec: ExecutionContext = routeEc` that this diff replaced. The diff
   edited this import line itself (it added `Promise`) and left the dead name in place. I verified it by probe: with
   `ExecutionContext` removed from the import, the spec compiles and passes 14/14. The edit was then reverted.
   The build has no `-Wunused` flag, so no gate catches this.

Everything else is sound:
- **Tracker correctness:**
  - `TrackedDbContext` decrements after `p.complete`, inside an `onComplete` task that `trackedEc` itself counts, so
    the counter cannot reach zero between a DB hop and its continuation.
  - Both `execute` and `tracked` decrement on a synchronous throw.
  - `awaitZero` recomputes the deadline on every wake, so spurious wakeups are handled.
- **Wiring:** gate collaborators (`usageRepo`, `conversationService`) stay on `plainCtx`/`routeEc` as D2 specifies.
- **Positive control (D4):** meaningful. My implicit-type probe showed it catches a real wiring defect.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` change.

### Overall: FAIL

### Change Requests
1. `backend/src/test/scala/com/helio/api/routes/proposals/ClaudeRoutesChatGateSpec.scala:58`: remove the unused
   `ExecutionContext` from the import, making it
   `import scala.concurrent.{Await, ExecutionContextExecutor, Future, Promise}`. Keep the code comment at :143, which
   mentions the type by name only.

### Non-blocking Suggestions
- The spec grew from 349 to 425 lines, past the ~400-line threshold in CONTRIBUTING.md ("propose a split in the PR
  description rather than adding to it"). Either propose the split in the PR body, or move
  `InFlight`/`trackedEc`/`TrackedDbContext` into a small test helper beside the spec. proposal.md's Impact section
  already permits such a helper.
