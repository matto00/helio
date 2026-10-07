## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 0d28f43f036f0bfed63216c406572dca83a3dece; the change dir is untracked. I did not run sbt. Every conclusion below comes from source I read myself. I treated the round-1 report and the planner's artifacts as claims and checked them.

### What I verified (with evidence)

**The diagnosis holds, checked from source.**
- `ProductEventRollupServiceSpec.scala:85` is `countEvents("signup_completed") shouldBe 400 + otherUsers`. It runs before any tick, and the Clock is pinned at :18.
- The fixture at :69-71 inserts `'bf' || g || '@t.local'`.
- The cleanup at :73 is `LIKE 'bf%@t.local'`, and `otherUsers` at :76 is `NOT LIKE 'bf%@t.local'`.
- `ProductTelemetryDbHarness.scala:35-36,84-85` creates userA/userB once, in `beforeAll`, as `<UUID.randomUUID>@t.local`.
- V10 is the only migration that seeds a user (grep of `INSERT INTO users` in `db/migration`). `V6__users.sql:3` has `email TEXT UNIQUE NOT NULL` with no format check, so `@backfill.invalid` inserts cleanly.
- V114 inserts one `signup_completed` row per `users` row, so 400 + 3 = 403. With a `bf` harness UUID, `otherUsers` = 2, giving 403 vs 402.
- The owner ruling `proceed-with-restated-scope` is in `.concertino/runs/HEL-1360/events.jsonl` (line 3, answer_source human).

**Round-1 CR1 is fixed.**
- Design Decision 2 and task 3.3 now both specify the FULL revert of Decision 1 and name the exact required failure: `404 was not equal to 403` at :85.
- I checked the arithmetic myself. 3.3 runs after the force is removed (3.2). Under the full revert the decoy (`bf222222-…@t.local`) matches `bf%@t.local`, so `otherUsers` = system + A + B = 3. The backfill still inserts 400 + 4 rows, so the result is 404 vs 403.
- This mutation fails only because of the decoy. Without the decoy it would be 403 == 403, green. So it is a genuine mutation of the guard, not evidence-shaped non-evidence.

**Round-1 CR2 is fixed (AC3 now has a signal).**
- Decision 2a adds a permanent exact-id survivor check, plus a red-first step (1.2).
- I traced 1.2 on the unmodified tree with userA forced to `bf111111-…`:
  - Test 5's body throws at :85, so per 2a the survivor check is skipped, but the cleanup deletes userA.
  - Tests 6 and 7 have no user-count assertions, so their bodies pass. Their survivor check then finds A/B count = 1 instead of 2, and fails.
  - The task's claim ("check fail in the later V114 tests because cleanup deleted userA") is therefore correct.
  - Under 3.3's full revert, tests 6 and 7 also fail the 3-id survivor check because the `LIKE` cleanup deletes the decoy. So the guard can be failed by mutation, as 2a says.

**Expected value after the fix.**
- With the force on (3.1), the non-backfill users are system, forced A (now counted), B and the decoy: 4, so 404 == 404.
- With the force off (3.2), the same count gives 404 == 404.
- The equality stays exact and nothing is loosened (C2), which satisfies AC2.

**Sibling tests are unaffected.**
- The decoy is inserted before the `created_at` UPDATE (:68), so it lands on 2026-09-23. That day is already covered by bf g=10, so `COUNT(DISTINCT day) = 400` (:96, :117) and `minusDays(401)` (:113) still hold.
- `SUM(event_count)` at :97 uses the same `otherUsers`, so it stays consistent.
- The decoy's signup rows are cleared by `beforeEach` and by the `ON DELETE CASCADE`. Its delete by exact id runs in its own `finally`, so it cannot leak.

**Ambiguity and literals.**
- The forced literal (`bf111111-1111-4111-8111-111111111111`) and the decoy literal (`bf222222-2222-4222-8222-222222222222`) are distinct, valid UUIDs, so the decoy insert cannot hit a PK/email conflict.
- 3.2 requires the harness to be byte-identical to main, so the force cannot ship.

**AC coverage.**
- AC1 is covered by 1.1 (red) and 3.1 (green).
- AC2 is covered by C2 and Decision 2's risk note.
- AC3 is covered by 2a, 1.2 (red), 2.2, and the 3.3 tests 6/7 failures.

**Scope.**
- The change touches one test file only. There are no production, migration or contract changes, so `skip_specs: true` is appropriate and no spec delta is needed.

**Placeholders.**
- There are no TODO or TBD markers, and no decision is deferred.

### Verdict: CONFIRM

### Non-blocking notes
- Task 3.3's phrase "any other failure does not count" means a *different* failure in place of the :85 one does not satisfy the task. The executor should expect the 3.3 log to also show survivor-check failures in tests 6 and 7. Those are additional evidence for AC3, not a disqualifier, so record them rather than "fixing" them.
- In 1.2 the survivor check's expected count is implicitly 2 (userA + userB). 2.2 raises it to 3 once the decoy exists. Make sure the committed form is the 3-id version.
- The survivor check should run after the backfill cleanup and before the decoy delete. The shape is: an inner `try body finally <backfill delete>`, then the survivor check, all wrapped in an outer `finally` that does the decoy delete by id. That ordering is what Decision 2a describes. Placing the check after the decoy delete would make it vacuous for the decoy.
- Per C3, confirm in every log that all 7 tests ran (sbt 2 cache no-op hazard).
