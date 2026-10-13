## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD f63ab8365d2b0e6cac36154a83437b6d26b3a209 (planning artifacts untracked in the change dir).

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/proposal-legacy-fields-followups/HEL-1440`.
- **Round-1 CR1 (Mapping row) is addressed.** design.md D1 now says "DECISION: unchanged in this change ... filed as
  HEL-1547 ... Their tests stay as they are", and if lint objects, "do not delete the row". tasks.md 2.1 repeats
  "Review UIs' Mapping row unchanged (HEL-1547)", and proposal.md Non-goals lists it. I checked HEL-1547 in Linear:
  it exists (Backlog, label Follow-up, relatedTo HEL-1440). It names both components and both pinning tests, poses the
  drop-vs-replace product question, and also carries the `helio-mcp/src/types.ts` gap. Neither `eslint.config.cjs` nor
  any frontend eslint config contains a deprecation rule (grep `deprecat`: 0 hits), so the `@deprecated` JSDoc cannot
  break the zero-warnings lint on those reads. The fallback clause in D1 will not trigger. The decision is now explicit,
  so two executors can no longer read it two ways.
- **Round-1 CR2 (deleting role) is addressed.** D4 says "Flyway runs as, and every `DELETE FROM users` is executed by,
  the NOSUPERUSER NOBYPASSRLS table-owner role `helio_migration_test` ... with `app.current_user_id` UNSET; every
  before/after count is read over the superuser connection. Not optional." Task 4.1 and standing constraint C1 say the
  same. I checked that this can be done:
  - `users` has no RLS (grep for `ROW LEVEL SECURITY` lines naming `users` across migrations: 0 hits). The role's own
    DELETE therefore sees the row, and cannot pass by matching zero rows.
  - In V119's template, Flyway runs as the role from V1 onward (`flyway(Template, ...)` connects as the role,
    V119OwnerFkMigrationSpec.scala:67-71), so the role owns `users` and every referencing table. The cascade and the
    NO ACTION check run under the owner, with FORCE RLS on `pipeline_run_rate_window` (V109:21-22). This is the
    hostile case.
  - The four scenarios assert outcomes from superuser counts, so an RLS-hidden failure would show up as a test failure.
    It cannot produce a false pass.
- **Correction to my own round-1 claim.** Round 1 called this "the V119 pattern". It is only partly that:
  V119OwnerFkMigrationSpec runs Flyway as the role but issues its `DELETE FROM users` over the superuser connection
  `c` (l.276, 292, 307, 327, 349, 371). D4 as revised is stricter than V119, which is what was asked for. The executor
  needs one extra connection as the role (`pg.getJdbcUrl(Role, db)`, already used at l.68), which is trivial. The
  new spec must also create the role in its own `beforeAll`, because the role is cluster-scoped and each spec starts
  its own `VerifiedEmbeddedPostgres`. That is implied by "following V119's per-scenario template-DB pattern", so I
  list it as a note, not a blocker.
- **Round-1 notes folded in.** D8 and task 3.3 cover `asInstanceOf[JsArray]` at :35. D2 says to target the panel's own
  `label`, not `ProposalControl.label`. D8 attributes 5a to HEL-1469 #918.
- **New scan.** I found no TODO/TBD. Every AC maps to tasks: AC1 -> 1.3/1.4/2.1/2.2/4.2/4.4, with an inertness test
  in 4.3. AC2 -> 2.3/4.5. AC3 -> 1.1/1.2/1.5/4.1. AC4 -> 3.1/3.2. AC5 -> 3.3. The spec deltas match D1 and D3/D4. The
  "remaining blocking reference" scenario uses a dashboard, and `dashboards.owner_id` is NO ACTION, so the scenario
  tests something real. No contract delta is missing: names are unchanged, the annotations are covered by the
  `mcp-panel-composition-tools` delta, and the FK is covered by the `user-reference-integrity` delta.

### Verdict: CONFIRM

### Non-blocking notes

- The 5a attribution is still inconsistent across artifacts. proposal.md Non-goals and ticket.md premise say
  "HEL-1480", while D8 says "HEL-1469 #918", which is the correct one. Align them in the PR body.
- The new `V133RateWindowCascadeMigrationSpec` must `CREATE ROLE helio_migration_test` (and do the schema-owner setup)
  itself, as V119's `beforeAll` does. It cannot rely on V119 having created the role.
- D1 still ends with "report what was found" about lint. With no deprecation rule present, record the 0-hit grep as the
  finding and move on.
- From round 1, still worth stating in the PR body: the V133 collision watch with HEL-1433's lane (its C4 says "any
  migration would be V133"), and that the PR parks behind #994/#1000.
