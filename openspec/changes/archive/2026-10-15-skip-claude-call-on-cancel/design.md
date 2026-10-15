## Context

See proposal.md (Why). Facts from the tree at 10d8626cc (to be re-verified by the executor before editing):

- `DashboardAuthoringRoutes.scala:60-67,104-106`: `gated` runs `ChatAccessService.guardAndCount(user)` (free 403, beta
  counted on the shared daily row or 429, owner unlimited) BEFORE the service; the stream branch then completes with
  `HttpEntity.Chunked.fromData(sse, service.authorStreaming(...).map(toSseBytes))`.
- `DashboardAuthoringService.scala:138-149` (`startStreaming`): `Source.futureSource(assembleGroundedContext(...).map {
  case Right(ctx) => ... streamAttempt(...) })`. `assembleGroundedContext` starts when `authorStreaming` is CALLED; the
  `.map` body is a plain Future callback, so it runs when grounding completes whether or not the Source was
  materialized, and whether or not its downstream already cancelled.
- `continueStreaming` (~line 186) has the identical shape around `loadForContinuation`.
- `streamAttempt` (line 341) calls `claudeClient.stream(...)` while BUILDING the Source; `ClaudeClient.stream` calls
  `transport.stream` eagerly; `HttpClaudeTransport.stream` (line 112) calls `Http().singleRequest` eagerly. So the
  billed request is sent from inside that Future callback. Pekko never surfaces downstream cancellation to a Future
  callback; it only stops the `futureSource` stage, whose completion callback is then ignored.
- HEL-1597 archive (`openspec/changes/archive/2026-10-15-fix-chat-gate-stream-race/`) shows the latch-probe technique
  and that `ClaudeRoutesChatGateSpec` now drains its `?stream=true` response before counting.

## Goals / Non-Goals

**Goals:** no `ClaudeClient.stream`/transport invocation for a stream cancelled before grounding (or conversation
load) completes; identical events and one call for a stream that is read; gates and charging unchanged; deterministic
red/green proof with no sleeps.

**Non-Goals:** see proposal Non-goals; changing `HttpClaudeTransport`/`ClaudeClient` (the fix lives where the side
effect is triggered, so every transport, including test fakes, benefits); deferring grounding itself (DB work, not
billed, and keeping it eager preserves today's latency).

## Decisions

D1 - Move the side effect from the Future callback into materialization. In `startStreaming` and `continueStreaming`,
the Future `.map` builds the inner Source WITHOUT side effects: the `Right` branch returns
`Source.lazySource(() => streamAttempt(...)).mapMaterializedValue(_ => NotUsed)` (or an equivalent lazy construct that
invokes `streamAttempt` only when the inner source is materialized and demanded). `Source.futureSource` materializes
the inner source only if its stage is still running when the Future completes; after a downstream cancel the stage has
stopped and its completion callback is dropped, so `streamAttempt` (and the transport) never run. `lazySource` also
waits for first demand. The `Left` (grounding/load failure) branches stay as they are.
Alternatives rejected: (a) an `AtomicBoolean` set from `watchTermination` and checked in the callback - works, but
duplicates what the stage lifecycle already guarantees and leaves a check-then-act window; (b) making
`HttpClaudeTransport.stream` lazy - fixes production only, leaves the service invoking `transport.stream` (so the
counting fake still sees a call) and changes a shared infrastructure contract; (c) `Source.lazyFutureSource` around
grounding alone - does not help, because the side effect still runs in the Future `.map` after cancel.

D2 - Charging semantics, documented in the route scaladoc and the spec delta: the daily chat counter is charged at
admission by `guardAndCount`, before the 200, for every admitted request (buffered or stream, read or not) - unchanged
and not refunded on cancel (refund is a policy change, out of scope). The billed Claude call happens only when the
response stream is live: grounding/load has completed AND the stream is still materialized and demanding. A client
that cancels after the call started is not covered (mid-stream abort is a non-goal). Telemetry: a stream cancelled
before the call emits no success/failure outcome event (previously the late call emitted one); grounding-failure
telemetry is unchanged (it still emits eagerly in the `.map`). `streamAttempt`'s mutable buffer/token vars are now
created per materialization. State all of this in the PR body.

D3 - Deterministic red test in `DashboardAuthoringServiceSpec` (no sleeps, no `eventually`, no real API, NO production
code change for testability). Gate points (hook-free; `WorkspaceContextService`, `PanelCapabilityService` etc. are
`final`, but these repos are not):
  - First turn: build a dedicated `PanelCapabilityService(gatedOutputRepo, null)(testEc)`, where `gatedOutputRepo` is an
    `OutputRepository(ctx)` subclass overriding `findByIdOwned` to (a) complete a `reached` Promise and (b) return a
    test-held `gate` Promise's future. `nodeSnapshotRepo = null` makes `rowCountOf` a synchronous
    `Future.successful(0)`, so nothing after the gate touches the DB. The authoring service is built with `testEc`.
    `WorkspaceContextService.assemble` may stay real: it completes before the gate is reached. The workspace must hold
    at least one Output so `fetchCapability` (and therefore the gate) is reached.
  - Continue turn: an `AuthoringConversationRepository(ctx)` subclass overriding `findById` the same way (reached +
    gate). `turns` shares this repo, so seed the prior turn via a real repo or delegate to `super` for the seed.
  - `testEc`: a test-owned manual-queue `ExecutionContext` (`execute` enqueues; the test drains with
    `while (queue.nonEmpty) queue.dequeue().run()`), or a single-thread executor with a self-resubmitting marker that
    re-enqueues until the queue is empty. Run-to-quiescence (NOT a single marker: grounding is multi-hop, each hop
    enqueues the next only on completion, so one marker runs after the first hop only). Deterministic because after
    the gate is released every remaining hop runs on `testEc` and no external async input can complete later. If a
    manual-queue EC is used, the test must also drain it during steps that need progress before the gate (or use the
    single-thread variant), so the real `assemble` reaches the gate.
  Step order (both turns):
  1. Materialize `authorStreaming(...)` with `.watchTermination` into a cancellable sink (`TestSink.probe` or
     `Sink.queue`).
  2. Await `reached` (the gate method was invoked).
  3. Cancel the downstream.
  4. Await the `watchTermination` Future (cancellation processed by the stage).
  5. Complete the `gate` Promise.
  6. Drain `testEc` to quiescence.
  7. Assert the counting transport's `stream` invocations == 0.
  On the unfixed code, record the red under this exact barrier: it must fail with `1 was not equal to 0`. If it shows
  0, the barrier is wrong; fix the barrier, never the assertion.
  This proof is at the service level: cancelling the Source stands for a client disconnect, because pekko-http cancels
  the response entity source when the connection closes.

D4 - Read test: same setup, the stub transport emits deltas assembling a valid proposal; the test reads the stream to
completion and asserts the terminal result event is present and the transport saw exactly 1 call. Existing streaming
scenarios (repair, upstream failure mapping) must stay green unchanged.

D5 - Gate/charging regression: keep `ClaudeRoutesChatGateSpec` and the other HEL-1205 tests green unchanged. Add (or
cite an existing) route-level assertion that a beta user's admitted `?stream=true` request increments the daily usage
counter before/without the body being read (simplest: a status-only beta request then `usage(f) shouldBe Some(1)`,
deterministic because `guardAndCount` completes before the 200 headers). Sweep every route spec that checks only `status` on a `?stream=true`
request and then asserts a transport count: after D1 an unread stream makes 0 calls, so such tests must drain
(`responseAs[String]`) as HEL-1597 did, never relax the count.

D6 - Mutation proof (temporary, uncommitted, recorded): restore the eager `streamAttempt(...)` call inside the `.map`
in `startStreaming` only -> D3's first-turn test red; restore -> green. Same for `continueStreaming`.

## Risks / Trade-offs

- [`lazySource` semantics] -> verified by the design-gate skeptic against pekko-stream 1.1.3 (`build.sbt:274`;
  `GraphStages.scala:297-384` FutureFlattenSource, `impl/LazySource.scala`). Do not swap in another construct without
  the same source check.
- [Some test relied on the eager call landing without reading the stream] -> D5 sweep; drain, never loosen counts.
- [Missing outcome telemetry for cancelled streams] -> accepted and documented (D2); there is no outcome to report.

## Planner Notes

- Self-approved: no charging-policy change (counter semantics unchanged), so no owner escalation is needed.
- Self-approved: fix placed in the service, not the transport (D1 alternative b).
- Local caps for every test run: `nice -n 19`, at most 3-4 workers, foreground, Bash `timeout: 600000`; prefer
  `sbt "testOnly ..."` for targeted specs before the full `sbt testFull` gate.
