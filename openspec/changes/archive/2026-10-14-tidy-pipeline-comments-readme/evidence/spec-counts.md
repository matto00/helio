# FireTimeRunConfigGateSpec counts
- Before (git HEAD): 459 lines, 4 banner blocks, 5 `should` groups + 10 tests (15 name lines).
- After: 443 lines, 0 banner blocks; name-line diff before/after is empty (claims.md D4).
- sbt run (foreground, HELIO_TEST_JVM_XMX=3g): "Total number of tests run: 10 / Tests: succeeded 10, failed 0 / All tests passed." Suite groups: scheduled fire (gap 2), debounced auto-run fire, undecodable step config (red-first), negative controls (GUARD), fire-time evaluation error (GUARD).
- The same invocation also ran the full backend testFull: "Total number of tests run: 8079, Suites: completed 615, aborted 0, Tests: succeeded 8079, failed 0, canceled 4" / All tests passed.
