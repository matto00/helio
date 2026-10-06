## Standing Constraints

- [C1] Test-only. No production source change unless a red test first proves the boundary wrong (D6). Never commit the mutation.
- [C2] Every boundary instant is microsecond-exact (`getNano % 1000 == 0`), and its DB round-trip is asserted.
- [C3] sbt runs use `HEL924_TEST_GROUP_CONCURRENCY=2 nice -n 19`, a 600000 ms timeout, and a separate `sbt --client shutdown` call.
- [C4] Do not touch `ci.yml`, `playwright.config.ts`, `.gitignore`, history schemas, or `NodeSnapshotRepository`.

### Tests

## 1. Repository-level boundary test

- [x] 1.1 Add a `nearestAtOrBefore` case in `OutputHistoryRepositorySpec` with points at b−1µs, b, b+1µs and latest, where b = latest − 7d (µs-exact). Assert that `nearestAtOrBefore(oid, latest.minus(7d))` returns b, and assert the µs preconditions and round-trip. Verify: `testOnly` green.

## 2. Route-level boundary test

- [x] 2.1 Add a window-baseline case in `OutputHistoryRoutesSpec` (`compare: "7d"`) with points at b−1µs (10), b (20), b+1µs (40) and Tb (50). Tb is µs-exact and ≥3d before now. Assert `baseline` == b.toString, `delta` 30, `pct` 150, `availableFrom` null, and that `current` round-trips exactly. Verify: `testOnly` green.

## 3. Mutation evidence

- [x] 3.1 Apply `<=` → `<` in `nearestAtOrBefore` and run both specs. Save `mutation-red.txt`, which must show both new tests failing on the decoy pick.
- [x] 3.2 Revert, confirm `git diff --quiet -- backend/src/main`, and re-run green. Save `mutation-green.txt` with the named tests executed, then persist both via `persist-evidence.sh`.

## 4. Full suite

- [x] 4.1 Run `nice -n 19 sbt testFull` (2 workers) and record the pass totals. Report any `FirstRunRoutesSpec` timeout or "Java heap space".
