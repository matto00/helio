## Context

See proposal.md (Why). Facts from the tree at 60086f02b:

- `ClaudeRoutesChatGateSpec.scala:240-256`: one `CountingTransport` `t` per test (not shared across tests; the spec's
  only shared state is the embedded Postgres, `userRepo`/`usageRepo`, and the actor system). The test sends buffered
  authoring (OK), then `?stream=true` authoring (OK, `status` checked only), reads `usage`, reads `before = t.calls.get`,
  sends two requests expected to 429, then asserts `t.calls.get shouldBe before`.
- `DashboardAuthoringRoutes.scala:103-106`: the stream branch completes immediately with
  `HttpEntity.Chunked.fromData(sse, service.authorStreaming(...))`.
- `DashboardAuthoringService.scala:138-148` (`startStreaming`): `Source.futureSource(assembleGroundedContext(...).map {
  case Right(ctx) => ... streamAttempt(...) })`. The `.map` body is a Future callback: it runs when grounding completes,
  whether or not anyone materializes the Source. `CountingTransport.stream` increments on invocation.
- Pekko testkit 1.1.0 `RouteTestResult`: `status` reads `rawResponse` only; the chunked body is drained only via
  `entity`/`response`/`responseAs`/`chunks`. So the test never waits for the streaming request's model call.
- `HttpClaudeTransport.stream` (prod) issues `singleRequest` eagerly on invocation as well.

Hypothesis H1: the streaming request's (permitted, charged) transport call is made asynchronously after its 200 is
observed; normally grounding wins the race against the `usage` DB reads, so `before` = 2; on a slow runner it loses, so
`before` = 1 and the late increment lands before the final read. That matches "got 2, expected 1" exactly, and both
"always early" and "never" would pass, which is why it is rare.

## Goals / Non-Goals

**Goals:** confirm or refute H1 with a probe before any fix; measure before/after failure rates; keep line 254's guarantee
("a 429'd request makes no Claude call") exactly as strict and failable.

**Non-Goals:** changing production streaming timing (see proposal Non-goals); touching other specs.

## Decisions

D1 - Probe first (systematic-debugging law). Two probes, neither committed:
  (a) Natural rate: repeated `testOnly com.helio.api.routes.proposals.ClaudeRoutesChatGateSpec` runs (N >= 30) under
      artificial CPU contention, all `nice -n 19`, and at least a few CI-shaped runs of the shard containing the spec
      with `HEL924_TEST_GROUP_CONCURRENCY=2` and `HEL924_TEST_GROUP_COUNT=4` (plus `HELIO_TEST_SHARD_INDEX`/shard-count envs exactly as `ci.yml:177-185` sets them).
  (b) Forced interleaving, deterministic (no tuned sleeps): a temporary, uncommitted probe transport whose `stream()`
      blocks on a `CountDownLatch` BEFORE incrementing `calls`; the unfixed test body releases the latch immediately after
      reading `before` (line 251). Expected under H1: deterministic red at line 254 with `2 was not equal to 1`, the exact
      CI message. If it stays green, H1 is refuted and the executor re-investigates before changing anything. (A
      fixed-delay probe is NOT accepted as a refutation: it can only go red if the late call lands inside the 251-254
      window.) For strict determinism the probe also signals a second latch right after incrementing, and the probe
      test waits on it just before line 254. Record each increment's thread name as supporting evidence that it runs on the grounding Future callback.
  Also pull the failing CI job log (`gh run view --log-failed` for 7c3e29867, PR #1026) and record the exact failure.

D2 - Fix (only if H1 is confirmed): in the beta shared-counter test, drain the `?stream=true` response inside its `check`
  (`responseAs[String]`) and assert it carries the terminal success event, so the stream's `futureSource` completed and
  therefore `streamAttempt` ran. Then pin the expected pre-429 count explicitly (`before shouldBe 2`) so a future
  regression to the race is a deterministic, readable failure instead of a flake. Line 254 is unchanged.
  Alternative rejected: `eventually { t.calls.get shouldBe 2 }` before reading `before` - polls a symptom, slower, and
  hides whether the call belongs to the request. Alternative rejected: making production stream lazy - production change
  outside the ticket's bug definition (the call is for a permitted request), and changes real latency behavior.

D3 - Sweep only within this spec: any other `?stream=true` OK check followed by a transport-count assertion gets the same
  drain. (The owner-tier test asserts no counts; the free-tier stream test expects 0 calls on a 403 and is unaffected.)

D4 - Production verdict: H1 means the extra count is the permitted streaming request's own call, observed late - NOT a
  call on a denied request. If the probe shows otherwise (an increment on a 429'd request), stop and treat it as a prod bug.

D5 - Proof the fix holds and line 254 stays failable (all mutations temporary, uncommitted, restored, red+green recorded):
  (i) fix holds: probe transport delays (e.g. 2 s) before incrementing; the fixed test (drain) is green with `before` = 2.
  (ii) drain is load-bearing: same delay, drain removed -> red at `before shouldBe 2`.
  (iii) line 254 still guards AC3: a mutation that KEEPS the 429 and makes the transport call synchronously before the
       response completes, at `DashboardAuthoringRoutes.scala:102-110`'s `gated` call site, e.g.
       `case Left(err) => onSuccess(service.author(request, user, mdcSnapshot)) { _ => completeTierError(err) }`.
       Required evidence: red reported AT line 254 itself (`3 was not equal to 2`, fix in place) - a red at
       `expectTier` (spec:252) or one that depends on timing does not count; then restore -> green.
  The drained body must contain the `authoring-result` SSE event, not merely any `event:` line.

## Risks / Trade-offs

- [Probe (a) may never reproduce naturally on this desktop] -> (b) is the deterministic confirmation; report rate as
  observed (possibly 0/N) honestly, together with the forced-interleaving red/green.
- [Shard runs are expensive and other lanes run concurrently] -> cap per driver: `nice -n 19`, <= 3-4 workers, foreground,
  Bash `timeout: 600000`.

## Planner Notes

- Self-approved: test-only change, `skip_specs: true` (no behavior change).
- Self-approved: CPU contention for probe (a) stays within the caps; the exact command is recorded.
- Self-approved: the production eagerness of `HttpClaudeTransport.stream` is recorded as an observation only.
