## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/rollup-spec-clock-independent/HEL-1247`.
- Reviewed HEAD `c26c3056785e7a5a1d7a33508a039aa66b24a5a1` (main tip; change dir untracked, no code changes yet).
- HEL-1360 re-scope claim holds: commit `33dcf8fd2` ("Stop ProductEventRollupServiceSpec miscounting a bf-prefixed harness user") exists; archive `2026-10-07-rollup-spec-bf-email-collision/ticket.md:12` cites the 03:10 UTC sighting and diagnoses `403 vs 402` as the `bf` collision. So the re-scope to the remaining whole-table-count hazard is justified.
- The latent hazard is real (derived from code, not the probe narrative):
  - `ProductEventRollupServiceSpec.scala:90` `otherUsers` counts every non-`@backfill.invalid` row in `users` at assertion time.
  - `V114__backfill_signup_completed_events.sql` loops `SELECT id, created_at FROM users` and inserts a signup at `u.created_at` for every user, including any created after the pin.
  - `ProductEventRollupService.scala:26-35` rolls only `from..today` where `today` comes from `tickAt(now)` = 2026-10-03; a signup on a later wall-clock day is never in the SUM at `:111`.
  - `ProductTelemetryDbHarness.newUser()` inserts with `now()`.
  - Arithmetic of the claimed probe agrees: pinned non-backfill users = V10 system user + userA + userB + decoy = 4, so SUM 404 vs expected 400 + 7 = 407. The `:113` line number fits a 2-line probe insertion that shifts `:111`. I did not re-run the probe; the conclusion does not depend on it.
- Per-suite EmbeddedPostgres (harness `beforeAll`) and `beforeEach` table wipes confirmed, so cross-spec residue is ruled out as stated.
- Decision 3's late user (2026-10-05) does not disturb the other two V114 tests: V114 orders by `created_at`, so `earliest_day` (and `rolled_through = minusDays(401)`) is unchanged, and the 10-03 tick never rolls 10-05, so `COUNT(DISTINCT day) = 400` holds.
- Mutation 3.3 reasoning checks out: with Decision 2 reverted and the late user kept, `:99` passes (whole-table raw = 400 + roster + 1 = 400 + otherUsers) and the SUM fails 400+roster vs 400+roster+1.

### Verdict: REFUTE

### Change Requests
1. **Internal contradiction: Decision 2's whole-table assertion vs AC2 and task 3.1.** design.md Decision 2 adds "assert the raw whole-table signup count is exactly `400 + roster.size + 1`". V114 backfills a signup for every `users` row, so the task 3.1 probe (three `newUser()` rows in the body, fixed spec) makes that count `400 + roster.size + 4`, and the spec goes **red**. Task 3.1 says that run must be green. ticket.md AC2 says the spec stays green "including with an extra unpinned `users` row present". The design's own Risks bullet ("A future author calls `newUser()` inside the body ... the whole-table assertion then fails loudly ... That is the desired loud failure") says the opposite of AC2. Pick one behaviour and make every artifact agree. Because AC2 is explicit, the expected fix is to drop the whole-table `400 + roster.size + 1` assertion, or replace it with something that unpinned rows cannot break. One option: assert exactly one `signup_completed` row for the late user's id, plus `eventCount(2026-10-05, ...) shouldBe None`. Then update the Risks bullet. If the planner wants the loud failure instead, AC2 and task 3.1 must change, and that is a scope decision against the ticket's AC. It would need an escalation, not a quiet edit.
2. **Pin the late user's insertion point relative to the roster read.** Decision 1 says the roster is read before the late user is inserted. Decision 3 and task 2.3 only say the late user is inserted "after the pin". If an implementer inserts it between the UPDATE and the roster `SELECT`, the late user joins the roster. The scoped expectations then silently include its unrolled 10-05 signup, and the SUM goes red. Make task 2.3 say "after the roster capture (Decision 1)". Also say the late user is not pinned by the UPDATE.
3. **Mutation 3.3 message check after CR1.** If CR1 removes the whole-table assertion, re-state the exact expected mutation failure (`400+roster` vs `400+roster+1` at the SUM line, e.g. `404 was not equal to 405`). The evaluator then has a precise string to check. Today the design gives only a "`404 was not equal to 405`-shaped" phrasing.

### Non-blocking notes
- Task 1.1 hard-codes `404 was not equal to 407`. That holds only while V10 seeds exactly one user. That is fine, but the log is the evidence, not the literal.
- The `newUser()` probe in 3.1 relies on the wall clock being after 2026-10-03 (true today). The permanent late-user guard is what makes the property date-independent. Good.
