## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: 60086f02bb5b1ee48f2246bc09e3e66349199585 (change dir untracked, artifacts only).

### What I verified (with evidence)

- **Test shape (design Context bullet 1)**: confirmed. `ClaudeRoutesChatGateSpec.scala:243-256`. `t` is a new
  `CountingTransport` per test (`:244`). The `?stream=true` request checks only `status` (`:246`). `before` is read at
  `:251`, after two DB reads (`:247`, `:250`). Line 254 is `t.calls.get shouldBe before`.
- **Eager route completion**: confirmed. `DashboardAuthoringRoutes.scala:104-106` builds the Source and completes right
  away with `HttpEntity.Chunked.fromData(...)`. `gated` (`:62-68`) takes `inner` by name, so a denied request never
  evaluates `service.authorStreaming` and makes no transport call.
- **Eager transport call (H1's mechanism)**: confirmed. `DashboardAuthoringService.scala:138-148` starts
  `assembleGroundedContext` as soon as `authorStreaming` is called. The `.map` callback calls
  `streamAttempt` -> `claudeClient.stream` (`ClaudeClient.scala:65-71`) -> `transport.stream` synchronously, so the
  stub's `calls.incrementAndGet()` (`spec:147`) runs when grounding completes, whether or not anything reads the
  response body.
- **Testkit does not drain on `status`**: confirmed from the pekko-http-testkit 1.1.0 sources jar (the build pins 1.1.0,
  `build.sbt:291`). `RouteTest.status = rawResponse.status`. Only `entity`/`response`/`responseAs`/`chunks` go through
  `entityRecreator` -> `awaitAllElements`. The drain is bounded by the `RouteTestResult` timeout, which `HelioRouteTest`
  sets to 15 s. `responseAs`'s 1 s default only bounds unmarshalling chunks that are already collected. The proposed
  `responseAs[String]` drain therefore will not swap a race flake for a 1 s timeout flake.
- **The CI numbers fit H1**: "2 was not equal to 1" means `before` = 1 (only the buffered call) and a later read of 2.
  The buffered call is awaited before its 200 (`completeAuthoring` -> `onSuccess`). It makes exactly one transport call,
  because the zero-panel proposal validates without a repair. `DashboardAuthoringRoutesSpec.scala:206-208` documents
  the same thing, so `before shouldBe 2` (D2) is the correct pin once the stream is drained. The drained stream also
  makes no repair `send`, so the count stays 2.
- **D3 sweep claims**: confirmed. The owner-tier test (`:290-297`) asserts no transport counts. The free-tier stream
  test (`:230-234`) and the fail-closed test (`:330-332`) return 403/503 before `inner` is evaluated, so their 0 counts
  do not depend on timing.
- **CI-shaped conditions**: `ci.yml:177-185` sets shard matrix `[0..3]`, `HELIO_TEST_SHARD_INDEX`/`HELIO_TEST_SHARD_COUNT`,
  `HEL924_TEST_GROUP_CONCURRENCY: 2` and `HEL924_TEST_GROUP_COUNT: 4`. D1(a) cites these correctly.
- **Placeholders / contradictions / scope**: no TODO/TBD. Proposal, design and tasks agree. The scope is one test file.
  No contract delta is needed (test-only), and `skip_specs` is justified.

### Verdict: REFUTE

The diagnosis and the fix are sound and grounded in the real code. Two planning gaps would leave an AC unproven or a
probe that cannot decide anything. Both are cheap to fix in the artifacts.

### Change Requests

1. **AC3 ("the assertion still fails when violated") has no task that proves it.** Tasks 3.1/3.2 prove the drain and
   the `before shouldBe 2` pin. Nothing shows that line 254 still goes red when a 429'd request does reach the
   transport, and "line unchanged" does not show that. Add a task in section 3 with a temporary, uncommitted mutation,
   for example in `ClaudeRoutesChatGateSpec` or `DashboardAuthoringRoutes.gated` so the `Left(err)` branch still
   evaluates `inner` or calls the transport once before completing the tier error. The task must record red at line
   254 with the fix in place, then restore and record green. Without this, AC3 is asserted, not evidenced.
2. **The D1(b) forced-interleaving probe can come out wrong either way.** Line 254 only goes red if the late increment
   lands strictly between the `before` read (`:251`) and the line-254 read. A fixed injected delay that is too long
   (lands after `:254`) or too short (lands before `:251`) stays green. Under the current D1 wording, that would
   "refute H1" and send the executor off to re-investigate a correct hypothesis. Make the probe deterministic: hold the
   streaming grounding `.map` callback, or the stub's `stream` before it increments, on a test-controlled latch or
   promise that the test releases right after reading `before` and waits on before line 254. Alternatively, state that
   a delay probe must be bracketed (shorter and longer delays both shown green, the in-window delay red) before its
   result counts. Update D1(b) and task 1.3 to match. Task 3.2's mutation (`before shouldBe 2` red with the drain
   removed) is already deterministic with any delay longer than the `:247`-`:251` reads. Keep it.

### Non-blocking notes

- D1(a): "artificial CPU contention" has to stay inside the run's caps (`nice -n 19`, at most 3-4 workers in total
  including the sbt fork). Other lanes are live on this desktop, so name the exact contention command in evidence.md.
  A 0/N natural rate on a desktop is an acceptable result if it is reported honestly (the Risks section already says so).
- D2: assert the `event: authoring-result` frame specifically (`DashboardAuthoringProtocol.scala:97-98`), not just
  `event:`. An `authoring-error` frame would also prove the drain but would hide a broken fixture.
- `workflow-state.md` has `TICKET_TYPE: feature` for a bug ticket. Cosmetic for this gate.
- Production observation (eager `HttpClaudeTransport.stream`, `HttpClaudeTransport.scala:112-131`): the call belongs
  to a permitted, already-charged request, so D4's "not a production defect" framing is correct. It is worth a
  follow-up note that a client disconnecting before reading the body still triggers a billed Claude call. That is
  outside this ticket.
