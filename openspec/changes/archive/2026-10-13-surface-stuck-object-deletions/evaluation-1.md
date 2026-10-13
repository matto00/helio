## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `30f7028a654d49c8af314d65868716e0f39ed214` (single commit on `feature/surface-stuck-object-deletions/HEL-1531`).
Diff base: `290ab8a22c7f0adc16b4c0d070748657067081fe`, resolved live with `resolve-review-base.sh`.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (live, non-null `storedObjectDeletionsQueued`/`Stuck` in `totals`, owner-only, no identifiers, on both paths): met.
  `AdminUsageService.scala` reads `queueCounts(DefaultMaxAttempts)` in both the `rolled.isEmpty` branch and the
  rolled-up `for`. Both fields are `Long`, outside `nullingNones`. The live API returned
  `storedObjectDeletionsQueued: 2, storedObjectDeletionsStuck: 1` for two seeded rows (attempts 10 and 9). The seeded
  key and `image_uploads` appeared 0 times in the raw body.
- AC2 (schema, frontend type, fixture, contract test, card): met. Both fields are required, `integer >= 0`, and
  `additionalProperties: false` is kept. `AdminUsageTotals` TS type, fixture and contract test (accept, and reject
  either field omitted) match. A separate "Storage cleanup" section shows both counts (design D4).
- AC3 (re-arm 24 h after the last attempt, attempts reset, both row kinds, `'infinity'` kept, reference check still
  applies): met. `StoredObjectDeletionRepository.rearm` runs before `claim` in `pass()`, inside the in-flight guard. The
  CASE keeps `claimed_at` for new-style rows. The reference classification still runs on every claimed row (the
  `keep the object when the re-armed key is still referenced` test covers both row kinds).
- AC4 (per-failure WARN unchanged): met. No diff touches the failure-WARN line.
- AC5 (tests: cap vs below, re-arm boundary, prod role shape): met (see Phase 2).
- Tasks 1.1 to 6.3 are all checked and match the implementation. There is no scope creep: the CLAUDE.md line change
  is required by task 2.4. No migration.
- Standing constraints:
  - C1: `StoredObjectDeletionsMigrationSpec` asserts `(rolsuper, rolbypassrls, current_user) = (false, true,
    helio_privileged)` at read time. The login role is NOSUPERUSER NOBYPASSRLS, the table owner with migration grants.
    The same read on the app pool gives `QueueCounts(0,0)`. `AdminUsageTotalsSpec` runs on `ProductTelemetryDbHarness`,
    which has the same role shape (I checked lines 20-23 and 60-81).
  - C2/C4: verified independently below.
  - C3: I ran only foreground `testOnly` shards.

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates (fresh, run by me in `WORKTREE_PATH`, nice -n 19, at most 3 workers):
- `npm run lint`: clean (zero warnings). `npm run format:check`: clean. `npm run typecheck`: clean.
- Root `npx jest --maxWorkers=3`: 51 suites / 469 tests passed.
- Frontend jest in 3 foreground shards (`--shard=1/3`, `2/3`, `3/3`, `--maxWorkers=3`): 196+196+196 suites;
  2326+2258+2481 = 7065 tests, all passed.
- `npm --prefix frontend run build`: success.
- `npm run check:scala-quality`: clean (no inline FQNs). It printed 251 soft size warnings, none for a file this
  change grew past budget.
- Backend: the whole suite is over 600 s, so I did not run `sbt testFull`. I ran two foreground `testOnly` shards:
  - Shard A: `StoredObjectDeletionRearmSpec`, `StoredObjectDeletionServiceSpec`, `FormAndConversationObjectDrainSpec`,
    `StoredObjectDeletionsMigrationSpec`, `PipelineSchedulerServiceStoredObjectDrainSpec`. 49 tests, 49 passed.
  - Shard B: `AdminUsageTotalsSpec`, `AdminUsageServiceSpec`, `AdminUsageRoutesSpec`,
    `ProductUsageRepositoryRoleSpec`, `FormSubmitRoutesSpec`, `PanelFormFileSubmissionFailedAppendSpec`. 65 tests,
    65 passed.
  - These shards cover every touched spec and every other spec that builds `StoredObjectDeletionService` or
    `AdminUsageService` (found with grep).

Independent mutation spot checks. I ran these in a throwaway `git archive HEAD` copy under the session scratchpad,
never in the worktree. The copy was removed afterwards.
- M2 (cutoff +1 h: `rearmAfterSeconds - 3600`): `StoredObjectDeletionRearmSpec` failed 2 of 12, the two
  `stay stuck one minute inside the 24 h cool-down` tests. This matches mutation-evidence.md exactly.
- M5 (WHERE widened to `(last_attempt_at IS NULL OR last_attempt_at <= cutoff)`): failed 2 of 12, the two
  `stay stuck when it has no last attempt` tests. Matches exactly.
- M7 (stuck `>=` changed to `>`): 4 tests failed in `AdminUsageTotalsSpec` + `StoredObjectDeletionsMigrationSpec`, the
  same 4 the evidence names. A 5th failure (`serialise ... validates against schema`) came from my copy only: its
  message was "could not locate schemas/", because the copy held only `backend/`. Not a discrepancy.

The executor's mutation claims I checked hold. M1, M3, M4, M6 and M8-M11 are not re-run; they are taken as recorded.
They are consistent with the test bodies I read: for example, M3's failures are exactly the `Day + 60` tests, and M4
fails on the `(0, !legacy, legacy, ...)` state tuple.

Checklist: canonical compliance OK (no FQNs; the new CSS modifier only sets `grid-template-columns`, with no literal
colour, space or font values); DRY (reuses `Stat` and the existing section classes); type safety OK; security OK (the
counts carry no identifiers, the schema pins `additionalProperties: false`); error handling (re-arm failure is
recovered and the claim still runs); no dead code; no over-engineering.

### Phase 3: UI Review — PASS
Issues: none.

Servers: `start-servers.sh` reported READY (backend 9870, frontend 6963), and `assert-phase.sh servers` PASSed.
Afterwards they were stopped with `stop-servers.sh` (`STOPPED ports=6963,9870`).
Setup: one throwaway user `hel1531-eval-1791928626@example.test` (id `4b4c1e05-8fa5-44fe-a060-216848953325`),
registered over the API and set to owner tier by exact id. I seeded two queue rows (ids 15, 16; keys
`images/hel1531-eval-{stuck,queued}-nonexistent.png`; attempts 10 and 9, `last_attempt_at = now()`, so neither could be
claimed during the review). Both rows were deleted by exact (id, key). The user was deleted with
`buildUserDeleteSql([{id, email}])`, and a post-check found 0 rows.

- Happy path: `/admin/usage` shows a "Storage cleanup" region (accessible name from `aria-labelledby`) with Queued 2
  and Stuck 1, separate from the "All-time totals" region.
- Unhappy and empty paths: `rolledThrough: null` and a zero queue are covered by the jest tests I re-ran green. The
  page's fetch-error and empty states are unchanged by this diff.
- Console: 0 errors and 0 warnings on `/admin/usage`. The only errors were the two expected pre-login 401s on
  `/api/auth/me` at `/login`.
- Breakpoints, measured with `getComputedStyle`. No horizontal overflow at any width:
  - 1440: 2 columns (568px each).
  - 1100: 2 columns (398px).
  - 768: 2 columns (352px).
  - 375: 1 column (327px), via the `max-width: 430px` override.
  - The totals card keeps 3 columns down to its own 1-column override.
- Themes: screenshots in dark and light. A 2-column pair, no empty cell, consistent vertical rhythm between the two
  stacked sections. Evidence (persisted):
  - `/home/matt/Development/helio/.concertino/runs/HEL-1531/evidence/openspec/changes/surface-stuck-object-deletions/eval-1-admin-usage-1440.png` (dark)
  - `/home/matt/Development/helio/.concertino/runs/HEL-1531/evidence/openspec/changes/surface-stuck-object-deletions/eval-1-admin-usage-1440-light.png` (light, set by swapping the `data-theme` attribute; chart axes already drawn in dark colours look faint there, which comes from the swap and not from this change)

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `backend/src/test/scala/com/helio/services/telemetry/AdminUsageTotalsSpec.scala` ("carry no key, source table or
  queue id"): the test reads the queue `id` and then asserts only `id should be > 0L`, so the "no queue id" part is
  not asserted. The fixed `totals` key set and `additionalProperties: false` give the real protection. Either drop the
  `id` lookup or rename the test so it does not claim an id check.
- The `.recover` in `StoredObjectDeletionService.rearmStuck` (design D1: a re-arm failure must not stop the claim in the
  same pass) has no test. Removing `.recover` would not turn any test red; a failed re-arm would then skip that pass's
  claim, logged as a pass-level ERROR. A failing-repo stub test would cover it.
- Spec scenario "Persistent failure reaches the cap again ... not claimed for another 24 hours": the test checks only
  2 h after the second cap, not the 24 h edge. That edge is already covered by the first-cap boundary tests.
- Cosmetic: `AdminUsageProtocol.scala` `AdminUsageTotals` keeps four parameters on the first line and wraps the two new
  ones. In `AdminUsageService.scala` the `persistence.sources` import comes after `persistence.telemetry`.
