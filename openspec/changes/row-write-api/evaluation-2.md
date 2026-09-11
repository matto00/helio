## Evaluation Report — Cycle 2 (evaluation-2.md)

### Phase 1: Spec Review — PASS
Issues: none. Re-checked tasks.md 5.7 against the new test (commit 81c7d76c) — the sub-case
explicitly required ("include a concurrent-appends-jointly-exceeding-the-limit case ... to prove
the check runs inside the lock, not before it") is now present and matches
`dataset-row-write-api/spec.md`'s "Two concurrent appends cannot jointly exceed the row limit"
scenario. No other planning-artifact drift since cycle 1 (only the one test file + evaluation-1.md
were touched by this commit — confirmed via `git show 81c7d76c --stat`). No scope creep.

### Phase 2: Code Review — PASS
Gates re-run fresh in `WORKTREE_PATH` (not trusted from the executor's report):
- `sbt test`: 4136 tests (was 4135 in cycle 1; +1 for the new case), 0 failed, 0 canceled — PASS.
- `npm run lint`: 0 warnings — PASS.
- `npm run format:check`: PASS.
- `npm test` (root jest + frontend jest): 25 suites/248 tests + 301 suites/3198 tests, all passed — PASS.
- `npm --prefix frontend run build`: succeeded — PASS.
- `node scripts/check-schema-drift.mjs`: in sync — PASS.
- `node scripts/check-openspec-hygiene.mjs`: clean — PASS.

**Verification of the specific fix (does the new test actually prove what it claims):**
Read `DataSourceRepository.appendRows` (lines 366-411). The row-count guard is:
```
_              <- lockSource(id)                              // FOR UPDATE, line 375
...
existingRows  <- rowsTable.filter(...).result                 // fresh read, line 384 -- AFTER the lock
existingCount  = existingRows.size
result <- if (existingCount + newRows.size > maxRows) ... Left(...) else ...
```
`lockSource` (line 355-356) is a `SELECT ... FOR UPDATE` on the `data_sources` row, acquired before
the row-count read, so a second concurrent transaction targeting the same source id blocks at the
lock until the first commits, then re-reads `existingRows` fresh (not a value captured before the
lock).

The new test (`DataSourceRepositorySpec.scala:487-502`) sets up 1 existing row + `maxRows=2`, then
issues two concurrent single-row `appendRows` calls via `f1`/`f2` created before either is awaited,
joined with `Future.zip` — the same construction pattern as the existing genuinely-parallel test
immediately above it (line 460-479, `two concurrent appendRows calls ... no lost rows`), which
already establishes that this construction produces two overlapping DB transactions rather than
two sequential calls. This is a real race, not a sequential test dressed up as concurrent:
- If the count check ran on a value read **before** the lock (the bug this test targets), both
  transactions could read `existingCount = 1` before either commits, both compute `1 + 1 = 2 <= 2`,
  and both would be admitted — landing 3 total rows, violating `maxRows`.
- With the actual implementation, the second transaction to acquire the lock re-reads
  `existingRows` fresh under `FOR UPDATE` and sees the first writer's committed row (whether it won
  or lost the race), computing `2 + 1 = 3 > 2` and correctly rejecting.
The assertions match this: `results.count(_.isLeft) should be >= 1` (at least one rejected —
correctly not asserting exactly one, since both could legitimately be rejected depending on
interleaving), the exact rejection message is checked, and `finalCount should be <= 2` independently
re-reads the persisted rows rather than trusting the in-memory `Either` results. This is sufficient
to fail under the pre-lock-check bug and pass under the current (correct) implementation.

No other code changes were made in this commit (test-only + evaluation-1.md), so no new code-quality
surface to review beyond what cycle 1 already cleared.

### Phase 3: UI Review — N/A
No `frontend/**`, `backend/src/main/scala/routes/ApiRoutes.scala`, `schemas/**`, or
`openspec/specs/**` changes in this commit (test-only). Unchanged from cycle 1's N/A determination.

### Overall: PASS
