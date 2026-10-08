## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/rollup-spec-clock-independent/HEL-1247`.
- Reviewed HEAD `c26c3056785e7a5a1d7a33508a039aa66b24a5a1`. The worktree contains only the untracked change dir, so there are no code edits yet.
- Re-read the spec (`ProductEventRollupServiceSpec.scala:56-149`), `ProductTelemetryDbHarness` (`newUser()` inserts with `now()`, `:41-44`; userA/userB use `now()`, `:84-85`; `countEvents` counts the whole table, `:51`), and `V114__backfill_signup_completed_events.sql`. V114 loops over every `users` row ordered by `created_at`. It sets `earliest_day` from the first inserted row and lowers the mark only when the mark is >= that day.

**Round-1 CR1 (whole-table +1 assertion contradicts AC2/task 3.1): addressed.**
- design.md Decision 2 now says: "No whole-table `users` or `product_events` count appears in any expected value: an extra unpinned users row ... must leave the spec green (AC2)."
- The late user is checked by exact id instead ("exactly one `signup_completed` row for its id").
- The Risks bullet now agrees with AC2.
- Task 3.1 (probe on the fixed spec stays green) holds up when I trace it. Three `now()` users dated 2026-10-08 are excluded from roster-scoped raw counts. A 10-03 tick never rolls their signups, so the SUM is unaffected. `COUNT(DISTINCT day) = 400` still holds.

**Round-1 CR2 (late-user insert before the roster capture): addressed.**
- Decision 1 says the roster is read "Immediately after the pinning UPDATE (and before the 400 backfill users and the late user are inserted)".
- Decision 3 and task 2.3 both say "after the pinning UPDATE AND after the ... roster capture", so the late user is "neither touched by the pinning UPDATE nor a member of the roster".

**Round-1 CR3 (exact mutation failure string): addressed.**
- Decision 4(d) and task 3.3 name "exactly `404 was not equal to 405`" at the rollup SUM assertion. Any other failure does not count.
- I checked the trace under the mutation (expectations back to whole-table `otherUsers`, late user kept):
  - `otherUsers` = roster(4) + late(1) = 5.
  - `:99`: the whole-table raw count is 400 + 4 + 1 = 405, which equals the expectation, so it passes.
  - `:109` (rolled_through) and `:110` (400 distinct days; the 10-05 day is never rolled) pass.
  - `:111`: SUM = 404 vs 405, so it fails with ScalaTest's `404 was not equal to 405`.
  - The new late-user assertions (one row by id; `eventCount(2026-10-05)` = None) pass under the mutation, so they cannot pre-empt the SUM failure.

**New-defect sweep:**
- The other two V114 tests are unaffected by the late user:
  - V114 visits users in `created_at` order, so `earliest_day` stays at BackfillToday-400 and `rolled_through = minusDays(401)` holds at `:127`.
  - The 10-05 day is never rolled by a 10-03 tick, so `:131` stays 400.
  - `:142`/`:147` concern provenance_opened only.
- The signup purge exemption keeps the late user's row, so the by-id check is stable after the tick.
- The roster is read before the 400 backfill users exist, so it holds V10 system user, userA, userB and decoy. All four are pinned to a literal date. The decoy is inserted with `now()` but is pinned by the UPDATE before the roster read.
- Scoped raw count = roster ids plus `@backfill.invalid` users. The backfill users still exist at assertion time; they are deleted only in the `finally` after the body.
- AC4 (no production/harness/migration change) is respected: the only impacted file listed is the spec.
- Every AC traces to a task:
  - AC1 -> 2.1/2.2
  - AC2 -> 3.1/3.4 plus the late-user guard
  - AC3 -> 1.1/3.1/3.3
  - AC4 -> C2/C4
- No placeholders or TBDs. The roster plumbing choice (parameter vs value) is explicitly delegated, and the constraint "captured at pin time, never recomputed" is stated, so either reading is acceptable.

### Verdict: CONFIRM

### Non-blocking notes
- AC2 literally says green "before, on, or after 2026-10-03 ... including with an extra unpinned `users` row present". The design honestly carves out a wall clock before 2026-10-03 combined with a `newUser()` inside the body: the rollup SUM would then include that signup. The shipped spec has no unpinned rows, so it is fully date-independent as written. The carve-out only affects a hypothetical future edit under a backdated clock, so it is reasonable to accept. The evaluator should not treat it as an unmet AC.
- Binding a `Set[String]` roster into a Slick `sql` interpolation needs care: for example `= ANY(?::uuid[])` or a `#$`-built list of literal UUIDs. The executor should not fall back to recomputing the roster from `users` at assertion time, which the design forbids.
- The task 1.1 literal `404 was not equal to 407` (and 3.3's `404`/`405`) assumes V10 seeds exactly one user, i.e. a roster of 4. The saved logs are the evidence.
