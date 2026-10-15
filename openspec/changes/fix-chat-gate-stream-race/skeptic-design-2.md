## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: 60086f02bb5b1ee48f2246bc09e3e66349199585 (change dir untracked, artifacts only).

### What I verified (with evidence)

- **Round-1 CR2 (deterministic probe) addressed**: design D1(b) and task 1.3 now specify a latch in the probe
  transport's `stream()` that blocks before `calls.incrementAndGet()`, released right after `before` is read, and
  they reject fixed-delay probes as refutations. Blocking that callback thread is safe. `routeEc` is
  `typedSystem.executionContext` (`ClaudeRoutesChatGateSpec.scala:73`), the actor system's default multi-thread
  dispatcher, so the later 429 requests are not starved. The `?stream=true` 200 is still observed, because the route
  completes eagerly (`DashboardAuthoringRoutes.scala:103-105`) and the testkit's `status` reads only `rawResponse`.
  `usage(f) shouldBe Some(2)` is unaffected, because `guardAndCount` charges before `inner` (`:62-68`).
- **Round-1 CR1 (AC3 proof) partly addressed**: D5(iii) and task 3.3 were added. They are still under-specified. See
  CR1 below.
- **H1 mechanism re-checked against code**: the `startStreaming` `.map` callback calls `streamAttempt` ->
  `claudeClient.stream` (`ClaudeClient.scala:65-71`) -> `transport.stream` synchronously
  (`DashboardAuthoringService.scala:138-148, 352`). The stub increments when it is invoked (`spec:147`). Confirmed.
- **D5(i)/(ii)** are deterministic. A 2 s delay is under the 15 s `RouteTestResult` drain bound, and longer than the
  two DB reads between the stream check and `before` (`spec:247-251`).
- **D2** now names the `authoring-result` event explicitly (round-1 note taken).
- **D3 sweep**: the owner-tier test (`spec:290-297`) asserts no transport counts. The free-tier stream test 403s before
  `inner`. Correct.
- **Placeholders / contradictions / scope**: none. Proposal, design and tasks agree. Test-only, `skip_specs`
  justified, no contract delta.

### Verdict: REFUTE

One remaining gap: the task meant to evidence AC3 is ambiguous. The obvious way to read it produces a red at the
wrong line (or a racy red), and that would not show line 254 is failable.

### Change Requests

1. **D5(iii) / task 3.3: specify a mutation that keeps the 429 AND makes the transport call happen before the
   response.**
   - **The naive reading fails at the wrong line.** "Mutate `gated` so a denied (429) request still reaches the
     service/transport" most naturally reads as `case Left(err) => inner`. That returns a 200, so the test goes red at
     `expectTier`'s `status shouldBe st` (`spec:252`, via `expectTier` at `spec:218`), not at line 254. That says
     nothing about whether line 254 itself is failable.
   - **The "evaluate and discard" variant is racy.** `case Left(err) => { inner; completeTierError(err) }` keeps the
     429. But `service.author`'s transport `send` then runs asynchronously after grounding, which is the same
     class of race this ticket is fixing, so any red at 254 would be timing-dependent.
   - **Required revision.** Have D5(iii) and task 3.3 require a mutation where:
     - the denied request still completes `CHAT_LIMIT_REACHED` 429 (so `spec:252-253` stay green);
     - the transport call is awaited before the 429 completes. For example, at the
       `DashboardAuthoringRoutes.scala:102-110` call site:
       `case Left(err) => onSuccess(service.author(request, user, mdcSnapshot)) { _ => completeTierError(err) }`.
       Any equivalent that sequences the call before completion is fine.
   - **What to record.** A red that is reported at line 254 specifically (`3 was not equal to 2` with the fix in
     place), then the restore, then green.

### Non-blocking notes

- D1(b) latch probe: after the latch is released, the late increment still races (very loosely) the line-254 read. In
  practice two full HTTP+DB round trips sit in between. Still, the probe body could await a second signal (for
  example a latch the probe transport counts down right after incrementing) just before line 254. That would make the
  red strictly deterministic, not just overwhelmingly likely. Recommended, not required.
- `workflow-state.md` `TICKET_TYPE: feature` is the orchestrator's design|feature enum (as noted by the caller); not
  a defect.
- Round-1 production observation still stands as a follow-up idea only: an eager `HttpClaudeTransport.stream` bills
  a call even if the client disconnects before reading the body.
