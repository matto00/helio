## Context

See ticket.md (premise validation) and proposal.md. In `ProductEventRollupServiceSpec.scala`, `withHistoricalUsers`
(lines 70-88) inserts the `bf` decoy, pins every existing user's `created_at` to 2026-09-23 with an unconditional
UPDATE, then inserts 400 `@backfill.invalid` users dated 1..400 days before 2026-10-03 09:00Z. `otherUsers` (line 90)
counts `users WHERE email NOT LIKE '%@backfill.invalid'` at assertion time. The V114 "roll up in ONE tick" test asserts
`countEvents("signup_completed") shouldBe 400 + otherUsers` (lines 99, 118) and the rollup
`SUM(event_count) ... shouldBe 400L + otherUsers` (line 111) after `tickAt(BackfillNow = 2026-10-03T12:00Z)`.

The rollup only covers days up to `BackfillToday` (2026-10-03). Any non-backfill user created after the pin carries a
`created_at` the fixture does not control (`now()` via `newUser()`); V114 backfills its signup on that day. If the day
is after 2026-10-03 (every day since), `otherUsers` counts it but the rollup SUM cannot: red. Probe (2026-10-08, three
`newUser()` at the top of the body): `404 was not equal to 407 (ProductEventRollupServiceSpec.scala:113)`. The service
and repository read no wall clock (`tickAt(now)`; purge/rollup take `now: Instant`), and the per-suite EmbeddedPostgres
rules out cross-spec residue.

## Goals / Non-Goals

**Goals:** expected counts derived only from users the fixture itself pinned to literal timestamps; a deterministic
standing guard for the after-the-anchor user; red first, green after; exact equalities.

**Non-Goals:** see proposal.md. No production, harness, or migration change.

## Decisions

1. **Pin-time roster, by exact id.** Immediately after the pinning UPDATE (and before the 400 backfill users and the
   late user are inserted), `withHistoricalUsers` reads `SELECT id FROM users` into a `Set[String]` roster. Every user
   in it has the literal `created_at` 2026-09-23 10:00Z. The roster is made available to the body (e.g. the
   fixture passes it as a parameter, or a `fixtureUsers` value the tests read; executor's choice, but it must be
   captured at pin time, never recomputed at assertion time). Assert the roster contains userA, userB and the decoy.
   - Alternative: keep counting the whole table at assertion time but filter `created_at <= BackfillNow`. Rejected:
     still a whole-table count, and it filters on the very column whose wall-clock origin is the hazard.
   - Alternative: hard-code the literal 3/4 non-backfill users. Rejected: depends on which migrations seed users
     (V10 system user today), which the spec does not own.
2. **Scoped expectations.** Replace `otherUsers` with the roster. Raw signup counts (lines 99, 118) count
   `product_events` signup rows whose `user_id` is in the roster or belongs to an `@backfill.invalid` user, and
   equal `400 + roster.size`. The rollup SUM (line 111) equals `400L + roster.size`. No whole-table `users`
   or `product_events` count appears in any expected value: an extra unpinned users row (e.g. `newUser()` in the
   body) must leave the spec green (AC2). The late user (Decision 3) is checked by exact id instead: exactly one
   `signup_completed` row for its id.
3. **Permanent late-user guard.** After the pinning UPDATE AND after the Decision 1 roster capture (so the late
   user is neither touched by the pinning UPDATE nor a member of the roster), insert one non-backfill user with a fixed UUID and
   `<uuid>@t.local` email and a literal `created_at` of `2026-10-05T09:00:00Z` (after `BackfillToday`). Delete it by
   exact id in a `finally`, as the decoy is. It is exactly the hazard (`now()` after the anchor) with the date made a
   literal, so every run exercises it regardless of today's date. In the "roll up in ONE tick" test also assert
   `eventCount(2026-10-05, "signup_completed") shouldBe None` (the tick at 2026-10-03 never rolls a later day).
   Under a revert of Decision 2 (expectations back to whole-table `otherUsers`, late user kept), the rollup SUM
   assertion fails on every run with `400 + roster.size` vs `400 + roster.size + 1`, i.e. `404 was not equal to 405`
   with today's roster of 4 (V10 system user, userA, userB, decoy); the guard is failable by mutation.
   - The other two V114 tests use `withHistoricalUsers` too; their assertions are `COUNT(DISTINCT day) = 400`
     over rolled days (the late day is never rolled at a 2026-10-03 tick), `rolled_through` values (V114 lowers the
     mark to the earliest backfilled day, unaffected) and per-day event counts. Executor confirms by running the
     whole spec.
4. **Red-first proof (transcripts in the change directory, not committed code).**
   (a) Unmodified spec + three `newUser()` at the top of the "roll up in ONE tick" body: expect
   `404 was not equal to 407` (wall-clock red; depends on today > 2026-10-03, which it is). (b) Same probe after the
   fix: green. (c) Final spec with the probe removed: green. (d) Mutation: revert Decision 2 only (keep the late
   user): must fail at the rollup SUM assertion with exactly `404 was not equal to 405` (roster of 4).
   Any other failure does not count.

## Risks / Trade-offs

- [Roster read at pin time includes migration-seeded users (V10)] -> intended: they are pinned like the harness
  users; a future migration seeding more users changes `roster.size`, not correctness.
- [Late user's fixed UUID collides with a random harness UUID] -> 2^-122; ignored. Must not start with `bf` or use the
  backfill domain.
- [A future author calls `newUser()` inside the body] -> excluded from the roster and the scoped counts, and its
  wall-clock-dated signup is never inside a 2026-10-03 tick's rolled range, so the spec stays green whatever the
  date (AC2; verified by task 3.1). Only a clock set back before 2026-10-03 could put that signup into the rolled
  range; not a reachable state for this spec's real runs, out of scope.

## Planner Notes

- Self-approved: test-only scope, `skip_specs: true`. Driver pre-authorized re-scope to the remainder after
  HEL-1360; premise evidence persisted at `.concertino/runs/HEL-1247/evidence/premise-validation.md`.
