# HEL-1323 probe: ConnectorCompletionServiceSpec 50 ms expiry race

## Contended setup (identical before and after the fix)

- Test run: `taskset -c 0-1 nice -n 19 sbt -Dsbt.color=false "testOnly com.helio.services.sources.ConnectorCompletionServiceSpec"`
  (one sbt invocation per run, run from `backend/`, forked test JVM and its embedded Postgres inherit the CPU 0-1 pinning).
- Background load: 3 busy-loop processes `taskset -c 0-1 nice -n 19 sh -c 'while :; do :; done'` (PIDs 1417528, 1417529,
  1417530, recorded in /tmp/claude-1000/hel1323/loadpids.txt, killed by those PIDs only). Total workers: 3 load + 1 test run = 4.
- Rationale: on this 12-thread box unpinned niced load never contends with a nice-19 test; pinning test and load to the same
  2 CPUs is what produces CPU starvation. Not a CI-runner measurement.
- Every run's executed test count is read from sbt's own summary (`Tests: succeeded N, failed M`); a silent cached no-op
  would show no such line. Uncontended baseline run: 18 succeeded, 0 failed (9 s).

## 1.1 Pre-fix reproduction under contention

20 consecutive runs: **2 failed / 20 (10%)**, each run executed 17+1 = 18 tests.

| run | failing test | assertion |
|---|---|---|
| 7  | "owner re-mint also recovers an expired pending Connector" | `Left(BadRequest("This completion link is invalid or has expired")) was not equal to Right(<(), the Unit value>) (ConnectorCompletionServiceSpec.scala:352)` -- the final `complete(remint.rawToken, ...)` |
| 16 | "refuse an expired token, then a re-mint on the SAME Connector succeeds with a fresh token" | same message at `ConnectorCompletionServiceSpec.scala:333` -- step 3 `complete(remint.rawToken, ...)` |

Both are the "must still be live" leg of a 50 ms-expiry re-mint failing (the token was already expired by the time
`complete` ran), exactly the hypothesised mechanism; the driver's "50 ms window" claim checked out (lines 256/308/341
use `Duration.ofMillis(50)`). Failure at 2 forks vs 3 forks in CI was not measured; this proxy is CPU pinning.

## 1.2 Deterministic mechanism probe

Scratch edit (reverted, `git checkout`): `Thread.sleep(100)` inserted between the re-mint and step 3's `complete` in the
"refuse an expired token, then a re-mint ..." test. Result: red with the identical assertion:
`Left(BadRequest("This completion link is invalid or has expired")) was not equal to Right(<(), the Unit value>) (ConnectorCompletionServiceSpec.scala:334)`
(17 succeeded, 1 failed).

## 1.3 Verdict

Hypothesis CONFIRMED: the root cause is the test's wall-clock 50 ms token lifetime vs several DB round trips on the
"live" leg. Layer: test fixture (real clock + 50 ms expiry). Product code behaves correctly (it refuses an expired
token, as designed); no product bug and no security-semantics change, so no escalation.

## Fix

`ConnectorCompletionService` and `ConnectorCompletionTokenRepository` take `clock: Clock = SystemClock` (existing
`com.helio.domain.util.Clock`); every `Instant.now()` in both is now `clock.now()`. Production defaults to `SystemClock`,
so behaviour is unchanged; `ApiRoutes` and `SourceServiceSpec` compile unchanged. The three 50 ms tests use a per-test
`FakeClock` shared by service and repo, advance 5 s past expiry, and have no `Thread.sleep`. All prior assertions kept;
one assertion added (`describePending` refuses the expired token, see mutation C).

## 3.2 D3 proofs (scratch edits, all reverted; same contended setup, 1 run each, test count shown)

| proof | result |
|---|---|
| A. `Thread.sleep(600)` in each fixed test's "must still be live" leg (3 sleeps) | 18 succeeded, 0 failed: latency-insensitive |
| B. `consume` uses `Instant.now()` instead of `clock.now()` | 17/1 red: "consume() itself refuses a token that expired AFTER being read as live", `true was not equal to false` (:289) |
| C. `resolveValidToken` uses `Instant.now()` | first attempt (before the added assertion) stayed GREEN 18/0: the SQL predicate in `consume` backstops the in-memory check on the `complete` path, so none of the original assertions observed it. Added the `describePending` assertion (that path decides on the in-memory check alone); re-run: 17/1 red at :341 `Right(ConnectorAuthShape(...)) was not equal to Left(BadRequest("This completion link is invalid or has expired"))` |
| D. delete `&& r.expiresAt > now` from `consume` | 17/1 red, same test as B |

## 3.3 Post-fix, identical contended setup

20 consecutive runs: **0 failed / 20**, each `Tests: succeeded 18, failed 0` (count shown, so none a cached no-op).
Caveat: the pre-fix rate was 2/20, so 20 greens alone is only ~12% likely by chance at a 10% failure rate; the
deterministic proofs (1.2 red before, A green after) carry the weight, the 20 runs are consistent with them.

## 3.4 Full suite

`nice -n 19 sbt testFull` (exit 0, 8 min): `Total number of tests run: 6021`, `Suites: completed 425, aborted 0`,
`Tests: succeeded 6021, failed 0`. Load PIDs 1417528/9/30 killed by PID; `sbt --client shutdown` run separately.

## 3.5 Recommendation: 3 forks per leg

Not changed here (CI config untouched). Evidence supports it only partly: the one flake HEL-1287 attributed to 3 forks
(this spec) is fixed at its root and now insensitive to a 600 ms stall in the formerly-racy window. It does NOT show that
3 forks is safe: local CPU pinning is a proxy for a shared CI runner, no 3-fork CI run was done, and other
timing-sensitive specs (e.g. RouteTestTimeout-based) were not swept. Recommendation: a 3-fork trial is reasonable as its
own ticket, with several CI runs on the runner pool before it becomes the default; this ticket does not remove that need.

## Residue

- `ConnectorCompletionServiceSpec` no longer sleeps; `shortExpiry` stays 50 ms but is now irrelevant to timing.
- Other timing-sensitive specs unswept (follow-up candidate).
