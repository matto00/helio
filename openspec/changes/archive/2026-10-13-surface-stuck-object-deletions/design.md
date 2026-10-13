## Context

See proposal.md (Why). The queue is `stored_object_deletions` (V128, V132). `StoredObjectDeletionRepository.claim`
skips any row with `attempts >= maxAttempts` (both the legacy `not_before IS NULL` branch and the new-style
`claimed_at = 'infinity'` branch); `recordFailure` bumps `attempts`, stamps `last_attempt_at`, clears the lease and,
for a new-style row, moves `not_before` by `LEAST(3600, 60 * 2^attempts)` s. The cap is
`StoredObjectDeletionService.DefaultMaxAttempts = 10`; `Main.scala` builds the drain with the defaults. The table is
ENABLE + FORCE RLS with no policy; every access is `DbContext.withSystemContext`, which in production is
`helio_privileged` (BYPASSRLS, V128 comment and grants). `GET /api/admin/usage` is `AdminUsageService` (built in
`ApiRoutes.scala:354` from `ProductUsageRepository`), `AdminUsageTotals` in `AdminUsageProtocol.scala`, schema
`schemas/admin/admin-usage-response.schema.json` (`totals` is `additionalProperties: false`, every field required),
frontend `features/adminUsage` (`types/adminUsage.ts`, `adminUsage.fixture.ts`, `adminUsage.contract.test.ts`,
`ui/UsageTotals.tsx`). `AdminUsageRoutesSpec.scala:205` already validates the real serialised body against the schema.

## Goals / Non-Goals

**Goals:** live queued/stuck counts in `totals`; a 24 h re-arm of capped rows for both row kinds.
**Non-Goals:** ERROR logs, metrics, alerting, per-row detail, migrations, changing cap/backoff/lease/deferral.

## Decisions

**D1. Re-arm is a separate UPDATE at the start of every pass, not a change to `claim`.**
`StoredObjectDeletionRepository.rearm(cutoff, maxAttempts): Future[Int]`, called by `StoredObjectDeletionService.pass()`
before `claim` (inside the existing in-flight guard). A re-arm failure is logged (exception class only) and recovered
on its own, so the claim in the same pass still runs:

    UPDATE stored_object_deletions
    SET attempts = 0,
        claimed_at  = CASE WHEN not_before IS NULL THEN NULL ELSE claimed_at END,
        lease_until = NULL
    WHERE attempts >= $maxAttempts
      AND last_attempt_at IS NOT NULL
      AND last_attempt_at <= $cutoff

A capped row with a NULL `last_attempt_at` is never re-armed (the `<= $cutoff` comparison is already NULL, so false,
for it; the explicit `IS NOT NULL` is documentation only and not a mutation target -- the guarding mutation is
`(last_attempt_at IS NULL OR last_attempt_at <= $cutoff)`): the drain cannot produce one (every attempt bump goes
through `recordFailure`, which stamps it), so such a row came from hand SQL and stays stuck and visible in the stuck
count rather than being retried with no cool-down. With `cutoff = now - rearmAfterSeconds` (new constructor param, `DefaultRearmAfterSeconds = 86400L`; no env var).
After the reset the row is due at once under the existing claim: legacy backoff with `attempts = 0` is 30 s after
`last_attempt_at` (24 h ago); a new-style row's `not_before` is at most `last_attempt_at + 3600` s. `claimed_at` of a
new-style row is never touched, so it stays `'infinity'` (V132 D6 invariant: V128-era claim SQL can never match it).
Alternatives: (a) add a time clause to `claim` without resetting `attempts`: the row would then retry hourly forever
instead of in bounded bursts of 10, and the SQL doubles in both branches; (b) a dedicated timer: the scheduler tick
already drives the drain. A positive count is logged once per pass at INFO (`Re-armed N stuck stored-object
deletion(s)`), never with keys. Re-arm is idempotent across instances; a capped row is never leased, so it cannot race
a live claim.

**D2. Counts are one statement on the queue repository, using the drain's cap constant.**
`StoredObjectDeletionRepository.queueCounts(maxAttempts): Future[QueueCounts(queued, stuck)]` =
`SELECT count(*), count(*) FILTER (WHERE attempts >= $maxAttempts) FROM stored_object_deletions` via
`withSystemContext`. `AdminUsageService` takes the repository as a new constructor dependency and passes
`StoredObjectDeletionService.DefaultMaxAttempts` (the single source of the cap; the drain is built with the same
default). Read in both the rolled-up and the empty (`rolled_through` null) paths. The queue is small in steady state
and the statement is a single scan; no index. Alternative: reading counts through the drain service instance: it is
built in `Main`, not in `ApiRoutes`, and would couple the route tree to the scheduler.

**D3. Wire shape: two required, non-null integer fields on `totals`.**
`storedObjectDeletionsQueued` and `storedObjectDeletionsStuck` (`Long`, `jsonFormat4` -> `jsonFormat6`, not in the
`nullingNones` list). Schema: both `{"type":"integer","minimum":0}`, added to `required`; `totals.description` and the
top-level description updated (no longer "rollups plus one count of users"). Frontend `AdminUsageTotals` gains
`storedObjectDeletionsQueued: number; storedObjectDeletionsStuck: number`; fixture and contract test (accept, and reject
an omitted field) updated; every other literal `AdminUsageTotals` in tests updated.

**D4. UI: a separate "Storage cleanup" section, not two more cells in "All-time totals".** The queue counts are a live
snapshot, not all-time totals, and the totals grid is 3 columns (`AdminUsagePage.css:38-40`), so 5 cells would leave a
3 + 2 row with an empty cell. A new `ui/StorageCleanup.tsx` renders a `<section>` reusing the totals card's classes
(`admin-usage__totals` wrapper, `admin-usage__section-title` heading "Storage cleanup", `admin-usage__muted` note
"Live at page load. Stuck rows are retried 24 h after their last attempt.") directly below the totals card, with two
existing `Stat` entries: "Queued deletions" (hint: stored objects waiting to be removed) and "Stuck deletions" (hint:
reached the retry limit). The note carries the re-arm caveat so the hint stays short. Layout: the shared `admin-usage__stats` grid plus one new modifier `admin-usage__stats--pair`
(`repeat(2, minmax(0, 1fr))`), mirroring the existing `--totals` modifier and its responsive overrides; tokens only.
The API keeps both fields in `totals` (owner ruling); only the page groups them separately. Alternative: a 5-column
totals grid: crowds the card and still mislabels live counts as all-time.

**D5. The per-failure WARN stays as is.** It names key and exception class only and is the one place the cause of a
failure is visible; the owner chose the admin view over a log, and nothing found argues for changing it.

## Risks / Trade-offs

- [RLS-filtered zero] The queue has no policy, so any non-BYPASSRLS session reads 0 rows without error: a wrong pool
  would show "0 stuck" forever. -> Counts use `withSystemContext`, and a test proves non-zero counts under a NOSUPERUSER
  login with `helio_privileged` created BYPASSRLS and only V128's grants (the `StoredObjectDeletionsMigrationSpec`
  recipe). `ProductUsageRepositoryRoleSpec` creates `helio_privileged` NOBYPASSRLS, so it will read 0 queue rows there;
  it must keep passing but is not evidence for the counts.
- [Re-arm deletes something referenced] -> the reference classification runs on every claimed row, re-armed or not;
  a test seeds a referenced key on a re-armed row.
- [Old revision during rollout] A legacy row re-armed by the new revision is claimable by V128-era code too, which
  handled the same legacy keys before; new-style rows stay `'infinity'`.
- [Count cost] `count(*)` over the queue on each admin page load; owner-only, low traffic, small table.

## Migration Plan

No migration. Deploy is additive; rollback leaves re-armed rows as ordinary queue rows.

## Planner Notes

- Docs: `CLAUDE.md`'s `GET /api/admin/usage` line ("reads the rollup tables only ... plus one identifier-free `users`
  count") gains the queue counts.
- Stuck-count semantics (skeptic design-1 note): resetting `attempts` discards re-arm history, and a persistently
  failing row is out of the stuck count during each re-attempt burst; accepted within the owner ruling, stated in the
  section note.
- Self-approved: re-arm reset to `attempts = 0` (bounded bursts) rather than an unbounded hourly retry; INFO count log
  on re-arm; constructor-param cool-down without env var; field names `storedObjectDeletionsQueued/Stuck`; counts shown
  without warning emphasis.
- Owner rulings (escalation 2026-10-13): Q1 `admin-view`, Q2 `rearm-24h`.
