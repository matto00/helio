## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 290ab8a22c7f0adc16b4c0d070748657067081fe. The planning artifacts are untracked in the worktree.
Owner rulings Q1 `admin-view` and Q2 `rearm-24h` are confirmed in `.concertino/runs/HEL-1531/events.jsonl` line 5
(`escalation.answered`, `sub_answers ["admin-view","rearm-24h"]`). I did not reopen them.

### Round-1 change requests: re-checked against the artifacts and the code

1. **CR1 (existing cap tests): addressed.** Task 5.3 names both fixtures. I re-read them.
   `StoredObjectDeletionServiceSpec.scala:187` seeds `attempts = 10, last_attempt_at = now - 100000 s` and line 190
   asserts `present(capped)`, so D1 would break it. `FormAndConversationObjectDrainSpec.scala:368-375` seeds
   `attempts = 10` with a NULL `last_attempt_at` and passes at `+100000 s`. 5.3 moves both inside the cool-down and
   requires a cap-clause mutation. Under the revised D1 the second test would in fact stay green without any change,
   because a NULL row is never re-armed. Moving it is harmless.
2. **CR2 (NULL `last_attempt_at`): addressed in the decision.** D1 now states that a capped row with a NULL
   `last_attempt_at` is never re-armed, and gives the reason. The spec delta adds the "Capped row without a recorded
   attempt" scenario, and 5.1 has a matching case. The named mutation for this branch has a defect; see CR1 below.
3. **CR3 (boundary values): addressed.** C4, 5.1 (24 h - 1 min / 24 h + 1 min) and 5.2 (cutoff +1 h and -1 h) fix
   the boundary. Both mutations are caught: a 25 h cutoff leaves the 24 h + 1 min row armed-out, and a 23 h cutoff
   re-arms the 23 h 59 min row. The spec scenarios use the same values.
4. **CR4 (prod-role mutation): addressed.** 5.5 names the mutation: counts read on the app pool, or with
   `helio_privileged` NOBYPASSRLS, return 0 and the test goes red. The C1 recipe exists at
   `StoredObjectDeletionsMigrationSpec.scala:37-39`: a NOSUPERUSER NOBYPASSRLS login plus `helio_privileged BYPASSRLS`.
5. **CR5 (totals-card layout): addressed.** D4 adds a separate "Storage cleanup" section and gives the reasons: the
   counts are live, not all-time, and the 3-column grid would leave a 3 + 2 layout with an empty cell. It reuses the
   shared `Stat` (`ui/Stat.tsx`, which has a `hint` prop) and adds one `--pair` modifier that mirrors `--totals`
   (`AdminUsagePage.css:38-40` and `:151-153`). The existing section pattern (`admin-usage__totals`,
   `admin-usage__section-title`, `admin-usage__muted`) is already there to reuse. The spec delta for the usage page
   was updated to match.
6. **CR6 (CLAUDE.md): addressed.** Task 2.4 targets `CLAUDE.md:173`, and the text quoted in design.md Planner Notes
   matches the file.

### Fresh checks

- **Re-arm SQL against `claim`/`recordFailure`** (`StoredObjectDeletionRepository.scala:48-73`, `:159-171`):
  - A legacy row at the cap has `claimed_at` NULL. With `attempts = 0`, `power(2,-1)` gives a 30 s backoff, so the
    row is due.
  - A new-style row at the cap has `not_before = last + 3600 s`, `lease_until` NULL, and `claimed_at` still
    `'infinity'` because the CASE preserves it. It is due.
  - `claim` excludes capped rows (`attempts < $maxAttempts`, line 58), so re-arm cannot race a lease.
  - `pass()` (`StoredObjectDeletionService.scala:55-66`) takes `now` from the injected `clock`, so the cutoff is
    testable through `OffsetClock`/`withOffset`.
- **Wiring:**
  - `Main.scala:295` builds the drain with the defaults.
  - `StoredObjectDeletionService.DefaultMaxAttempts = 10` (line 82).
  - `ApiRoutes.scala:354` builds `AdminUsageService(new ProductUsageRepository(dbContext), SystemClock)`.
  - `ApiRoutes.scala:379` already builds `new StoredObjectDeletionRepository(dbContext)`, so D2's wiring follows an
    existing pattern.
  - `AdminUsageService.scala:46` (not-rolled-up path) and `:52-65` (rolled-up path) are the two sites D2/2.2 must fill.
- **Spec deltas:** both MODIFIED requirements copy the base text and all of its scenarios
  (`openspec/specs/owner-usage-admin/spec.md:23-36`, `:79-88`) and only add to them. Nothing is dropped. They do not
  conflict with "All-time active-user totals" (`:57-58`). The stored-object-lifecycle delta is ADDED, and the base
  spec has no cap or "stays queued" requirement to contradict.
- **Consumer coverage:** I grepped `activeLast30Days` outside archives. The hits are CLAUDE.md, AdminUsageProtocol,
  AdminUsageRoutesSpec, AdminUsageTotalsSpec, the schema, and the frontend fixture, types, UsageTotals, page test and
  contract test. Tasks cover every one of them; there are no e2e or MCP consumers.
- **No placeholders or TBDs.** Every ticket AC maps to a task: counts 2.1/2.2/5.4/5.5; schema, types and UI
  2.3/3.1/4.x/6.x; re-arm 1.x/5.1-5.3; WARN unchanged D5; tests 5.x/6.x.

### Verdict: REFUTE

### Change Requests

1. **Task 5.2 requires a mutation that cannot go red: "`IS NOT NULL` removed".** In D1's WHERE, the clause
   `AND last_attempt_at IS NOT NULL` adds nothing, because `AND last_attempt_at <= $cutoff` already evaluates to NULL
   (false) for a NULL `last_attempt_at`. Removing it leaves behaviour unchanged. I checked this on a live Postgres
   with a read-only VALUES probe: rows `(10, NULL)` and `(10, now() - 25 h)` filtered by
   `attempts >= 10 AND last_attempt_at <= now() - 24 h` return 1 row. The NULL row stays excluded without the
   `IS NOT NULL` clause.

   Under C2, the executor cannot record this mutation as red unless the evidence is faked or misread. Required
   revisions:
   - **(a)** Replace this mutation in 5.2 with one that does change behaviour, for example rewriting the clause as
     `(last_attempt_at IS NULL OR last_attempt_at <= $cutoff)`. That is the re-arm-immediately behaviour that round 1
     flagged and D1 now rejects. The "Capped row without a recorded attempt" test must go red against it.
   - **(b)** Either drop the redundant `IS NOT NULL` from D1/1.1, or keep it and state that it is documentation only
     and not a mutation target.

### Non-blocking notes

- D4 does not name the wrapper and note classes for the new section. The obvious reuse is `admin-usage__totals`,
  `admin-usage__section-title` and `admin-usage__muted`. The final gate will judge the result visually in both
  themes.
- The "Stuck deletions" hint in D4 is long, about 150 characters, for a `Stat` hint. Consider a shorter hint and
  moving the "0 is not proof" caveat into the section note.
- 5.5 does not name which spec file hosts the prod-role proof. The recipe is clear enough, but the evaluator will need
  the file named in the evidence.
