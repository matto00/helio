## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `82a82da848b35606efc058179de24b2d22c31a2e` against live-resolved base `2c1884ac5b2cc2578320ace4a21e37b32df5c603` (origin/main).
Scratch logs: `/tmp/claude-1000/-home-matt-Development-helio/7c91d5de-7eee-4b42-a6c7-dffd6f7b4dc2/scratchpad/eval-*.log`.

### Phase 1: Spec Review — PASS
- AC1 (retry soon after a lock-held skip; choice explained): met. design.md D1 claims a short retry window instead of releasing the claim, and gives the reason (releasing would retry on every 30 s tick). `OutputHistoryRetentionService` shortens `nextDue` to `now + lockRetry` with a CAS on the exact `Some` that `claim()` stored (C5). A failure keeps the full interval, and when a pass both fails and hits a busy lock, the failure wins (D4).
- AC2 (skipped once, then succeeds inside the window): `OutputHistoryRetentionServiceSpec` "retry a lock-held skip…" covers it with a real shared advisory lock on EmbeddedPostgres, exact survivors, and restoration of the full interval afterwards.
- AC3 (thin + age deletes under the guard): `RetentionLockGuardSpec` covers both directions. Forward: the real `writeAction` holds the shared key while the real `thinAndPurge` and `purge` return `LockBusy`, then `Purged(2)` and `Purged(3)` with hand-derived survivors. Reverse: the real `thinAndPurge` is parked after its age deletes, and the trim is skipped with the run committing promptly.
- Driver constraints and C1–C6 hold. No migration. `NodePayloadWiringSpec`, `ci.yml`, `playwright.config.ts` and `.gitignore` are absent from `git diff --name-only`. The constructor, `purgeIfDue: Future[Option[Int]]` and `fromEnv()` are source-compatible (`lockRetry` is the last field and has a default). The advisory key literal is not duplicated (`RetentionLockKey` test helper).
- All tasks are checked and match the implementation. The spec deltas (`output-history-retention`, `output-snapshot-history`) describe what was built. CLAUDE.md has the env row for `OUTPUT_HISTORY_LOCK_RETRY_SECONDS`.
- No scope creep was found.

### Phase 2: Code Review — PASS
Gates, run fresh by the evaluator (backend only, so the frontend gates do not apply):
- `nice -n 19 sbt testFull`: exit 0. Suites 427 completed, 0 aborted. Tests 6037 succeeded, 0 failed. No "Java heap space". No FirstRunRoutesSpec timeout. `NodePayloadWiringSpec` ran and passed (unedited). The suite ran one forked group at a time, since `HEL924_TEST_GROUP_CONCURRENCY` was unset. `sbt --client shutdown` was run separately (no server was running).
- `npm run check:scala-quality`: exit 0. It printed only informational soft-budget warnings (RetentionLockGuardSpec is 263 lines against a 250 budget).

Red spot-checks. I applied each mutation to the post-fix code, ran the suites, then reverted it. `git status` was clean afterwards and HEAD was unchanged.
- 3.2 retry, dropping the shortening CAS (`nextDue.compareAndSet(claimed, …)` → `nextDue.get()`): RED as claimed at `None was not equal to Some(2) (OutputHistoryRetentionServiceSpec.scala:154)`. It also turns 3.3c red: `(1, 1) was not equal to (2, 2) (:219)`.
- 3.6, removing the `insertAndTrim` shared try-lock (`insert.andThen(trim)`): RED as claimed at `RetentionLockGuardSpec.scala:250`, where `writeAction` fails to commit within the bound. 3.5 run-side is also red at `:191` (`Purged(2) was not equal to LockBusy`).
- 3.1 / D5.1-t0 / 3.5 history, with `thinAndPurge`'s try-lock false branch → `Purged(0)`: RED at `OutputHistoryRepositorySpec.scala:289`, `OutputHistoryRetentionServiceSpec.scala:146` and `RetentionLockGuardSpec.scala:191`. The actual message at :191 is `Purged(0) was not equal to LockBusy`, while red-green-evidence.md records `Purged(2)` (see suggestions).
- The green baseline of the six targeted specs passed (42 tests) before any mutation.

Two-role proof is real. I added a temporary probe to the forward test, then reverted it. It returned `priv=(helio_privileged, rolsuper=false, rolbypassrls=true)` and `app=(helio_app_test, rolsuper=false, rolbypassrls=false)`. The privileged pool sees more than 0 rows in both tables at the moment the app role sees 0. Both tables are `FORCE ROW LEVEL SECURITY` (V115/V116). So the "app role sees none" assertion really is RLS filtering, not an empty table.

Code quality:
- `PartResult` is a private ADT and failed / busy / ran are handled explicitly.
- No silent failures (errors are logged and mapped to `Failed`).
- No inline FQNs, no TODO/FIXME, no casts.
- The synchronisation in the new tests uses latches and `pg_locks` polling with 30 s bounds, never sleeps, and every lock and latch is released in `finally`.
- The stub-count tests (3.3a/b/c) assert invocation counts, never `purgeIfDue`'s return value, as C5 requires.

Issues: none blocking.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `openspec/changes/retention-lock-skip-retry/red-green-evidence.md`, row "3.5 forward (history)": the recorded failing assertion reads `Purged(2) was not equal to LockBusy`. Under the stated mutation (try-lock false → `Purged(0)`), the real message is `Purged(0) was not equal to LockBusy (RetentionLockGuardSpec.scala:191)`. `Purged(2)` is the message from the run-side guard-removal row. Correct the transcription so the evidence record matches what the mutation produces.
- `RetentionLockGuardSpec`: assert the role attributes in the spec itself (`rolsuper = false AND rolbypassrls = true` for the privileged pool, both false for `helio_app_test`), as `NodePayloadTrimPurgeLockOrderSpec.scala:256/312` already does. That way a fixture change cannot quietly turn the two-role proof into a superuser run. It holds today only through V34 and the evaluator's probe.
- `OutputHistoryRetentionServiceSpec.scala` imports: `com.helio.domain.model.UserTier` sits among the `infrastructure` imports. Group it with the other `com.helio.domain` imports.
