## Standing Constraints

- [C1] No Flyway migration; code only.
- [C2] Do not edit `NodePayloadWiringSpec`, `ci.yml`, `playwright.config.ts`, `.gitignore`; `OutputHistoryRetentionService`'s constructor and `purgeIfDue: Future[Option[Int]]` and `OutputHistoryRetentionConfig.fromEnv()` stay source-compatible.
- [C3] `nice -n 19 sbt testFull` (Bash timeout 600000, at most 2 workers); EmbeddedPostgres only; never `pkill`/`pgrep`/`killall` — recorded PIDs only; `sbt --client shutdown` as its own Bash call.
- [C4] Every red/green claim is shown red on the pre-fix code (stash or mutation) and green after; guards are labelled as guards.
- [C5] Retry red proof via a mutation of the post-fix code that drops the shortening CAS; failure-hourly red via a mutation that also shortens on failure, asserted by stub invocation counts (never `purgeIfDue`'s return); the shortening CAS uses the exact instance `claim()` stored.
- [C6] A compile failure is never a red. Reds are mutations of the POST-fix code: 3.1/D5.1-t0 via mapping the try-lock-false branch to `Purged(0)`; 3.5 via removing the `insertAndTrim` shared try-lock or mapping false→`Purged(0)` (name which + the failing assertion); record reds for 3.1, 3.2, 3.3 (a,b,c), 3.5, 3.6. Do not duplicate the advisory key literal in tests — expose it via a persistence-package test helper or a deliberate visibility change.

### Backend

## 1. Repository outcome

- [x] 1.1 Add `RetentionPassOutcome` (`Purged(deleted)`, `LockBusy`); `thinAndPurge` returns it (`LockBusy` on try-lock false); verify compile
- [x] 1.2 `NodePayloadHistoryRepository.purge` returns `RetentionPassOutcome` likewise; verify compile

## 2. Service and config

- [x] 2.1 Add `lockRetry` (default 120 s, last field with default) and `OUTPUT_HISTORY_LOCK_RETRY_SECONDS` in `fromEnv`, capped at `purgeInterval`; verify config spec
- [x] 2.2 Replace `lastAttempt` with `nextDue`; `claim` returns the stored `Some` instance; `purgePayloads` returns failed/LockBusy/Purged; shorten via CAS on that instance when a part was LockBusy and none failed; keep `purgeIfDue` type; verify service spec
- [x] 2.2a Update stale doc comments: `OutputHistoryRetentionService` class doc, `purgeIfDue` doc (`None` incl. lock-held history part), `NodePayloadHistoryRepository.purge` doc; verify by reading
- [x] 2.3 Document `OUTPUT_HISTORY_LOCK_RETRY_SECONDS` in CLAUDE.md's env table; verify by reading the table row

### Tests

## 3. Tests

- [x] 3.1 Update existing repo-test callers to `Purged(n)` with the same n (not NodePayloadWiringSpec), EXCEPT the HEL-1272 lock-held test `OutputHistoryRepositorySpec` (~:281-295) which asserts `LockBusy` at ~:289 — record its red on main (stash yields 0)
- [x] 3.2 Service spec: lock-held skip → not run at retry-1s → succeeds at retry (exact survivors) → not due at retry+interval-1s, due at retry+interval; red via drop-shortening mutation (C5)
- [x] 3.3 Service spec, invocation-COUNTING stubs: history failure → counts unchanged at retry, increment at interval; failure+payload LockBusy → same; payload-only LockBusy → increment at retry; each red under its named mutation (no guard fallback)
- [x] 3.4 Config spec: retry default, invalid, cap at interval
- [x] 3.5 New two-role spec: real `writeAction` holds shared key in an open txn; real `thinAndPurge` (thin + age candidates, payload-linked) and `purge` return `LockBusy` without waiting; after commit both `Purged` with exact survivors; app role sees nothing
- [x] 3.6 Deterministic reverse direction: real `thinAndPurge` paused on a FOR UPDATE-held thin point after its age deletes (pg_locks-observed); real `writeAction` trimming P_old commits within a bound with trim skipped; retention completes, exact survivors, no 40P01; red by removing the `insertAndTrim` shared guard
- [x] 3.7 `nice -n 19 sbt testFull` green; record red evidence (mutation + failing assertion) for 3.1, 3.2, 3.3a/b/c, 3.5, 3.6 in the commit notes / files-modified.md
