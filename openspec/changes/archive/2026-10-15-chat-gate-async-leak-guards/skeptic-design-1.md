## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `53e24df5ee24a003e777fa9c8b44abb324537528` (change dir untracked; no code changes yet).

### What I verified (with evidence)

- **Guard lines** (`ClaudeRoutesChatGateSpec.scala` at HEAD): `t.calls.get shouldBe 0` at :228/:233/:238/:335/:346, `t.calls.get shouldBe before` at :268, `val before = t.calls.get` at :264. Matches design Context.
- **Gate shapes**: `DashboardAuthoringRoutes.gated` :69-75 (`inner: => Route`, `Left(err) => completeTierError`), `RefinementRoutes` :67-71. Matches. M1/M2 as written compile into the `Left` branch.
- **`DbContext`** (`infrastructure/persistence/DbContext.scala:34-65`): non-final class, two public non-final methods `withUserContext`/`withSystemContext`, implicit `ec`. `TrackedDbContext extends DbContext` is feasible.
- **D1 counter soundness (the key claim), buffered path**: holds, by code reading.
  - Increment-before-`super` covers the whole `db.run`, including Slick DBIO `.map` continuations, because those run inside the `db.run` future.
  - The decrement comes after `p.complete` in the same tracked task. Scala 2.13 `DefaultPromise.tryComplete` dispatches every registered callback via `executor.execute` synchronously, so callbacks on `trackedEc` (+1 each) happen-before that task's −1, and `parasitic` callbacks run inline inside it.
  - `MdcPropagatingExecutionContext(ec, …)` (used by `AuthoringTelemetry.emit`'s `Future {}`) wraps the tracked `ec`, so it stays tracked.
  - I found no `db.run` that bypasses `DbContext` on the Claude path. The direct `db.run` callers (`UserRepository`, `MfaRepository`, `UserPreferenceRepository`) are not on it. No scheduler or `pattern.after` either.
- **First-hop happens-before, buffered**: holds.
  - `author` → `startBuffered` → `assembleGroundedContext` → `WorkspaceContextService.assemble` (:123-128) calls `dataSourceService.findAll`/`outputRepo.findAllByOwner`/… synchronously. So `withUserContext` increments on the route thread inside the `onSuccess` callback, before `completeTierError` builds the response.
  - `RefinementService.refine` → `startBuffered` (:59-60) → `refinementGrounding.assemble` has the same synchronous shape.
- **Empirical probe of the stream claim** (temporary M1 plus `Thread.sleep(3000)` before the :228 and :233 reads, base spec; both reverted, `git status` clean afterwards). Command: `cd backend && nice -n 19 sbt -J-Xmx3g "testOnly com.helio.api.routes.proposals.ClaudeRoutesChatGateSpec"`. Output, in this worktree's paths:
  ```
  [info] - should get 403 TIER_FORBIDDEN on buffered authoring, with zero transport calls *** FAILED ***
  [info]   1 was not equal to 0 (ClaudeRoutesChatGateSpec.scala:228)
  [info] - should get 403 on streaming authoring, with zero transport calls
  ...
  [info] Tests: succeeded 12, failed 1, canceled 0, ignored 0, pending 0
  ```
  Even after a 3 s wait, M1 leaks no Claude call on the streaming denied request. The reason is in the code.
  - `authorStreaming` → `startStreaming` evaluates `assembleGroundedContext` eagerly (grounding DB work does leak). But the Claude call sits behind `Source.futureSource(...)` → `lazyStreamAttempt` → `Source.lazySource` (HEL-1609, `DashboardAuthoringService.scala` ~:150-175). It runs only when the discarded `byteSource` is materialized and demanded, which M1 never does.
  - The same probe run also shows the beta 429 guard (:268) is blind under M1 without a wait. That confirms the ticket's premise for the buffered path.

### Verdict: REFUTE

The tracker mechanism (D1) is sound for the buffered authoring and refinement paths. But the plan makes a false prediction about the streaming guard and leaves an AC-named guard with no way to fail deterministically.

### Change Requests

1. **D5(ii) predicts a result that cannot happen.** D5(ii) / tasks 2.2 say "changed spec + M1 → RED at … free :228/:233 equivalents". At this base, M1 causes no Claude call on the `?stream=true` denied request (probe above: 0 calls after 3 s), so :233 will stay GREEN under M1 whatever the tracker does.
   - An executor following the plan as written will either hit an unexplainable "missing red" or, per the Risks bullet ("D5(ii)/(iii) fail if coverage is incomplete; the executor fixes the wiring"), go chasing a wiring defect that does not exist.
   - Fix: correct D5(ii) to expect RED at :228 and the beta `shouldBe before` guard only, and state why :233 stays green under M1 (`lazySource`, never materialized).

2. **The :233 guard (named in AC 1) still has no deterministic failure path.** The only way a denied stream can actually reach Claude is a regression that materializes the stream, for example `byteSource.runWith(Sink.ignore)` or completing with the entity anyway. In that case the hop from the completed grounding future to `lazySource` → `claudeClient.stream` → `transport.stream` runs on the Pekko stream actor's dispatcher, which is untracked. `futureSource`'s completion callback only enqueues a message to the actor and returns, so the tracked counter can reach 0 before `transport.stream` increments `calls`. That is exactly the "transiently reaches zero while a leaked chain is in flight" failure the design claims to rule out.
   - The Risks bullet ("a denied stream never materializes a body") is an assumption about one particular mutation, not a property the guard enforces.
   - Required: the design must do one of two things, and say which.
     - (a) Extend quiescence to stream materialization. Options include running the test's route or materializer on a dispatcher whose executor is the tracked EC, or a tracked hop at `transport.stream`'s caller. Then add a stream-leak mutation M3 (materialize `byteSource` in the `Left` branch) to D5 that goes RED at :233 deterministically (≥3 runs) and is GREEN-blind on the unchanged spec.
     - (b) Explicitly re-scope :233 (and the stream request in the :344/:346 test): it can detect only Claude calls reachable through tracked hops, and the stream path's Claude call is not one. Record this as a named, owner-visible limitation against AC 1, not an implicit Non-goal.
   - If (b), the orchestrator must treat it as an AC-scope question, not a planner self-approval.

3. **D4 positive control covers only `author` (buffered).** If CR 2 is resolved via (a), add a matching stream positive control: materialize `authorStreaming(...)` without awaiting, then `awaitQuiescence()`, and expect `calls == 1`. Its own no-op red, like D4, proves the latch covers the streaming chain.

### Non-blocking notes

- D2 says `UserRepository`/`AssistantDailyUsageRepository` "stay as they are", but `usageRepo` and `AssistantConversationRepository` are built over the same `ctx` that D2 turns into `TrackedDbContext`. Tracking them is harmless, because their work completes before the response. Still, state whether they share the tracked `ctx` or get a plain `DbContext`, so the executor doesn't have to guess.
- D2's list should name `ResourcePermissionRepository`/`AccessCheckerImpl` and the `ResourceTypeRegistry` lambdas (which `.map` on `beforeAll`'s implicit `ec`). These sit on the grounding path through `DashboardService`/`PanelService`. With `implicit val ec = trackedEc` they are covered automatically, but only if they are built after that implicit is in scope.
- The :335 and :346 guards will never go red under M1 or M2 (ungated sub-routes; `chatAccessOpt = None` folds to `unavailable` before `inner`). The AC's "RED at the guard lines under the mutation" should list which guard lines each mutation is expected to turn red, so the evaluator can check each prediction against the run output.
