# HEL-1228 proof (local: 6c/12t Ryzen, not CI's runner)

## 1.1 Enumeration
- mixin-enumeration.txt: 113 files with `with ScalatestRouteTest` (matches design's 113). 114 files touched: +FirstRunRoutesSpec (unused stray import removed), PublicRouteOwnerIdLeakSpec (local 15s implicit + RouteTestTimeout import removed).
- latency-spec-enumeration.txt: 4 mixin specs using nanoTime/currentTimeMillis; their diffs are import+mixin lines only (verified with git diff -U0).

## 1.2 Probe: FirstRunRoutesSpec first vs second build request (temporary nanoTime, uncommitted)
Idle x3:   first 529/518/527 ms, second 108/107/106 ms (first ~4.9x second)
Load x3 (3 burners, nice 19): first 549/539/538 ms, second 115/112/113 ms (~4.8x)
Worst first-request = 549 ms. 15s = ~27x headroom (>=5x required by D2). Load of 3 niced burners on a 12-thread box barely perturbs latency; the stall is dominated by a one-time cold cost, not contention.
Warm-up (D5): first/second >=3x in both conditions -> trial warm-up in FirstRunRoutesFixture.beforeAll (one throwaway build, 7 lines). Under load x3: first 115/120/113 ms, second 107/118/110 ms (~1.0x, within 1.5x). No assertion affected (deltas used; PersonaTemplateRoutesSpec also green). ADOPTED.

## 1.3 Red A (unmodified main test code, load, 5 runs of FirstRun/ExistenceNotLeaked/PipelineRunGuard/AssistantTelemetry)
5/5 runs: 77 succeeded, 0 failed, 0 "neither completed nor rejected" occurrences. Red A did NOT reproduce locally (reported honestly).

## 4.1 Red B (HarnessTimeout mutated 15s -> 200ms, uncommitted, restored)
FirstRunRoutesSpec: Tests succeeded 5, failed 2
  - "build a dashboard ... ZERO Claude calls" *** FAILED *** Request was neither completed nor rejected within 200 milliseconds (DynamicVariable.scala:59)
  - "reach the counting transport ... (positive control" *** FAILED *** Request was neither completed nor rejected within 200 milliseconds (RouteTest.scala:72)

## 4.2 Red C (ApiRoutesPipelineRunGuardSpec reverted to direct ScalatestRouteTest mixin, restored)
RouteTestBaseGuardSpec: Tests succeeded 3, failed 1; "should have no test source that mixes in the route testkit directly instead of HelioRouteTest *** FAILED ***" naming src/test/scala/com/helio/api/ApiRoutesPipelineRunGuardSpec.scala. (First attempt of the mutation changed only the mixin, not the import: compile error, not a valid red; redone with import too.)

## 4.3 Green (fixed code + warm-up, load PIDs 2102005 2102006 2102007, nice 19)
5 runs x (FirstRunRoutesSpec, PersonaTemplateRoutesSpec, ExistenceNotLeakedRoutesSpec, ApiRoutesPipelineRunGuardSpec, AssistantTelemetrySpec): each 85 succeeded, 0 failed, 0 harness timeouts.
Load PIDs killed by exact PID; verified: "2102005 gone / 2102006 gone / 2102007 gone" (ps -p).

## 4.4 sbt testFull (nice -n 19): exit=0, Tests: succeeded 5701, failed 0, canceled 0, ignored 0, pending 0

## Limits
Local hardware != CI runner; Red A did not reproduce; green under 3-burner local load proves the timeout is the binding constraint (Red B) and 15s has ~27x measured headroom, not that CI is flake-free.
