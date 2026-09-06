# Probe / mutation transcripts (HEL-974)

All runs against a fresh `EmbeddedPostgres`, migrated head-to-head as `helio_migration_test`
(`LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`, owner of `public`, with
`helio_privileged` pre-seeded `BYPASSRLS NOLOGIN` and granted `WITH ADMIN OPTION`) — the exact
role shape `FlywayNonSuperuserMigrationSpec` already uses. Scratch harness:
`backend/src/test/scala/com/helio/infrastructure/persistence/ProbeVacuityScratchSpec.scala`
(deleted after this file was written — task 1.1/1.2 only, not part of the permanent suite).

## Task 1.1 — premise probe (unmodified V99, BEFORE any fix)

The repro is NOT "delete via a normal app-pool connection with the GUC blanked to `''`" —
`data_sources_owner` (V35) has no `missing_ok=true` and hard-errors (`22P02 invalid input syntax
for type uuid: ""`) on that shape, which is a *wrong-reason* red, discarded below. The real defect
shape (ticket: "any writer that reaches `pipeline_roots` without a user context — a migration, an
admin script, a future privileged path, or a background job") is a connection on the **privileged
pool** (`SET ROLE helio_privileged`, BYPASSRLS) that never touches the GUC at all: BYPASSRLS skips
the outer DELETE's own RLS evaluation entirely (so `data_sources_owner`/`pipeline_roots_delete`
are never even invoked, no error), while the trigger function's *own* internal read — `SECURITY
DEFINER`, executing as the non-BYPASSRLS table-owning role — still evaluates
`pipelines_select`/`pipeline_roots_select` (both `helio_can_access_pipeline`-backed,
`missing_ok=true`) against the same, still-unset GUC, and those return `FALSE`, not an error.

Discarded wrong-reason attempt (recorded for completeness): app-pool connection, GUC blanked to
`''` via `set_config(..., '', false)` → `ERROR: invalid input syntax for type uuid: ""`
(SQLSTATE `22P02`) on the outer `DELETE FROM data_sources` itself — this never reaches the trigger
at all, so it proves nothing about the guard.

Discarded wrong-reason attempt #2: app-pool connection, GUC never set on that connection at all
(no prior `SET LOCAL`/`set_config` in the session) → `ERROR: unrecognized configuration parameter
"app.current_user_id"` (SQLSTATE `42704`) on the same outer DELETE, for the same reason
(`data_sources_owner` has no `missing_ok=true`).

**Right-reason transcript (privileged-pool connection, GUC never set):**

```
[PROBE 1.1] GUC unset delete -- raised=None sqlState=None pipelines=1 pipeline_roots=0
```

No exception. Post-state: `pipelines=1`, `pipeline_roots=0` — the exact silent R1-violating orphan
the ticket names. **Premise confirmed: the guard is currently vacuous.** Proceeding to the fix.

## Task 1.2 — same delete, GUC set to the pipeline owner (isolates the cause to RLS session state)

Same fixture, same shape of delete, but the connection is on the **app pool** (no `SET ROLE
helio_privileged`) with `app.current_user_id` set to the pipeline's actual owner for the whole
session (mirrors `DataSourceRepository.delete`'s `ctx.withUserContext`).

```
[PROBE 1.2] GUC set to owner delete -- raised=Some(ERROR: HEL-913: this delete would leave
pipeline(s) [<pid>] with zero roots (R1 violation) -- remove the pipeline itself instead of its
last root, or add another root first
  Where: PL/pgSQL function hel913_prevent_zero_root_pipelines() line 11 at RAISE) sqlState=Some(P0001)
```

Raises correctly, SQLSTATE `P0001`. Confirms the difference is isolated to RLS session state (the
GUC), not the fixture — matching the ticket's own description of why the user-facing
`DataSourceRepository.delete` path (which always runs under `withUserContext`) is already safe.

---

## Task 3.7 — mutation check, THE FIX (MUTATION STATE A)

Harness: `V100ZeroRootGuardNonSuperuserSpec`, test `"3.7 MUTATION STATE A ..."`. After the full
V100-fixed chain is migrated, the function is mutated in-place (via the EmbeddedPostgres
superuser connection, never touching the migration file on disk): `CREATE OR REPLACE` with the
ORIGINAL V99 body (no `SET row_security = off`), `ALTER FUNCTION ... OWNER TO
helio_migration_test` (the non-BYPASSRLS migrating role — reverting the re-own). Same
privileged-pool, GUC-never-set delete as task 1.1/3.2.

**Right-reason red, confirmed:**

```
attemptDelete(dsId, privileged = true, guc = None) => (raisedMessage = None, sqlState = None)
post-state: pipelines(pid) count = 1, pipeline_roots(pid) count = 0
```

Test passed: `msg shouldBe None`, `state shouldBe None`, `pipelines=1`, `pipeline_roots=0` — the
IDENTICAL silent orphan as the pre-fix probe (task 1.1). Confirms the `OWNER TO helio_privileged`
re-own alone (not the `row_security` clause) is what's load-bearing for the fix — reverting only
the ownership reproduces the original defect exactly, even with the tripwire clause absent (state
A never has the clause, by construction).

No wrong-reason reds were observed on this run (no `permission denied`, no missing relation, no
Flyway checksum, no connection error) — the mutation reproduced the target defect on the first
attempt. Function state restored to the correct V100 body/ownership immediately after (`
restoreV100State()`), verified by the spec's own trailing "post-mutation sanity" test.

## Task 3.7a — mutation check, THE TRIPWIRE (MUTATION STATE B)

Harness: same spec, test `"3.7a MUTATION STATE B ..."`. Function mutated to the FIXED body (KEEPS
`SET row_security = off`) but re-owned BACK to `helio_migration_test` (reverting only the
ownership, distinct from state A which also strips the clause). Same privileged-pool,
GUC-never-set delete.

**Right-reason red, confirmed — LOUD, not silent:**

```
attemptDelete(dsId, privileged = true, guc = None) =>
  raisedMessage = Some("ERROR: query would be affected by row-level security policy for table
    \"pipeline_roots\"
  Hint: To disable the policy for the table's owner, use ALTER TABLE NO FORCE ROW LEVEL SECURITY.
  Where: SQL statement \"SELECT string_agg(p.id, ', ') FROM (SELECT DISTINCT pipeline_id FROM
    deleted_roots) AS d JOIN pipelines p ON p.id = d.pipeline_id ...\"")
  sqlState = Some("42501")
```

(The blocked table is `pipeline_roots` — the trigger's `WHERE NOT EXISTS (SELECT 1 FROM
pipeline_roots pr ...)` subquery — not `pipelines`; either would equally demonstrate the tripwire
firing.)

Test passed: `msg` is defined and contains `"row-level security policy"`; `state shouldBe
Some("42501")`. This is the EXPECTED red for state B — `42501` (`insufficient_privilege`) reads
like a generic "permission denied" but here is the RIGHT reason (the tripwire firing), not
discarded as task 3.7's wrong-reason `permission denied` case (which would be a grant problem on
`pipelines`/`pipeline_roots` themselves, a different error text and cause entirely). Confirms the
tripwire is alive: if the re-own is ever lost in a future migration while the `row_security = off`
clause survives, the failure is loud (`42501`) rather than the silent orphan of state A/task 1.1.

Both states behave exactly as design.md D5 predicted, and are mutually exclusive as designed:
state A (no clause) → silent; state B (clause present) → loud `42501`. Function restored to the
correct V100 body/ownership immediately after, verified by the spec's trailing "post-mutation
sanity" test (re-runs the task 3.2 positive gate end-to-end: raises `P0001`/`HEL-913`, and confirms
`pg_proc.proowner` is `helio_privileged` again).
