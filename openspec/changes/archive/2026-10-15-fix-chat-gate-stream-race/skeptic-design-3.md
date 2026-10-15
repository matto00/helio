## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: 60086f02bb5b1ee48f2246bc09e3e66349199585. The change dir is untracked and contains only artifacts.
The spawn-cwd guard printed `READY ambient=/home/matt/Development/helio branch=bug/chat-gate-stream-race/HEL-1597`.

### What I verified (with evidence)

- **Test shape**: `ClaudeRoutesChatGateSpec.scala:243-256`. `t` is a new `CountingTransport` per test (`:244`). The
  `?stream=true` request checks only `status` (`:246`). `before` is read at `:251`, after two DB reads (`:247`, `:250`).
  `:254` is `t.calls.get shouldBe before`. This matches design Context.
- **H1 mechanism, re-derived from code**: `DashboardAuthoringRoutes.scala:103-105` completes at once with a Chunked
  entity. `DashboardAuthoringService.scala:138-148`: `Source.futureSource(assembleGroundedContext(...).map{...
  streamAttempt(...)})`. The `.map` runs eagerly, whether or not anything materializes the Source.
  `streamAttempt:352` calls `claudeClient.stream`, which calls `transport.stream` synchronously
  (`ClaudeClient.scala:65-71`). The stub increments when invoked (`spec:146-148`). So the permitted stream's count
  can land after `before` is read. "2 was not equal to 1" fits `before`=1 with a late increment before `:254`.
- **The D2 drain is causally sufficient**: the increment happens inside the `.map` callback. That callback's
  completion is what `futureSource` waits on, so it happens before the first element of the body. The terminal
  `authoring-result` frame (`DashboardAuthoringProtocol.scala:98`) is emitted only after `MessageStop`, then
  `completeStream`, then persist (`Service:365-391`). Draining up to that frame therefore guarantees the increment
  happened. The harness bound is 15 s (`HelioRouteTest.HarnessTimeout`), and the D5(i) 2 s delay fits well inside it.
- **Round-2 CR1 (AC3 proof) is resolved**: D5(iii) and task 3.3 now require a mutation that keeps the 429 and awaits
  the transport call before completion (`onSuccess(service.author(...)) { _ => completeTierError(err) }`). They require
  the red to appear at line 254 itself (`3 was not equal to 2`), and they exclude reds at `expectTier`/`:252` and
  timing-dependent reds. The arithmetic checks out:
  - the buffered call is 1 and the drained stream is 1, so `before`=2;
  - the mutated authoring 429 adds 1 synchronously;
  - refinements are untouched (a separate `RefinementRoutes`), so the total is 3 at `:254`.

  `request` and `mdcSnapshot` are only in scope at the call site (`:96-103`), not inside `gated`. The design names the
  call site, so the mutation is implementable.
- **Round-2 note (second latch) is adopted**: D1(b) now waits on a post-increment latch before `:254`. That makes the
  forced-interleaving red strictly deterministic.
  - Blocking the callback thread is safe: `routeEc` is the actor system's multi-thread dispatcher (`spec:73`), and
    it is passed into the routes and services (`spec:196-203`).
  - `CountingTransport` is a non-final private class and `routes(...)` takes that type, so a probe subclass inside
    the spec fits without changing the signature.
- **Count pin `before shouldBe 2`**: the stub's stream returns a valid zero-panel proposal, so there is no repair
  `send`, and the drained count is exactly 2. Correct.
- **D3 sweep**: the owner test (`:290-297`) makes no count assertions. The free-tier tests return 403 before `inner`
  (by-name `gated`, `Routes:62-68`), so their 0 counts do not depend on timing. Correct.
- **CI-shaped conditions**: `ci.yml:179-185` sets the shard index/count, `HEL924_TEST_GROUP_CONCURRENCY: 2` and
  `HEL924_TEST_GROUP_COUNT: 4`. `build.sbt:200-240` consumes them.
- **AC coverage**:
  - AC1 (probe recorded): tasks 1.3/1.4 and `evidence.md`.
  - AC2 (before/after rate with run and executed counts): tasks 1.2/3.4.
  - AC3 (line 254 not relaxed and failable): D2 leaves `:254` unchanged; tasks 3.3 and D5(iii) prove it fails.
  - AC4 (production verdict): D4.
  - AC5 (not reproducible): Risks, plus the deterministic latch probe and honest 0/N reporting.
- **Placeholders, contradictions, scope**: none. Proposal, design and tasks agree. The change is test-only, so
  `skip_specs` is justified and no contract delta is needed.

### Verdict: CONFIRM

### Non-blocking notes

- D1(a) "shard-count envs exactly as ci.yml sets them": also set `HEL924_TEST_GROUP_COUNT=4`. The `build.sbt:221`
  default is 8, and changing the grouping changes which suites share a JVM group.
- `tasks.md` has an empty `## Standing Constraints` heading. This is cosmetic.
- The production observation from rounds 1 and 2 still stands as a possible follow-up only: the eager
  `HttpClaudeTransport.stream` bills a call even when the client disconnects before reading the body.
