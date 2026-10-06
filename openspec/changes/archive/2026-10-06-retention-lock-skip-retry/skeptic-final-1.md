## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `82a82da848b35606efc058179de24b2d22c31a2e` against live-resolved base `2c1884ac5b2cc2578320ace4a21e37b32df5c603`. Spawn guard: `READY ambient=/home/matt/Development/helio branch=bug/retention-lock-skip-retry/HEL-1343`.

### What I verified (with evidence)

- **Constraints.** `git diff --name-only` contains no migration and none of `NodePayloadWiringSpec`, `ci.yml`, `playwright.config.ts`, `.gitignore`. The constructor, `purgeIfDue: Future[Option[Int]]` and `fromEnv()` are source-compatible: `lockRetry` is the last field and has a default.
- **Production code (read in full).** `claim()` returns the exact `Some` it stored (`OutputHistoryRetentionService.scala`, `claim`). The shortening is `nextDue.compareAndSet(claimed, Some(now.plus(lockRetry)))`, gated on `busy && !failed`, so a failure wins (D4). Both repos map try-lock false to `LockBusy`. `fromEnv` caps `lockRetry` at the interval. The code is correct.
- **Retry-window choice (AC1).** The D1 argument holds. Releasing the claim would make every 30 s tick retry under sustained contention, and a CAS-shortened slot bounds retries to one every `lockRetry`. The CAS on the stored instance cannot overwrite a later claim.
- **HEL-1272 "failure retries hourly".** This property survives. I re-ran the reds myself on the post-fix code and reverted each one:
  - `busy && !failed` → `busy || failed`: red at `OutputHistoryRetentionServiceSpec.scala:204` and `:211`, `(2, 2) was not equal to (1, 1)`.
  - `busy && !failed` → `busy`: red at `:211` only.
  - The assertions use invocation counts, not `purgeIfDue`'s return (C5).
- **Mutation: thinAndPurge false → `Purged(0)`.** I ran this on 3 suites and reverted it. Red at `OutputHistoryRepositorySpec.scala:289` (`Purged(0) was not equal to LockBusy`) and `OutputHistoryRetentionServiceSpec.scala:146` (`Some(0) was not equal to None`), and red at `RetentionLockGuardSpec.scala:191` with **`Purged(2)`**. See the defect below.
- **Green baseline.** 5 targeted suites, 42 tests, exit 0. This includes the reverse (3.6) test, which synchronises correctly: it polls `pg_locks` for a granted exclusive advisory lock plus a not-granted wait.
- **Two-role proof.** V34 creates `helio_privileged BYPASSRLS NOLOGIN`, which is non-superuser by default. V115 and V116 `FORCE ROW LEVEL SECURITY`. `helio_app_test` is created `NOSUPERUSER`. The privileged pool deletes exact counts while the app pool counts 0, so RLS is genuinely in effect for one role and bypassed for the other. This is genuine, but see note 2.

### DEFECT: the forward two-role test (task 3.5) passes or fails by thread timing; it is not a proof

`RetentionLockGuardSpec.scala:178`:
```scala
val hold = DBIO.from(Future { blocking { reached.countDown(); release.await(30, TimeUnit.SECONDS) } })
```
Scala's `Future { ... }` starts running as soon as it is created. So `reached` fires when `hold` is *defined*, before the run's transaction has run `writeAction` or taken the shared key. The test then calls `thinAndPurge` while racing the run's `pg_try_advisory_xact_lock_shared`. That breaks the design's D5 rule that tests synchronise "on `pg_locks` or held connections", and the D5.3 claim that the run "holds the shared key" when retention is invoked.

Reproduced. The probes below were temporary, the scratch edits were reverted, and the final `git status` showed only the untracked `evaluation-1.md`.
1. **Probe after `reached.await`**, counting granted `ShareLock` advisory rows on the key: `sharedHeldAtReached=0 runFutureCompleted=false` in 3/3 runs. Ref: `/home/matt/Development/helio/.concertino/runs/HEL-1343/evidence/.skeptic-evidence/sk-probe1.log`.
2. **Probe immediately before line 191:** `advisory=` (no advisory lock held at all) in both green and mutated runs. Refs: `.../sk-probeG.log`, `.../sk-probeM.log`.
3. **The UNMODIFIED committed test at HEAD**, run alone 3 times: pass, **FAIL**, **FAIL**, both failures `Purged(2) was not equal to LockBusy (RetentionLockGuardSpec.scala:191)`. Refs: `.../sk-green-solo2.log`, `.../sk-green-solo3.log`. Retention won the race, took the key exclusively, and deleted A and B1 while the run's transaction was open.

Consequences:
- The green is luck. Run with other suites (`testFull`, the evaluator's run, my 5-suite baseline) the test happened to pass. Run alone it fails 2 of 3 times, and CI timing differs again.
- **The 3.5 red evidence is not attributable.** The rows "3.5 forward (history)" and "3.5 forward (run-side)" in `red-green-evidence.md` record `Purged(2) ... :191`, which is exactly the race outcome the *unmutated* code also produces. The evaluator saw `Purged(0)` for the same mutation; the executor and I saw `Purged(2)`. That disagreement was not a transcription error. It was this race showing up, and the evaluator's suggestion to "correct" it to `Purged(0)` would have hidden the defect.
- AC3 ("coverage of the thin and age deletes under the guard") is genuinely met only by the reverse test (3.6). The forward direction is coverage in shape only.

### Verdict: REFUTE

### Change Requests

1. **`RetentionLockGuardSpec.scala:178`: make `hold` lazy**, so it executes only when the DBIO chain reaches it. For example, use `DBIO.successful(()).flatMap(_ => DBIO.from(Future { blocking { ... } }))` or a `SimpleDBIO` that blocks on the latch. **Additionally**, after `reached.await`, wait with the existing bounded `awaitCondition` on `pg_locks` until a granted `ShareLock` advisory row on `RetentionLockKey.value` exists, before calling `thinAndPurge` at :191. That is the `pg_locks` synchronisation D5 promises, and it is self-checking.
2. **Show the fix is stable.** Run `RetentionLockGuardSpec` alone, unmodified, at least 5 times in a row, all green, and record the result. A single green is what the current version also produces.
3. **Re-record the three 3.5 reds in `red-green-evidence.md` against the fixed test**, with the actual failing message each mutation produces:
   - false → `Purged(0)` for `thinAndPurge`: expected `Purged(0) was not equal to LockBusy (:191)`.
   - The same mutation for `purge`.
   - Removal of the `insertAndTrim` shared try-lock: with the lock-held wait in CR1 in place, this should now fail at the new `pg_locks` wait, not at :191. Record whatever it actually is.

   Each red must be deterministic (reproduce at least twice) and must differ from the unmutated outcome.

### Non-blocking notes

1. The evaluator's suggestion to correct the "3.5 forward (history)" message to `Purged(0)` should not be applied as a wording fix. Once CR1 lands, the message will naturally be `Purged(0)`. Recording it before then would certify a racy red.
2. The evaluator's other suggestion is worth taking while the spec is open, but it is not blocking. `RetentionLockGuardSpec` does not assert `rolsuper=false` / `rolbypassrls` for its two pools, as `NodePayloadTrimPurgeLockOrderSpec` does. The proof is genuine today through V34 (`CREATE ROLE helio_privileged BYPASSRLS NOLOGIN`) plus the exact-count-versus-0 contrast. But a superuser privileged pool would also pass, so an in-spec assertion would make it fixture-proof.
3. The 3.6 reverse test, the service retry test (3.2) and the cadence tests (3.3a/b/c) are sound. Their reds are mechanical and I reproduced them (3.3a/b myself, 3.2/3.6 per the evaluator, and 3.1 and D5.1-t0 myself).
4. `testFull` was not re-run by me. It is moot until CR1 lands, and the executor's re-run will supersede it. No FirstRunRoutesSpec timeout or "Java heap space" appeared in any of my targeted runs.
5. No gate defect: no report in this chain claims unsound evidence mtimes, and none of my conclusions depend on mtime ordering. They rest on pasted assertion messages and probe output.
