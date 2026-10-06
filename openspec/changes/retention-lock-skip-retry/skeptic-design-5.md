## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)

- Spawn guard: `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=bug/retention-lock-skip-retry/HEL-1343`. HEAD `2c1884ac5b2cc2578320ace4a21e37b32df5c603`; only the change dir is untracked.
- `openspec validate retention-lock-skip-retry --strict` → "Change 'retention-lock-skip-retry' is valid". MODIFIED `Tiered time-bucket retention` keeps all three baseline scenario titles (baseline spec.md:16,21,25); no rename.
- r4 CR1 genuinely addressed (not reworded): D5.2 / task 3.3 / C5 now assert "not run" by unchanged stub invocation counts and "run" by count increment, never by `purgeIfDue`'s return; "otherwise labelled guard" escape removed. D5.1 cleans tables first (r4 note 1); D3 documents the cap-equals-interval case (r4 note 2).
- Design claims vs live code (all match):
  - `OutputHistoryRetentionService.scala:34,61-65` claim CAS before repo call; `:49-53` history failure recovered to `None`, then `purgePayloads` still runs (so D4's "both parts observed in one pass" is real); `:56-59` payload error swallowed to `Unit`.
  - `OutputHistoryRepository.scala:153-159` try-lock false → `DBIO.successful(0)`; order `purgeByAge.flatMap(a => thin...)` (supports D5.4's "age deletes first, then blocks on X in thin").
  - `NodePayloadHistoryRepository.scala:117-123` shared try-lock taken unconditionally after the insert, before the trim (so D5.3's open `writeAction` txn always holds the shared key); `:178-184` exclusive try-lock in `purge`.
  - `OutputHistoryRepository.scala:165` `PurgeAdvisoryLockKey` is `private[persistence]`.
- Caller completeness for the repo return-type change: grep of `thinAndPurge|.purge(|purgeIfDue|new OutputHistoryRetentionService` over `backend/src/test/scala` — D2's list is complete. `OutputHistoryRetentionPrivilegedSpec:92-94` and `NodePayloadWiringSpec:131-142` use only the constructor/`fromEnv`/`purgeIfDue` (unchanged signatures); `ProductEventRepositorySpec` is a different repo. Existing `Some(0)`/`Some(1)` service assertions (`OutputHistoryRetentionServiceSpec:107,115,118`) keep their semantics under `nextDue` (due iff `nextDue <= now`, identical boundary to `lastAttempt + interval <= now`).
- Red-proof achievability, case by case (reasoned against the code above):
  - D5.1 retry: drop-shortening mutation → at `t0+retry` the slot is still `t0+interval`, so `purgeIfDue` returns `None` where the test asserts `Some(n)` and eligible points remain. Genuinely red.
  - D5.2(a) shorten-on-failure mutation → throwing history stub invoked again at `t0+retry`, count increments. Red. (b) shorten-on-any-LockBusy mutation → same. Red. (c) drop-shortening → no increment at `t0+retry`. Red.
  - D5.4 reverse: with the `insertAndTrim` guard removed, the trim deletes P_old and the `ON DELETE SET NULL` cascade (V116) waits on the points retention already age-deleted; retention waits only on X (third connection), so it is a wait without a cycle — the `writeAction` bound fails. Red, and the design records it as such. Green preconditions (X thin-only and unlinked; keep=1; P_old points age-eligible; payload count keep+1) are stated to be asserted.
  - Task 3.1 LockBusy repo test and D5.3 forward test: the assertions are red-able, but the plan's stated red procedure is not — see notes 1 and 2.
  - Pool sizing for D5.3 (open run txn + concurrent retention on the privileged pool): the model spec uses a 5-connection Hikari pool (`NodePayloadTrimPurgeLockOrderSpec.scala` `setMaximumPoolSize(5)`), so holding one connection does not starve retention.
- Constraints: no migration planned; no planned edits to `NodePayloadWiringSpec`, `ci.yml`, `playwright.config.ts`, `.gitignore`; constructor, `purgeIfDue` type, `fromEnv()` stay source-compatible (`lockRetry` last field with default).

### Verdict: CONFIRM

Every planned test assertion can go red under a mechanical mutation of the post-fix code, the D4 precedence and retry semantics are consistent across design, tasks and the ADDED requirement, and the r1–r4 change requests are substantively fixed. The remaining defects are wording in the red-recording procedure. The test design itself is not affected, and C4 already requires a genuine red. The final gate must enforce the notes below.

### Non-blocking notes (the final-gate skeptic should enforce 1–3)

1. **Task 3.1 and D5.1: "stash on main" cannot produce a red.** The new tests reference `LockBusy` / `RetentionPassOutcome` (and possibly `config.lockRetry`), none of which exist on main. Stashing the main-code changes therefore gives a compile error, not "yields 0" / "`Some(0)` at t0". The genuine red for task 3.1 (and for D5.1's t0 step) is a mutation of the post-fix code that maps the try-lock-false branch to `Purged(0)`. The final gate should reject a compile failure recorded as a red.
2. **D5.3 / task 3.5 names no red mutation, but task 3.7 requires red evidence for 3.5.** Natural, genuinely red choices:
   - Remove the shared try-lock in `insertAndTrim`. Retention then acquires the key and either deletes (the `LockBusy` assertion fails) or blocks behind the run's cascade row locks (the bounded `Await` fails).
   - Alternatively, map `thinAndPurge`'s / `purge`'s false branch to `Purged(0)`.

   The executor should name the mutation and the assertion that failed.
3. **Task 3.7 lists only 3.2 and 3.5 for red evidence.** 3.1, 3.3 (all three cases) and 3.6 each have a named red that C4/C5 require. All of them should be recorded.
4. **D5.1 lives in `com.helio.services.pipelines`, which cannot see `OutputHistoryRepository.PurgeAdvisoryLockKey` (`private[persistence]`).** The executor will need to either reference the key from a test helper in the persistence package or widen visibility deliberately. A duplicated literal would silently drift if the key ever changed.
5. **The except-clause in MODIFIED "Tiered time-bucket retention" omits failure precedence.** It says a pass "any part of which was skipped because the retention lock was held is retried after the lock retry window" without "and no part raised an error". The ADDED requirement states the precedence explicitly, so the spec set is consistent read as a whole. Adding the qualifier would remove the literal tension.
