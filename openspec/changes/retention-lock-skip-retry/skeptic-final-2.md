## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `2759d02b6337aae59652f255d4ea20155c771b54` (82a82da84 + 2759d02b6). The base was resolved live by `resolve-review-base.sh` as `2c1884ac5b2cc2578320ace4a21e37b32df5c603`. The spawn guard printed `READY ambient=/home/matt/Development/helio branch=bug/retention-lock-skip-retry/HEL-1343`. The branch is one commit behind `origin/main` (a5a2fa2ce, HEL-1334). `git merge-tree --write-tree HEAD origin/main` reports a clean merge. `NodePayloadWiringSpec` on main (in the `api` package) does not call the changed repository signatures.

### What I verified (with evidence)

- **Hard constraints.** `git diff 2c1884ac5...HEAD --name-only` contains no migration and none of `NodePayloadWiringSpec`, `ci.yml`, `playwright.config.ts` or `.gitignore` (zero grep hits). The constructor, `purgeIfDue: Future[Option[Int]]` and `fromEnv()` stay source-compatible (C2). `lockRetry` is the last field and has a default.
- **Production code, read in full in the diff.**
  - `claim()` returns the exact `Some` it stored.
  - The shortening is `nextDue.compareAndSet(claimed, Some(now.plus(lockRetry)))`, gated on `busy && !failed`.
  - Both repositories map the try-lock `false` result to `LockBusy` and the run result to `Purged(n)`.
  - `fromEnv` falls back to 120 when the value is `<1` or non-numeric, and caps it at `purgeInterval`.
  - The only production callers of `thinAndPurge`/`purge` are the service (`grep` of `backend/src/main`).
- **AC1: retry window, and why.** D1 claims a short window instead of releasing the claim. The reason is that releasing it would retry on every 30 s tick under sustained contention. That reasoning is sound and it is stated in design.md D1 and in the CLAUDE.md env row. The CAS on the exact stored instance cannot overwrite a later claim.
- **HEL-1272 property: a genuine failure retries hourly.** It is preserved: `failed` blocks the shortening. The cadence stubs count invocations (C5). The round-1 skeptic reproduced the `busy || failed` and `busy` mutation reds (`(2, 2) was not equal to (1, 1)`). The code is unchanged since round 1 apart from the test file (`git show --stat 2759d02b6` touches only RetentionLockGuardSpec and the evidence/doc artifacts).
- **AC2: skipped once, then succeeds within the window.** Covered by `OutputHistoryRetentionServiceSpec` "retry a lock-held skip after the short window". It holds a real shared session lock, expects `None` with 3 points kept, `None` at retry-1s, `Some(2)` at retry, and then a full interval again. It uses a FakeClock and explicit instants, with no wall-clock timing.
- **Round-1 CR1 (racy forward test) is fixed.** `RetentionLockGuardSpec.scala:195` is now lazy: `DBIO.successful(()).flatMap(_ => DBIO.from(Future {...}))`. `:207` adds a bounded `pg_locks` wait for a granted `ShareLock` on `RetentionLockKey.value` before retention is invoked. The test is now self-checking, because even an eager hold could not let retention run before the shared key is held.
- **Stability: I ran the spec alone 3 times on unmodified HEAD.** All 3 passed with `Tests: succeeded 3, failed 0`. Together with the executor's 6 recorded runs, this is consistent with the race being closed.
- **Re-applied 3.5 mutation A: `thinAndPurge` false branch returns `Purged(0)`.** Ran 2 of 2 times; both were red at `Purged(0) was not equal to LockBusy (RetentionLockGuardSpec.scala:210)`. This is deterministic and differs from the unmutated green. Reverted.
- **Re-applied 3.5 mutation B: removed the `insertAndTrim` shared try-lock (`insert.andThen(trim)`).** Red at `timed out waiting for: the run holds a granted shared advisory lock on the retention key ... (RetentionLockGuardSpec.scala:142)`. The 3.6 reverse test was also red: `the run's writeAction must commit promptly (trim skipped) while retention holds the key: false was not equal to true (RetentionLockGuardSpec.scala:269)`. Reverted; `git status --short` is empty afterwards.
- **AC3: thin and age deletes under the guard.**
  - Forward: real `thinAndPurge` with an age-eligible A and a thin-eligible B1, plus a payload purge, both give `LockBusy` while the run is open. After commit they give exactly `Purged(2)` (A, B1) and `Purged(3)` (pAged, pThin, pOrph).
  - Reverse: a real `thinAndPurge` parked mid-transaction after its age deletes, confirmed in `pg_locks` (exclusive advisory lock held plus a lock wait that is not granted). The run commits with the trim skipped, and the pass then completes with `Purged(3)`.
- **Two-role RLS and privileged-pool proof.**
  - `:160-166` asserts privileged = `(helio_privileged, rolsuper=false, rolbypassrls=true)` and app = `(helio_app_test, false, false)`, which closes round-1 note 2.
  - All repository work runs through `DbContext(appDb, privilegedDb)`.
  - The app pool counts 0 rows while the privileged pool deletes exact counts.
- **Other timing-dependent assertions.**
  - Fixtures are relative to an hour-truncated `t0` taken once per spec instance. The run's own points use `Instant.now()`, which is after `t0` and only touches a separate output and pipeline, so the exact counts do not depend on the clock.
  - The 5-minute bucket for t0-4m and t0-3m is deterministic because `t0` is hour-aligned.
  - The one remaining wall-clock bound is the reverse test's `Await.ready(write, 10.seconds)`. A correct trim skip commits in milliseconds and the failure mode blocks indefinitely, so this is a generous timeout rather than a race (see note 1).
  - The service and cadence specs use only FakeClock instants.
- **Full suite.** I ran `nice -n 19 sbt testFull`: exit 0, `Tests: succeeded 6038, failed 0`, `Suites: completed 427, aborted 0`. NodePayloadWiringSpec, RetentionLockGuardSpec and OutputHistoryRetentionServiceSpec all ran. The log has zero "Java heap space" lines and no FirstRunRoutesSpec timeout. Local grouping runs one forked group at a time (`HEL924_TEST_GROUP_CONCURRENCY` unset), which is within the 2-worker cap. `sbt --client shutdown` printed "no sbt server is running".
- **No gate defect.** No report in this chain discloses unsound evidence mtimes, and nothing in my verdict rests on mtime ordering. It rests on assertion messages and line numbers that I reproduced myself.

### Verdict: CONFIRM

### Non-blocking notes
1. The reverse test's 10 s `Await.ready` bound (`RetentionLockGuardSpec.scala:264`) is the only wall-clock bound left. It can only produce a false red under extreme load; it can never produce a false green.
2. `red-green-evidence.md` still cites the 3.6 failure at `RetentionLockGuardSpec.scala:250`. After the cycle-2 edits it is `:269`. The message is identical. This is cosmetic.
3. The service-level retry test (3.2) exercises thinning only and runs on the single (superuser) test pool. Age-under-guard and the two-role topology are covered at repository level in RetentionLockGuardSpec, so together the ACs are met.
4. As the ticket notes, the rolling-deploy window of the unguarded trim on old instances is out of scope (design Non-Goals).
