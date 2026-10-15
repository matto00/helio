# Evidence - HEL-1610 (test-only; ClaudeRoutesChatGateSpec)

All runs: `cd /home/matt/Development/helio/.claude/worktrees/task/chat-gate-async-leak-guards/HEL-1610/backend && nice -n 19 sbt -J-Xmx3g "testOnly com.helio.api.routes.proposals.ClaudeRoutesChatGateSpec"`
(foreground; the runner printed `cwd` = that backend dir for every run). Base spec = `git show HEAD:` copy
(13 tests); changed spec = 14 tests (13 + the D4 positive control). "Executed" = ScalaTest `Total number of tests run`.
Mutations were applied with sed, run, and reverted with `git checkout backend/src/main`; the final `git status`
shows only the spec file modified (plus this change dir).

## Root cause found while wiring (not in the design)

First wiring attempt (`implicit val ec: ExecutionContext = trackedEc`) left the D4 positive control RED
(`0 was not equal to 1`, `inflight=0 completed=false` when `awaitQuiescence()` returned). Probe: logged every
inc/dec plus the continuation lambda of every `trackedEc.execute` issued while the count was 0 from a dispatcher
thread -> the continuations were `DashboardAuthoringService` lambdas run by Transformations executing in a Pekko
`BatchingExecutor` batch with no tracker wrapper frame, i.e. on the raw actor-system dispatcher. Cause: the route
testkit (`RouteTest`) offers `implicit def executor: ExecutionContextExecutor` (= `system.dispatcher`); against an
expected `ExecutionContext` it is MORE SPECIFIC than a local `ExecutionContext`-typed `ec`, so every service/repo
in `beforeAll` silently captured the dispatcher, not `trackedEc` (the pre-change spec was the same). Typing the local
as `implicit val ec: trackedEc.type = trackedEc` makes it the most specific candidate. With that, the probe showed
`inflight=0 completed=true calls=1`. The probe code is not in the diff.

## First tracked hop of a leaked call (task 1.1), from code and probe

- Buffered: `author` -> `startBuffered` -> `assembleGroundedContext` -> `WorkspaceContextService.assemble`, whose first
  statements (`dataSourceService.findAll`, `outputRepo.findAllByOwner`, ...) call `ctx.withUserContext` synchronously
  on the calling (route) thread. Probe log: `inc->1 TrackedDbContext:120/121, DataSourceRepository:135`, issued
  synchronously from the caller before `author` returned. So the first hop happens-before the response.
- Refinement: `RefinementService.refine` -> `startBuffered` -> `RefinementGrounding.assemble`, same shape; confirmed
  by M2 going red below.
- Facts re-verified at 53e24df5e: guards at base lines 228/233/238/268/335/346; `gated` / `RefinementRoutes` `Left`
  branches complete the tier error without evaluating `inner`; every repo reaches the DB only through `DbContext`.

## D5 proof

M1 = `DashboardAuthoringRoutes.gated`: `case Left(err) => { val _ = inner; TierErrorCompletion.completeTierError(err) }`
M2 = `RefinementRoutes`: `case Left(err) => { val _ = service.refine(request, user); TierErrorCompletion.completeTierError(err) }`
M3 = M1 + `DashboardAuthoringService.scala:171` `lazyStreamAttempt(` -> `streamAttempt(` (pre-HEL-1609 eager shape)

| # | spec | mutation | runs | result | executed / run |
|---|------|----------|------|--------|----------------|
| i | BASE | M1 | 3 | GREEN 13/13 every run (blind guard, "before") | 13 |
| iv-base | BASE | M3 | 3 | GREEN 13/13 every run (blind) | 13 |
| ii | CHANGED | M1 | 3 | RED every run: `free tier ... buffered authoring` (`1 was not equal to 0`, spec :284), `beta tier ... across both routes` (`3 was not equal to 2`, :342); 12 pass, 2 fail | 14 |
| iii | CHANGED | M2 | 3 | RED every run: `free tier ... refinements` (`1 was not equal to 0`, :299), `beta tier ... across both routes` (`4 was not equal to 2`, :342); 12 pass, 2 fail | 14 |
| iv | CHANGED | M3 | 3 | RED every run, three tests: buffered authoring (:284), `free tier ... streaming authoring` (`1 was not equal to 0`, :293 - the new proof), beta across both routes (:342); 11 pass, 3 fail | 14 |
| v | CHANGED | none | 5 | GREEN 14/14, 5 consecutive runs | 14 |
| vi | CHANGED | `awaitQuiescence()` made a no-op | 3 | RED every run, only the positive control (`0 was not equal to 1`, :310); 13 pass, 1 fail | 14 |

As predicted by design.md: the streaming guard stays GREEN under M1 (the lazySource is never materialized) and
under M2; the :335 ("not charge the outcome or conversation-read sub-routes") and :346 ("fail closed 503") guards get
the quiescence read for uniformity but no mutation targets them (ungated sub-routes / `chatAccessOpt = None` folds
to `unavailable` before `inner`). Stated limitation: a regression that MATERIALIZES a denied stream runs its Claude
call on Pekko's stream actor (untracked) and is not caught deterministically; written as a comment at the streaming guard.

## Constraints

- C1: no `Thread.sleep`, no `eventually`, no retry loop in the spec (grep: none). The wait is a monitor
  `wait(remaining)` / `notifyAll` latch, bounded at 10 s, failing with the in-flight count on timeout.
- C2: `git status` after all mutation runs: only `ClaudeRoutesChatGateSpec.scala` modified + the change dir untracked.
- C3: every run above is from this worktree's backend dir with non-zero executed counts.

## Full suite (task 2.5)

`cd .../HEL-1610/backend && nice -n 19 sbt -J-Xmx3g testFull` (exit 0):
```
[info] Total number of tests run: 8134
[info] Suites: completed 619, aborted 0
[info] Tests: succeeded 8134, failed 0, canceled 4, ignored 0, pending 0
[success] elapsed time: 717 s (0:11:57.0), cache 100%, 648 disk cache hits
```

## Cycle 2 (evaluation-1.md change requests)

- CR1: dropped the unused `ExecutionContext` from the `scala.concurrent` import (now `{Await, ExecutionContextExecutor, Future}`).
- Size note: the tracker moved to `backend/src/test/scala/com/helio/api/routes/proposals/InFlightTracker.scala`
  (`InFlightTracker`: counter, bounded latch, nested `object ec`, nested `TrackedDbContext`). Behaviour identical. The spec is
  384 lines. `trackedEc` is a stable lazy val (`tracker.ec.type`), so the `implicit val ec: trackedEc.type` trick and its
  comment are unchanged. Only the two test files changed; no full `testFull` re-run.
- Re-verification, runs from `.../HEL-1610/backend`, non-zero executed counts, mutations reverted
  (`git checkout backend/src/main`; the spec restored from a copy; `git status` shows only the spec, helper, change dir):
  - Changed spec, no mutation: GREEN 14/14, 2 runs.
  - Changed spec + M1: RED both runs, same two tests (buffered authoring `1 was not equal to 0` at :243; beta across both
    routes `3 was not equal to 2` at :301); 12 pass, 2 fail, 14 executed.
  - `awaitQuiescence()` no-op: RED both runs, only the positive control (`0 was not equal to 1` at :269); 13 pass, 1 fail, 14 executed.

## Cycle 2 — merged head

`git merge origin/main` (d517db75b) with an ordinary merge commit 7049e2bc5; no conflicts. All runs from
`/home/matt/Development/helio/.claude/worktrees/task/chat-gate-async-leak-guards/HEL-1610/backend`, foreground,
`nice -n 19 sbt -J-Xmx3g`; every mutation reverted (`git checkout backend/src/main` / the spec), `git status` clean after.

| mutation | runs | result | executed |
|---|---|---|---|
| none | 2 | GREEN 14/14 each | 14 |
| M1 | 2 | RED each: buffered authoring (`1 was not equal to 0`, :243), beta across both routes (`3 was not equal to 2`, :301); 12 pass, 2 fail | 14 |
| M3 (M1 + eager `streamAttempt`) | 1 | RED: buffered (:243), streaming (`1 was not equal to 0`, :252), beta (:301); 11 pass, 3 fail | 14 |
| M2 | 1 | RED: refinements (`1 was not equal to 0`, :258), beta (`4 was not equal to 2`, :301); 12 pass, 2 fail | 14 |
| `awaitQuiescence()` no-op | 1 | RED: positive control only (`0 was not equal to 1`, :269); 13 pass, 1 fail | 14 |

Full suite on the merged head (`nice -n 19 sbt -J-Xmx3g testFull`, exit 0):
```
[info] Total number of tests run: 8145
[info] Suites: completed 620, aborted 0
[info] Tests: succeeded 8145, failed 0, canceled 4, ignored 0, pending 0
[success] elapsed time: 1107 s (0:18:27.0), cache 89%, 584 disk cache hits, 65 onsite tasks
```
The driver's /proc/loadavg rule arrived after this testFull had already finished, so no load check preceded it.
