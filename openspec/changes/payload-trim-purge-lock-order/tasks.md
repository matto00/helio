## Standing Constraints

- [C1] Deadlock/regression specs bound every run-side Future with a timeout and make retention-connection cleanup (finish/rollback, await the Future) unconditional, so the red-without-fix run is a clean assertion failure, never a hung pool; cascade lock order (ctid) is asserted empirically, never assumed.
- [C2] Lower deadlock_timeout (e.g. 100ms) on the test sessions as the superuser before SET ROLE; proofs still run as helio_privileged / helio_app_test, never as superuser.

## 1. Backend

- [x] 1.1 In `NodePayloadHistoryRepository.insertAndTrim`, guard the trim with `pg_try_advisory_xact_lock_shared(OutputHistoryRepository.PurgeAdvisoryLockKey)` taken after the INSERT; skip (debug log) on false; update the scaladoc of `writeAction`/`purge` to state the lock contract; verify `sbt compile` passes
- [x] 1.2 Confirm no other run-side statement in the node tx locks rows the retention pass locks (read overwriteRowsAction, insertAction, writeAction); record the statement list in files-modified.md

## 2. Tests

- [x] 2.1 Add a two-role EmbeddedPostgres probe spec that reproduces the deadlock with the pre-fix trim SQL on two connections and asserts SQLSTATE 40P01; verify it passes
- [x] 2.2 Add the regression test driving the real `writeAction` while a retention-shaped tx holds the key and a linked point; assert the run commits without waiting, retention commits without error, count = keep+1, then `purge` -> keep; verify it passes
- [x] 2.3 Revert task 1.1 locally, run the regression spec, capture the red transcript as evidence, restore the fix and re-run green
- [x] 2.4 Add positive controls: write-time cap still enforced with no retention tx; two concurrent writes both trim; verify pass
- [x] 2.5 Add role assertions (current_user, rolsuper=false, no superuser proof, app role cannot see stranger rows); verify pass
- [x] 2.6 Run `nice -n 19 sbt testFull` (2 workers, timeout 600000) and confirm green; report any FirstRunRoutesSpec timeout or "Java heap space"
