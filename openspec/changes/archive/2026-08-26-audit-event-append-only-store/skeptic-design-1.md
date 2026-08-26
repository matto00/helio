## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Cold review of `openspec/changes/audit-event-append-only-store/` (ticket.md, proposal.md,
design.md, tasks.md, both spec deltas). Every factual claim below was checked against the
worktree, not against design.md's narrative.

### What I verified (with evidence)

**Claims that hold up.**

- **V38 grants full DML to `helio_privileged`, including future tables.**
  `backend/src/main/resources/db/migration/V38__*.sql` contains
  `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_privileged`
  *and* `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO helio_privileged`.
  design.md's Context fact 2 is accurate. A revoke-only mechanism is genuinely defeated.
- **The test harness re-grants full DML after Flyway.** Confirmed in
  `src/test/scala/com/helio/api/ApiTokenAuthSpec.scala:116`,
  `src/test/scala/com/helio/api/routes/pipelines/PipelineApplyProposalSpecBase.scala:131`,
  `RlsSharingAwareTablesSpec.scala:92`, `RlsPrivilegedDmlSpec` beforeAll, and
  `BetaAccessRoutesSpec.scala:84` — all issue
  `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO helio_app_test` *after*
  `Flyway...migrate()`. design.md's third dominating fact is real, and its inference (a
  revoke-based test would be testing harness grant ordering) is correct.
- **FORCE ROW LEVEL SECURITY is needed because the app role owns the tables.** `V35` line 9 says
  exactly this. Accurate.
- **RLS-only enforcement yields silent zero rows, not an error.** Correct Postgres semantics: a
  row that fails the `USING` quals for UPDATE/DELETE is simply not visible to the statement;
  the command reports `UPDATE 0` / `DELETE 0`. design.md's rejection of RLS-as-mechanism, and of
  `RULE ... DO INSTEAD NOTHING`, is sound.
- **The `USING`-as-`WITH CHECK` fact load-bearing in Decision 2 is true**, and is already
  documented in-repo: `V42__api_tokens.sql:34` — "With no WITH CHECK clause the USING expression
  also gates INSERT". Matches the Postgres `CREATE POLICY` docs. Decision 2's first reason (an
  owner-scoped policy would reject NULL-actor rows on INSERT) therefore stands.
- **A trigger is not privilege-dependent and not RLS-dependent.** Correct: triggers fire for the
  table owner, for a `BYPASSRLS` role, and for a superuser alike, and `RAISE EXCEPTION` in a
  `BEFORE` trigger aborts the statement. Claims (a) loud error, (b) survives a re-GRANT, and
  (c) not bypassed by `helio_privileged` all hold *for UPDATE and DELETE*.
- **`ENABLE ALWAYS` is genuinely necessary, not cargo cult.** A default (`ENABLE ORIGIN`) trigger
  is skipped when `session_replication_role = 'replica'`. That is doubly relevant here because
  the ScalaTest harness logs in as the `postgres` superuser and only then `SET ROLE`s
  (`RlsPrivilegedDmlSpec` beforeAll; `appCfg.setConnectionInitSql("SET ROLE helio_app_test")`) —
  a superuser login can set that GUC. `ENABLE ALWAYS` closes a hole that is reachable in this
  repo's own test topology.
- **`ERRCODE = 'restrict_violation'` is SQLSTATE `23001`** and is a stable, real Postgres error
  code. Asserting on the code rather than the message is the right call. `grep -rn "23001"
  backend/src` returns no existing use, so there is no collision risk on this assertion.
- **Migration number.** `ls backend/src/main/resources/db/migration | sort -V | tail -1` in this
  worktree gives `V90__invite_codes.sql`. `V91` is correct today, and Decision 5's instruction to
  re-verify against a fresh `origin/main` is appropriate given the shared dev Postgres.
- **Scope discipline is genuinely maintained in the artifacts.** `grep -i ratelimit` across the
  change dir returns only Decision 4 / the non-goal statements — no import, no call site, no
  route is named as a target. Task 4.3 explicitly forbids adding a call site. The proposal's
  "Modified Capabilities: (none)" is consistent with that.
- **Schema-drift check is not a hazard here.** `scripts/check-schema-drift.mjs` iterates
  `schemas/` and looks up the matching case class (line 108/113), not the reverse — adding an
  `AuditEvent` formatter without a JSON Schema will not trip the pre-commit hook.
- **Task 6.3's premise is technically correct.** In Scala, `repo.append(x).recover { ... }`
  evaluates `repo.append(x)` first; a synchronous throw escapes before `.recover` is ever
  applied. The synchronous-throw case therefore *does* require a distinct eager guard
  (`Future.fromTry(Try(...)).flatten`, `Future.unit.flatMap(_ => ...)`, or equivalent), and a
  naive `.recover`-only implementation would genuinely fail that test. This is real red, not
  ceremony.
- **Task 5.6's methodology is sound in principle.** Because `EmbeddedPostgres` is created fresh in
  `beforeAll`, dropping the trigger and re-running produces a real, reproducible red — and the
  red arrives *as the exact failure mode the brief names* (a silent `UPDATE 0` where SQLSTATE
  23001 was expected). It is falsifiable and a reviewer can rerun it. See CR 4 for the one thing
  it fails to pin down.

**Claims and plans that do not hold up** — detailed as change requests below.

### Verdict: REFUTE

The design is well above average and most of its load-bearing claims survived checking. But two
of the defects below are substantive (an unclosed bypass that falsifies design.md's own stated
guarantee, and a missing positive control on the exact pool the write path uses), and all six are
cheap to fix at the design stage and expensive to discover in execution.

### Change Requests

1. **TRUNCATE is an uncovered bypass, and it falsifies design.md's own claim.** Decision 1's
   Residual-risk paragraph asserts the design "claims immutability against *all DML*, from every
   pool". That is not what the proposed mechanism delivers. A `FOR EACH ROW BEFORE UPDATE OR
   DELETE` trigger **does not fire on `TRUNCATE`**, and `TRUNCATE` privilege belongs implicitly to
   the table owner — which, per design.md's own Context fact 1, is the role the **app pool**
   connects as in production. So the app pool can erase the entire audit history with one
   statement that succeeds silently. (`helio_privileged` is not similarly exposed: V38 grants only
   SELECT/INSERT/UPDATE/DELETE, never TRUNCATE. The test harness's `helio_app_test` is likewise
   not the owner, which is precisely why no test would have caught this.) The fix is one
   statement: add a `BEFORE TRUNCATE ... FOR EACH STATEMENT` trigger on `audit_events` calling the
   same raising function, and `ENABLE ALWAYS` it too. Required revisions:
   - design.md Decision 1: name TRUNCATE explicitly, state that the row-level trigger does not
     cover it and that the app-pool role holds TRUNCATE by ownership, and adopt the statement-level
     `BEFORE TRUNCATE` trigger as part of the mechanism.
   - tasks.md 1.5: add the `BEFORE TRUNCATE ... FOR EACH STATEMENT` trigger + its `ENABLE ALWAYS`.
   - `specs/audit-event-persistence/spec.md`, "audit_events is append-only and fails loudly":
     the requirement text says "every UPDATE and every DELETE"; extend it to TRUNCATE and add a
     scenario ("TRUNCATE against the audit table fails").
   - tasks.md section 5: add a TRUNCATE case. Note it must be issued by a role that *can*
     TRUNCATE — the harness's `helio_app_test` cannot, so the assertion must be run on the
     superuser/owner connection or the test proves nothing (this is exactly the
     evidence-shaped-non-evidence trap; state the connection explicitly in the task).
   (For completeness: I checked `COPY` and it is not a further hole — `COPY ... FROM` is an insert
   path, which is permitted anyway, and there is no `COPY`-based delete.)

2. **There is no positive control on the pool `append` actually uses.** Decision 2 puts `append`
   on `DbContext.withSystemContext` (the `helio_privileged` pool), but task 5.5's positive control
   says only "INSERT and SELECT succeed" without naming a pool, and `RlsPrivilegedDmlSpec`'s
   beforeAll deliberately does **not** re-grant to `helio_privileged` ("do NOT re-grant here so
   that a missing V38 causes permission denied, not a silent pass"). `audit_events` inherits its
   privileged-role INSERT grant solely from V38's `ALTER DEFAULT PRIVILEGES`, which only applies to
   objects created by the role that issued it. If that inheritance does not hold for this table,
   the entire write path is dead on arrival in production and every test in section 5 (which
   asserts failures) still passes. Revise tasks.md 5.5 to require an explicit assertion that
   **INSERT succeeds on the privileged pool** (`withSystemContext`), and add the corresponding
   scenario to the persistence spec's "INSERT remains permitted" — change "a permitted role" to
   name the privileged pool. This is the V38 regression class that `RlsPrivilegedDmlSpec` exists to
   catch; a new ACL'd table must not opt out of it.

3. **The repository read signatures are ambiguous in a way that decides whether test 6.2 means
   anything.** `DbContext.withUserContext` requires a `userId` argument, but neither task 3.3
   ("Implement `findByActor` (newest-first) and `findByResource` via `DbContext.withUserContext`")
   nor the persistence spec's `AuditEventRepository` requirement says where that user id comes
   from. Two readings a competent implementer could take: (a) `findByActor(actor)` passes the
   *actor argument* as the RLS context user — in which case the owner policy is vacuous, it can
   never filter anything, and task 6.2's "app pool sees only its own rows" is unfalsifiable; or
   (b) the methods take a separate caller/context `UserId` distinct from the actor/resource
   filter. Only (b) makes Decision 3's read-scoping real. Pin the signatures explicitly in
   design.md/tasks.md/spec — including what `findByResource` receives as its RLS context user,
   which its name does not suggest at all.

4. **Task 5.6 must specify the *reason* the red is acceptable, not just that a red occurred.** As
   written ("capture the failing output to a committed evidence file") the task is satisfied by
   any failure. With the trigger dropped there are at least two possible reds — a silent
   `UPDATE 0`/`DELETE 0` (the correct one, and the exact failure mode the brief calls out) and a
   `permission denied` from the defence-in-depth REVOKE (which would demonstrate the revoke, not
   the absence of the trigger, and would mean the trigger case never actually distinguished
   itself). Require the transcript to record the observed behaviour, and require the red for
   case 5.4 (post-`GRANT`) specifically to be the silent-zero-row form — that is the single
   observation that proves the trigger, not the revoke, is load-bearing. Also state the drop
   mechanism concretely (a `DROP TRIGGER` issued on the superuser connection in `beforeAll` of a
   scratch run, versus commenting out the migration lines) so a reviewer reproduces the same
   thing you did.

5. **Task 6.4's rate-limit-isolation check is not checkable as written.** "a grep-style assertion
   **or explicit reviewer note** that the diff contains no reference to the rate-limiting code" —
   the second disjunct is an escape hatch that reduces the check to an assertion, which is what
   the brief forbids. The corresponding spec scenario ("No existing component is instrumented ...
   WHEN this change's diff is inspected") has the same problem. Make it mechanical and recordable:
   a command whose output is captured in the evidence file, e.g.
   `git diff main...HEAD | grep -i -e ratelimit -e 'rate_limit'` expected empty, plus a check that
   no route/directive file appears in `files-modified.md`. Drop the "or reviewer note" alternative.

6. **Task 1.6's `REVOKE` has no grantee and is not valid SQL as specified.** "`REVOKE UPDATE,
   DELETE ON audit_events`" is incomplete — `REVOKE` requires `FROM <role>`. Name the grantees
   deliberately (`PUBLIC` and/or `helio_privileged`) and note in the same task that revoking from
   `helio_privileged` does not survive a future re-run of a V38-style grant, which is the stated
   reason it is defence-in-depth rather than the mechanism.

### Non-blocking notes

- Decision 3's accepted consequence (`findByResource` answers "what did **I** do to this
  resource") is acceptable for a foundation ticket, and I do not think it boxes in the query
  ticket: the persistence spec already codifies "The privileged pool sees all audit rows", which
  is the escape hatch the admin/owner-tier read path will use, and Decision 3 names that path
  explicitly. It is documented rather than hidden, which is the right posture. Recommend only
  that the *method name* not imply cross-user semantics it does not have — consider naming the
  app-pool method to reflect its self-scoping.
- `ERRCODE = 'restrict_violation'` is semantically borrowed (its usual origin is a RESTRICT
  referential action), but it is stable, specific, and collision-free in this repo. A custom
  `P0001`-class or `2F`-class code would read more honestly; not worth blocking over.
- This would be the repo's **first** database trigger (`grep -l "CREATE TRIGGER"` over
  `db/migration` returns nothing). Worth an extra sentence in the task 1.8 header comment, since
  future readers have no in-repo precedent to pattern-match against.
- Task 1.2 gives `id` a `gen_random_uuid()` default; V90's header notes the newer house style is
  app-side minting with no DEFAULT. V11/V41/V42 use the default, so either is defensible — just be
  deliberate about which, since the domain model's `AuditEventId` construction follows from it.
- `metadata JSONB` is specified nullable; consider `NOT NULL DEFAULT '{}'::jsonb` so the domain
  model and every future consumer avoid an `Option` that carries no meaning.
- Environmental note, not a defect in the artifacts: this worktree's `scripts/concertino/` predates
  `next-report-number.sh` / `persist-evidence.sh` / `emit-event.sh`; I ran those from the main
  checkout at `/home/matt/Development/helio/scripts/concertino/`.
