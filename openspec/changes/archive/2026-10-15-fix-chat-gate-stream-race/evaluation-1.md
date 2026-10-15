## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: e7e9e72726fd1f2ab864611497c99094180adc36 (base 60086f02bb5b1ee48f2246bc09e3e66349199585, live-resolved).
Diff: one test file (`ClaudeRoutesChatGateSpec.scala`, +7/-1) plus change-dir artifacts. No production code. No frontend files.

### Phase 1: Spec Review — PASS
- AC1 (root cause confirmed by a probe, probe recorded): evidence.md 1.3 records a deterministic latch probe (diff inline) with
  the exact CI message `2 was not equal to 1`. The mechanism holds up against the code. `DashboardAuthoringRoutes.scala:103-106`
  completes the chunked response right away. `CountingTransport.stream` increments when it is invoked, and the test checked only
  `status`. I re-ran a probe of my own (delay, below) and it agrees with H1.
- AC2 (before/after rate with run and executed counts): reported honestly. Natural rate is 0/40 single-spec runs (480 tests) and
  0/3 CI-shaped shard runs, both before and after. The discriminating evidence is the deterministic red-before/green-after
  probes. I accept this under the ticket's "cannot reproduce naturally" clause, because the forced interleaving gives the
  confirmation.
- AC3 (line-254 assertion not relaxed): `t.calls.get shouldBe before` is unchanged (now spec:260). A stricter pin
  `before shouldBe 2` was added at spec:257. I re-verified that the assertion can still fail, by mutation (below).
- AC4: verdict is a test race, not a production defect. This is backed by D5(iii): a transport call on a 429'd request is caught.
- AC5: n/a (cause confirmed).
- Tasks 1.1-3.4 are all marked done and match the diff. D3 sweep: confirmed that no other `?stream=true` OK check precedes a count assertion.
- No scope creep. No API/schema impact (`skip_specs: true` is appropriate). The planning artifacts match the implementation.
- CONSTRAINTS: `[]`, so nothing to honor.

### Phase 2: Code Review — PASS
Gates (fresh, run by me in this worktree; the sbt logs print `.../HEL-1597/backend`):
- `testOnly ...ClaudeRoutesChatGateSpec`: 12 run, 12 succeeded.
- `sbt testFull`, run as the four CI-shaped shards (`HEL924_TEST_GROUP_CONCURRENCY=2 HEL924_TEST_GROUP_COUNT=4
  HELIO_TEST_SHARD_INDEX=i HELIO_TEST_SHARD_COUNT=4`, nice 19, `HELIO_TEST_JVM_XMX=2g`), all exit 0:
  - shard 0: 2394 succeeded / 0 failed / 3 canceled (HELIO_MEASURE report-only, by design)
  - shard 1: 1763 / 0
  - shard 2: 1852 / 0 / 1 canceled (latency measurement, by design)
  - shard 3: 2119 / 0. Contains the spec; the beta test ran. These counts match the executor's claimed 2119/156 suites.
- `npm run check:scala-quality`, `check:openspec`, `check:repo-integrity`, `check:test-temp-dir-hygiene`: all exit 0.
  Prettier check on the change-dir markdown is clean.
- The frontend gates do not apply (no `frontend/**` changes).

Claims I re-verified:
- CI log (run 38596961437, job 115966051928): `gh run view --log` shows `2 was not equal to 1 (ClaudeRoutesChatGateSpec.scala:254)`
  and `Tests: succeeded 2216, failed 1`. This matches evidence.md 1.1 verbatim.
- Probe D5(i)/(ii), my own run: I added a temporary transport that sleeps 2 s in `stream()` before incrementing.
  - With the drain in place the spec is GREEN, 12/12.
  - With the drain removed it goes RED at spec:262 (the pin line in the mutated file), `1 was not equal to 2`. This matches the executor's claim.
- Production mutation D5(iii), my own shape: in `gated`, `case Left(err)` runs `inner(ctx)` to completion and then still
  completes the 429. This goes RED at spec:260 (`t.calls.get shouldBe before`) with `3 was not equal to 2`, and also at
  spec:228 (free-tier zero-call guard). So the "no Claude call on a 429'd request" guard is intact and can still fail.
- All mutations were reverted. `git status --short` is empty.

Code-quality notes:
- The drain via `responseAs[String] should include("event: authoring-result")` is the right happens-before. The
  `authoring-result` event can only be produced after the stub stream's events are consumed, and that requires
  `transport.stream` to have been invoked (which increments). It does not rely on tuned sleeps or polling.
- The explicit `before shouldBe 2` makes any regression to the race a readable, deterministic failure.
- The comment carries the ticket prefix and explains why. This complies with CONTRIBUTING.md's comment guidance. No dead code, no FQNs.

### Phase 3: UI Review — N/A
No trigger paths changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**` are untouched).

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- evidence.md 1.3 cites `/tmp/claude-1000/ev/latch_probe.diff`, which is an ephemeral path. The diff is also reproduced inline,
  so nothing is lost, but the inline copy is the durable reference.
- The 40x single-spec counts are executor-only; I did not repeat the 40x loop. My independent checks were the shard-3 run and
  the deterministic delay and production-mutation probes.
