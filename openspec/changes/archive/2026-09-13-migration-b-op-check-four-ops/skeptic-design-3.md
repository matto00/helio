## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD: 9f7bd3838452cb7e76393e6b4fc38d171297c239

### What I verified (with evidence)
- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/migration-b-op-check/HEL-1104`.
- I read proposal.md, design.md, tasks.md, specs/pipeline-steps-persistence/spec.md, ticket.md, and skeptic-design-2.md in full.
- **FlywayNonSuperuserMigrationSpec.scala: the orchestrator's description is accurate.** I read the file myself:
  - Lines ~436-440 (superuser connection): `CREATE ROLE helio_migration_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, `ALTER SCHEMA public OWNER TO helio_migration_test`, `CREATE ROLE helio_privileged BYPASSRLS NOLOGIN`, `GRANT helio_privileged TO helio_migration_test WITH ADMIN OPTION`. This setup happens before any Flyway call.
  - First `.migrate()` has `.target("93")`. Second `.migrate()`, inside `noException should be thrownBy`, has no `.target(...)`. It therefore applies every migration on the classpath, and V107 will run automatically once the file exists. The test code needs no changes for that.
  - The same role runs both migrate calls. It owns the schema and every table it creates, so it will own `pipeline_steps` when V107 runs.
- Round 2 CR1 (V34 role setup) is resolved. Decision 2 and task 2.2 reuse this existing, already-passing gate and do not invent a setup that would fail.
- Round 2 CR2 is resolved. Decision 2 now says prod's `helio_privileged` bootstrap is undocumented in `infra/`. It drops the "matches prod exactly" claim and argues only that ownership is what's required.
- Round 2 CR3 is resolved. "## Standing Constraints" now contains C1-C4, and C4 correctly restates the ticket's no-product-wiring AC.
- Base facts:
  - Highest migration on disk is V106, so V107 is the correct next number.
  - V83's CHECK tuple matches the design's 23-op list exactly, in the same order.
  - The spec delta lists the 23 ops plus the 4 new ones (27 total).
  - `PipelineStepKind.All.contains` guards returning `ServiceError.BadRequest` exist at PipelineService.scala:521 and around :1495 (`validateStepKinds`), as Decision 4 cites.
- AC coverage:
  - Migration AC: task 1.1.
  - Seeded existing rows: task 2.1, which seeds all 23 ops (stricter than the "representative sample" the AC asks for).
  - Non-superuser role: task 2.2, using the existing gate plus a new negative ownership case.
  - API still rejects the new ops: task 2.3. Decision 4 justifies pinning this at the real 400 guard instead of analyze's "Unknown op" arm, which the AC names. Testing at the layer that actually returns 400 is stricter and consistent with what the AC is for.
  - No product wiring: C4.
  - Specs reflect the change: tasks 3.1 and 3.2.
- No TODO, TBD or deferred decisions that would block implementation.

### Verdict: CONFIRM

### Non-blocking notes
- design.md has two Risk bullets (Decision 4 layer; shared dev DB) sitting under "## Decisions", above the "## Risks / Trade-offs" heading. This is cosmetic; consider moving them.
- Task 2.2's negative case will be denied by Postgres's normal ownership check on ALTER TABLE (`must be owner of table`). The test should assert that specific error (SQLSTATE 42501). Otherwise a denial for some unrelated reason, such as missing schema USAGE, could pass as the evidence.
- The executor should run the existing gate and paste its real output showing it passed with V107 applied. Asserting that it "passes automatically" is not evidence.
