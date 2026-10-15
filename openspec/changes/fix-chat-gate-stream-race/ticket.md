# HEL-1597: Flaky CI-only backend test: ClaudeRoutesChatGateSpec:254 beta-tier shared counter (`t.calls.get shouldBe before` got 2, expected 1)

## Description

Origin: HEL-1592 (PR matto00/helio#1026), lane-reported. Its first CI run on 7c3e29867 failed in backend shard 3, in a
test that diff doesn't touch. It passed 12/12 twice locally, and CI on the final head c425758 was green.

`ClaudeRoutesChatGateSpec:254`: `t.calls.get shouldBe before` got 2 instead of 1, in the beta-tier shared-counter case.
This may be a real race in the test's transport counter, for example a call from a previous or concurrent test hitting a
shared transport.

Do: reproduce under CI-like conditions (repeat runs with test-group concurrency 2, as in CI), find the root cause per the
systematic-debugging law, and fix it with the failure rate measured before and after. Don't just relax the assertion. If
the cause is in production code (a counted call that shouldn't happen), say so and treat it as a bug.

## Acceptance Criteria

- Root cause identified and confirmed by a probe (systematic-debugging law), with the probe recorded as evidence.
- Failure rate measured before and after the fix under CI-like conditions (repeat runs; `HEL924_TEST_GROUP_CONCURRENCY=2`
  where a shard/suite-level run is used), with run counts and executed-test counts recorded.
- The assertion at line 254 is not relaxed: the "no Claude call on a 429'd request" property it guards still holds and
  still fails when violated.
- If the cause is production code (a Claude transport call that should not happen), it is called out and treated as a bug.
- If it cannot be reproduced, an evidence-backed hypothesis from the CI log and the test's shared-state assumptions is
  reported instead of a speculative patch.

## Driver constraints (overnight run)

- Non-UI; test/backend only. Local caps: `nice -n 19`, at most 3-4 parallel workers, foreground `sbt testFull` shards.
- Concurrent lanes HEL-1578/1583/1572/1576/1575/1579 are frontend-heavy; do not touch their files.
