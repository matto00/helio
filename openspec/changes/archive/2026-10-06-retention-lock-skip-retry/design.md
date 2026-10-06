## Context

See proposal.md (Why). Current code (main 2c1884ac5):
- `OutputHistoryRetentionService.claim(now)` CASes `lastAttempt` to `now` BEFORE calling the repos; due again only at
  `lastAttempt + purgeInterval` (default 60 min). This gives HEL-1272's "a failing purge retries hourly" property.
- `OutputHistoryRepository.thinAndPurge` and `NodePayloadHistoryRepository.purge` each run in one privileged-pool
  transaction gated by `pg_try_advisory_xact_lock(PurgeAdvisoryLockKey)`; on `false` they return `DBIO.successful(0)`,
  indistinguishable from "nothing eligible".
- HEL-1333: `NodePayloadHistoryRepository.writeAction` takes the same key via `pg_try_advisory_xact_lock_shared` just
  before the trim, inside the run's per-node transaction, so retention's exclusive try fails for as long as any run is
  inside that transaction.
- `NodePayloadWiringSpec` (owned by concurrent HEL-1334, must not be edited) constructs the service with the current
  5-arg constructor and asserts `purgeIfDue(...) shouldBe defined`; `OutputHistoryRetentionConfig.fromEnv()` is called
  there too. Both signatures must stay source-compatible.

## Goals / Non-Goals

**Goals:** a lock-held skip is distinguishable from a successful zero-delete pass; a lock-held skip makes the next pass
due after a short retry window; genuine failures keep the full interval; coverage for real thin + age deletes (and the
payload purge) under the guard on the two-role topology.

**Non-Goals:** guaranteeing retention eventually wins against a continuous stream of shared holders; changing the
run-side trim; a migration or cross-instance claim table; the rolling-deploy unguarded-trim window.

## Decisions

### D1. Claim a short retry window (not "don't consume the claim")

Keep the claim-before-call CAS exactly as today (so overlapping callers still run at most one pass and failures keep
the hourly cadence). After the pass completes, if either repo reported lock-not-acquired, shorten the claimed slot so
the next pass is due at `claimedAt + lockRetry` instead of `claimedAt + purgeInterval`.

Alternative rejected — release the claim (reset to the previous value) on a lock-held skip: the next 30 s tick would
retry immediately, so under sustained contention retention would issue a try-lock + transaction every tick — exactly
the per-tick cadence HEL-1272 avoided for failures. A bounded retry window gives a known, configurable upper bound on
retry frequency. (Releasing only after the pass completes would not itself create overlapping passes; the per-tick
cadence is the reason.)

Mechanics: replace `lastAttempt: AtomicReference[Option[Instant]]` with `nextDue: AtomicReference[Option[Instant]]`
(`None` = due). `claim(now)` CASes `prev -> Some(now + purgeInterval)` when `prev.forall(!_.isAfter(now))`. On a
lock-held outcome, `nextDue.compareAndSet(claimedValue, Some(now + lockRetry))` — CAS on the exact value this pass
wrote, so a later claim is never overwritten. Uses the same `now` passed in (fake-clock testable).
`AtomicReference.compareAndSet` compares by reference: `claim` must RETURN the exact `Some(...)` instance it stored
(e.g. `Option[Some[Instant]]`), and the shortening CAS must use that instance. A reconstructed
`Some(now.plus(purgeInterval))` never matches and would silently make the shortening a no-op (C5).
A successful pass (no lock-held part) leaves the full-interval slot in place.

### D2. A distinct repo outcome type, keeping the service's public signature

Add `sealed trait RetentionPassOutcome` in `com.helio.infrastructure.persistence.pipelines` with `Purged(deleted: Int)`
and `LockBusy`. `thinAndPurge` and `purge` return `Future[RetentionPassOutcome]`. Rejected: `Future[Option[Int]]`
(None is ambiguous with "not due" at the service layer) and a parallel `...Outcome` method alongside the old one (two
entry points to keep in sync). Existing test callers (`OutputHistoryRepositorySpec`, `NodePayloadHistoryRetentionSpec`,
`NodePayloadHistoryRlsSpec`, `NodePayloadTrimPurgeLockOrderSpec`, `PipelineSchedulerServiceSpec`'s override) are
updated to `Purged(n)` with the same n, except the HEL-1272 lock-held repo test (`OutputHistoryRepositorySpec`
~:281-295), which now asserts `LockBusy` (its red on main is `0`); `NodePayloadWiringSpec` does not call the repos and
is untouched. The `output-snapshot-history` "History repository primitives" requirement is MODIFIED accordingly.

`purgeIfDue: Future[Option[Int]]` keeps its type: `Some(n)` when the history thin/purge ran (`Purged(n)`); `None` when
not due, failed, or the history part was lock-held. The payload part's outcome affects only the retry schedule (as its
count never surfaced before). Constructor unchanged. `purgePayloads` today swallows its error into `Unit`; it must
instead return a three-way result (failed / `LockBusy` / `Purged`) so D4 can be applied.

Semantic note for `NodePayloadWiringSpec` (not edited): on main a lock-held pass returned `Some(0)`; now it returns
`None`, so its `shouldBe defined` additionally implies the key was free. It stays deterministic: the spec has its own
EmbeddedPostgres (`OutputHistoryApiHarness`), suites run serially in one JVM (`build.sbt`), and the run's payload is
committed before `purgeIfDue` is called — no session holds the key at that point.

### D3. Config: `lockRetry` with a default, env `OUTPUT_HISTORY_LOCK_RETRY_SECONDS`

Add `lockRetry: Duration = Duration.ofSeconds(120)` as the LAST case-class field with a default (source-compatible).
`fromEnv` reads `OUTPUT_HISTORY_LOCK_RETRY_SECONDS` via the existing `positive(...)` helper (default 120) and caps it at
`purgeInterval` (`min`). 120 s = 4 ticks: frequent enough that one hour of contention gives ~30 chances, rare enough
that the try-lock is never per-tick. Documented in CLAUDE.md's env table, including that when the purge interval is
not longer than the retry window the cap makes the retry equal to the interval (no shortening).

### D4. A lock-held skip and a failure in the same pass

If history `thinAndPurge` throws and payload `purge` is `LockBusy`, the failure wins (full interval) — a failure must
never be retried faster than HEL-1272 allows. Lock-held shortens the slot only when no part of the pass failed.

### D5. Tests (all on EmbeddedPostgres, no sleeps; synchronisation on `pg_locks` or held connections)

1. Service, fake clock, retry (`OutputHistoryRetentionServiceSpec`): a separate JDBC connection holds
   `pg_advisory_lock_shared(key)` (session-level, released in `finally`). `purgeIfDue(t0)` → `None`, eligible points
   survive; release; `purgeIfDue(t0 + retry - 1s)` → `None`; `purgeIfDue(t0 + retry)` → `Some(n)` with exact
   survivors; then `purgeIfDue(t0 + retry + interval - 1s)` → `None` and `purgeIfDue(t0 + retry + interval)` runs
   (success restores the full interval). RED PROOF (C5): stash-on-main goes red already at `t0` (main returns
   `Some(0)`), which only proves `LockBusy` is distinguishable. The retry red comes from a MUTATION of the post-fix code
   that keeps `LockBusy` but drops the shortening CAS: the test must then fail at the `t0 + retry` assertion with the
   eligible points still present. Record both.
2. Failure cadence (stub repos that COUNT their invocations; "not run" is asserted by an unchanged count, never by
   `purgeIfDue`'s return value — `None` means both "not due" and "ran and failed"): (a) history stub throws →
   at `t0 + retry` the history and payload counts are unchanged; at `t0 + interval` they increment. RED: a mutation that
   also shortens on failure makes the count increment at `t0 + retry`. (b) D4 combined case — history stub throws,
   payload stub returns `LockBusy` → counts unchanged at `t0 + retry`, increment at `t0 + interval`. RED: a mutation that
   shortens on any `LockBusy` ignoring the failure flag. (c) payload-only `LockBusy` (history stub `Purged`) → counts
   increment at `t0 + retry`. RED: drop the shortening. All three reds are mechanical; no "guard" fallback for these.
   D5.1 cleans the history/payload tables first (the suite shares one DbContext) so its survivor set is exact.
3. Forward direction, two-role topology (new spec `RetentionLockGuardSpec`, modelled on
   `NodePayloadTrimPurgeLockOrderSpec`): a REAL `writeAction` inside an open privileged-pool transaction (held via a
   blocking DBIO step, latch released in `finally`) holds the shared key; the REAL `thinAndPurge` with thin-eligible
   and over-age points (some payload-linked) returns `LockBusy` without waiting and deletes nothing; the REAL `purge`
   returns `LockBusy`; the run commits; then both return `Purged` with the exact hand-derived survivors; the app role
   (`helio_app_test`, no user context) sees none of the rows. Bounded (30 s) `Await`s.
4. Reverse direction, deterministic — the real thin + age deletes under the guard (replaces the earlier race loop):
   seed over-age points linked to payload P_old plus a thin-eligible point X; a third connection holds
   `SELECT ... FOR UPDATE` on X; start the REAL `thinAndPurge` — it takes the exclusive key, runs its age DELETEs
   (row-locking the P_old-linked points), then blocks on X in the `thin` DELETE (order fixed by
   `purgeByAge.flatMap(a => thin...)`); observe in `pg_locks` that its backend holds the advisory lock and waits on a
   not-granted lock; run the REAL `writeAction` whose trim victim is P_old — it must commit within a short bound with
   the trim skipped; release X; retention completes with the exact survivors and no 40P01. RED PROOF: remove the
   run-side shared guard in `insertAndTrim` — the SET NULL cascade then waits on the retention-deleted rows (the
   `writeAction` bound fails, or 40P01). Optionally the same for the real `purge` by row-locking a payload row.
   No bounded race loop; if any is added it is labelled a guard and is in addition to this test.
   Preconditions (assert/document in the test so a fixture tweak cannot make it vacuous): X is thin-eligible but NOT
   age-eligible and NOT linked to P_old; the node has exactly `keep` payloads before the write (`keep = 1`), so P_old is
   the trim victim; the P_old-linked points are age-eligible under the caps passed. Green path asserts payload count
   `keep + 1` (trim skipped). Runs as `helio_privileged` on the two-role setup. Red is recorded as the `writeAction`
   bound failing (a wait, no cycle), not a 40P01.

## Risks / Trade-offs

- [Continuous shared holders still starve retention] → retries every 2 min instead of 60; residual noted as follow-up.
- [Another instance's retention also yields `LockBusy`] → a redundant cheap pass 2 min later, then the interval.
- [Exclusive try-lock checks queued waiters too] → irrelevant: neither side ever queues (both try).

## Migration Plan

None. Code only; rollback = revert. New env var optional.

## Planner Notes

- Self-approved: retry default 120 s, env var name, ADT name; no escalation (no dependency/API/migration change).
- Driver constraints are binding: no edits to NodePayloadWiringSpec/ci.yml/playwright.config.ts/.gitignore.
