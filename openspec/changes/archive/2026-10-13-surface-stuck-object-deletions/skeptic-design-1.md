## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 290ab8a22c7f0adc16b4c0d070748657067081fe (planning artifacts untracked in the worktree).
Owner rulings Q1 `admin-view` / Q2 `rearm-24h` confirmed in `.concertino/runs/HEL-1531/events.jsonl` line 5
(`escalation.answered`, `sub_answers: ["admin-view","rearm-24h"]`). Not reopened.

### What I verified (with evidence)

- **Re-arm SQL, legacy (V128) rows.** `recordFailure` (StoredObjectDeletionRepository.scala:159-171) sets
  `claimed_at = NULL` for a legacy row, so a capped legacy row has `claimed_at` NULL, `lease_until` NULL. After
  D1's reset (`attempts = 0`), the claim's legacy branch (lines 59-62) requires
  `last_attempt_at <= now - LEAST(3600, 60*2^(0-1))` = 30 s; the row's last attempt is >= 24 h old, so it is due at
  once. Design's "30 s" claim is correct.
- **Re-arm SQL, new-style (V132) rows.** At the cap, `not_before = last_attempt_at + LEAST(3600, 60*2^9)` =
  `last + 3600 s` (line 168). Claim branch (63-66) needs `claimed_at = 'infinity'`, `not_before <= now`, no live
  lease. D1's CASE leaves `claimed_at` untouched for `not_before IS NOT NULL` and clears `lease_until`, so the row is
  due and stays `'infinity'` (V128-era claim SQL still cannot match it). Correct.
- **Concurrency.** A capped row is excluded from `claim` (`attempts < $maxAttempts`, line 58), so it is never leased;
  concurrent re-arm UPDATEs from two instances are serialised by row locks and the second re-checks
  `attempts >= cap` under READ COMMITTED and skips. A row that just failed into the cap has a fresh
  `last_attempt_at`, so it is not re-armed. No race found.
- **Reference guard still applies.** `pass()` (StoredObjectDeletionService.scala:55-66) classifies every claimed row;
  re-arm only changes claimability. Correct.
- **RLS/role risk of the counts.** V128 grants `SELECT, INSERT, UPDATE, DELETE ON stored_object_deletions TO
  helio_privileged` and the table is ENABLE+FORCE RLS with no policy (V128 lines 36-38 and final GRANT). So a
  NOBYPASSRLS role reads 0 rows silently rather than erroring — the design's "RLS-filtered zero" risk is real and
  correctly identified. `ProductUsageRepository` already runs every read on `withSystemContext` (lines 26-69).
  `ProductUsageRepositoryRoleSpec` flips `helio_privileged` to NOBYPASSRLS after migrating (lines ~55-58), so it will
  read 0 queue rows and keep passing — design's claim verified. `StoredObjectDeletionsMigrationSpec` creates
  `helio_privileged BYPASSRLS` with a NOSUPERUSER NOBYPASSRLS login (lines 37-39) — the right recipe for C1.
- **Wiring claims.** `ApiRoutes.scala:354` builds `AdminUsageService(new ProductUsageRepository(dbContext),
  SystemClock)`; `AdminUsageTotals` is `jsonFormat4` with `nullingNones` (AdminUsageProtocol.scala:29,71-72); schema
  `totals` is `additionalProperties: false` with all four fields required; `AdminUsageRoutesSpec.scala:205` validates
  the real body against the schema. All verified. The not-rolled-up path (AdminUsageService.scala:46) only calls
  `totalUsers()`, so D2's "both paths" is a real requirement.
- **Frontend.** `features/adminUsage` files named in design exist; `UsageTotals.tsx` renders three `Stat`s in
  `admin-usage__stats--totals`; other literal totals at `AdminUsagePage.test.tsx:145`,
  `adminUsage.contract.test.ts:32`, `adminUsage.fixture.ts:41`.
- **Spec deltas.** MODIFIED requirement names ("Aggregates from rollups only", "Usage page totals and data-through
  date") match `openspec/specs/owner-usage-admin/spec.md` exactly. Stored-object-lifecycle delta is ADDED and
  conflicts with no existing requirement (grep for cap/backoff/forever: none).
- **AC coverage.** Every ticket AC maps to a task (counts 2.1-2.2/3.3-3.4; schema/types/card 2.3/3F/4.x; re-arm
  1.x/3.1-3.2; WARN unchanged D5; tests 3.x). No placeholders/TBDs.

### Verdict: REFUTE

The core design is sound; the revisions below are to the plan's test/task completeness and one UI decision, all
cheap to fix in the artifacts.

### Change Requests

1. **The plan silently breaks two existing attempt-cap guard tests; name them and specify their replacement.**
   - `backend/src/test/scala/com/helio/services/sources/StoredObjectDeletionServiceSpec.scala:187-191` seeds the
     `capped` row with `attempts = 10, last_attempt_at = now - 100000 s` (27.8 h) and asserts `present(capped)` after
     `pass()`. Under D1 that row is re-armed and deleted in the same pass, so the test goes red.
   - `backend/src/test/scala/com/helio/services/sources/FormAndConversationObjectDrainSpec.scala:368-375` ("honour the
     attempt cap") sets `attempts = 10` with `last_attempt_at` NULL and runs the pass at `+100000 s`. D1's
     `last_attempt_at IS NULL OR ...` clause re-arms it at once, so this goes red too.
   Add a task that updates both fixtures so each still guards the cap (e.g. `last_attempt_at` 23 h ago, inside the
   cool-down) and records that the change follows from the new behaviour rather than from weakening the test.
2. **Make the `last_attempt_at IS NULL` branch of the re-arm WHERE an explicit decision with a test.** A capped row
   with no `last_attempt_at` cannot come from the drain. It only comes from manual edits or fixtures. Today D1
   re-arms it immediately, with no cool-down. Either drop the branch, so such a row is never re-armed, or keep it and
   say so in D1, with a 3.1 case and a mutation. Right now the plan contains it without a stated reason, and it is
   the exact branch that breaks the existing test in CR1.
3. **Pin the 3.1 boundary values so the listed "cutoff off by an hour" mutation is actually caught.** "23 h kept,
   >24 h re-armed" allows e.g. 48 h, and then a `cutoff = now - 25 h` mutation stays green. Specify values on both
   sides within the hour of 24 h (e.g. 24 h - 1 min kept, 24 h + 1 min re-armed) and name both mutation directions
   (`-23 h` and `-25 h`).
4. **3.4 needs a named mutation (C2).** The prod-role proof must be shown red when the count runs on the
   non-privileged path (e.g. `queueCounts` via the app pool / `withUserContext`, or `helio_privileged` NOBYPASSRLS),
   where it reads 0. Without that, a pass that happens to read through any pool proves nothing about the RLS risk the
   design names.
5. **D4: decide the totals-card layout explicitly.** `.admin-usage__stats--totals` is `repeat(3, minmax(0, 1fr))`
   (AdminUsagePage.css:38-40). Five `Stat`s leave a 3 + 2 grid with an empty cell. The card is also headed "All-time
   totals", but the queue counts are a live current-state snapshot, not all-time figures. Revise D4 to choose one of
   these and state why:
   - a separate labelled group or row for the deletion-queue stats inside the card (still the shared `Stat`), or
   - accept the 3 + 2 layout, and say how the heading or hints signal that the queue counts are current-state.

   "No new styling" alone does not settle this.
6. **Add the CLAUDE.md doc update to the tasks.** `CLAUDE.md:173` says `GET /api/admin/usage` "reads the rollup tables
   only (never `product_events`) plus one identifier-free `users` count". After this change that is false, because
   the endpoint also counts the deletion queue. Add a task to update that line, naming the two new `totals` fields.

### Non-blocking notes

- `AdminUsageRoutesSpec.scala:198` asserts `totals.fields.keySet` equals the four current keys; it must change (implied
  by 3.5, worth listing). The three `new AdminUsageService(...)` test call sites (AdminUsageServiceSpec:34,
  AdminUsageTotalsSpec:33, ProductUsageRepositoryRoleSpec:89) gain a constructor argument.
- A re-arm DB failure fails the whole pass (no claim that tick). The re-arm hits the same table and pool as the claim,
  so this is acceptable. Consider `recover` on re-arm alone if you want the drain to continue.
- Stuck-count semantics: a persistently failing row cycles through roughly 24 h stuck, then a few hours of
  re-attempts. At those moments the admin card can show 0 stuck for a row that will never succeed. Resetting
  `attempts` also discards the "re-armed N times" history. This is within the owner's ruling, but say it in the UI hint
  so "0 stuck" is not read as "healthy".
