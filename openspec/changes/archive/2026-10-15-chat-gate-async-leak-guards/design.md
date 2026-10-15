## Context

See proposal.md (Why). Facts at 53e24df5e (executor re-verifies before editing):

- Guards that read the transport count right after a response: `ClaudeRoutesChatGateSpec.scala` :228/:233/:238
  (free 403), :268 (beta 429, `shouldBe before`), :335 (ungated sub-routes), :346 (fail-closed 503).
- `DashboardAuthoringRoutes.gated` (:69-75) and `RefinementRoutes` (:67-71) complete the tier error on `Left` without
  evaluating the service. Evaluating `inner` calls `service.author`/`authorStreaming`/`refine` eagerly, which returns a
  Future whose transport call follows grounding DB work, so a leaked call lands after the response (HEL-1597
  skeptic-final-1.md).
- Every repo on the Claude-reaching path reaches the DB only through `DbContext.withUserContext`/`withSystemContext`
  (`DbContext` is a non-final class); every service/repo/`ClaudeClient`/`LocalFileSystem` takes an implicit
  `ExecutionContext`, today `routeEc` from the spec's `beforeAll`.
- HEL-1609 (`DashboardAuthoringServiceSpec` `DrainableEc`, :245-260) drains a single-thread EC to quiescence; it works
  there because a gate repo removes every DB hop after the gate. Here the leaked chain does real DB work, so draining
  the EC alone is not enough: between hops the chain lives on Slick's executor, invisible to the EC.

## Goals / Non-Goals

**Goals:** each guard reads the count only after every async hop of the Claude-reaching stack started by the request
has finished; deterministic (no sleeps, no `eventually`, a bounded latch wait); red under the async-leak mutation,
green without it; no production change.

**Non-Goals:** catching a leak that escapes the tracked stack (a new client or `Future` on an untracked EC); changing
`ChatAccessService`/usage repos (they run before the response by construction). **Stated limitation (owner-visible in
the PR body):** since HEL-1609 the streamed Claude call sits behind `lazySource` and happens only when the response
stream is materialized, on Pekko's stream actor. A regression that *materializes* a denied stream (e.g.
`runWith(Sink.ignore)` on a 403/429) is not tracked by this design and the :233 guard cannot catch it deterministically;
tracking Pekko materialization would need a production hook (out of scope). What :233 does catch deterministically is a
denied stream whose Claude call is reached from a Future callback (the pre-HEL-1609 eager shape), via M3 below.

## Decisions

D1 - In-flight tracker (test-only), one per suite:
- `TrackedEc`: an `ExecutionContextExecutor` delegating to `routeEc`. `execute(r)` increments an in-flight counter
  before delegating a wrapper whose `run` calls `r.run()` and decrements in `finally`.
- `TrackedDbContext extends DbContext`: overrides both methods. Each increments the counter, calls `super`, and returns
  `p.future`, where `p` is completed inside `f.onComplete(...)(trackedEc)` and the counter is decremented after
  `p.complete`, in the same task. Callbacks registered on `p.future` by repos/services (all on `trackedEc`) are
  enqueued, and so counted, before that task's decrement, so the counter cannot hit zero between a DB hop and its
  continuation.
- `awaitQuiescence()`: monitor-based latch (`synchronized`/`wait(remaining)`/`notifyAll` on reaching zero), bounded at
  10 s, failing the test with the current count on timeout. Never `Thread.sleep`.
- Invariant this relies on: a leaked call's first hop is started synchronously while the route handles the denied
  request (the mutation evaluates `inner` inside the `onSuccess` callback, which calls the service, whose first step
  increments the counter via a tracked DB call or task) and so happens-before the response the test observes. The
  executor states in evidence.md which hop that is (from code), not assumes it.
Alternatives rejected: (a) `Thread.sleep`/`eventually` - forbidden, and timing-based; (b) DrainableEc alone - DB hops
are invisible to it (Context); (c) gate repos returning test-held promises (HEL-1609) - removes the real grounding from
the chain the guard is supposed to watch, and needs a gate per repo method; (d) a custom Slick `AsyncExecutor` -
breaks Slick's `PrioritizedRunnable` connection accounting; wrapping at `DbContext` is the narrowest seam;
(e) recording only service entry - detects "service entered", not a Claude call; the tracker keeps the guard on the
transport count the ticket names.

D2 - Wiring: in `beforeAll`, declare `implicit val ec = trackedEc` FIRST, then `ctx = new TrackedDbContext(db, db)`,
and build everything after it so it all captures `trackedEc`: `ResourcePermissionRepository`/`AccessCheckerImpl`, the
`ResourceTypeRegistry` lambdas, and everything on the Claude-reaching path (repos, `DashboardService`, `PanelService`, `DataSourceService`, `PipelineService`,
`WorkspaceContextService`, `PanelCapabilityService`, `PatchSetPreviewService`, `RefinementGrounding`,
`AuthoringConversationRepository`, the two service factories, and `client(...)`'s `ClaudeClient`). Route classes may
keep `routeEc`. `UserRepository`, `AssistantDailyUsageRepository` and `AssistantConversationRepository`/service get a
separate plain `DbContext(db, db)(routeEc)` and explicit `routeEc` (they are not on the leak path; keeping them untracked
keeps the counter's meaning narrow). The two service factories and `client(...)` pass `(routeEc)` EXPLICITLY today:
switch all three to `trackedEc` by hand; `trackedEc` must be a class-level field so `client` sees it.
`AssistantService` (converse) may stay on `routeEc`; no guard reads its count.

D3 - Guards: add `noClaudeCallsAfter(t, expected)` (or inline `awaitQuiescence(); t.calls.get shouldBe n`) at
:228/:233/:238/:268/:335/:346, and an `awaitQuiescence()` immediately before `val before = t.calls.get` (keeps HEL-1597's
body drain and `before shouldBe 2`). No assertion is relaxed.

D4 - Positive control test (standing, in-suite): call `authoringService(client(t)).author(...)` directly for a seeded
user WITHOUT awaiting its Future, then `awaitQuiescence()`, then `t.calls.get shouldBe 1`. Proves the latch waits for
an un-awaited async Claude call through real grounding. Its own red: with `awaitQuiescence()` replaced by a no-op it
reads 0 (record in evidence.md, then restore).

D5 - Red/green proof (temporary mutations, reverted; recorded in evidence.md with run counts, this worktree's paths,
executed-test counts). Expected red lines are by test name (line numbers move):
  (i) Baseline blindness: unchanged spec (base) + M1 (`DashboardAuthoringRoutes.gated`:
      `case Left(err) => { val _ = inner; TierErrorCompletion.completeTierError(err) }`) -> GREEN, >=3 runs.
  (ii) Changed spec + M1 -> RED in "free tier / buffered authoring" (zero-call guard) and "beta tier / across both
      routes" (`shouldBe before`), every run of >=3. Expected GREEN under M1: "free tier / streaming authoring" (M1
      never materializes the lazySource, so no call happens — verified by the design skeptic's probe), refinement,
      :335, :346.
  (iii) Changed spec + M2 (`RefinementRoutes`: `case Left(err) => { val _ = service.refine(request, user);
      TierErrorCompletion.completeTierError(err) }`) -> RED in "free tier / refinements" and "beta tier / across both
      routes", every run of >=3.
  (iv) Changed spec + M3 = M1 plus reverting HEL-1609's lazy construct in `DashboardAuthoringService.startStreaming`
      (call `streamAttempt(...)` directly in the grounding `.map`, the pre-HEL-1609 eager shape) -> RED in "free tier /
      streaming authoring" (and also, since M3 includes M1, "free tier / buffered authoring" and "beta tier / across
      both routes"), every run of >=3. M3 is a one-token revert at `DashboardAuthoringService.scala` ~:171
      (`lazyStreamAttempt(` -> `streamAttempt(`). Also run M3 on the unchanged base spec -> GREEN (blind), >=3.
  (v) Changed spec, no mutation -> GREEN, >=5 consecutive runs.
  (vi) D4's no-op mutation -> positive control RED.
  :335 and :346 get the quiescence read for uniformity; no mutation in this plan targets them (ungated / fail-closed
  before `inner`), stated in evidence.md.

## Risks / Trade-offs

- [A hop runs on an untracked EC, so quiescence is reached early] -> D4's positive control and D5(ii)/(iii) fail
  if coverage is incomplete; the executor fixes the wiring, never weakens the guard.
- [Stream materialization runs on Pekko's stream actor, untracked] -> permitted streams are drained before counting
  (HEL-1597); a materialized-denied-stream leak is the stated limitation above, written as a code comment at :233 and
  in the PR body.
- [Counter never reaches zero (a stray periodic task)] -> the latch times out at 10 s with a clear message; none
  expected (no schedulers in this stack).

## Planner Notes

- Self-approved: test-only, one spec file (helper classes may live in the spec file). No production change, no new
  dependency, `skip_specs: true`.
- Runs: `cd backend && nice -n 19 sbt -J-Xmx3g "testOnly com.helio.api.routes.proposals.ClaudeRoutesChatGateSpec"`
  (foreground, Bash `timeout: 600000`); a full `sbt testFull` once at the end, foreground.
