## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 10d8626cc3816fd4e8ec643c2c1ebace5d268ead (worktree clean apart from the untracked change dir).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/stream-authoring-cancel-before-call/HEL-1609`.
- **Call path (design Context), checked against the tree. It matches:**
  - `DashboardAuthoringService.scala:138-149`: `startStreaming` = `Source.futureSource(assembleGroundedContext(...).map { case Right(ctx) => ... streamAttempt(...) })`. `continueStreaming:185-204` has the same shape around `loadForContinuation`.
  - `streamAttempt:341-372` calls `claudeClient.stream(...)` while it builds the Source. `ClaudeClient.scala:65-71` calls `transport.stream` eagerly. `HttpClaudeTransport.scala:112-130` calls `Http().singleRequest` eagerly. So on the current code the billed request is sent from inside the Future `.map` callback.
  - Route `DashboardAuthoringRoutes.scala:62-67,104-106`: `gated` -> `guardAndCount` runs before `authorStreaming`. The premise evidence is consistent with this.
- **D1 soundness against Pekko 1.1.3:** `backend/build.sbt:274` pins `pekko-stream 1.1.3`. I read the sources jar from the coursier cache. Result: **sound, with two independent safeguards.**
  - `GraphStages.scala:297-384` `FutureFlattenSource`:
    - In `preStart` it registers `futureSource.onComplete(getAsyncCallback(onFutureSourceCompleted).invoke)(parasitic)`.
    - Its initial `onDownstreamFinish` fails the mat promise and stops the stage.
    - The inner graph is materialized only inside `onFutureSourceCompleted`. An async callback delivered to a stopped stage is not run.
    - Consequence: after a processed cancel, the inner Source is never materialized.
  - `impl/LazySource.scala`: `sourceFactory()` is invoked only in `onPull`. `onDownstreamFinish` before any pull only fails `matPromise` and completes the stage.
  - Consequence: even if the stage were materialized, `streamAttempt` would not run without demand.
  - With D1, the `.map` body builds only a description: `initialUserMessage`, the `persistTurn` closure and `lazySource`. All of these are side-effect free. So D1 guarantees that `streamAttempt` (and the transport call) is never invoked after a downstream cancel that was processed before the Future completed.
  - Rejected alternative (c) is correctly reasoned.
- **Route sweep (D5):** the specs that hit `?stream=true` are `ClaudeRoutesChatGateSpec`, `DashboardAuthoringRoutesSpec` and `AuthoringTelemetrySpec`.
  - Every test that asserts on the stream outcome or a transport count already drains with `responseAs[String]`.
  - The owner-tier test (`ClaudeRoutesChatGateSpec:299`) checks status only, but it asserts `usage(f) shouldBe None`, not a transport count, so it is unaffected.
  - The sweep is sound but will likely find nothing to change.
- **Injectability for D3, checked against the classes:**
  - `WorkspaceContextService`, `PanelCapabilityService`, `DashboardService`, `DataSourceService` and `PipelineService` are all `final class`. There is no existing grounding fake in `DashboardAuthoringServiceSpec`: it wires real services over real repos (lines 102-127).
  - Non-final and overridable: `OutputRepository(ctx)` (`findByIdOwned:206`), `NodeSnapshotRepository(ctx)`, and `AuthoringConversationRepository(ctx)` (`findById:74`).
  - `PanelCapabilityService.rowCountOf` treats `nodeSnapshotRepo == null` as `Future.successful(0)`.
- **The D3 barrier, checked against the grounding chain:**
  - `assembleGroundedContext:237-256` is multi-hop on the service `ec`: `assemble(...).flatMap` -> `Future.traverse(fetchCapability)`. Each `fetchCapability` is itself `getCapabilities` (`flatMap` -> `rowCountOf.map`) -> `.map` -> `.recover`. After that comes `.map` to `GroundedContext`, then the `startStreaming` `.map`.
  - `loadForContinuation` -> `.map` -> `continueStreaming` `.map` is at least two hops.
  - Each hop enqueues its continuation only when the previous hop completes. So a single marker task submitted right after completing the gate Promise runs **after the first hop only**. It does not run after the `.map` that calls the transport.

### Verdict: REFUTE

D1 (the fix) is sound and verified against Pekko 1.1.3. D3, the AC2 proof procedure, is not deterministic as written. Its step 4 rests on a false claim: "submit a marker task and await it — FIFO guarantees the `.map` callback ran first".

- **Fixed code:** the 0-call assertion would be vacuous. It would be checked before the callback it is meant to follow has run.
- **Unfixed code:** the red run would reliably show 0, not 1.

D3 also never establishes that the gated call has actually been reached before the Promise is completed. And it points the executor at "the spec's existing fakes" when none exists for grounding, and every grounding service is `final`. That invites a production hook or a sleep, which the design itself forbids. These are revisions to the design artifacts, not to code.

### Change Requests

1. **design.md D3 step 4: replace the single-marker FIFO barrier with a run-to-quiescence barrier, and fix the false claim.**
   - Run the service, and every grounding hop after the gate, on a test-owned executor that has no other external async inputs. For example, a single-thread executor with a self-resubmitting marker that re-enqueues until the queue is empty, or a manual queue EC that the test drains with `while (queue.nonEmpty) queue.dequeue().run()`.
   - State explicitly why this is deterministic: after the gate is released, every remaining hop is on that executor and nothing external can complete later.
2. **design.md D3 step 1: name a concrete, hook-free gate point that actually exists.**
   - **First turn:** construct a dedicated `PanelCapabilityService(gatedOutputRepo, null)(testEc)`. `gatedOutputRepo` is an `OutputRepository(ctx)` subclass that overrides `findByIdOwned` to return a test Promise. `nodeSnapshotRepo = null` gives a synchronous `Future.successful(0)`, so no DB call happens after the gate. The service is built with `testEc`; `WorkspaceContextService.assemble` may stay real, because it completes before the gate is reached.
   - **Continue turn:** subclass `AuthoringConversationRepository(ctx)` and override `findById` to return a test Promise. (Note: `turns` is built from the same `conversationRepo`, so seed the prior turn through a real repo, or delegate to `super` for the seeding call.)
   - State that the production code is not touched.
3. **design.md D3: add a "gate reached" barrier before cancel and release.**
   - The overridden `findByIdOwned`/`findById` completes a `reached` Promise (or counts down a latch) when it is invoked. The test awaits that before it cancels the stream.
   - Without this, the first-turn test can complete the gate Promise before real-DB `assemble` has even reached `fetchCapability`. Grounding then finishes after the barrier, and the assertion is vacuous.
4. **design.md D3: state the order of steps.** The order is: materialize with `watchTermination`; await `reached`; cancel; await the termination Future; complete the gate Promise; drain to quiescence; assert `streamInvocations == 0`.
   - Also note that the red run on unfixed code must show `1 was not equal to 0` under this exact barrier. If the barrier is wrong, the red step is what exposes it, so record the red under the same barrier rather than a different one.
5. **tasks.md 1.2:** reference the revised D3 (gate points plus the quiescence and reached barriers) so the executor cannot fall back to "find an injection point".

### Non-blocking notes

- The D3/AC2 proof is at the service level: cancelling the Source stands in for "client disconnects". That reading of AC2 is reasonable. Optionally add one sentence noting that pekko-http cancels the response entity source on connection close, which is what connects the service-level proof to a real disconnect. It is not required by the ACs.
- D1's comment and the PR body should say that `streamAttempt`'s mutable `buffer`/token `var`s now get created per materialization, which is a strict improvement. They should also note that the `Left` branches' `failStreamEvent` still emits telemetry eagerly in the `.map`. That is unchanged, but it is a side effect that remains in the callback.
- For D5 "charged before/without reading": a status-only beta request followed by `usage(f) shouldBe Some(1)` is deterministic, because `guardAndCount` completes before the 200 headers. The simplest form is to add that assertion next to the owner-tier status-only test.
- On the Risks entry "lazySource semantics differ across Pekko versions": this is now settled for 1.1.3 (citations above). The executor need not re-derive it, but should not swap in a different construct without the same source check.
