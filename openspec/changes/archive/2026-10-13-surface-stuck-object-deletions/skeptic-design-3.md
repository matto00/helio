## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 290ab8a22c7f0adc16b4c0d070748657067081fe. The planning artifacts are untracked in the worktree.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/surface-stuck-object-deletions/HEL-1531`.
The owner rulings are confirmed in `.concertino/runs/HEL-1531/events.jsonl` (`escalation.answered`,
`sub_answers ["admin-view","rearm-24h"]`, `answer_source: human`). I did not reopen them.

### Round-2 change request: re-checked

- **CR1(a), the mutation that could not go red: addressed.** Task 5.2 no longer lists "`IS NOT NULL` removed". It now
  lists "WHERE widened to `(last_attempt_at IS NULL OR last_attempt_at <= cutoff)`", and says the NULL-row test goes
  red against it. That mutation does change behaviour: it re-arms a capped NULL row at once. Task 5.1 has the
  matching "capped row with NULL `last_attempt_at` not re-armed" case, and the spec delta has the scenario "Capped
  row without a recorded attempt".
- **CR1(b): addressed.** D1 and task 1.1 now say that `IS NOT NULL` is documentation only and not a mutation target.
  They name the guarding mutation explicitly.
- **Round-2 non-blocking notes were also taken up:**
  - D4 names the reused classes (`admin-usage__totals`, `__section-title`, `__muted`).
  - The "Stuck deletions" hint is now short ("reached the retry limit"). The re-arm caveat moved to the section note.
  - Task 5.5 names `StoredObjectDeletionsMigrationSpec.scala` as the host of the prod-role proof.

### Fresh verification against code

- **The re-arm SQL against `claim` and `recordFailure`** (`StoredObjectDeletionRepository.scala`, read fresh).
  - `claim` excludes rows with `attempts >= maxAttempts`, in both branches.
  - `recordFailure` stamps `last_attempt_at`. For a legacy row it nulls `claimed_at`. For a new-style row it sets
    `not_before = now + LEAST(3600, 60*2^attempts)` and leaves `claimed_at` alone.
  - After D1's reset to `attempts = 0`, a legacy row has a 30 s backoff from a last attempt at least 24 h old, so it
    is due.
  - A new-style row's `not_before` is at most `last + 3600 s`. `lease_until` is NULL and `claimed_at` stays
    `'infinity'` through the CASE, so it is due and V132's D6 invariant holds.
  - A capped row is never leased, so the re-arm cannot race a claim.
- **Where the re-arm hooks in.** `StoredObjectDeletionService.pass()` takes `now` from the injected `clock` and runs
  inside the `inFlight` guard of `runPass`, so the re-arm can go there. `DefaultMaxAttempts = 10` is in the companion
  object. The reference classification runs on every claimed row (`process`), so a re-armed row is still guarded.
- **The two cap fixtures in task 5.3 exist as described.**
  - `StoredObjectDeletionServiceSpec.scala:187` sets `attempts = 10, last_attempt_at = now - 100000 s` and asserts
    `present(capped)`. D1 would break it, so moving it is required.
  - `FormAndConversationObjectDrainSpec.scala:368-375` sets `attempts = 10` with a NULL `last_attempt_at`.
- **The two `AdminUsageService` paths.** The not-rolled-up path is `AdminUsageTotals(n, None, None, None)` after
  `totalUsers()`. The rolled-up path is the for-comprehension. Both sites exist, as D2 states. The constructor is
  `(repo, clock)`. The call sites are `ApiRoutes.scala:354`, `AdminUsageServiceSpec:34`, `AdminUsageTotalsSpec:33`
  and `ProductUsageRepositoryRoleSpec:89`, which matches task 5.4.
- **The prod-role proof (C1) can be built.**
  - `DbContext.withSystemContext` = `privilegedDb.run(action.transactionally)`.
  - `ProductUsageRepositoryRoleSpec:59-71` shows how to build a `DbContext` from a NOSUPERUSER login pool plus a
    `SET ROLE helio_privileged` pool.
  - `StoredObjectDeletionsMigrationSpec:37-39` creates `helio_privileged BYPASSRLS` and does not flip it.
  - Task 5.5's mutation reads through the owner/app pool. The table is FORCE RLS with no policy, so even the table
    owner reads 0 there, and the mutation is red.
- **Schema.** `totals` is `additionalProperties: false`, with `required = [totalUsers, activeLast7Days,
  activeLast30Days, asOf]`. Task 2.3 adds both fields as required, so the "fails against the pre-change schema" leg of
  task 5.6 holds.
- **UI.** `.admin-usage__stats--totals` is 3 columns (`AdminUsagePage.css:38-40`) and collapses to 1 column at
  `:151-153`. The base `__stats` grid is 2 columns at `:139-141`. A `--pair` modifier that mirrors this gives a clean
  2-column layout and then 1 column. `UsageTotals.tsx` is the only non-type importer of `AdminUsageTotals` in
  `frontend/src`. `CLAUDE.md:173` contains the "plus one identifier-free `users` count" text that task 2.4 targets.
- **Acceptance-criteria coverage.**
  - The counts on both paths, owner-only and identifier-free, are covered by 2.1/2.2/5.4/5.5.
  - Schema, types, fixture, contract and card are covered by 2.3/3.1/4.x/6.1-6.2.
  - The re-arm for both row kinds, `'infinity'` kept, and the reference check still applying are covered by
    1.x/5.1-5.3.
  - "WARN unchanged" is D5.
  - The tests at the cap vs. below it, at the boundary, and under the prod role are covered by 5.1/5.2/5.4/5.5.
- **Placeholders, contradictions and scope drift.** There are no TBD/TODO entries. The proposal, design, tasks and
  spec deltas agree with each other: cutoff 24 h, `attempts` reset to 0, NULL rows not re-armed, field names, and the
  section layout. Scope stays within the owner rulings.

### Verdict: CONFIRM

### Non-blocking notes

- `AdminUsageTotalsSpec.scala:112` also asserts the exact four-key `totals` set, just like `AdminUsageRoutesSpec:198`.
  Task 5.4 lists that file only for its constructor call site. It will fail loudly, so it cannot be missed, but name it
  alongside task 5.6.
- Task 5.5 hosts the proof in `StoredObjectDeletionsMigrationSpec`, which today uses raw JDBC with no `DbContext`. The
  executor will need the two-pool `DbContext` construction from `ProductUsageRepositoryRoleSpec:59-71`, without the
  NOBYPASSRLS flip. The evidence should show the `rolbypassrls` state of `helio_privileged` at the moment of the read.
- Two existing classes are reused by more than one section on the page: `admin-usage__totals` (as the section
  wrapper) and `admin-usage__section-title`. The final gate will check visually that the two stacked sections keep
  the page's vertical spacing rhythm in both themes.
