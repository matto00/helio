# Tasks — HEL-471 Audit event model + append-only event store

## 1. Migration

- [x] 1.1 Re-verify the max Flyway version against a freshly fetched `origin/main`
      (`ls backend/src/main/resources/db/migration | sort -V | tail -3`) and use the next number.
      design.md Decision 5 expects `V91`; adjust if main has moved. Do not trust the ticket's "V59".
- [x] 1.2 Create `V<N>__audit_events.sql` with the `audit_events` table: `id` UUID PK default
      `gen_random_uuid()`, `actor_user_id` UUID NULL, `actor_token_id` UUID NULL, `source` TEXT NOT NULL
      with a CHECK constraining it to `ui`/`pat`/`mcp`/`system`, `action` TEXT NOT NULL, `resource_type`
      TEXT NOT NULL, `resource_id` TEXT NULL, `metadata` JSONB NOT NULL DEFAULT `'{}'::jsonb`,
      `created_at` TIMESTAMPTZ NOT NULL DEFAULT `now()`.
- [x] 1.3 Add indexes on `(actor_user_id, created_at)` and `(resource_type, resource_id)`.
- [x] 1.4 Decide and implement the `actor_token_id` reference per the spec scenario "Deleting the
      referenced token does not erase history" — a soft reference, or an FK with `ON DELETE SET NULL`
      following V74's precedent. Never `ON DELETE CASCADE`.
- [x] 1.5 Add the append-only trigger function raising `ERRCODE = 'restrict_violation'` (SQLSTATE 23001)
      with a clear message, and TWO triggers, both `ENABLE ALWAYS` (design.md Decision 1):
      - `BEFORE UPDATE OR DELETE ... FOR EACH STATEMENT` — this is the LOAD-BEARING one. A statement-level
        BEFORE trigger fires before the scan, so it is indifferent to RLS row visibility, to whether any
        row matches, to which pool is connected, and to table ownership. A row-level trigger only fires
        for rows the scan selects, and RLS controls exactly that.
      - `BEFORE UPDATE OR DELETE ... FOR EACH ROW` — defence-in-depth only, NOT load-bearing.
      - `BEFORE TRUNCATE ... FOR EACH STATEMENT` — REQUIRED. A row-level trigger does not fire on
        TRUNCATE, and TRUNCATE belongs implicitly to the table owner, which is the role the app pool
        connects as in production. Omitting this leaves the whole audit history erasable by one statement.
      - `ALTER TABLE audit_events ENABLE ALWAYS TRIGGER ...` for each.
- [x] 1.6 Add `REVOKE UPDATE, DELETE, TRUNCATE ON audit_events FROM PUBLIC` (and from `helio_privileged`)
      as documented defence-in-depth. A grantee is mandatory — a bare `REVOKE ... ON audit_events` is not
      valid SQL. Comment that this is NOT the load-bearing mechanism, and that revoking from
      `helio_privileged` does not survive a future re-run of a V38-style blanket grant. Note also that
      several test harness bases DO grant TRUNCATE to `helio_privileged`, so the migration comment must
      not lean on the absence of that grant as if it were a guarantee — the TRUNCATE trigger is what
      guarantees it.
- [x] 1.7 Enable `ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY` and create THREE policies (Decision 3).
      Do NOT use the single `FOR ALL` owner policy of V35/V42 — under FORCE RLS its USING qual is applied
      to UPDATE/DELETE during the scan. NOTE: the split below is defence-in-depth/clarity only. It does
      NOT by itself make mutations reach a trigger — Postgres applies SELECT policies alongside the
      UPDATE/DELETE policy as soon as a statement references any column, so targeted `WHERE`-bearing
      statements are still scan-filtered. The guarantee is carried by task 1.5's statement-level trigger.
      - `audit_events_owner  ... FOR SELECT USING (actor_user_id = current_setting('app.current_user_id')::uuid)`
      - `audit_events_update ... FOR UPDATE USING (true)`
      - `audit_events_delete ... FOR DELETE USING (true)`
      Comment that with the owner policy narrowed to FOR SELECT, NO policy applies to INSERT, so under
      FORCE RLS every app-pool INSERT is DENIED OUTRIGHT ("new row violates row-level security policy") —
      for the app role and the table owner alike. This is fail-safe and consistent with Decision 2 (all
      inserts run on the privileged pool), but it is a hard denial, not merely an un-gated insert.
- [x] 1.8 Header comment explaining the two-pool posture, why the trigger rather than revoke/RLS carries
      the guarantee (including why TRUNCATE needs its own statement-level trigger), and the Decision 3 read
      consequence — matching the documentation density of V35/V42. Note explicitly that this is the repo's
      FIRST database trigger, since future readers have no in-repo precedent to pattern-match against.
      Also note that `MERGE ... WHEN MATCHED THEN UPDATE/DELETE` is intercepted by the same
      statement-level trigger (probed at the design gate), so no separate handling is needed.

## 2. Domain model

- [x] 2.1 Add `AuditEventId` value class following the `DashboardId`/`PanelId` pattern.
- [x] 2.2 Add the immutable `AuditEvent` case class. State explicitly how identity and `created_at` are
      modelled given both have DB defaults (`gen_random_uuid()` / `now()`) while `append` returns
      `Future[AuditEventId]` and reads return `Seq[AuditEvent]` that the later query/UI ticket needs ids
      from for paging and linking. Pick ONE and document it: either `AuditEvent` carries
      `id: AuditEventId` and `createdAt: Instant` with a separate id-less pre-persist projection using
      Slick `returning`, or they are `Option`-typed and populated on read. Do not leave `AuditEvent`
      without any identity — that would make read results unusable for the query ticket.
      Fields: identity per above, actor user id, actor token id, source, action,
      resource type, resource id, metadata, created at and an `AuditSource` representation constrained
      to `ui`/`pat`/`mcp`/`system` that round-trips to the DB text values.
- [x] 2.3 Minimal `JsonProtocols` formatters for `AuditEvent` (Decision: keep minimal; the query ticket
      extends). No inline fully-qualified names anywhere.

## 3. Repository

- [x] 3.1 Add the Slick table mapping for `audit_events`, using the existing `jsonbStringType` pattern
      for `metadata` (same approach as `AlertRuleRepository.condition`/`DataSourceRepository.config`).
- [x] 3.2 Implement `append(event): Future[AuditEventId]` via `DbContext.withSystemContext`, with the
      inline bypass justification comment `DbContext` requires (Decision 2).
- [x] 3.3 Implement the reads via `DbContext.withUserContext` with these EXACT signatures (Decision 2):
      `findByActor(callerUserId, actorUserId)` (newest-first) and
      `findByResource(callerUserId, resourceType, resourceId)`. The RLS context user passed to
      `withUserContext` MUST be `callerUserId` and MUST NEVER be derived from a filter argument — passing
      the actor argument as the context user makes the owner policy vacuous and test 6.2 unfalsifiable.
- [x] 3.4 Expose no update or delete operation on the repository surface.

## 4. Service

- [x] 4.1 Add `AuditService.record(actor, source, action, resourceType, resourceId, metadata): Future[Unit]`.
- [x] 4.2 Isolate failures: log and swallow. Must handle BOTH a failed `Future` AND a synchronous throw
      from the repository — a bare `.recover` on the returned future does not cover the throw.
- [x] 4.3 Wire `AuditService` construction into the server construction root. Do NOT add a call site to
      any route, directive, or existing service (Decision 4 / proposal Non-goals).

## 5. Tests — append-only, demonstrated red before green

- [x] 5.1 New spec following `RlsPrivilegedDmlSpec`/`RlsOwnerTablesSpec` harness conventions
      (`helio_app_test` non-BYPASSRLS role + privileged role, both pools).
- [x] 5.1b Test isolation (design.md Decision 6) — REQUIRED, because `audit_events` can never be cleaned
      between runs (DELETE and TRUNCATE both raise by construction) and all worktrees share one dev
      Postgres. Scope EVERY assertion by per-run-unique `actor_user_id`/`resource_type`/`resource_id`
      values. FORBIDDEN anywhere in these suites: absolute `count(*)`, "returns all rows", "table is
      empty". Default to NO teardown. If teardown is genuinely needed, the only mechanism is
      `ALTER TABLE audit_events DISABLE TRIGGER ALL` + `DELETE` + re-`ENABLE ALWAYS` on the
      owner/superuser connection, strictly in `afterAll`, never `beforeEach`, and never on the same
      connection or in the same transaction as an immutability assertion.
- [x] 5.2 App pool: UPDATE raises SQLSTATE 23001; DELETE raises SQLSTATE 23001; row unchanged/still present.
      All statements MUST be TARGETED (`WHERE id = ...`). A bare column-free `UPDATE audit_events SET ...`
      is the one form that escapes RLS scan-filtering, so testing only that form proves nothing about the
      statements real code issues.
      MUST cover THREE row classes, not just the easy one:
      (a) a row the app-pool context user owns,
      (b) a row owned by a DIFFERENT user,
      (c) a NULL-actor (`source='system'`) row.
      (b) and (c) are the cases that fail silently (`UPDATE 0`) whenever the guarantee depends on row
      visibility. A test covering only (a), or using only untargeted statements, passes while the general
      claim is false — the exact evidence-shaped-non-evidence trap this ticket is guarding against.
- [x] 5.3 Privileged pool, TWO PHASES (design.md Testing-strategy item 2). Task 1.6 revokes UPDATE/DELETE
      from `helio_privileged` and `RlsPrivilegedDmlSpec` does not re-grant, so a single "raises 23001"
      assertion CANNOT PASS — the statement fails at the privilege check before reaching the trigger:
      (a) with the revoke in place, assert UPDATE/DELETE fail with SQLSTATE **42501** (permission denied),
          recorded as the defence-in-depth revoke working;
      (b) then `GRANT UPDATE, DELETE ON audit_events TO helio_privileged` and assert the same statements
          raise SQLSTATE **23001**, recorded as proof the trigger binds a BYPASSRLS role holding the privilege.
      Loosening this to "any database error" is NOT an acceptable resolution — it collapses the
      permission-denied vs trigger distinction the entire test plan is built on.
- [x] 5.4 Post-`GRANT` case: issue `GRANT ... UPDATE, DELETE ON ALL TABLES ...` to the app role, then
      assert UPDATE/DELETE still raise. This is the case that proves the trigger, not the revoke, is load-bearing.
- [x] 5.5 Positive control, pool-specific: assert INSERT succeeds **on the privileged pool**
      (`withSystemContext`) — the pool `append` actually runs on. `audit_events` inherits its
      privileged-role INSERT grant solely from V38's `ALTER DEFAULT PRIVILEGES`; if that inheritance does
      not hold, the production write path is dead on arrival while every failure-asserting test in
      5.2-5.4 still passes. Also assert SELECT succeeds on the app pool, and that the `source` CHECK
      rejects an out-of-enum value.
- [x] 5.5b TRUNCATE case: assert `TRUNCATE audit_events` raises SQLSTATE 23001. It MUST be issued on the
      owner/superuser connection — `helio_app_test` is not the owner and cannot TRUNCATE at all, so
      running it as that role proves nothing.
- [x] 5.6 **Capture the red transcript, and record WHICH red.** Drop the triggers via `DROP TRIGGER` on the
      superuser connection in a scratch run's `beforeAll` (NOT by commenting out migration lines — that
      changes the Flyway checksum on the shared dev Postgres). Run 5.2-5.5b, capture the failing output to
      a committed evidence file, restore, re-run green, capture that too.
      The transcript MUST record the observed failure mode, not merely that a failure occurred. With the
      trigger dropped there are two possible reds: a silent `UPDATE 0`/`DELETE 0` (correct — the exact
      failure mode the brief names) and a `permission denied` from the defence-in-depth REVOKE (which would
      demonstrate the revoke, not the trigger). **For case 5.4 (post-GRANT) the red MUST be the
      silent-zero-row form** — that single observation is what proves the trigger, not the revoke, is
      load-bearing. If it comes back `permission denied`, the test is not yet proving what it claims.
- [x] 5.6b Second captured red, targeting the LOAD-BEARING mechanism: drop ONLY the statement-level
      trigger (leave the row-level trigger and all three policies in place), then issue TARGETED
      UPDATE/DELETE against a NULL-actor row and an other-user row and capture the silent
      `UPDATE 0`/`DELETE 0`. Restore and re-run green.
      DO NOT instead use "revert the policies to a single FOR ALL policy" as the red — once the
      statement-level trigger exists it raises before the policy matters, so that check can never fail.
      A check that cannot fail is exactly what this ticket forbids.

## 6. Tests — repository and service

- [x] 6.1 Repository: `append` persists all fields; `findByActor` returns newest-first and only that
      actor's rows; `findByResource` filters by type+id. All scoped to per-run-unique actor/resource
      values per 5.1b — assert on the run's OWN rows, never on the table's total contents.
- [x] 6.2 RLS read scoping: two actors' rows, app pool sees only its own; NULL-actor row invisible on the
      app pool; privileged pool sees all three OF THIS RUN'S rows (filter by the run-unique values — do
      NOT assert the privileged pool returns three rows in total, which depends on run history). Include a case calling `findByActor(callerA, actorB)` and
      asserting it returns EMPTY — this is what proves the RLS context user is the caller and not the
      filter argument (if it returned B's rows, the policy is vacuous).
- [x] 6.3 `AuditService` failure isolation: stub repo returning a failed `Future` -> `record` succeeds;
      stub repo throwing synchronously -> `record` succeeds. Observe both red against an implementation
      without the guard, and capture it.
- [x] 6.4 Model-shape check for Decision 4: constructing a `system`-sourced, null-actor,
      metadata-carrying trip-shaped event is valid.
- [x] 6.5 Scope-isolation check, MECHANICAL and recorded (no reviewer note substitute): run
      `git diff <base>...HEAD | grep -i -e ratelimit -e rate_limit` and capture the (expected empty)
      output into the evidence file, plus confirm `files-modified.md` lists no route or directive file.

## 7. Gates

- [x] 7.1 `sbt compile` and `sbt test` green in the worktree.
- [x] 7.2 Read CONTRIBUTING.md at point of use; no inline fully-qualified names; Scala code-quality check passes.
- [x] 7.3 No frontend change in this ticket (DESIGN.md not applicable).
- [x] 7.4 Commit messages prefixed `HEL-471 `; no `git commit -n`.
- [x] 7.5 Write `files-modified.md` in the change directory listing every file touched.
