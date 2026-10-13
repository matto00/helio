## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `30f7028a654d49c8af314d65868716e0f39ed214`. The diff base was resolved live with `resolve-review-base.sh` (main/origin): `290ab8a22c7f0adc16b4c0d070748657067081fe`. The branch is one commit ahead.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/surface-stuck-object-deletions/HEL-1531`.

- **AC1 (live, non-null counts on both paths, owner-only, no identifiers):**
  - `AdminUsageService.scala` reads `deletions.queueCounts(StoredObjectDeletionService.DefaultMaxAttempts)` in both the `rolled.isEmpty` branch and the rolled-up `for`.
  - Both fields are `Long` and are not in the `nullingNones` list (`AdminUsageProtocol.scala`, jsonFormat6).
  - `queueCounts` is one `count(*)` / `count(*) FILTER (WHERE attempts >= cap)` statement on `withSystemContext`.
  - Live API check: I registered a throwaway owner-tier `@example.test` user over the API and seeded 3 queue rows (attempts 8, 8, 10). `GET /api/admin/usage?days=7` returned `storedObjectDeletionsQueued: 3` and `storedObjectDeletionsStuck: 1`. A grep of the raw body for the seeded key prefix and for `image_uploads` found 0 hits.
  - The owner-only gate is the unchanged route; `AdminUsageRoutesSpec` passed.

- **AC2 (schema, type, fixture, contract, card):**
  - In the schema, both fields are `integer, minimum 0` and required, and `additionalProperties: false` is kept.
  - The TS type, fixture and contract test match. The contract test rejects each field when it is omitted.
  - The page shows both counts in a separate "Storage cleanup" section (design D4).

- **AC3 (24 h re-arm, both row kinds, `'infinity'` kept, reference check):**
  - `rearm` SQL: `attempts >= cap AND last_attempt_at IS NOT NULL AND last_attempt_at <= cutoff`. The CASE keeps `claimed_at` for new-style rows.
  - `pass()` runs `rearmStuck(now).flatMap(_ => claimAndProcess(now))`, and `rearmStuck` recovers on its own.
  - I traced claim eligibility after a reset:
    - Legacy row: backoff with attempts=0 is `60*2^-1` = 30 s from a last attempt 24 h ago, so the row is due.
    - New-style row: `not_before` is at most `last_attempt + 3600`, so the row is due.
  - The reference classification runs on every claimed row. `StoredObjectDeletionRearmSpec` "keep the object when the re-armed key is still referenced" covers both kinds.
  - Main.scala builds the drain with defaults, so the cap used by the counts and by the drain is the same constant.

- **AC4 (per-failure WARN unchanged):** the diff does not touch the failure-WARN line. The only new log lines are a re-arm INFO count (no keys) and a re-arm failure WARN (exception description only).

- **AC5 / C1-C4 tests, re-run by me (foreground, nice -n 19, -Xmx3g):**
  - Shard A: `StoredObjectDeletionRearmSpec`, `StoredObjectDeletionServiceSpec`, `FormAndConversationObjectDrainSpec` and `StoredObjectDeletionsMigrationSpec`. Result: `Tests: succeeded 43, failed 0`. This includes all 12 re-arm tests (6 per row kind) and the C1 prod-role test.
  - Shard B: `AdminUsageTotalsSpec`, `AdminUsageServiceSpec`, `AdminUsageRoutesSpec`, `ProductUsageRepositoryRoleSpec` and `PipelineSchedulerServiceStoredObjectDrainSpec`. Result: `Tests: succeeded 30, failed 0`.
  - C1:
    - The MigrationSpec test asserts `(rolsuper, rolbypassrls, current_user) = (false, true, "helio_privileged")` at read time on a NOSUPERUSER login with only migration grants.
    - It gets `QueueCounts(4,2)` on the privileged pool and `QueueCounts(0,0)` on the app pool.
  - C4: the boundary fixtures sit at `Day - 60` and `Day + 60` s, for both kinds.
  - C2: I did not re-run the mutations. The evaluator independently reproduced M2, M5 and M7 in a throwaway copy and its results match mutation-evidence.md. I read the test bodies against M1, M3, M4, M6 and M8 and they are consistent: each named mutation breaks exactly the assertion it targets.
  - Gate-defect check: neither report depends on mtime ordering. There is nothing to flag.

- **Frontend checks:**
  - `npx jest --maxWorkers=3 adminUsage`: 4 suites, 25 tests passed.
  - `npm run typecheck`: clean.
  - `eslint src/features/adminUsage --max-warnings 0`: clean.
  - Prettier check of `src/features/adminUsage` and `schemas/admin`: clean.

- **UI / design judgment (DESIGN.md), on the running app:**
  - Servers were started with `start-servers.sh` 6963/9870, `assert-phase.sh servers` returned PASS, and they were stopped with `stop-servers.sh` (`STOPPED ports=6963,9870`).
  - Dark theme at 1440: `/home/matt/Development/helio/.concertino/runs/HEL-1531/evidence/openspec/changes/surface-stuck-object-deletions/skeptic-final-1-dark-1440.png`
  - Light theme at 1440, set through the app's real `helio-theme` preference and a reload, not an attribute swap: `/home/matt/Development/helio/.concertino/runs/HEL-1531/evidence/openspec/changes/surface-stuck-object-deletions/skeptic-final-1-light-1440.png`
  - **Vertical spacing between the two stacked sections, measured with getBoundingClientRect and identical in both themes:**

    | Gap | Size |
    |---|---|
    | data-through bar to "All-time totals" | 178 to 198 = 20 px |
    | "All-time totals" to "Storage cleanup" | 331 to 351 = 20 px |
    | "Storage cleanup" to the stat row | 514 to 534 = 20 px |

    All three gaps are the parent's `gap: var(--space-5)`, so the rhythm is uniform and there is no doubled or collapsed margin.
  - The section reuses the `admin-usage__totals`, `__section-title` and `__muted` classes and the shared `Stat`.
  - The new CSS modifier sets only `grid-template-columns` and has no literal values.
  - The stat-card background is the same token-derived colour as the totals cards (light `rgb(253,252,250)` for both).
  - Layout: 2 columns (568 px each) at 1440 and 1 column (327 px) at 375, with no horizontal overflow.
  - Console: 0 errors and 0 warnings on `/admin/usage`.
  - The section sits naturally between the all-time totals and the windowed stat row. The live note makes clear it is a snapshot, not a cumulative total. It is consistent with sibling sections in both themes, and I see nothing an experienced eye would reject.

- **Cleanup:**
  - Seeded queue rows 17-19 were deleted by exact (id, storage_key).
  - The throwaway user `bd6f69be-6b74-4fb5-9225-602fcfcb7a92` / `hel1531-skeptic-1791928917@example.test` was deleted with `buildUserDeleteSql`. A post-check found 0 user rows and 0 queue rows.
  - The worktree screenshots were removed after they were persisted. The worktree is otherwise unchanged (only the orchestrator's untracked `evaluation-1.md`).

### Verdict: CONFIRM

### Non-blocking notes
- `StoredObjectDeletionService.rearmStuck`'s `.recover` (design D1: a re-arm failure must not stop that pass's claim) has no test, so removing it would turn nothing red. The impact is bounded: one skipped claim pass, retried on the next tick. A failing-repo stub test would close the gap.
- In `AdminUsageTotalsSpec`, the test "carry no key, source table or queue id" looks up the queue `id` but only asserts `id > 0`. The fixed key set and `additionalProperties: false` give the real protection, so the test name over-claims.
- The scenario "Persistent failure ... not claimed for another 24 hours" is checked only 2 h after the second cap. The 24 h edge itself is covered by the first-cap boundary tests.
- Cosmetic: `AdminUsageTotals` keeps four params on line one and wraps the two new ones. The `persistence.sources` import sits after `persistence.telemetry`.
