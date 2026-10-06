# HEL-1338 probe evidence

Root cause: `ConnectorRepository.rotateCredential` discarded the Future of the old credential's delete
(`existing.credentialId.foreach(old => credentialRepo.delete(...).recover{...})`) and returned success. Product
defect: rotation could report success while the old encrypted credential still existed and was resolvable; a failed
delete was swallowed and the old secret persisted forever.

## (1) Red run of the new D4 lock-holding test against UNFIXED code
A separate superuser connection holds `SELECT ... FOR UPDATE` on the old credential row; rotation is started and
must stay pending for a 1.5 s bounded poll. Output (full log kept locally, gitignored):

```
 [info] - should does not return success until the old credential is actually deleted (HEL-1338) *** FAILED ***
 [info]   rotation reported success while the old credential's delete was still blocked: true was not equal to false (ConnectorRepositorySpec.scala:459)
 [info] Tests: succeeded 16, failed 1, canceled 0, ignored 0, pending 0
```
(sbt `testOnly ...ConnectorRepositorySpec` exit 1; 16 passed, 1 failed = the new test.)

## (2) Before-fix rate of the ORIGINAL rotate assertion under 2-fork contention
Unfixed code, original test only (`-z "replaces the plaintext"`), 2 concurrent JVM forks (each its own
EmbeddedPostgres, loop.sh A and B, 40 runs each, nice -n 19, -Xmx512m) plus 2 nice -n 19 busy-loop burners
(4 workers total). Result: 80 runs, 0 failures (A: 40/0, B: 40/0). The race is too narrow to reproduce by load,
which is why the deterministic D4 test is the real proof. Load PIDs: burners 1733631, 1733632; loops 1733633
(A), 1733634 (B); burners killed by recorded PID afterwards.

## (3) After the fix: consecutive green runs under 2-fork contention
Whole ConnectorRepositorySpec (18 tests incl. the 2 new ones), fixed code, same harness: 2 concurrent forks x 25
consecutive runs = 50 runs, 50 green, 0 failures (every log shows "Tests: succeeded 18, failed 0"). Burner PIDs
1747966, 1747967; loop PIDs 1747968 (A), 1747969 (B); burners killed by recorded PID. Harness: loop-harness.sh
(invokes org.scalatest.tools.Runner directly on the sbt test classpath).

## Full suite
`nice -n 19 sbt testFull` exit 0: "Tests: succeeded 6023, failed 0 ... All tests passed." No "Java heap space"
and no FirstRunRoutesSpec timeout observed.
