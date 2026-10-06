# Red/green evidence (HEL-1343)

Every red is a mutation of the POST-fix code (never a compile failure); each mutation was reverted and the
suite re-run green (see the final `sbt testFull`). Raw logs: scratchpad `m*-red.log`, `guard-green.log`.

| Task | Mutation applied (post-fix code) | Failing assertion | Green after revert |
|---|---|---|---|
| 3.1 `OutputHistoryRepositorySpec` HEL-1272 lock-held test | `OutputHistoryRepository.thinAndPurge` try-lock-false branch returns `Purged(0)` | `Purged(0) was not equal to LockBusy (OutputHistoryRepositorySpec.scala:289)` | yes |
| 3.2 / D5.1-t0 (`OutputHistoryRetentionServiceSpec`) | same mutation as 3.1 | `Some(0) was not equal to None (OutputHistoryRetentionServiceSpec.scala:146)` | yes |
| 3.2 retry | service drops the shortening CAS (`nextDue.compareAndSet(claimed, ...)` -> `nextDue.get()`) | `None was not equal to Some(2) (OutputHistoryRetentionServiceSpec.scala:154)` (the `t0 + retry` step) | yes |
| 3.3a history failure stays hourly | `if (busy && !failed)` -> `if (busy \|\| failed)` (also shortens on failure) | `(2, 2) was not equal to (1, 1) (...ServiceSpec.scala:204)` | yes |
| 3.3b failure + payload LockBusy | `if (busy && !failed)` -> `if (busy)` (ignores the failure flag) | `(2, 2) was not equal to (1, 1) (...ServiceSpec.scala:211)` | yes |
| 3.3c payload-only LockBusy | drop the shortening CAS (as 3.2) | `(1, 1) was not equal to (2, 2) (...ServiceSpec.scala:219)` | yes |
| 3.5 forward (history), cycle 2, fixed test, 2/2 runs | `thinAndPurge` false branch -> `Purged(0)` | `Purged(0) was not equal to LockBusy (RetentionLockGuardSpec.scala:210)` | yes |
| 3.5 forward (payload), cycle 2, 2/2 runs | `purge` false branch -> `Purged(0)` | `Purged(0) was not equal to LockBusy (RetentionLockGuardSpec.scala:211)` | yes |
| 3.5 forward (run-side), cycle 2, 2/2 runs | remove the `insertAndTrim` shared try-lock (`insert.andThen(trim)`) | `timed out waiting for: the run holds a granted shared advisory lock on the retention key` (new pg_locks wait, :142) | yes |
| 3.6 reverse | same run-side guard removal | `the run's writeAction must commit promptly (trim skipped) while retention holds the key: false was not equal to true (RetentionLockGuardSpec.scala:250)` (a wait, no cycle) | yes |

The advisory key literal is not duplicated: tests use `RetentionLockKey.value` (persistence-package test helper)
for the service/guard specs; the pre-existing HEL-1272/HEL-1333 specs keep their existing references.

## Cycle 2 (final-gate skeptic CR1-3)

The earlier forward test was racy (`hold`'s Future started when defined, so `reached` fired before the run took the
shared key; the unmodified test failed 2 of 3 solo runs with `Purged(2)`), so the cycle-1 3.5 rows were removed.
Fix: `hold` is now lazy (`DBIO.successful(()).flatMap(_ => DBIO.from(Future {...}))`), and after `reached` the test
polls `pg_locks` (bounded 30 s) for a GRANTED advisory `ShareLock` on `RetentionLockKey.value` before retention runs.
Stability: `RetentionLockGuardSpec` run alone, unmodified, 6 times in a row, all green (3 tests each; logs
`stable-1..6.log`). Each 3.5 red above reproduced 2/2 (logs `c2m35{a,b,c}-{1,2}-red.log`) and differs from the
unmutated outcome. The run-side mutation also reds the 3.6 reverse test (`...must commit promptly...: false was not equal to true`).
Also added: an in-spec assertion that the privileged pool is rolsuper=false/rolbypassrls=true and the app pool
rolsuper=false/rolbypassrls=false.
