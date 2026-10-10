## Standing Constraints

- [C1] Outside `VerifiedEmbeddedPostgres.scala`, `VerifiedEmbeddedPostgresSpec.scala` and `EmbeddedPostgresStartGuardSpec.scala`, every backend file change is produced by the codemod and proven byte-equal under the inverse transform by the independent verifier. No hand edits.
- [C2] No role name, grant, `SET ROLE`, BYPASSRLS property or `IF NOT EXISTS` DO-block changes anywhere.
- [C3] Every test-run verdict is judged from its log (grep `TESTS FAILED`, `*** FAILED`, `RUN ABORTED`, `*** ABORTED`), never from the exit code alone (HEL-1468).
- [C4] Local resource caps: `nice -n 19`, ≤4 concurrent workers, `-J-Xmx3g` on own sbt invocations; check available memory before commits (wait if under ~15 GB); shut down every sbt server started; never pkill/pgrep/killall.
- [C5] Loop and parity proofs run with `HEL924_TEST_GROUP_CONCURRENCY=2` and `HEL924_TEST_GROUP_COUNT=4` (no shard env), and each loop iteration shows ≥1 overlapping suite pair from DIFFERENT forked groups via JUnit XML timestamps (design-gate rounds 1 and 3).

## 1. Reproduce and confirm the zonky facts

- [x] 1.1 Re-verify design.md Context's zonky facts against the 2.0.7 source jar (builder mutation, unchecked pg_ctl exit, port-only readiness, `setPort(0)`, `close()` addressing only its own data dir). Verify by quoting the source lines in the transcript.
- [x] 1.2 Write `VerifiedEmbeddedPostgresSpec` step 2 first (old direct path pinned to cluster A's port reports A's `data_directory`) and run it. Verify it passes, which demonstrates the silent attach deterministically, with the log captured.

## 2. Helper

- [x] 2.1 Implement `com.helio.testkit.VerifiedEmbeddedPostgres.start` per design D1–D4 (by-name builder, own data dir with the temp-dir-hygiene escape hatch, `SHOW data_directory` real-path comparison, discard-without-touching, bounded retry on mismatch only, loud exhaustion error). Verify that it compiles and that `check:test-temp-dir-hygiene` passes.
- [x] 2.2 Complete `VerifiedEmbeddedPostgresSpec` steps 3–5 (incl. the failed-check path via the `observeDataDirectory` seam): the helper lands on its own cluster on a new port, A is alive with its marker intact, and exhaustion throws naming both dirs. Verify it is green. Then show the mutation red: disable the comparison, step 3 fails; revert.

## 3. Guard (red first)

- [x] 3.1 Implement `EmbeddedPostgresStartGuardSpec` per D7 (non-vacuity, positive and negative pattern cases, per-line exemption marker). Run it BEFORE the migration. Verify it is red and lists the unmigrated files.

## 4. Mechanical migration

- [x] 4.1 Write `migrate-embedded-postgres.py` (D5) in this change dir and run it with the worktree as cwd. Verify it transformed all 226 occurrences in 221 files and exited 0 with no refusals.
- [x] 4.2 Write `verify-embedded-postgres-migration.py` (D5, independent of the codemod) and run it against the merge base. Verify it reports byte-equality under the inverse transform for every changed file, an exact changed-file set, 226 wrapped and 0 unwrapped occurrences, and one import per non-testkit file, and save its transcript.
- [x] 4.3 Re-run the guard. Verify it is green. Run `npm run check:scala-quality`, `npm run check:test-temp-dir-hygiene` and the repo's formatting checks. Verify they pass (any line-length rejection is handled via D5's rule, never by hand edits).

## 5. Proof

- [x] 5.1 RLS mutation: add `BYPASSRLS` to `OutputHistoryApiHarness`'s role temporarily. Verify `OutputHistoryRoutesSpec` and `OutputHistoryPayloadRoutesSpec` go red on `assertAppPoolEnforcesRls`, then revert and verify it is green (transcript only).
- [x] 5.2 Full-suite parity: `testFull` on base and on branch, each a fresh sbt JVM with the C5 env and a freshly emptied report dir; per-suite table from JUnit XML plus log-only aborts (D8, including its pre-decided flake handling). Verify the per-suite results diff is empty except for the two new specs, judged by log.
- [x] 5.3 Loop: record `show Global/concurrentRestrictions` (must show `Limit forked-test-group to 2`), then 30 iterations of the D8 fully-qualified suite set, each a fresh sbt JVM with a freshly emptied report dir, each meeting D8's positive-evidence and cross-group-overlap (end-based window, >1 s) checks, with `HEL924_TEST_GROUP_CONCURRENCY=2 HEL924_TEST_GROUP_COUNT=4` under `nice -n 19` (C5). Verify zero `TESTS FAILED`/`*** FAILED`/`RUN ABORTED`/`*** ABORTED` lines across all iteration logs, with a per-iteration summary saved.
- [x] 5.4 Write `files-modified.md` and commit (`HEL-1445 ...`). Verify the pre-commit hooks passed with no bypass.
