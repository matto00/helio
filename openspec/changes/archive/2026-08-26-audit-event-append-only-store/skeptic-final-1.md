## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review. Every conclusion below is derived from the actual diff, the actual migration
applied to a live Postgres 18.4 instance I stood up myself, and a test run I executed myself.
The executor's evidence.md and the evaluator's evaluation-1.md were read as claims only.

### What I verified (with evidence)

**1. The append-only guarantee, against a real built schema (the central question)**

Stood up scratch DB `hel471_skeptic` on the local PG 18.4 cluster, owned by a fresh non-superuser
role `hel471_owner`, and applied `V91__audit_events.sql` verbatim as that owner. Confirmed via
`\d+ audit_events`: all nine columns as specified, both required indexes
(`idx_audit_events_actor_created`, `idx_audit_events_resource`), the source CHECK constraint,
`forced row security enabled`, three policies, and all three triggers listed under
**"Triggers firing always"** (i.e. `ENABLE ALWAYS` really took).

Ran a **21-statement mutation matrix against 4 principals = 84 attempts**:

- Principals: `hel471_app` (non-BYPASSRLS app role, granted full DML incl. TRUNCATE),
  `hel471_owner` (the TABLE OWNER — the app pool's production role),
  `helio_privileged` (real BYPASSRLS role, granted UPDATE/DELETE/TRUNCATE), and `postgres`
  (superuser, the only principal that can set `session_replication_role`).
- Statements: targeted UPDATE/DELETE against an own-actor row, another user's row, and a
  NULL-actor row; untargeted (no-WHERE) UPDATE and DELETE; UPDATE/DELETE with `RETURNING`;
  zero-match (`WHERE false`) UPDATE and DELETE; `UPDATE ... FROM` join; `DELETE ... USING` join;
  data-modifying CTEs (`WITH d AS (UPDATE ... RETURNING) ...` and the DELETE form);
  `INSERT ... ON CONFLICT (id) DO UPDATE`; `MERGE ... WHEN MATCHED THEN UPDATE`;
  `MERGE ... WHEN MATCHED THEN DELETE`; `TRUNCATE`; `TRUNCATE ... CASCADE`; and — as superuser —
  UPDATE/DELETE/TRUNCATE under `SET session_replication_role = 'replica'`.

**Result: 84/84 raised `audit_events is append-only: <TG_OP> is not permitted (HEL-471)`. Zero
silent zero-row outcomes anywhere.** SQLSTATE confirmed as `23001` by catching it in a `DO` block
(`NOTICE: SQLSTATE=23001`). After all 84 attempts, `SELECT action, count(*) ... GROUP BY action`
still returned exactly `orig-null|1`, `orig-other|1`, `orig-own|1` — every seeded row present and
its `action` unmodified. Bonus: `session_replication_role` is not even settable by the app role,
the owner, or `helio_privileged` (`permission denied to set parameter`) — so the `ENABLE ALWAYS`
hardening is belt-and-braces on top of a privilege the production roles do not hold, and it still
holds for the superuser who does.

Also verified the documented INSERT posture is real, not aspirational: both `hel471_app` and
`hel471_owner` get `ERROR: new row violates row-level security policy for table "audit_events"`
on INSERT (V91's owner policy being `FOR SELECT` only), while the BYPASSRLS privileged role — the
only pool `AuditEventRepository.append` uses — inserts fine. The migration's comment block states
exactly this consequence; it is accurate.

**2. Authenticity of evidence.md's RED transcripts — 5.6b re-derived live**

Dropped ONLY `audit_events_no_mutation_stmt` (leaving `audit_events_no_mutation_row` and all three
policies exactly as V91 creates them) and re-ran targeted statements as the app role with
`app.current_user_id` set to owner A:

```
-- (a) targeted UPDATE against OTHER user row:   UPDATE 0
-- (b) targeted DELETE against NULL-actor row:   DELETE 0
-- (c) control: targeted UPDATE against OWN row: ERROR: audit_events is append-only: UPDATE ...
-- (d) untargeted UPDATE (no WHERE):             ERROR: audit_events is append-only: UPDATE ...
```

This reproduces evidence.md's 5.6b transcript **exactly, and in the right failure mode** — a
genuine silent `UPDATE 0` / `DELETE 0`, NOT a `permission denied` standing in for one. The control
lines (c)/(d) further prove the row-level trigger is present and functioning, which is what makes
(a)/(b) a real isolation of the *statement-level* trigger as the load-bearing mechanism rather
than an artefact of having disabled enforcement wholesale. The statement-level trigger was then
recreated with `ENABLE ALWAYS` and the guarantee re-confirmed. evidence.md's recorded red is
authentic.

**3. Tests that cannot fail — hunted, none found**

- `AuditEventsAppendOnlySpec` (16 tests): every assertion goes through `expectSqlState`, which
  `intercept[Exception]`s and then asserts the *specific* SQLSTATE (`23001` trigger vs `42501`
  permission-denied vs `23514` check-violation). It cannot be satisfied by "any error", which is
  precisely the collapse the design gate warned about. My 5.6b run proves the 23001 cases go GREEN
  → RED (to a silent success) the moment the mechanism is removed, so these are genuinely
  falsifiable. The 5.4 case (fresh `GRANT ... ON ALL TABLES` to the app role, then still 23001) is
  the one that distinguishes trigger from revoke, and it does what it claims.
- `AuditEventRepositorySpec`: every assertion is scoped to freshly-minted random users /
  `res-<uuid>` resource types / random resource ids. The "RLS context user is the caller, not the
  filter argument" test is non-vacuous — `callerA` is a brand-new user, so a repository that
  wrongly derived the RLS context from the `actorUserId` argument would return `idB` and fail.
- `AuditServiceSpec` synchronous-throw case: the guard is real. `record` is
  `Future(auditEventRepo.append(event)).flatten.map(...).recover {...}` — the eager `Future(...)`
  defers the repository call onto the EC, so a synchronous throw becomes a failed Future. The test
  would genuinely catch its absence: ScalaTest's `be thrownBy` takes its operand **by name**, so
  with a bare `append(event).recover {...}` the `IllegalStateException` escapes `record` itself and
  is caught by `noException should be thrownBy`, failing the test. The stub repositories construct
  `AuditEventRepository(ctx = null)` safely (the constructor body touches only `TableQuery`).

**4. The FK-removal story — verified true, and the fix is right**

Demonstrated the mechanism directly rather than taking the narrative: added a temporary
`fake_tokens` table and an FK `audit_events.actor_token_id REFERENCES fake_tokens(id)
**ON DELETE SET NULL**`, then `TRUNCATE fake_tokens CASCADE`:

```
NOTICE:  truncate cascades to table "audit_events"
ERROR:  audit_events is append-only: TRUNCATE is not permitted (HEL-471)
```

then dropped the constraint and re-ran the identical statement: `TRUNCATE TABLE` (clean). So the
claim is exactly true — `TRUNCATE ... CASCADE` walks the FK graph regardless of the FK's own
`ON DELETE` action, and `ON DELETE SET NULL` does not protect against it. `grep -rln
"TRUNCATE.*CASCADE" backend/src/test` finds **22 spec files** doing exactly this cleanup, several
of them on `users`/`api_tokens` (e.g. `ApiTokenAuthSpec:185`, `ApiRoutesSpec:98`,
`MfaApiRoutesSpec:114`). The soft reference is a correct architectural call, not a
make-the-tests-pass dodge, and it matches the existing V74 `triggered_by_token_id` precedent the
migration cites. Latent-problem sweep: `\d+ audit_events` shows no "Foreign-key constraints" and
no "Referenced by" section — `audit_events` is neither a CASCADE child nor a CASCADE parent of
anything in the built schema, so no other table carries the same hazard.

**5. Test isolation**

Both new DB specs spin up their **own `EmbeddedPostgres` instance** in `beforeAll` and run Flyway
into it, so they never touch the shared dev Postgres at all — the "audit_events can never be
cleaned" concern is structurally moot for them. Within each instance, every assertion is
run-scoped: `rows should have size 1` is against a fresh random user, `rows shouldBe empty` is
against a fresh caller with no rows, `rows.toSet shouldBe Set(...)` is filtered by a random
`resource_type`+`resource_id` tag, and `findByActor` newest-first is filtered to `id1`/`id2`. No
absolute `count(*)`, no "table is empty", no "all rows" assertion anywhere. Nothing here goes
flaky or vacuous as rows accumulate.

**6. Gates re-run by me, ACs, scope, standards**

- `sbt -batch "testOnly com.helio.infrastructure.persistence.audit.* com.helio.services.audit.*
  com.helio.api.ApiTokenAuthSpec com.helio.api.ApiRoutesSpec"` →
  `Total number of tests run: 259 / Suites: completed 5, aborted 0 / Tests: succeeded 259,
  failed 0 ... All tests passed. [success]`. I deliberately included the two TRUNCATE-CASCADE
  harness specs most likely to be collateral damage from the trigger; both pass.
- `node scripts/check-scala-quality.mjs` → `clean (132 soft warning(s))`; the only audit-related
  entry is a 303-line soft budget warning on `AuditEventsAppendOnlySpec` (budget 250), in line
  with dozens of existing spec files.
- ACs traced: migration applies + columns/indexes present (§1 above); UPDATE and DELETE fail
  loudly on the app pool AND explicitly on the privileged/BYPASSRLS pool with a stated,
  justified posture in V91's header and design.md (§1); `AuditService.record` inserts correct
  actor/source/action/resource and never propagates failure (`AuditServiceSpec`, §3);
  repository append + `findByActor`/`findByResource` covered; compile+test green.
- Scope discipline: `git diff main...HEAD --name-only | grep -iE "routes|directive"` → empty. No
  route or directive file touched. `git diff main...HEAD -- backend/src | grep -i
  "RateLimitDirective\|com.helio.services.ratelimit\|import.*ratelimit"` → empty (exit 1),
  independently re-deriving evidence.md's 6.5 claim. `Main.scala` only constructs the repo +
  service; nothing calls `record`. HEL-495 is accommodated by model shape only.
- Inline FQN sweep across all six new/changed Scala files: `java.sql.Timestamp` in
  `AuditEventRepository` matches verbatim existing precedent (`PanelRepository:243`,
  `DataTypeRepository:211`, `PipelineRepository:407`) and is the accepted single-use qualifier
  form. One genuine violation found — see Change Requests.

### Verdict: REFUTE

The append-only mechanism itself is, in my independent judgement, **fully demonstrated and
correct** — 84/84 statement forms across 4 principals raise loudly, the recorded reds are
authentic and reproduce in the right failure mode, and the FK story checks out under direct
probing. This is the opposite of evidence-shaped non-evidence. The single blocking item below is
a small, mechanical standards violation in new test code, not a defect in the guarantee.

### Change Requests

1. `backend/src/test/scala/com/helio/services/audit/AuditServiceSpec.scala` lines **28, 63 and 79**
   inline `java.util.UUID.randomUUID().toString`. `CONTRIBUTING.md:29` names this exact expression
   as the canonical example of the banned pattern ("never inline a fully-qualified name when an
   `import` would do"), and `CONTRIBUTING.md:150` says to follow the rule strictly. The narrow
   single-use escape hatch at `CONTRIBUTING.md:31` does not apply — there are three uses and no
   coupling argument, and the change's own sibling specs
   (`AuditEventRepositorySpec`, `AuditEventsAppendOnlySpec`) already do the right thing with a
   top-level `import java.util.UUID`. Add `import java.util.UUID` to `AuditServiceSpec` and use
   `UUID.randomUUID().toString` at all three sites. No other change required.

### Non-blocking notes

- `AuditEventsAppendOnlySpec` has an implicit **intra-suite ordering dependency**: the 5.3 phase
  (a) tests assert `42501` and depend on V91's REVOKE still being in place, while the 5.3 phase
  (b) test issues `GRANT UPDATE, DELETE ON audit_events TO helio_privileged` — and the 5.4 second
  test relies on the `GRANT` issued by the 5.4 first test. This is correct under `AnyWordSpec`'s
  default declaration-order execution and the migration comment flags it, but it would break
  silently under `ParallelTestExecution` or a shuffled runner. Worth a one-line comment at the
  5.4 second test, or folding each GRANT into the test that depends on it.
- `Main.scala` constructs `auditService` but nothing consumes it yet (deliberate, per Non-Goals).
  It compiles warning-free today; if `-Wunused` is ever tightened before the instrumentation
  ticket lands, this is the line that will trip it.
- `AuditEventsAppendOnlySpec` is 303 lines against the repo's 250-line soft budget. Consistent
  with existing practice; noted only for completeness.
- Nothing exercises `AuditEventProtocol`'s `AuditEventResponse` formatter (no route consumes it).
  Expected for a foundation ticket; the query ticket will cover it.
