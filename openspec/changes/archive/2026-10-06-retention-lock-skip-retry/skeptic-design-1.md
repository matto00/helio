## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD 2c1884ac5b2cc2578320ace4a21e37b32df5c603 (planning artifacts are uncommitted, untracked in
`openspec/changes/retention-lock-skip-retry/`). No sbt run (design gate, no code yet).

### What I verified (with evidence)

- **Design "Context" claims match the code.**
  - `OutputHistoryRetentionService.scala:34,61-65`: `lastAttempt` is CASed to `Some(now)` in `claim` BEFORE the repo
    call; due again at `lastAttempt + purgeInterval`. Correct.
  - `OutputHistoryRepository.scala:153-159` and `NodePayloadHistoryRepository.scala:178-184`: one
    `withSystemContext(...transactionally)` gated by `pg_try_advisory_xact_lock(PurgeAdvisoryLockKey)`, `false` gives
    `DBIO.successful(0)`. That cannot be told apart from "nothing eligible". Correct.
  - `NodePayloadHistoryRepository.scala:117-123`: `writeAction` → `insertAndTrim` takes
    `pg_try_advisory_xact_lock_shared` just before the trim, inside the caller's transaction. Correct.
  - `NodePayloadWiringSpec.scala:131-142`: uses the 5-arg ctor and `OutputHistoryRetentionConfig.fromEnv()`, and
    asserts `purgeIfDue(...) shouldBe defined`. It does not call either repo directly. Correct.
- **(d) Source compatibility of NodePayloadWiringSpec.** The ctor is unchanged, `purgeIfDue: Future[Option[Int]]` is
  unchanged, and `fromEnv(env = sys.env)` is unchanged. Adding `lockRetry` as the last case-class field with a default
  breaks no test: `grep` finds no positional `OutputHistoryRetentionConfig(...)` construction or pattern match in
  `src/test`, because every caller uses `fromEnv`. The spec will compile untouched.
  - Semantic change: on main a lock-held pass returns `Some(0)`, and after D2 it returns `None`. So `shouldBe defined`
    now also requires the key to be free.
  - Risk is low. The spec gets its own EmbeddedPostgres (`OutputHistoryApiHarness.scala:68`), suites in a JVM run
    serially (`build.sbt:107`), and the run's payload is committed before `purgeIfDue` (`payloadCount shouldBe 1`).
    See the note below.
- **Other callers that D2 must update** (grep for `thinAndPurge(` / `.purge(` / `purgeIfDue`):
  - `OutputHistoryRepositorySpec` (12 sites, including the HEL-1272 lock-held test at :280-293 that asserts `0`)
  - `NodePayloadTrimPurgeLockOrderSpec:259`
  - `NodePayloadHistoryRlsSpec:178`
  - `NodePayloadHistoryRetentionSpec:27`
  - `PipelineSchedulerServiceSpec:292` (override signature)

  The task list (3.1) names all of them. `OutputHistoryRetentionPrivilegedSpec:94` (`Some(2)`) and
  `OutputHistoryRetentionServiceSpec:107/115/118/125` keep their meaning under the `nextDue` scheme.
- **(a) D1 mechanics are sound.**
  - `claim`: CAS `prev -> Some(now+interval)` when `prev.forall(!_.isAfter(now))`. This is equivalent to main's
    `!last.plus(interval).isAfter(now)`, so `nextDue == now` counts as due. The boundary `t0+retry` is due and
    `t0+retry-1s` is not.
  - Overlapping callers with the same `now` see `nextDue > now` for the whole pass, so at most one pass runs. The
    8-caller test at `OutputHistoryRetentionServiceSpec:122-127` still holds.
  - The shortening happens only after the pass completes, and it uses CAS on the value this pass wrote. A later claim
    (a caller with a later `now`, which is possible today too) is never overwritten.
  - D4 (failure beats LockBusy) keeps HEL-1272's hourly retry for real failures, and D3's `min(lockRetry, purgeInterval)`
    cap means a retry is never later than the normal interval.
  - Rationale: the main reason for rejecting "release the claim" (sustained contention would retry on every 30 s tick)
    is correct. The second reason ("reopens the door for an overlapping caller") is weak. A release done after the
    pass completes does not create overlap. See the note below.
- **(e) No migration.** Nothing in the plan touches `db/migration`. Correct.
- **(b) The red claim in D5.1 is inaccurate.** On main, `purgeIfDue(t0)` with the key held returns `Some(0)`, not
  `None`: `thinAndPurge` returns 0 and the service wraps it in `Option(deleted)`, `OutputHistoryRetentionService.scala:44-47`.
  So the stash-based "red on main" fails at the first assertion (`t0`). It never reaches the `t0 + retry` step, which
  the design's parenthetical names as the red ("main returns None at t0+retry"). → CR1.
- **(b)/(c) D5.3 vs D5.4.**
  - D5.3 covers only the forward direction: a run holds the shared key and the real `thinAndPurge`/`purge` skip.
  - HEL-1333's regression (`NodePayloadTrimPurgeLockOrderSpec:228-265`) covers the reverse direction, but retention
    there is a raw-connection single-point delete (`:132-140`, `:230-248`). That is exactly the gap the ticket names.
  - D5.4 drops the reverse direction with the real thin and age deletes. Its reason is "cannot pause the real
    retention mid-transaction deterministically", and that premise is false. → CR2.
- **Contract coverage.** `openspec/specs/output-history-retention/spec.md:9-23` requires retention "at most once per
  configured purge interval". Its scenario "Second tick within the interval is a no-op" is also affected. The delta only
  ADDs requirements, so after archive the capability spec contradicts itself. → CR3.

### Verdict: REFUTE

The core design (D1–D4) is sound and implementable. The refutation is about the test plan and the spec delta, which
are cheap to fix now and expensive to discover at the final gate.

### Change Requests

1. **D5.1 / task 3.2: make the red proof exercise the retry, not the return-type change.** Stash-on-main goes red at
   `purgeIfDue(t0)` (main returns `Some(0)` there), not at `t0 + retry` as the design states. That proves only that
   LockBusy is now distinguishable. It does not prove that the pass retries soon.
   - Fix the parenthetical in design.md.
   - Require the red evidence for the retry step to come from a mutation of the post-fix code: keep `LockBusy` but drop
     the shortening (do not CAS to `now + lockRetry`). The test must then fail at the `t0 + retry` assertion, with
     eligible points still present.
   - Likewise, task 3.3's "failure still hourly" must be shown red under a mutation that also shortens on failure.
     Otherwise it is a guard and must be labelled as one (C4).
   - Also assert the slot after the successful retry: not due at `t0 + retry + interval - 1s`, due at
     `t0 + retry + interval`. This proves a success restores the full interval.
2. **Replace D5.4's bounded loop (task 3.6) with a deterministic test that pauses the real retention mid-transaction.**
   - The premise "cannot pause the real retention mid-transaction deterministically" is wrong. Steps:
     1. Seed over-age points linked to payload P_old, plus a thin-eligible point X.
     2. A third connection holds `SELECT ... FOR UPDATE` on X.
     3. Start the REAL `thinAndPurge`. It takes the exclusive key, runs its age DELETEs (row-locking the P_old-linked
        points), then blocks on X in the `thin` DELETE. This order is fixed by `OutputHistoryRepository.scala:154`,
        `purgeByAge.flatMap(a => thin...)`.
     4. Observe in `pg_locks` that the retention backend holds the advisory lock and is waiting on a not-granted lock.
     5. Run the REAL `writeAction` whose trim victim is P_old. It must commit within a short bound with the trim skipped.
     6. Release X. Retention completes with the exact survivor set, with no 40P01.
   - This is HEL-1333's regression with real thin and age deletes instead of a single-point delete, which closes the gap
     the ticket names. It must be shown red by removing the run-side shared guard in `insertAndTrim`: the
     `SET NULL` cascade then waits on the retention-deleted rows.
   - Optionally do the same for the real `NodePayloadHistoryRepository.purge`, by row-locking a payload row.
   - A 20-iteration race loop almost never hits the window, so it would pass almost vacuously. If kept at all, label it
     as a guard in addition to this test, never instead of it. Use bounded `Await`s and the two-role topology, as D5.3
     does.
3. **Spec delta must MODIFY the existing requirement, not only ADD.**
   - In `specs/output-history-retention/spec.md`, add a `## MODIFIED Requirements` entry for "Tiered time-bucket
     retention on the scheduler tick". Its "at most once per configured purge interval" must allow the lock-held retry,
     e.g. "...at most once per configured purge interval, except that a pass skipped because the retention lock was
     held is retried after the lock retry window".
   - Restate its scenarios so "Second tick within the interval is a no-op" still reads correctly ("after a purge that
     ran").
   - Without this, the archived capability spec states two contradictory cadences.

### Non-blocking notes

- **`AtomicReference.compareAndSet` uses reference equality.** The shortening CAS must use the exact `Some(...)`
  instance that `claim` stored, for example by having `claim` return it. A reconstructed
  `Some(now.plus(purgeInterval))` never matches, and the shortening silently becomes a no-op. CR1's mutation-red test
  would catch this, but state it in design.md D1 so the executor does not learn it the hard way.
- **D1 rationale:** "reopens the door for an overlapping caller" holds only if the release happens before the pass
  completes. Lead with the per-tick retry argument (correct), and drop or qualify the overlap argument so the PR body
  does not carry a wrong rationale.
- **NodePayloadWiringSpec:** state in design.md that its `shouldBe defined` now also implies the key was free (D2
  semantic change), and why it is still deterministic: per-suite EmbeddedPostgres, serial suites, run committed first.
  This way a future flake there is diagnosable without re-deriving it.
- **D4 needs payload-failure tracking.** Today `purgePayloads` swallows its error into `Unit`
  (`OutputHistoryRetentionService.scala:56-59`). The implementation must carry a failed/LockBusy/Purged outcome out of
  it. Task 2.2 should say so explicitly.
- **D5.3's "blocking DBIO step released by a latch"** blocks a Slick async-executor thread. That is fine with the
  existing pool sizes, but release the latch in a `finally` so a failed assertion does not hang the suite until the
  30 s bound.
