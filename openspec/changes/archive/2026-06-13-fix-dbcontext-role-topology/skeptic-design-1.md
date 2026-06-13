## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

**1. Ticket acceptance criteria (ground truth from Linear + ticket.md)**
Read `ticket.md` and fetched HEL-285 via Linear API. Three ACs:
- A test fails if `helio_privileged` lacks table-level DML privileges on any ACL'd table.
- The privileged-pool `SET ROLE` path is genuinely exercised (not collapsed onto a superuser datasource).
- CI would catch the class of bug that V38 fixed before it reaches a real deployment.

**2. Proposal-to-design coherence**
Read `proposal.md` and `design.md`. Proposal introduces `RlsPrivilegedDmlSpec` covering DML on all nine ACL'd tables and a `withUserContext` RLS spot-check. Design translates this faithfully: D1 (new spec file), D2 (explicit allowlist of nine tables), D3 (INSERT+SELECT+DELETE strategy), D4 (non-superuser app pool pattern). No internal contradictions.

**3. Tasks-to-design coherence**
Read `tasks.md`. Seven tasks map cleanly to the design. Task 1.2 covers INSERT on all nine ACL'd tables; tasks 1.3–1.4 scope UPDATE/DELETE to two representative tables (`data_sources`, `dashboards`), consistent with D3.

**4. Existing test infrastructure read and verified**
Read `DbContextSpec.scala`, `RlsOwnerTablesSpec.scala`, `RlsSharingAwareTablesSpec.scala`, `RlsPolicyGuardSpec.scala`. The design's description of each spec is accurate:
- `RlsOwnerTablesSpec` already creates `helio_app_test`, grants it table-level DML, and uses HikariCP `connectionInitSql = "SET ROLE helio_app_test"` for the app pool (D4 is grounded in a live pattern).
- `DbContextSpec` uses HikariCP `connectionInitSql = "SET ROLE helio_privileged"` for the privileged pool — confirmed.
- Neither grants test for the privilege-loss regression class — confirmed gap.

**5. Flyway migration context read**
Read `V34__rls_privileged_role.sql`, `V38__rls_privileged_grants.sql`. V38 grants `SELECT, INSERT, UPDATE, DELETE ON ALL TABLES` to `helio_privileged`, but only `USAGE, SELECT ON ALL SEQUENCES`. `RlsOwnerTablesSpec` manually grants `USAGE, SELECT, UPDATE ON ALL SEQUENCES` to `helio_privileged` (more permissive than V38). New spec will need the same pattern since `data_type_rows` uses `BIGSERIAL`. The design's description of the manual grant pattern is consistent with the existing code.

**6. FK dependency chain for child tables**
Read `V23__pipeline_steps.sql`, `V24__pipeline_runs.sql`, `V29__data_type_rows.sql`:
- `pipeline_steps.pipeline_id REFERENCES pipelines(id)` — requires parent pipeline row.
- `pipeline_runs.pipeline_id REFERENCES pipelines(id)` — requires parent pipeline row.
- `data_type_rows.data_type_id TEXT NOT NULL` — no FK constraint (text column, not a reference constraint in the migration), so no hard dependency.
- `panels.dashboard_id` — requires a parent dashboard (as seen in `RlsSharingAwareTablesSpec`).
- `resource_permissions.grantee_id REFERENCES users(id)` — can be NULL (public grant), so FK is optional.

**7. Spec delta read**
Read `specs/rls-privileged-dml-coverage/spec.md`. Scenarios are concrete and testable. No TBDs or deferred decisions.

**8. Scope completeness vs. ACs**
- AC 1 (test fails if `helio_privileged` lacks DML): Satisfied by tasks 1.2–1.4 (INSERT/UPDATE/DELETE would fail with `permission denied` if GRANTs are missing).
- AC 2 (`SET ROLE` path genuinely exercised): Satisfied by D4 (non-superuser app pool) + task 1.5 (`SELECT current_role` assertion on the privileged pool).
- AC 3 (CI catches V38 class bug): Satisfied by the INSERT assertions in task 1.2.

**9. Accuracy of design risk claim**
Design states "existing suite already boots three separate instances (`RlsPolicyGuardSpec`, `RlsOwnerTablesSpec`, `RlsSharingAwareTablesSpec`, `DbContextSpec`)". The actual count is much higher (27+ specs across the suite spin their own EmbeddedPostgres). The four named specs are correct but the "three" count is inaccurate. This is cosmetic — the risk assessment conclusion (additional instance is acceptable overhead) is correct and unaffected.

---

### Verdict: CONFIRM

The design is sound and ready for execution. The approach is fully grounded in existing codebase patterns. All three ACs are covered. No placeholders, no deferred decisions, no schema/API changes required.

---

### Non-blocking notes

- **Task 1.2 insert ordering is implicit.** `pipeline_steps` and `pipeline_runs` have FK constraints on `pipelines.id`. The task says "seed two owner users" but does not mention that inserting into those child tables requires a parent `pipelines` row first (and a pipeline requires `data_sources` + `data_types` as FK). An implementer following `RlsOwnerTablesSpec`'s seeding pattern will figure this out, but documenting the insertion order explicitly in tasks 1.2 would reduce friction.
- **Goals text vs. D3 scope tension.** The `Goals` section says "INSERT, UPDATE, and DELETE on every ACL'd table"; D3 and tasks 1.3–1.4 scope UPDATE/DELETE to two representative tables only. The design is internally consistent (D3 is the operative decision), but "every ACL'd table" in Goals is technically inaccurate. Not a blocker — D3 is explicit and justified.
- **Design's EmbeddedPostgres count** (stated as "three separate instances" in the risk note, referring to existing specs): the actual suite has 27+ such instances. The risk conclusion stands regardless; the count is just wrong.
