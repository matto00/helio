## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `a014d7a94c4ffba16c335b4c75b8eaea14f68818`. The diff base was resolved live with `resolve-review-base.sh`: `d517db75b83b9b66ee4a38fbf58e4c69a73f8079`.

### What I verified (with evidence)

**Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/chat-gate-async-leak-guards/HEL-1610`.

**Diff scope** (`git diff d517db75b...HEAD --stat`):
- `ClaudeRoutesChatGateSpec.scala` (+51/-8)
- new `InFlightTracker.scala` (57 lines)
- the change dir

There is nothing under `backend/src/main`, so the AC "test-only; no production code changes" holds.

**Every guard is behind the quiescence point.** I read the diff. `awaitQuiescence()` comes before the transport-count read at:
- free buffered :243
- free streaming :252
- free refinements :258
- beta, before `val before` and before `shouldBe before` (:301)
- ungated sub-routes
- fail-closed 503

No assertion was relaxed. grep finds no `sleep`, `eventually` or retry in either file; the only hit is the doc comment "never a sleep". The wait is a monitor `wait(remaining)`/`notifyAll` latch, bounded at 10 s, and it fails with the in-flight count if it times out.

**Red/green proof, re-run by me** on HEAD. All runs used `nice -n 19 sbt -J-Xmx3g "testOnly ...ClaudeRoutesChatGateSpec"` from `.../HEL-1610/backend`, and sbt printed that build path. Every mutation was applied with sed and reverted with `git checkout`, and `git status` was clean after each one. Logs are in scratchpad `hel1610/run-*.log`.

| spec | mutation | runs | result | executed |
|---|---|---|---|---|
| changed | none | 2 | GREEN 14/14 each | 14 |
| BASE (`git show d517db75b:`) | M1 | 2 | GREEN 13/13 each (blind "before") | 13 |
| changed | M1 (`gated` `Left` evaluates `inner`) | 2 | RED each: buffered `1 was not equal to 0` (:243); beta `3 was not equal to 2` (:301); 12 pass / 2 fail | 14 |
| changed | M2 (`RefinementRoutes` `Left` calls `service.refine`) | 1 | RED: refinements `1 was not equal to 0` (:258); beta `4 was not equal to 2` (:301) | 14 |
| changed | M3 (M1 + `DashboardAuthoringService.scala:171` `lazyStreamAttempt(`→`streamAttempt(`) | 1 | RED: buffered (:243), streaming `1 was not equal to 0` (:252), beta (:301); 11 pass / 3 fail | 14 |
| changed | `awaitQuiescence()` made a no-op | 1 | RED: positive control only, `0 was not equal to 1` (:269) | 14 |

Taken together:
- The base spec is blind to M1.
- The changed spec catches M1, M2 and M3 at exactly the tests design.md D5 predicts.
- The no-op probe shows the latch is what makes the leaked call visible: without it the positive control reads 0, and with it the control reads 1.

These results match the evidence.md tables line for line.

**The tracker cannot reach quiescence early.** I checked this from the code, not from the narrative:
- `ec.execute` increments the counter before it delegates, and decrements in a `finally` after `r.run()`. Any callback that a running task schedules on `ec` is therefore counted before that task's own decrement.
- `TrackedDbContext.tracked` increments before the Slick call. Its `onComplete` runs on `ec` and completes `p` before it decrements. `Promise.complete` dispatches the dependents (all on `trackedEc`) synchronously, so each one is counted first.
- The counter never touches zero between a DB hop and its continuation. Unpaired decrements are not possible: each decrement path matches one increment, and the exception paths decrement once.
- Negative drift would show up as a timeout, never as an early return.

**Untracked ECs on the path.** I grepped the `ai`, `proposals`, `workspace`, `dashboards`, `panels`, `sources`, `pipelines`, `patchsets`, `persistence` and `storage` packages for `parasitic`, `global`, `scheduleOnce` and `pattern.after`: there are no hits. `MdcPropagatingExecutionContext` delegates to the wrapped ec, which is tracked. `ClaudeClient`, both service factories and every repo on the Claude-reaching path get `trackedEc`, either explicitly or through the singleton-typed local implicit.

**The singleton-type implicit fix is real and load-bearing.** `RouteTest` exposes an `implicit def executor`. The positive control turning red under the no-op, and green with the latch, confirms the stack is actually tracked.

**Happens-before.** Under M1/M2 the leaked service call is started inside the `onSuccess` callback, before `completeTierError`. The first DB hop of `author`/`refine` therefore increments the counter before the response the test observes. Consistent red on every run (2/2 M1 here, plus the evaluator's and executor's runs) agrees with this.

**The stated limitation is honestly scoped.**
- design.md Non-Goals names it: a regression that *materializes* a denied stream runs on Pekko's stream actor, which is untracked.
- The code comment at the streaming guard (:248-250) says the guard "tracks Future-callback hops only" and "cannot catch [a materialized-denied-stream leak] deterministically; it does catch the eager-call shape".
- My M3 run shows the eager shape is caught at :252, and the M1 run shows the streaming guard stays green when the lazySource is never materialized. That is exactly what is claimed, no more.

**Quality gate:** `npm run check:scala-quality` reports "clean (252 soft warning(s))". These are repo-wide soft size budgets.

**UI:** none. There is no `frontend/**` in the diff, so step 4 does not apply.

### Verdict: CONFIRM

### Non-blocking notes
- The ticket AC says the limitation is "owner-visible in the PR body". The PR does not exist yet. The orchestrator must make sure the PR body states the materialized-denied-stream limitation, in the wording design.md Non-Goals uses.
- `evaluation-2.md` is untracked in the worktree. It is the evaluator's own artifact and has no effect on the code.
- I did not re-run base+M3 or testFull. The diff is test-only, and the targeted runs above cover every claim the ACs make. The executor's testFull evidence (8145/0) is pasted output, not a bare assertion.
