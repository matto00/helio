## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `53e24df5ee24a003e777fa9c8b44abb324537528` (the change dir is untracked; no code changes yet). Cold review of ticket.md, proposal.md, design.md and tasks.md against the code, plus round 1's change requests.

### What I verified (with evidence)

- **Round 1 CR1 (the D5(ii) prediction) is resolved.** D5(ii) now expects RED only in "free tier / buffered authoring" and "beta tier / across both routes", and expects "free tier / streaming authoring" to stay GREEN under M1. The reason it gives, that the `lazySource` is never materialized, matches the code at `DashboardAuthoringService.scala:150-175` (HEL-1609 diff, `git show 53e24df5e`) and round 1's probe.
- **M3 is a real mutation and it applies cleanly.** It means replacing `lazyStreamAttempt(` with `streamAttempt(` at `DashboardAuthoringService.scala:171`, which is exactly the pre-HEL-1609 line in the `53e24df5e` diff. Both have the same signature and return type. I applied M1 + M3 temporarily and the code compiled. Both edits were reverted, and `git status` shows only the untracked change dir.
- **M3 leaks a real transport call on a denied stream, asynchronously.** I ran it on the unchanged spec: `cd backend && nice -n 19 sbt -J-Xmx3g "testOnly com.helio.api.routes.proposals.ClaudeRoutesChatGateSpec"`, with output in this worktree's paths.
  - **Without a wait:** `Tests: succeeded 13, failed 0`. The base spec is blind to M3, which confirms the "M3 on base spec → GREEN" claim in D5(iv) (1 run).
  - **With a temporary probe `Thread.sleep(3000)` before the :233 read** (reverted): `should get 403 on streaming authoring, with zero transport calls *** FAILED *** 1 was not equal to 0 (ClaudeRoutesChatGateSpec.scala:233)`, `Tests: succeeded 12, failed 1`. So under M3 the denied stream does reach `transport.stream`, after the response.
- **M3's leaked call happens inside a hop the tracker counts, so :233 can go red deterministically under D1/D2.** Traced in code:
  - The stream route's `inner` (`DashboardAuthoringRoutes.scala:107-108`) evaluates `service.authorStreaming(...)` eagerly. That leads to `startStreaming`, which calls `assembleGroundedContext(...)` eagerly as the `futureSource` argument. Its DB hops go through `DbContext` (tracked), and its first hop starts synchronously on the route thread before the response, as round 1 verified.
  - Under M3, the `.map { ... streamAttempt(...) }` callback runs on the service's implicit `ec`, which D2 sets to `trackedEc`. Inside that task, `streamAttempt` calls `claudeClient.stream` synchronously (`DashboardAuthoringService.scala:376`). That checks `guardrailReject`, a pure function (`ClaudeClient.scala:271-277`), and then calls `transport.stream`. `CountingTransport.stream` increments `calls` synchronously (spec :145-147).
  - So the increment happens inside a tracked task, before that task's decrement. The counter cannot reach 0 before `calls` becomes 1.
- **Round 1 CR2 is resolved via option (b), and the limitation is written down.** The design's Non-Goals and Risks, the proposal's Non-goals, ticket.md AC 2, and task 1.4 (a code comment at the streaming guard) all state the limitation: a regression that materializes a denied stream runs its Claude call on Pekko's stream actor, outside the tracker. The plan also commits to stating it in the PR body. The ticket in Linear has no formal AC; its ask is "make the guards able to fail on an async leak deterministically". After HEL-1609 the only Future-callback-reachable async leak on the stream path is the pre-HEL-1609 eager shape, and M3 covers it. Covering a stream-materialization leak needs a hook in production code, which a test-only ticket excludes. I consider the re-scope legitimate as disclosed.
- **Round 1 CR3** applied only if CR2 went via (a). It is moot.
- **Round 1's non-blocking notes are resolved in D2.**
  - The tracked and untracked split is stated explicitly. User and usage repos and the assistant conversation repo/service get a plain `DbContext(db, db)(routeEc)`.
  - `ResourcePermissionRepository`/`AccessCheckerImpl` and the `ResourceTypeRegistry` lambdas are named and ordered after the `trackedEc` implicit.
  - D5 lists the expected red and green results by test name, including :335 and :346 as never targeted.
- **M2 compiles as written.** `RefinementService.refine(request: RefinementRequest, user: AuthenticatedUser)` is at `RefinementService.scala:52`, and the `Left` branch is at `RefinementRoutes.scala:68`.
- **D5(ii)'s GREEN predictions under M1 hold.**
  - Refinement is untouched by M1.
  - :346 has `chatAccessOpt = None`, so `fold(unavailable)` returns before `onSuccess`/`inner` (`DashboardAuthoringRoutes.scala:69-70`).
  - :335 is on ungated sub-routes.
- **No placeholders or TODO/TBD.** The C1-C3 constraints are consistent with the ticket's "no sleeps".

### Verdict: CONFIRM

### Non-blocking notes

1. D5(iv)'s expected-results list for M3 is incomplete. M3 includes M1, so on the changed spec it will also turn "free tier / buffered authoring" and "beta tier / across both routes" RED, not only "free tier / streaming authoring". The executor and evaluator should expect three red tests under M3. Only the streaming one is the new proof. State all three in evidence.md so no one misreads the extra reds as a wiring problem.
2. D2's "build everything after it so it all captures `trackedEc`" does not cover arguments passed explicitly. Today the two service factories (spec :117-118) pass `(routeEc)` explicitly, and `client(...)` (spec :154-155) is a class member that also passes `routeEc` explicitly. Both must be switched to `trackedEc`, and `trackedEc` must be a class-level field so `client` can see it. D2 lists them by name, so this is a reminder, not a gap. If it is missed, D4 and D5(ii)/(iv) go red-missing, which the Risks section already covers.
3. The materialization limitation is a narrowing of the ticket's literal "every guard can fail on an async leak". It is disclosed. The orchestrator or PR body should make it visible to the owner as a deliberate scope call, not just a footnote.
4. The probe used a `Thread.sleep` only as a temporary measurement, and it was reverted. Nothing in the plan relies on it.
