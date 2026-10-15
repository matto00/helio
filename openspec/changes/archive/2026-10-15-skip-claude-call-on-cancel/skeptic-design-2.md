## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 10d8626cc3816fd4e8ec643c2c1ebace5d268ead. The worktree is clean apart from the untracked change dir.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/stream-authoring-cancel-before-call/HEL-1609`.

- **CR1 (quiescence barrier) is addressed.** D3 no longer relies on a single FIFO marker. It requires a test-owned `testEc` that runs until the queue is empty, and it states why: grounding is multi-hop, and once the gate is released no external input remains. I checked that claim against the code:
  - **First turn.** After `gate.success(...)`, the remaining work is `PanelCapabilityService.getCapabilities`'s `flatMap`, then `rowCountOf` (`PanelCapabilityService.scala:48-50`). With `nodeSnapshotRepo == null` that returns `Future.successful(0)`. Then come:
    - `fetchCapability` `.map` and `.recover` (`DashboardAuthoringService.scala` ~267-274);
    - the `zipWith` folds inside `Future.traverse`;
    - the `.map` to `GroundedContext`;
    - the `startStreaming` `.map`.

    All of these use the implicit `ec` of `PanelCapabilityService` or `DashboardAuthoringService`, and both are `testEc` under D3. None of them touches the DB or an actor. So the run-to-quiescence claim holds.
  - **Continue turn.** After the gate the work is `loadForContinuation` `.map`, then the `continueStreaming` `.map`. Both are on the service `ec`. Same conclusion.
  - Scala is 2.13.15 (`build.sbt`). A plain `ExecutionContext.fromExecutorService` / `ThreadPoolExecutor` is not a batching EC, so callbacks are actually enqueued and not run inline.

- **CR2 (concrete, hook-free gate points) is addressed, and the points exist.**
  - `OutputRepository` is a non-final `class` (`OutputRepository.scala:27`), and `findByIdOwned` (`:206`) is a non-final `def`.
  - `AuthoringConversationRepository` is a non-final `class` (`:30`), and `findById` (`:74`) is a non-final `def`.
  - `PanelCapabilityService(outputRepo, nodeSnapshotRepo)(implicit ec)` can be built per test with a gated repo and `null`. `DashboardAuthoringService` takes both of these services as constructor arguments plus an `implicit ec: ExecutionContextExecutor`, so no production change is needed.
  - A gate value of `None` on the first turn still reaches `streamAttempt`: `fetchCapability` turns NotFound into a `Left` warning, and `Right(GroundedContext)` is still produced. So the red run will be genuine.

- **The real `assemble` / EC question the orchestrator asked about.**
  - The spec's shared `workspaceContextService` is built on `routeEc` (the actor dispatcher, spec line ~90-120), and `assemble` itself runs on `routeEc` plus Slick, not on `testEc`.
  - Its completion enqueues `assembleGroundedContext`'s `flatMap` on `testEc`. That step then synchronously calls `fetchCapability`, which calls `findByIdOwned` and completes `reached`.
  - Single-thread variant: progress to the gate happens on its own, and awaiting `reached` is a bounded wait on an event, not a sleep.
  - Manual-queue variant: the test must keep draining while `assemble` is in flight on Slick. D3 explicitly flags this ("must also drain it during steps that need progress before the gate (or use the single-thread variant)").
  - Both variants are deterministic as specified. Once `reached` has fired, `assemble` has already completed (the gate sits downstream of it). So nothing external remains after release.

- **CR3 ("reached" barrier) is addressed.** It is step 2, and it comes before cancel.

- **CR4 (step order and red under the same barrier) is addressed.** The order is: materialize with `watchTermination`; await `reached`; cancel; await termination; release the gate; drain; assert. The text requires recording the red (`1 was not equal to 0`) under this exact barrier, and says to fix the barrier, never the assertion.
  - The red is achievable. `FakeClaudeTransport.stream` increments `streamInvocations` when it is invoked (`DashboardAuthoringServiceSpec.scala:218-219`), not when it is materialized. `ClaudeClient.stream` calls `transport.stream` eagerly unless the guardrail rejects (`ClaudeClient.scala` ~65-71), and the default `maxInputTokens = 100000` does not reject. So on unfixed code the `.map` on `testEc` records 1.

- **The race in step 4 (watchTermination before futureSource processes the cancel) does not threaten the fixed-code green.**
  - Fusing puts `watchTermination` and `futureSource` in one interpreter, so the upstream cancel is processed in the same interpreter run that completes the termination promise.
  - The inner-source `AsyncCallback` from the `parasitic` `onComplete` arrives as a later actor message, after the stage has stopped.
  - Even if that ordering were inverted, D1's `lazySource` invokes its factory only on `onPull`, which is the second safeguard verified in round 1.
  - So the green does not depend on timing.

- **CR5 is addressed.** tasks.md 1.2 now names the gated subclasses, the reached and gate Promises, the test-owned EC drained to quiescence, the 7-step order, and recording the red.

- **The round-1 non-blocking notes were folded in:**
  - D2 now covers the per-materialization vars and the eager grounding-failure telemetry;
  - D3 covers pekko-http cancelling on disconnect;
  - D5 covers the status-only beta `usage(f) shouldBe Some(1)` check;
  - Risks now cite the pekko 1.1.3 sources.

- **No new placeholders, contradictions or scope drift.**
  - AC1 is covered by D1/1.3, AC2 by D3/1.2/2.3, AC3 by D4/2.1, AC4 by D2/D5/1.4/2.2, and AC5 by D1, which touches only the stream paths.
  - The spec delta matches D2.

### Verdict: CONFIRM

### Non-blocking notes

- **Continue-turn gate value.** The continue test must complete `gate` with `Some(record)`, where the record has `latestProposal.isDefined` and is under the token budget. Fetch it first with `super.findById` on the seeded id. A `None` would take the `Left(NotFound)` branch and never reach `streamAttempt`. Mandatory red-first would catch this, but saying it in the test avoids a wasted cycle. (Seeding goes through `repo.create`, not `findById`, so it does not conflict with the override.)
- **`reached` can fire more than once.** If the workspace holds more than one Output, `Future.traverse` calls `findByIdOwned` once per Output, so use `reached.trySuccess`. The simplest fix is one Output per test user.
- **Prefer the single-thread variant.**
  - Build it as `new ThreadPoolExecutor(1, 1, 0L, MILLISECONDS, new LinkedBlockingQueue[Runnable])` so `getQueue` is accessible. `Executors.newSingleThreadExecutor` wraps it and hides the queue.
  - Shut it down in a `finally`.
  - The manual-queue variant needs a blocking poll while Slick is in flight, and that is easy to get subtly wrong.
