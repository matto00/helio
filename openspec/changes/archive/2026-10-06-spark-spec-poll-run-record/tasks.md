## Standing Constraints

- [C1] Test-only: no file under `backend/src/main` is changed in any commit; mutation edits are reverted and
  `git diff --stat -- backend/src/main` is shown empty before every commit.
- [C2] The assertions in the two `submit` tests are unchanged byte-for-byte (verify with the diff).
- [C3] Test runs use `nice -n 19`, `HEL924_TEST_GROUP_CONCURRENCY=2`, Bash timeout 600000; `sbt --client shutdown`
  runs as its own Bash call.

### Tests

## 1. Replace the sleeps

- [x] 1.1 Add `awaitRunPersisted(pid)` (Eventually, 30 s timeout, 50 ms interval; run row terminal AND lastRunStatus defined); verify it compiles
- [x] 1.2 Replace both `Thread.sleep(3000)` with `awaitRunPersisted(pid)`; verify `git diff` shows only those lines + helper/imports
- [x] 1.3 Run `testOnly com.helio.spark.SparkJobSubmitterSpec`; verify green (M0)

## 2. Mutation proof (temporary, never committed)

- [x] 2.1 M1 with reconstructed lastRunStatus-only poll: record RED output and failing assertion
- [x] 2.2 M1 with the new poll: record GREEN output
- [x] 2.3 M2 with run-record-only poll: record RED output and failing assertion
- [x] 2.4 M2 with the new poll: record GREEN output
- [x] 2.5 Restore product code; verify `git diff --stat -- backend/src/main` is empty

## 3. Measurement and full suite

- [x] 3.1 Time the spec on main (sleeps) vs this branch; record per-test durations and the delta
- [x] 3.2 Run `nice -n 19 sbt testFull` (2 workers); verify green and report any FirstRunRoutesSpec timeout or heap error
