## Standing Constraints

## 1. Probe (Backend, tests only)

- [x] 1.1 Enumerate `ScalatestRouteTest` mixins and latency-asserting specs by grep; save both lists as evidence (count matches 113 or explain)
- [x] 1.2 Time FirstRunRoutesSpec first vs second build request (temporary nanoTime, uncommitted), idle x3 and under the D6 load x3; record numbers
- [x] 1.3 Red A: unmodified test code, D6 load, 5 targeted runs of the four named specs; record timeout count (0 is a valid, reported result)

## 2. Base trait and migration (Backend)

- [x] 2.1 Add `com.helio.testkit.HelioRouteTest` with the 15s constant and its rationale comment; verify D2 headroom (>=5x over 1.2's worst) or escalate
- [x] 2.2 Swap every mixin + import per D3 (incl. shared fixtures/bases); remove PublicRouteOwnerIdLeakSpec's local implicit; `sbt Test/compile` green
- [x] 2.3 Apply D5's decision rule; add the FirstRunRoutesFixture warm-up only if it qualifies, else record why not

## 3. Guard and docs

- [x] 3.1 Add `RouteTestBaseGuardSpec` per D4 (incl. non-vacuity asserts); passes on the migrated tree
- [x] 3.2 Update CONTRIBUTING.md's embedded-postgres test-group section: base trait, 15s, harness-latency-not-perf rule

## 4. Tests / proof

- [x] 4.1 Red B: lower the trait constant (e.g. 200ms) -> FirstRunRoutesSpec fails with the testkit timeout message; restore; record
- [x] 4.2 Red C: revert one spec to a direct mixin -> guard fails naming it; restore; record
- [x] 4.3 Green: same D6 load, 5 targeted runs, 0 harness timeouts; load PIDs killed by exact PID and verified gone
- [x] 4.4 Full `nice -n 19 sbt testFull` (Bash timeout 600000) green; confirm no latency assertion changed (`git diff` on latency specs = mixin/import only)
