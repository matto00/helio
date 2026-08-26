# Design — Audit event model + append-only event store (HEL-471)

## Context

This is the foundation ticket of the Audit Logging epic (HEL-435). Nothing audit-shaped exists in the backend
today: `AuditEvent`, `audit_events`, `AuditService`, and `EventStore` all return zero hits across `backend/src`.
The single audit-adjacent artifact is `pipeline_runs.triggered_by_token_id` (V74, HEL-369) — one narrow
attribution column, not a store.

Two pre-existing facts dominate every decision below, and both were verified against `origin/main` at `666da5d7`
rather than assumed:

1. **The app pool connects as the table owner.** `DbContext` runs `withUserContext` on a pool whose role is
   `DB_USER`, which owns the tables. This is exactly why `V35` needs `FORCE ROW LEVEL SECURITY` — without FORCE,
   the owner bypasses RLS entirely.
2. **`helio_privileged` is `BYPASSRLS` and already holds full DML on every table, present and future.** `V38`
   issues `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_privileged` *and* an
   `ALTER DEFAULT PRIVILEGES` clause that covers tables created later — including `audit_events`.

A third fact settles the mechanism: **the ScalaTest harness re-grants full DML after migrations run.**
`ApiTokenAuthSpec`, `PipelineApplyProposalSpecBase`, and `AuthoringConversationRepositorySpec` each execute
`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test` during setup, *after*
Flyway has applied the schema. Any privilege the migration revokes is handed straight back.

## Goals / Non-Goals

**Goals.** A durable `audit_events` table; a demonstrable append-only guarantee that raises an error rather than
silently doing nothing; owner-scoped reads following the established RLS convention; an `AuditEvent` domain model,
a Slick repository, and a failure-isolating `AuditService.record`.

**Non-Goals.** Instrumenting any route, directive, or service. PAT attribution wiring beyond the columns existing.
The audit query API and UI. Retention/pruning (HEL-438). Cross-user or admin-wide audit reads.

## Decision 1 — Append-only is enforced by an `ENABLE ALWAYS` trigger, not by revokes and not by RLS

**Decision.** The load-bearing mechanism is a **statement-level** `BEFORE UPDATE OR DELETE ... FOR EACH
STATEMENT` trigger on `audit_events` whose function unconditionally `RAISE EXCEPTION`s with a stable `ERRCODE`,
promoted with `ALTER TABLE audit_events ENABLE ALWAYS TRIGGER <name>`. A row-level trigger is retained only as
defence-in-depth.

**Why statement-level, and why this is the cause-level fix.** A `FOR EACH ROW` trigger only fires for rows the
scan actually selects, which makes the guarantee depend on **row visibility** — and under `FORCE ROW LEVEL
SECURITY` visibility is exactly what RLS controls. Postgres applies `SELECT` policies alongside the
`UPDATE`/`DELETE` policy whenever the statement references table columns, so any `WHERE`- or `RETURNING`-bearing
statement against a NULL-actor or other-user row is filtered out of the scan, no row-level trigger fires, and the
result is the forbidden silent `UPDATE 0` / `DELETE 0`. Splitting the RLS policies (Decision 3) fixes only the
column-free statement form — which is not the form anything real issues.

A **statement-level `BEFORE` trigger fires before the scan happens at all**. It is therefore unaffected by which
rows RLS makes visible, by whether any row matches, by which pool is connected, and by whether the connected role
owns the table. That is what makes the guarantee unconditional rather than contingent, and it is why this is a
cause-level fix rather than a third patch on the same symptom. Add `REVOKE UPDATE, DELETE ON audit_events` as
defence-in-depth only, explicitly *not* as the load-bearing mechanism.

**Why not the ticket's literal suggestion (revoke only).** The ticket says "no UPDATE/DELETE grants for the app
role on this table (revoke)". Three independent facts defeat that as a sole mechanism:
- The app pool's role **owns** the table. An owner can re-grant to itself at will, so a revoke is a speed bump.
- `V38`'s `ALTER DEFAULT PRIVILEGES` re-grants full DML on newly created tables to `helio_privileged` anyway.
- The test harness re-grants full DML *after* migration. A revoke-based test would therefore be testing the
  harness's grant ordering, not the schema — and would flip from green to red on an unrelated harness edit.

**Why not RLS alone.** Under `FORCE ROW LEVEL SECURITY` with a `USING` policy that no UPDATE or DELETE can satisfy,
Postgres does not error — it matches zero rows and reports success. That is precisely the "evidence-shaped
non-evidence" failure this ticket's acceptance criteria forbid: a test asserting "the row is still there after a
DELETE" would pass against a table with no protection at all if the row simply had a different owner. RLS is
retained for **read** scoping (Decision 3) and given no mutation-blocking role.

**Why not a `RULE ... DO INSTEAD NOTHING`.** Same defect as RLS: silent success.

**TRUNCATE is a separate hole and needs a separate trigger.** A `FOR EACH ROW BEFORE UPDATE OR DELETE`
trigger does **not** fire on `TRUNCATE`, and `TRUNCATE` privilege belongs implicitly to the table owner — which,
per Context fact 1, is exactly the role the **app pool** connects as in production. Without this, the app pool
could erase the entire audit history with one statement that succeeds. (`helio_privileged` is not similarly
exposed: `V38` grants only SELECT/INSERT/UPDATE/DELETE, never TRUNCATE. The test harness's `helio_app_test` is
not the owner either — which is precisely why no test written against the harness role would have caught this.)
The mechanism therefore includes a second trigger: `BEFORE TRUNCATE ... FOR EACH STATEMENT`, calling the same
raising function, also `ENABLE ALWAYS`. (TRUNCATE triggers can only be statement-level, so this was already the
right shape here.) `COPY` is not a further hole: `COPY ... FROM` is an insert path, which is
permitted anyway, and there is no `COPY`-based delete.

**Why `ENABLE ALWAYS`.** A plain trigger is `ENABLE ORIGIN`, which is skipped when
`session_replication_role = 'replica'` — a session-level setting, not a DDL change. `ENABLE ALWAYS` closes that
hole so the guarantee is not one `SET` away from evaporating.

**Residual risk, stated plainly.** A trigger is still DDL-removable: the table owner can
`ALTER TABLE ... DISABLE TRIGGER` or `DROP TRIGGER`. This design does **not** claim tamper-proofness against a
deliberate actor holding owner DDL rights. The precise claim is narrower and is stated deliberately: **no DML
statement — UPDATE, DELETE, or TRUNCATE — from any pool can alter or remove an existing audit row.** Anything
beyond that requires DDL rights on the table. True tamper-resistance (WORM storage, an
append-only replica, or hash-chaining) is named in the epic as its own later ticket and is out of scope here.

**Error code.** The trigger raises with `ERRCODE = 'restrict_violation'` (SQLSTATE `23001`) so tests assert on a
stable, specific code rather than string-matching a message.

## Decision 2 — `AuditService` writes through the privileged pool; reads are owner-scoped

**Decision.** `AuditEventRepository.append` runs under `DbContext.withSystemContext`. `findByActor` and
`findByResource` run under `DbContext.withUserContext`.

**Why.** Three reasons, each sufficient on its own:
- The store must record **pre-auth and system events with a null `actor_user_id`**. An owner-scoped RLS policy
  whose `USING` clause also gates INSERT (Postgres applies `USING` as `WITH CHECK` when no `WITH CHECK` is given)
  would reject exactly those rows.
- An audit record must not be contingent on the acting user's own visibility. Making the write depend on the
  caller's RLS context creates a class of bug where the very action worth auditing is the one that fails to record.
- Audit writes must be able to record an action by actor A even when the surrounding transaction is scoped to B.

**Read signatures are pinned, because the RLS context user is not the same thing as the filter argument.**
`withUserContext` takes a `userId`; if `findByActor` were to pass its own *actor argument* as that context user,
the owner policy would be structurally vacuous — it could never filter anything, and the read-scoping test would
be unfalsifiable. The signatures are therefore explicitly:

- `findByActor(callerUserId: UserId, actorUserId: UserId): Future[Seq[AuditEvent]]`
- `findByResource(callerUserId: UserId, resourceType: String, resourceId: String): Future[Seq[AuditEvent]]`
- `append(event: AuditEvent): Future[AuditEventId]`

`callerUserId` is the RLS context user passed to `withUserContext` and is always the authenticated caller, never
derived from the filter arguments. `findByResource` takes it too, even though its name does not suggest a user at
all — which is exactly why it is written down here.

`DbContext` requires every `withSystemContext` callsite to carry an inline comment justifying bypass; the append
callsite will carry the three reasons above in condensed form. Decision 1 is what makes this safe: the privileged
pool gains no ability to mutate history, because the trigger does not care which role is connected.

## Decision 3 — Owner-scoped read policy, with its consequence stated

**Decision.** `ENABLE`/`FORCE ROW LEVEL SECURITY` plus **three** policies — an owner-scoped policy restricted to
`FOR SELECT`, and permissive `FOR UPDATE` / `FOR DELETE` policies:

```sql
CREATE POLICY audit_events_owner  ON audit_events FOR SELECT
  USING (actor_user_id = current_setting('app.current_user_id')::uuid);
CREATE POLICY audit_events_update ON audit_events FOR UPDATE USING (true);
CREATE POLICY audit_events_delete ON audit_events FOR DELETE USING (true);
```

**Why not the single `FOR ALL` owner policy that `V35`/`V42` use.** This is the one place the established
house pattern is actively wrong for this table, and the reason is subtle enough to be worth stating at length.
A policy with no `FOR` clause is `FOR ALL`, so under `FORCE ROW LEVEL SECURITY` its `USING` qual is applied to
UPDATE and DELETE **as part of the scan**. Rows the app-pool user does not own are therefore never selected for
modification, the `BEFORE ... FOR EACH ROW` trigger **never fires**, and Postgres reports `UPDATE 0` / `DELETE 0`
and success. That is precisely the silent-zero-row outcome Decision 1 exists to eliminate, reintroduced through
the back door — and it is falsified for exactly the two row classes this decision itself calls out: NULL-actor
system rows (every `source = 'system'` row, including Decision 4's future trip events) and any other user's rows.

It is also **self-concealing**: a test that inserts a row and then updates it *on the app pool as that row's own
actor* passes, while the general claim ("any connection issuing an UPDATE raises an error") is false. A green
test proving nothing is exactly the failure mode this ticket's brief forbids, so the test plan must exercise a
row the app-pool caller does not own (see the Testing strategy).

RLS therefore does not merely have "no mutation-blocking role" — left as `FOR ALL` it silently **pre-empts** any
*row-level* mutation-blocking mechanism. **Correction to an earlier draft of this decision: the policy split is
NOT what "lets every mutation reach the trigger."** It achieves that only for column-free statements; Postgres
applies `SELECT` policies alongside the UPDATE/DELETE policy as soon as the statement references any column, so a
targeted `WHERE`-bearing statement is still filtered out of the scan. The policy split is retained as
defence-in-depth and for clarity of intent, but the guarantee is carried entirely by Decision 1's
**statement-level** trigger, which fires before the scan and is therefore indifferent to all of this.

**Consequence to record, not discover — and stated correctly.** With the owner policy narrowed to `FOR SELECT`,
no policy applies to INSERT at all, and under `FORCE ROW LEVEL SECURITY` that means every app-pool INSERT is
**denied outright** with "new row violates row-level security policy" — not merely un-gated as an earlier draft
of this decision claimed. This holds for the non-owner app role and for the table owner alike, including for a
row the caller itself owns. That outcome is fail-safe and consistent with Decision 2 (every insert runs on the
privileged pool; the repository exposes no app-pool write path), so it is accepted deliberately — but it is a
hard denial, and any future ticket that wants an app-pool audit insert must add an INSERT policy rather than
expecting one to work.

**Read-scoping consequence, deliberately accepted.** On the app pool a user sees only rows *they authored*. `findByResource`
therefore answers "what did **I** do to this resource", not "what did anyone do to this resource"; and NULL-actor
system rows are invisible to every app-pool caller (a NULL comparison yields NULL, which Postgres treats as false —
the same posture `V35` documents for ownerless `data_sources`). Cross-user and administrator reads are explicitly
out of scope for this ticket; the query-API ticket will need an admin/owner-tier read path and should use the
privileged pool for it. This is documented rather than worked around so the later ticket inherits a known contract
instead of a surprise.

## Decision 4 — Accommodate HEL-495's future trip events by model shape only

**Decision.** The model must be able to express a rate-limit trip event, and this change must not contain a single
reference to the rate-limiting code.

**Why.** HEL-495 (the immediately preceding ticket, shipped at `666da5d7`) added `RateLimitDirective`, whose trip
events are a plausible future producer for this store. A trip event is expressible today with no schema change:
`source = 'system'`, `action = 'ratelimit.trip'`, `actor_user_id`/`actor_token_id` carrying the throttled
principal when known (null when not), and `metadata` carrying the limit, window, and bucket key. Confirming this
is the entire obligation. **Instrumentation is explicitly out of scope**, so the correct posture is: verify the
shape fits, write it down here, and stay otherwise ignorant. No import, no dependency, no call site.

## Decision 5 — Migration number is resolved against `origin/main` at authoring time

**Decision.** The migration is `V91`, but the executor MUST re-verify `ls backend/src/main/resources/db/migration`
against a fresh `origin/main` immediately before writing the file, and adjust if the max has moved.

**Why.** The ticket text says "main at V59"; the actual max at `666da5d7` is `V90__invite_codes.sql`. That is a
31-version drift, which is a concrete demonstration of why the number cannot be trusted from a ticket. All
worktrees on this machine share one dev Postgres, and a stale migration from a parallel run has poisoned
`flyway_schema_history` before.

## Risks / Trade-offs

- **Trigger overhead on write.** A `BEFORE UPDATE OR DELETE` trigger costs nothing on INSERT, which is the only
  operation this table ever performs in production. No measurable cost.
- **The trigger blocks legitimate deletion, including retention pruning.** This is intended and is the point of the
  ticket, but HEL-438 (retention) will need a deliberate, auditable escape hatch — most likely a
  `SECURITY DEFINER` pruning function, or a documented `ALTER TABLE ... DISABLE TRIGGER` inside the pruning
  transaction. Flagged here so the retention ticket is not surprised; not built now.
- **Owner-scoped reads hide system rows from users.** Accepted; see Decision 3.
- **This is the repo's first database trigger.** `grep -l "CREATE TRIGGER"` over `db/migration` returns nothing,
  so future readers have no in-repo precedent to pattern-match against. The migration header comment must carry
  extra explanation for that reason.
- **Scope isolation is verified mechanically, not by assertion.** Decision 4's "no reference to rate-limiting
  code" is checked by a command whose output is captured
  (`git diff <base>...HEAD | grep -i -e ratelimit -e rate_limit`, expected empty) plus a check that no route or
  directive file appears in `files-modified.md`. A reviewer note is not an acceptable substitute.

## Testing strategy — how append-only is *demonstrated*, not asserted

The brief is explicit that a check which cannot fail is not evidence, so the plan is stated in terms of what must
be observed **red**:

1. A migration-level spec (following `RlsPrivilegedDmlSpec`/`RlsOwnerTablesSpec`) inserts an audit row, then
   issues a **targeted** (`WHERE id = ...`) UPDATE and DELETE **on the app pool** and asserts each raises
   SQLSTATE `23001`. Targeted matters: a bare column-free `UPDATE audit_events SET ...` is the one statement
   form that escapes RLS scan-filtering, so a test using only that form would pass against a design that fails
   for every statement anything real issues. Cover three row classes — a row the caller owns, a row another user
   owns, and a NULL-actor row.
2. **On the privileged (`helio_privileged`, BYPASSRLS) pool, in two explicit phases** — not "the same two
   assertions repeated". Task 1.6 revokes UPDATE/DELETE from `helio_privileged`, and
   `RlsPrivilegedDmlSpec` deliberately does not re-grant, so with the revoke in place the privileged pool
   gets **42501 permission denied** and the statement never reaches the trigger at all. Therefore:
   (a) assert the revoked privileged role fails with **42501**, recorded as the defence-in-depth revoke
   working; then (b) re-`GRANT UPDATE, DELETE ON audit_events TO helio_privileged` and assert the same
   statements now raise **23001**, recorded as the proof that the trigger binds even a BYPASSRLS role that
   holds the privilege. Both phases are required. **Loosening this to "any database error" is NOT an
   acceptable resolution** — the whole test plan rests on distinguishing a permission-denied (which
   demonstrates the revoke) from a 23001 (which demonstrates the trigger), and collapsing them destroys
   exactly the distinction this ticket exists to make trustworthy.
3. A case that issues `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public` to the app role
   *first*, then asserts UPDATE and DELETE still raise — this is the case that distinguishes the trigger from a
   revoke, and it is the reason the revoke is not the mechanism.
4. **A positive control on the pool `append` actually uses.** INSERT must be asserted to succeed **on the
   privileged pool** (`withSystemContext`), not merely "on some role". `audit_events` inherits its
   privileged-role INSERT grant solely from `V38`'s `ALTER DEFAULT PRIVILEGES`, which applies only to objects
   created by the role that issued it; `RlsPrivilegedDmlSpec` deliberately does not re-grant to
   `helio_privileged` so that a missing V38 surfaces as `permission denied` rather than a silent pass. If that
   inheritance does not hold for this table the entire write path is dead on arrival in production — and every
   failure-asserting test in 1–3 would still pass. SELECT on the app pool is asserted alongside it.
5. A TRUNCATE case. It must be issued **by a role that can actually TRUNCATE** — the harness's
   `helio_app_test` is not the owner and cannot, so running it as that role would prove nothing (the
   evidence-shaped-non-evidence trap). It must be issued on the owner/superuser connection.
6. **Captured red transcript.** Each of the above must be observed failing against a variant with the trigger
   absent, and the transcript must record **which** red was observed, not merely that one was. With the trigger
   dropped there are at least two possible failures: a silent `UPDATE 0`/`DELETE 0` (the correct one — the exact
   failure mode the brief names) and a `permission denied` from the defence-in-depth REVOKE (which would
   demonstrate the revoke, not the absence of the trigger). **For the post-`GRANT` case specifically the red must
   be the silent-zero-row form** — that single observation is what proves the trigger rather than the revoke is
   load-bearing. The drop mechanism is stated concretely: a `DROP TRIGGER` issued on the superuser connection in a
   scratch run's `beforeAll` (not commenting out migration lines, which changes the checksum on a shared dev
   Postgres), naming **which** trigger is dropped for which red. The transcript is committed as evidence.
   Specifically: dropping the **statement-level** trigger (leaving the row-level trigger and all three policies
   in place) and issuing a **targeted** UPDATE/DELETE against a NULL-actor row and an other-user row must produce
   the silent `UPDATE 0`/`DELETE 0`. That is the red which proves the statement-level trigger is the load-bearing
   mechanism. Note that a red derived from reverting the RLS policies to a single `FOR ALL` policy will NOT go
   red once the statement-level trigger exists — the trigger raises before the policy matters — so that check
   must not be used; it is a check that cannot fail.
7. `AuditService` failure isolation is tested with a stub repository that (a) returns a failed `Future` and
   (b) throws synchronously — both must yield a successful `Future` from `record`. The throwing case matters
   because a naive `.recover` on the result of a method that throws before returning a `Future` does not catch it;
   this test must be seen red against an implementation lacking the eager guard.

## Smaller decisions, recorded deliberately

- **`metadata` is `JSONB NOT NULL DEFAULT '{}'::jsonb`**, not nullable. A null metadata and an empty metadata
  carry the same meaning, so an `Option` at the domain layer would be a distinction without a difference for
  every future consumer.
- **`id` keeps the `gen_random_uuid()` default** (V11/V41/V42 precedent) rather than V90's newer app-side
  minting. Chosen deliberately because `append` returns the generated `AuditEventId` and the DB default keeps the
  insert path minimal; the domain model's construction follows from this.
- **`ERRCODE = 'restrict_violation'` (23001)** is semantically borrowed — its usual origin is a RESTRICT
  referential action — but it is stable, specific, and `grep -rn "23001" backend/src` shows no existing use, so
  assertions on it cannot collide. Accepted over a custom `P0001` code for that stability.

## Decision 6 — Test isolation, given that the audit table can never be cleaned

**The problem.** Every other spec in this repo cleans between runs with `DELETE`/`TRUNCATE` over a named table
list. On `audit_events` both are now impossible **by construction** — that is the entire point of the ticket.
All worktrees on this machine share one dev Postgres, a hazard this repo has already been bitten by. Left to
improvise, the failure modes are the silent ones: `findByActor` "newest-first" and `findByResource` "only events
for that resource" asserted against rows accumulated by previous runs, or an absolute-count assertion that
passes or fails on run history rather than on behaviour.

**Decision (a) — isolation is mandatory and is the primary mechanism.** Every assertion in every new spec MUST be
scoped by per-run-unique `actor_user_id` / `resource_type` / `resource_id` values (fresh UUIDs / a run-unique
suffix). Explicitly forbidden anywhere in these suites: absolute `count(*)` assertions, "returns all rows"
assertions, and "the table is empty" assertions. A test that depends on the table's total contents is a test that
depends on run history.

**Decision (b) — teardown is `afterAll`-only, or omitted.** The only mechanism that can empty the table is
`ALTER TABLE audit_events DISABLE TRIGGER ALL` + `DELETE` + re-`ENABLE ALWAYS`, on the owner/superuser
connection. If adopted it MUST run strictly in `afterAll` — **never** in `beforeEach`, and never on the same
connection or inside the same transaction as any immutability assertion. A suite that disables the guard it is
proving is one ordering mistake away from a vacuous green. Given Decision 6(a) makes teardown unnecessary for
correctness, omitting it entirely is the safer default and is the recommended choice; adopt it only if row
accumulation on the shared dev DB becomes a practical problem, and if adopted, document the ordering constraint
at the callsite.

## Migration Plan

Single forward migration; no backfill (the table is new and empty). No rollback path is provided — dropping an
audit table is not an operation this system should make easy.
