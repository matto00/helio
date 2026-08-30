## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Allowlist gap is real and exactly two tables.** Re-derived independently, not from design.md:
  `grep -rhio "ALTER TABLE [a-z_.]* ENABLE ROW LEVEL SECURITY" backend/src/main/resources/db/migration | awk '{print tolower($3)}' | sort -u`
  → 27 tables. `rlsTables` in `RlsPolicyGuardSpec.scala` (read in full) has 25 entries.
  Set difference is exactly `audit_events`, `connector_credentials`. D1's claim
  ("no further gaps exist") is **confirmed against ground truth**, including the
  V88 `assistant_daily_usage` entry whose comment does not match its migration filename.
- **Policy names in D2/task 1.3 are correct.** `V91__audit_events.sql:164,168,171` create
  exactly `audit_events_owner` (FOR SELECT), `audit_events_update`, `audit_events_delete`.
  No fourth policy. The `Some(Set(...))` triple in task 1.3 matches the migration verbatim.
- **`connector_credentials` shape is correct.** `V92__connector_credentials.sql:31,32,37` —
  `ENABLE` + `FORCE` + single `connector_credentials_owner`. `-> None` (task 1.4) is right.
- **The stale comment task 1.4 removes exists.** `RlsPolicyGuardSpec.scala` V93 entry carries
  the "pre-existing gap ... flagged as a finding" note about `connector_credentials`.
- **D2's non-vacuousness reasoning holds.** `V91:148-160` confirms the three-policy split is
  deliberate and that the append-only guarantee is trigger-carried (`V91:111-136`,
  `ENABLE ALWAYS` statement/row/truncate triggers), not RLS-carried — design.md does not
  overclaim here, and correctly refuses to let a green `count > 0` imply append-only.
- **Scope/contract:** `.openspec.yaml` sets `skip_specs: true`; proposal declares no
  capability deltas. Correct — the change touches one test file, no API/schema surface.
- **Gate-chain checklist** ("not applicable") verified: no `.husky/**` or hook-invoked script involved.

### Verdict: REFUTE

Two specific, cheap defects. The core design (D1–D3) is sound and I found no
factual error in it; these are a task/design contradiction and an uncovered AC.

### Change Requests

1. **`tasks.md` 2.2 contradicts design D3's probe and would report a false failure.**
   Task 2.2 instructs: comment out the `audit_events` map entry, run the spec, "confirm
   nothing fails". But D3's probe test looks up `audit_events`'s expected policy-name set
   in that same map; with the entry removed the probe will either throw
   (`NoSuchElementException` / missing key) or silently degrade to a pass, so "nothing
   fails" is not the expected outcome and the executor will burn a cycle deciding whether
   it hit a real bug. Additionally, what 2.2 measures (removing an entry disables its
   checks) is allowlist *scoping*, not non-vacuousness — D3's probe is the actual
   non-vacuousness proof and already satisfies AC #4 durably. Either delete 2.2, or
   rewrite it to state its real purpose and its interaction with the probe (e.g. "expect
   the D3 probe to fail while the entry is removed; that failure is itself the evidence").

2. **Ticket AC #5 is covered by design D4 but by no task.** D4 says the mechanical
   same-PR-enforcement question is "filed as a spinoff ticket during Delivery", yet
   `tasks.md` has no item for filing it. An AC whose only owner is a sentence in design.md
   will be dropped. Add an explicit task (e.g. `3.1 File a spinoff Linear ticket for
   mechanically enforcing the migration↔rlsTables same-PR contract; record its id in the
   PR body`) so AC #5 has a checkable completion signal.

### Non-blocking notes

- The spec's outer test-suite label `"Row Level Security (V35 + V36)"` and the class-doc
  `Coverage` list (V34/V35/V36/V37 only) are already stale relative to the 20+ later
  migrations in `rlsTables`. Task 1.7 covers the class doc; consider also updating the
  `should` label to something version-agnostic (e.g. `"Row Level Security (all ACL'd tables)"`)
  while it is being touched.
- `pg_policies` is queried by `tablename` with no `schemaname` filter (pre-existing). Harmless
  in EmbeddedPostgres, but the new exact-name-set assertion in 1.5 inherits it; a
  `AND schemaname = 'public'` would make the equality assertion strictly correct.
- Task 1.1 asks the executor to record the re-derivation "in a code comment or commit note" —
  prefer the commit/PR body over a code comment, since an in-file enumeration snapshot goes
  stale the next time a migration lands and becomes a second thing to maintain.
