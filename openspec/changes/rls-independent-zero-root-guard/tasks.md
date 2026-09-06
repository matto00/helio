## 1. Backend

### Backend

- [x] 1.1 Probe FIRST, before writing any fix: in a scratch harness (EmbeddedPostgres + the
      `helio_migration_test` role shape copied from `FlywayNonSuperuserMigrationSpec`), migrate the
      unmodified chain to head as that non-superuser role, seed one user + one data source + one
      pipeline + one root, then with `app.current_user_id` UNSET delete the data source over a
      `helio_migration_test` connection. Record verbatim: the absence of any raise, and the
      resulting `SELECT count(*) FROM pipelines` / `pipeline_roots` values, in
      `openspec/changes/rls-independent-zero-root-guard/probe.md`. If the delete DOES raise, stop
      and escalate — the premise is dead and nothing below should be built.
- [x] 1.2 Confirm in the same probe that the identical delete WITH the GUC set to the pipeline owner
      DOES raise `P0001`, so the difference is isolated to RLS session state and not to the fixture.
- [x] 1.3 Write `backend/src/main/resources/db/migration/V100__zero_root_guard_rls_independent.sql`:
      `CREATE OR REPLACE FUNCTION hel913_prevent_zero_root_pipelines()` with the body unchanged
      except for an added `SET row_security = off`, THEN
      `GRANT CREATE ON SCHEMA public TO helio_privileged` /
      `ALTER FUNCTION hel913_prevent_zero_root_pipelines() OWNER TO helio_privileged` /
      `REVOKE CREATE ON SCHEMA public FROM helio_privileged` (V40's bracket, in that order — see
      design D2 for why the replace must precede the re-own).
- [x] 1.4 Add an explicit idempotent `GRANT SELECT ON pipelines, pipeline_roots TO helio_privileged`
      to V100 (design D3) rather than relying on V38's default privileges.
- [x] 1.5 Write V100's header comment: what was vacuous, why (FORCE RLS on a DB_USER-owned
      SECURITY DEFINER function), the V40 precedent, the `row_security = off` tripwire's purpose,
      and that a BYPASSRLS-owned guard reads cross-tenant ids by construction.
- [x] 1.6 Do NOT edit `V99__prevent_zero_root_pipelines.sql` or any other already-applied migration
      (checksum risk; escalated and ANSWERED this run: `v100-header-only`). V100's header MUST also
      state explicitly WHY V99's stale claim was not corrected in place, so a future reader does not
      "tidy it up" and break the next deploy.
- [x] 1.6a Add a privileged, COUNT-ONLY sole-root check to `DataSourceRepository` (design D9), run
      via the privileged/BYPASSRLS pool. It MUST return only a count — no pipeline ids, no names —
      so no cross-tenant identifier can reach a 409 body, error message, or log line. Its predicate
      MUST be the IDENTICAL sole-root predicate as `soleRootDependentPipelines`
      (`HAVING count(*) = 1 AND bool_and(r.data_source_id = <id>)`), differing only in pool and in
      projecting `count(*)`. Do NOT use `WorkspaceTeardownRepository`'s any-referencing predicate —
      `DataSourceRepository:219-222` records it as the rejected scope, and it would 409 every
      multi-root delete the trigger would never raise on.
- [x] 1.6b Call it in `DataSourceService.delete` after the existing RLS-scoped
      `soleRootDependentPipelines` and STRICTLY BEFORE `deleteFileF`. Visible blocking pipelines
      keep HEL-987's existing named 409 unchanged; a non-zero privileged count with an empty
      RLS-scoped result yields a generic 409 that names nothing. Short-circuit the privileged query
      when the RLS-scoped check already returned a non-empty result.
- [x] 1.7 LAST backend task, after V100's body is frozen (design D8): verify `sbt run`/boot still succeeds against the dev database with V100 applied, and that
      `helio_privileged`-pool code paths are unaffected.

## 2. Documentation

### Backend

- [x] 2.1 Correct the archived HEL-913 caveat at
      `openspec/changes/archive/2026-09-04-multi-root-pipelines/tasks.md` (around the
      `FlywayNonSuperuserMigrationSpec` proof claim) to record that the gap was real, that HEL-974
      closed it in V100, and that the original claim was false — preserving the history, correcting
      the present tense.

## 3. Tests

### Tests

- [x] 3.1 Add `backend/src/test/scala/com/helio/infrastructure/persistence/V100ZeroRootGuardNonSuperuserSpec.scala`:
      provision `helio_migration_test` (`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
      owner of `public`, with `helio_privileged` pre-seeded and granted `WITH ADMIN OPTION`),
      migrate the full chain as that role, and run every assertion below over a connection
      authenticated as that role.
- [x] 3.2 Positive gate: with `app.current_user_id` UNSET, deleting a DataSource that is a
      pipeline's sole root's source raises, the raise carries SQLSTATE `P0001` and the
      `hel913_prevent_zero_root_pipelines` invariant text, and after rollback the pipeline, its
      root, and the DataSource all still exist (assert counts explicitly — a raise alone does not
      prove the rollback).
- [x] 3.3 Parity gate: the same delete WITH the GUC set to the owner raises identically, so
      HEL-987's 409 mapping (which keys on that signature) is unaffected.
- [x] 3.4 Negative gate, GUC UNSET: deleting one of two roots succeeds and the pipeline retains the
      other root — the false-positive risk the fix introduces (design D6).
- [x] 3.5 Negative gate, GUC UNSET: deleting the pipeline itself succeeds and raises nothing.
- [x] 3.6 Guard-liveness assertion: fail loudly if the trigger's owner is not `helio_privileged`
      (query `pg_proc.proowner`), so a future migration re-owning it is caught by name rather than
      only by behaviour.
- [x] 3.7 Mutation check — the fix (design D5 step 4). MUTATION STATE A: revert the `ALTER FUNCTION
      ... OWNER TO helio_privileged` line AND remove `SET row_security = off`. Re-run 3.2 and record
      message + SQLSTATE in `probe.md`. Right-reason red: the guard SILENTLY did not raise
      (post-state `roots=0`). Wrong-reason reds — record, discard, fix the harness, retry:
      `permission denied` on `pipelines`/`pipeline_roots`, missing relation, Flyway checksum,
      connection error.
- [x] 3.7a Mutation check — the tripwire (design D5 step 5; owner-flagged co-equal with the fix).
      MUTATION STATE B, distinct from 3.7: revert the `OWNER TO` line but KEEP `SET row_security =
      off`. Right-reason red: LOUD failure, SQLSTATE `42501`, `query would be affected by row-level
      security policy`. In state B that `42501` is the EXPECTED red — do NOT discard it as the
      "permission denied" wrong-reason of 3.7. Record separately in `probe.md`. A silent red here
      means the tripwire does not work and the change is not done, even if 3.2 and 3.7 pass.
- [x] 3.7b Run all probe/mutation work against EmbeddedPostgres ONLY (design D8) — never against the
      shared dev DB. Freeze V100's body before task 1.7's dev-DB boot check, which runs LAST. If a
      mutated V100 does reach the dev DB, recover by deleting its `flyway_schema_history` row (or
      `flyway repair`) and re-migrating.
- [x] 3.7b1 Build the D9 gates' harness per design D10 — NOT in `DataSourceRoutesSpec`, which
      connects as the `postgres` superuser with `new DbContext(db, db)` and would make every gate
      below pass vacuously. Use two genuinely distinct pools: an app connection as
      `helio_migration_test` (`NOSUPERUSER NOBYPASSRLS`) and a separate `helio_privileged`
      connection, as two distinct `JdbcBackend.Database`s in the `DbContext`.
- [x] 3.7c Divergence gate (design D9): construct the case that matters — a `pipeline_roots` row
      pointing at the caller's OWN source where the `pipelines` row is INVISIBLE to the caller.
      FIRST assert fixture liveness: `soleRootDependentPipelines` returns EMPTY for this fixture
      (without this the gate silently degrades into a re-test of the visible path). Then assert the
      delete is refused with a 409, and assert the backing FILE STILL EXISTS afterwards. A 409 alone
      does not establish the property this change exists to preserve.
- [x] 3.7d Non-disclosure gate: in that same invisible-pipeline case (same liveness precondition), assert the 409's body AND its
      message contain no pipeline id and no pipeline name, and that nothing logged on that path
      carries one either. If the implementation emits no log line on that branch, state that
      plainly rather than asserting absence against silence.
- [x] 3.7e Regression gate: a VISIBLE blocking pipeline still produces HEL-987's existing named 409,
      byte-for-byte unchanged in shape — the privileged check must not alter the good path.
- [x] 3.7f Service-level false-positive gate (design D9 predicate pinning): a source that is one of
      SEVERAL roots — including of an INVISIBLE pipeline — still deletes successfully and its
      backing file is removed. Task 3.4 does NOT cover this: it is a SQL-level assertion inside
      `V100ZeroRootGuardNonSuperuserSpec` and never exercises the new Scala pre-check.
- [x] 3.8 Re-run the pre-existing `V99PreventZeroRootPipelinesMigrationSpec`,
      `FlywayNonSuperuserMigrationSpec`, `DataSourceRoutesSpec` (HEL-987's 409 tests especially),
      and the RLS spec package unchanged
      and green — the fix must not alter superuser-path behaviour or the 409 mapping.
- [x] 3.9 Run the full `sbt test` suite green before handing off.
