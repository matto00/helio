## Context

`V99__prevent_zero_root_pipelines.sql:53-83` defines `hel913_prevent_zero_root_pipelines()` —
`LANGUAGE plpgsql`, `SECURITY DEFINER`, `SET search_path = pg_catalog, public` — fired by an
`AFTER DELETE ... REFERENCING OLD TABLE AS deleted_roots FOR EACH STATEMENT` trigger on
`pipeline_roots`, `ENABLE ALWAYS`. Its body joins the transition table to `pipelines` and raises
when a surviving pipeline has no remaining `pipeline_roots` row.

The function is created by the migrating role (`DB_USER`, prod's `helio`), so `SECURITY DEFINER`
executes it *as that role* — which owns `pipelines` and `pipeline_roots`, both `relforcerowsecurity`
(V98:348-349 for `pipeline_roots`; earlier for `pipelines`). `pipeline_roots_select` and
`pipelines`' own SELECT policy both delegate to `helio_can_access_pipeline(...)`, which returns
false when `app.current_user_id` is unset. So the guard's `JOIN pipelines` sees zero rows and
raises nothing, while the FK cascade from `data_sources` — a system-level row action, not
RLS-filtered — has already removed the root.

`V40__fix_rls_policy_function_recursion.sql:26-42` is the same defect, already diagnosed and fixed
in this repo: helper functions owned by the migrating role were subject to FORCE RLS; the fix
re-owned them to `helio_privileged` (`CREATE ROLE helio_privileged BYPASSRLS NOLOGIN`, V34:18)
inside a transient `GRANT CREATE ON SCHEMA public` / `REVOKE` bracket. V40's header also records
why it shipped green: "dev and CI connect as a Postgres superuser, which BYPASSes RLS".

## Goals / Non-Goals

**Goals.** Make the guard raise for a `NOSUPERUSER NOBYPASSRLS` role with `app.current_user_id`
unset; keep every legitimate delete legal; prove the current vacuity empirically *before* fixing it;
prove the fix by mutation; stop the false RLS-independence claim being archived as fact (in V100's
header and HEL-913's archived caveat — NOT by editing V99, per the settled `v100-header-only`
ruling).

**Non-Goals.** No sweep of other `SECURITY DEFINER` functions for the same ownership defect. No
change to `DataSourceService`'s 409 mapping (HEL-987) or `PipelineService.removeRoot`. No
production database or deploy access, no tagging.

## Decisions

### D1 — Fix shape: re-own the function to `helio_privileged` (V40's precedent)

A new migration `V100__zero_root_guard_rls_independent.sql`:

```sql
GRANT CREATE ON SCHEMA public TO helio_privileged;
ALTER FUNCTION hel913_prevent_zero_root_pipelines() OWNER TO helio_privileged;
REVOKE CREATE ON SCHEMA public FROM helio_privileged;
```

`SECURITY DEFINER` then executes the body as a `BYPASSRLS` role, so `row_security` is skipped for
its reads. This is byte-for-byte the shape V40 already uses and that this repo has run in production
since the v0.4-era RLS work.

*Rejected alternative — restructure the query so it does not read a protected table.* There is no
such formulation: establishing "this pipeline still exists and now has no roots" requires reading
both `pipelines` and `pipeline_roots`, and both are FORCE-RLS.

*Rejected alternative — drop FORCE RLS on `pipeline_roots`.* That weakens the tenant boundary to
fix a guard; strictly worse.

*Rejected alternative — move the check into application code.* The entire stated rationale of V99's
DB-level placement is covering writers that do not go through application code.

### D2 — `SET row_security = off` on the function: a co-equal deliverable, not a nicety

Alongside the re-own, the migration `CREATE OR REPLACE`s the function with `SET row_security = off`
added to its existing `SET search_path` clause. With a `BYPASSRLS` owner this is a no-op. Its value
is what happens if the ownership is ever lost again (a future migration re-creating the function
under `DB_USER`): Postgres then raises `query would be affected by row-level security policy` rather
than silently returning zero rows.

**Product owner ruling (escalation, this run): this tripwire is the most valuable part of the
change and is a deliverable co-equal with the re-own.** The defect being fixed is a guard that
silently does not fire. A fix that could itself silently stop firing after a future re-own
regression would reproduce the identical failure class one layer along. It therefore carries its
own mutation obligation (D5 step 5), separate from the fix's: reverting the re-own must produce a
LOUD failure, and that loudness must be observed, not assumed.

Note the `CREATE OR REPLACE` must come **before** the `ALTER FUNCTION ... OWNER TO` in the
migration, or the replace runs as `DB_USER` against a function it no longer owns and fails.

### D3 — Grants: assert, do not assume

`helio_privileged` needs `SELECT` on `pipelines` and `pipeline_roots`. V38:19-30 grants
`SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public` plus `ALTER DEFAULT PRIVILEGES`
covering future tables created by the migration role, which should cover `pipeline_roots` (created
by V98 as `DB_USER`). But V60/V61/V75/V91/V94 all still issue explicit grants, so the default-privilege
path is not uniformly relied on. The migration therefore issues an explicit, idempotent
`GRANT SELECT ON pipelines, pipeline_roots TO helio_privileged`, and the test asserts the guard
actually raises rather than failing with `permission denied` — a `permission denied` red is a wrong
reason and must be distinguished from the right one (see D5).

### D4 — Test placement: a new dedicated non-superuser spec, not an extension of `FlywayNonSuperuserMigrationSpec`

`FlywayNonSuperuserMigrationSpec` is a single ~250-line test case that boots EmbeddedPostgres,
migrates to V93, loads a 10k-line real dump, migrates to head, and makes ~30 assertions. Its own
header warns against reordering or "simplifying away" its load-bearing comparison. Appending a
delete-and-expect-raise sequence to it would (a) run inside the same transaction-less test body
where a raised exception must be caught and the DB left usable for the assertions that follow, and
(b) make a slow migration-chain gate slower for a reason unrelated to its purpose.

Instead: a new `V100ZeroRootGuardNonSuperuserSpec` in the same package, which provisions the same
role shape this repo already uses (`helio_migration_test`: `LOGIN NOSUPERUSER NOCREATEDB
NOCREATEROLE NOBYPASSRLS`, owner of `public`, pre-seeded `helio_privileged` granted `WITH ADMIN
OPTION` — copied from `FlywayNonSuperuserMigrationSpec`'s setup block, which exists precisely
because that shape is what makes FORCE RLS apply), migrates the full chain as that role, then
exercises deletes over a *non-superuser connection* with `app.current_user_id` unset.

`FlywayNonSuperuserMigrationSpec` itself is left functionally unchanged; the acceptance criterion
"`FlywayNonSuperuserMigrationSpec` — **or an equivalent that genuinely runs as the non-superuser
role** — actually fires the trigger" is satisfied by the equivalent.

### D5 — Proof obligations, in order. The vacuity proof comes first.

1. **Probe (before any fix exists).** On the unmodified schema, as `helio_migration_test` with the
   GUC unset, delete a DataSource that is a sole root's source. Record the observed
   `pipelines=1, roots=0` state and the absence of any raise. This artifact is written to
   `probe.md` in the change directory and is what makes the later red meaningful.
2. **Fix**, per D1/D2.
3. **Re-run the same probe** and observe the raise plus rollback.
4. **Mutation check — the fix. MUTATION STATE A: revert the `OWNER TO` line AND remove
   `SET row_security = off`.** This is the ONLY configuration that reproduces the original defect,
   and therefore the only one that proves the re-own is load-bearing. Expected right-reason red:
   **silent non-firing** — no raise at all, post-state `roots=0`. Wrong-reason reds, to be recorded
   and discarded before retrying: `permission denied` on `pipelines`/`pipeline_roots` (meaning D3's
   grant is broken), a missing relation, a Flyway checksum mismatch, or a connection error.
5. **Mutation check — the tripwire (D2). MUTATION STATE B: revert the `OWNER TO` line but KEEP
   `SET row_security = off`.** Expected right-reason red: **loud** — SQLSTATE `42501`, message
   `query would be affected by row-level security policy`. `42501` is `insufficient_privilege` and
   reads like "permission denied"; in state B it is the RIGHT-reason red and MUST NOT be discarded
   as state A's wrong reason. A *silent* red in state B means the tripwire is dead and the change is
   not done, even if states A and 3.2 both pass.

   States A and B are mutually exclusive by construction: B cannot produce A's silent red (the
   tripwire converts it into an error), and A cannot produce B's `42501` (there is no
   `row_security` clause left to trip). Both transcripts — message AND SQLSTATE — go in `probe.md`,
   separately labelled.

### D6 — Negative cases, run under the same no-GUC non-superuser connection

Deleting one of two roots succeeds; deleting the whole pipeline succeeds. Both are run with the GUC
unset, because D1 changes what the trigger *can see*, and the specific hazard of a bypassing read is
a **new false positive** (the trigger now sees rows it previously could not). This is the risk the
fix introduces and the reason these are gates, not niceties.

### D7 — Documentation corrections

**Settled by escalation this run: `v100-header-only`. `V99__*.sql` is NOT edited — not one byte.**
Flyway checksums the whole file, comments included, and `Database.initApp` runs with validation on
by default, so editing an applied migration fails boot on every database that has applied V99,
including prod.

V99's header currently carries a long, accurate "HONEST LIMIT" section ending "Making this trigger
genuinely RLS-independent is HEL-974". It stays exactly as it is. The correction lives in two
places that carry no checksum:

1. **V100's header**, which states that V99's documented limit was real, that V100 closes it, how,
   and — required by the owner — **why V99's own header was not corrected in place**. A future
   reader who finds a stale-looking claim in V99 and its correction in V100 must not have to
   rediscover the checksum reason, or they will "tidy it up" and break the next deploy.
2. **HEL-913's archived `tasks.md` caveat**, a plain doc file, corrected to record that the gap was
   real, that the `FlywayNonSuperuserMigrationSpec` proof claim was false, and that HEL-974 closed
   it.

### D9 — Privileged, count-only pre-check so a refused delete never destroys the file

**Owner ruling this run: `widen-precheck-privileged-count`.** After D1 the trigger reads with
`BYPASSRLS`, but `DataSourceRepository.soleRootDependentPipelines` (`:228-239`) runs under
`ctx.withUserContext`, and `DataSourceService.delete` (`:588-599`) runs `deleteFileF` between the
pre-check and the DB delete. Where a `pipeline_roots` row points at the caller's own source but the
`pipelines` row is invisible to them — reachable, since `addRoot` binds via `findByIdOwned`, so an
editor may bind their own source to another user's pipeline and later lose the grant — the
pre-check returns empty, the file is irreversibly deleted, and only then does the trigger raise.

HEL-987's own comment at `DataSourceService.scala:576` states the pre-check runs before
`deleteFileF` *specifically* so a rejected delete no longer destroys the backing file. This fix
would silently defeat that property in a file its diff does not touch.

**This is not a regression fix for HEL-987.** Both changes are individually correct; the
interaction is new, created by making the trigger see more. Note the pre-fix behaviour was not
good either — it silently created the orphan. Refusing is right; refusing after destroying the
file is not.

Add a companion check, run under the privileged (BYPASSRLS) pool, immediately after the existing
RLS-scoped pre-check and **before** `deleteFileF`.

**The predicate is pinned: it is the IDENTICAL sole-root predicate as
`soleRootDependentPipelines`** (`HAVING count(*) = 1 AND bool_and(r.data_source_id = <id>)`),
differing in exactly two ways — it runs on the privileged pool, and it projects `count(*)` instead
of `(id, name)`. It is emphatically NOT the broader any-referencing predicate used by
`WorkspaceTeardownRepository`, which `DataSourceRepository:219-222` explicitly records as the
*rejected* scope: adopting that shape would make every multi-root delete return a generic 409 the
trigger would never have raised — a new, user-visible false positive. Matching the trigger's own
predicate is what makes the check introduce no false positives at all: it blocks exactly the
deletes the post-fix trigger would raise on, no more.

Further constraints:

- It returns a **count and nothing else — no ids, no names.** Count-only is load-bearing, not an
  optimisation: it is what makes it impossible for the invisible-pipeline branch to leak a
  cross-tenant identifier through the 409 body, the error message, or a log line.
- Visible blocking pipelines keep HEL-987's existing named 409, unchanged — the RLS-scoped check
  still runs first and still owns the good message.
- A non-zero privileged count with an empty RLS-scoped result yields a generic 409 naming nothing.
- Short-circuit: if the RLS-scoped check already returned a non-empty result, the privileged check
  is dead work and is not run.
- **D9 guarantees "no NEW file destruction", not "no file destruction".** The pre-existing TOCTOU
  race path (`DataSourceService.scala:600-604`) still deletes the file before mapping a racing
  `P0001`. That window is unchanged by this design and is not closed here; do not read D9 as having
  closed it.

### D10 — Where the D9 gates run, and why not in the obvious place

`DataSourceRoutesSpec` (`backend/src/test/scala/com/helio/api/routes/sources/DataSourceRoutesSpec.scala:87-99`)
is where a service-level delete test would naturally land, and it **cannot** host the divergence
gates: it migrates and connects as the `postgres` superuser and constructs `new DbContext(db, db)`,
so the app pool and the "privileged" pool are the same BYPASSRLS connection. In that harness nothing
is ever invisible to the RLS-scoped pre-check, the fixture silently takes the *visible* branch, and
all three gates pass for the wrong reason — 3.7c's 409 would be HEL-987's named one, 3.7d's
non-disclosure assertion would fail against it, and 3.7e could not distinguish the branches at all.
That is this ticket's own failure class (a gate that cannot observe what it certifies), reproduced
in the tests written to prevent it.

The D9 gates therefore run in a harness with **two genuinely distinct pools**: an app connection as
`helio_migration_test` (`NOSUPERUSER NOBYPASSRLS`, the D4 role shape) and a separate privileged
connection as `helio_privileged`, passed as two distinct `JdbcBackend.Database`s into the
`DbContext`. Invisibility is then real, produced by RLS rather than asserted.

**Fixture liveness assertion, mandatory:** each divergence gate first asserts that
`soleRootDependentPipelines` returns EMPTY for its fixture. Without that, a fixture that drifts back
into visibility silently downgrades the gate into a re-test of the visible path — exactly how V99's
own coverage went vacuous.

## Risks / Trade-offs

- **Editing V99's comment changes its Flyway checksum. RESOLVED BY ESCALATION — answer:
  `v100-header-only`.** Verified independently by the coordinator: `Database.initApp` builds Flyway
  with `.configure().dataSource(...).locations(...).load().migrate()` and nothing else — no
  `validateOnMigrate(false)`, no `ignoreMigrationPatterns` anywhere in the backend. Any database that has already applied V99
  (the shared dev DB, and any prod deploy that has run since HEL-913) will fail validation with a
  checksum mismatch. **This is the single highest-risk element of the change.** Mitigation: do not
  edit `V99__*.sql` at all. Put the corrected narrative in V100's own header (which is where a
  reader of `git log`/`git blame` on the trigger will land anyway) and, if a pointer at V99 is
  wanted, leave V99 untouched and note the correction in the archived HEL-913 `tasks.md` plus
  V100's header. The executor MUST NOT modify any already-applied migration file. AC5's literal
  file target moves; its intent (the false claim must stop being archived as fact) is satisfied.

  **V100's header MUST state plainly WHY V99's own header was not corrected in place** (owner
  ruling). A future reader who finds a stale claim in V99 and its correction in V100 must not have
  to rediscover the checksum reason — or they will "tidy it up" and break the next deploy.
- **A BYPASSRLS-owned trigger sees cross-tenant rows, and its error message may name pipeline ids
  the caller cannot see and never referenced.** An earlier draft of this bullet claimed the ids are
  ones "the caller already necessarily referenced" — **that is false after this fix**, and this
  ticket exists because a migration header asserted something untrue about RLS reach. Stated
  honestly: post-fix the trigger reads with `BYPASSRLS`, so a raise can disclose the id of a
  pipeline outside the caller's visibility. In the shipped path `DataSourceService` maps the raise
  to a generic 409 that does NOT echo the trigger's text (`soleRootConflict(source, Vector.empty)`
  on the recover branch), so the ids do not currently reach an API client — but that is a property
  of the caller, not of the trigger, and must be stated as such rather than asserted of the trigger.
  See D9 for the behavioural divergence this creates.
- **Test runtime.** A second EmbeddedPostgres full-chain migration adds roughly the cost of
  `FlywayNonSuperuserMigrationSpec` again. Acceptable for a gate on a silent-data-loss guard; the
  new spec skips the 10k-line dump load, which is the expensive part.

### D8 — Mutation work never touches the shared dev database

All probe and mutation work (D5 steps 1-5) runs **only** against EmbeddedPostgres inside the new
spec. The shared dev DB is never used for a mutated V100 body: once it records a checksum for V100,
any subsequent boot with a different body fails Flyway validation — the same incident class that
produced this change's `v100-header-only` ruling, re-armed one layer along.

Sequencing is therefore pinned: probe and both mutation states first (EmbeddedPostgres only), then
freeze V100's body, and only then run task 1.7's dev-DB boot check against that final frozen body.
If a mutated V100 ever does reach the dev DB, the recovery is named up front rather than discovered
mid-run: delete that row from `flyway_schema_history` (or `flyway repair`) and re-migrate.

## Migration Plan

Single forward migration, no data change, no rollback path needed (re-owning a function is
idempotent and the `REVOKE` restores the prior grant state). Verified under a non-superuser
connection in test; not applied to any production database by this run.

## Planner Notes

- Self-approved: the new capability name `pipeline-zero-root-db-guard`, the V100 filename, and the
  new spec class name. All follow existing conventions.
- Self-approved: leaving `FlywayNonSuperuserMigrationSpec` unchanged (D4) rather than extending it.
- Escalated and ANSWERED (`v100-header-only`): no edit to `V99__*.sql`. Not revisitable in-loop.
