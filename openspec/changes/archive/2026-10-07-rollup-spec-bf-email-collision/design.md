## Context

See proposal.md (Why). In `ProductEventRollupServiceSpec.scala`, `withHistoricalUsers` (lines 66-74) inserts 400
users with `'bf' || g || '@t.local'` emails. It deletes them in `finally` with `email LIKE 'bf%@t.local'`, and
`otherUsers` (line 76) counts `email NOT LIKE 'bf%@t.local'`. `ProductTelemetryDbHarness` (lines 84-85) inserts
userA/userB with `<UUID.randomUUID>@t.local`. A passing run has 3 non-backfill users (V10 `system@helio.internal`,
userA, userB), so line 85 asserts 403 == 403. With a `bf…` harness UUID, `otherUsers` = 2: expected 402, actual 403.

## Goals / Non-Goals

**Goals:** the backfill selector matches exactly the 400 fixture users, whatever the harness UUIDs are, and a
standing guard makes the collision case run on every execution.

**Non-Goals:** see proposal.md (Non-goals). No change to the harness, V114, or any production code.

## Decisions

1. **Unambiguous backfill email domain.** The fixture uses `'bf' || g || '@backfill.invalid'`, and both the cleanup
   and `otherUsers` select `email LIKE '%@backfill.invalid'`. No harness, `newUser()` or V10 email uses that domain
   (`.invalid` is RFC 2606-reserved), so no UUID can collide.
   - Alternative: keep `@t.local` with a non-hex prefix such as `backfill-`. Rejected: it still relies on the harness
     never producing that prefix, and the domain makes the intent explicit.
   - Alternative: select the backfill users by recorded ids. Rejected: the 400-row `generate_series` insert would
     need `RETURNING` plumbing for no extra safety over a reserved domain.
2. **Permanent decoy user.** Inside `withHistoricalUsers`, before the `created_at` UPDATE, insert one non-backfill
   user with a fixed UUID starting `bf` and email `<that uuid>@t.local`, the exact shape of a colliding harness user.
   Delete it in `finally` by exact id. Its signup row is counted by `countEvents`, and it must be counted by
   `otherUsers`. A FULL revert of Decision 1 (fixture email
   and both selectors back to `bf…@t.local`) makes line 85 fail `404 was not equal to 403` on every run, so the guard can be failed by
   mutation.
2a. **Permanent survivor guard (AC3).** `withHistoricalUsers` asserts, once `body` has completed without
   throwing and the backfill cleanup has run, that userA, userB and the decoy all still exist (an exact-id count of
   3). The decoy is then deleted by exact id in its own `finally`, so it never leaks into a later test whatever
   happens. If the body throws, the survivor check is skipped so the body's real failure is not masked; the cleanup
   still runs. Under the full revert of Decision 1 the cleanup's `bf%@t.local` deletes the decoy, so this guard can
   be failed by mutation too.
3. **Red-first proof (transcript only, not committed code).** On the unmodified tree, temporarily force harness
   userA's UUID to a `bf`-prefixed literal and run the spec: expect `403 was not equal to 402` at line 85. Revert
   that, then apply Decisions 1-2 and run again with the same forced UUID: expect green. Then run with the force
   removed. Keep the transcripts as files inside the worktree's change directory.

## Risks / Trade-offs

- [The decoy adds a 4th non-backfill user, so the expected value moves from 403 to 404] → expected stays
  `400 + otherUsers`, computed the same way, and the equality stays exact. Nothing is loosened.
- [The decoy's fixed UUID could clash with a random harness UUID] → probability 2^-122; ignored.
- [The other two V114 tests also use `withHistoricalUsers`] → their assertions don't depend on user counts beyond the
  backfilled days (`COUNT(DISTINCT day)` = 400). The decoy shares the pre-existing users' `created_at` day
  (2026-09-23), which a bf user already occupies, so the day counts are unchanged. The executor must confirm this by
  running the whole spec.

## Planner Notes

- Self-approved: test-only scope, `skip_specs: true`, `.invalid` domain choice.
- Owner ruling 2026-10-07 (ticket-drift escalation): `proceed-with-restated-scope`.
