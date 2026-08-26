## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Cold re-review. Round 1's six change requests were treated as a checklist; every factual claim
below was checked against the worktree or against a live PostgreSQL probe, not against design.md.

### What I verified (with evidence)

**Round 1 checklist — all six are genuinely addressed, not merely acknowledged.**

1. **TRUNCATE.** design.md Decision 1 now carries a dedicated paragraph naming TRUNCATE, stating
   that a `FOR EACH ROW BEFORE UPDATE OR DELETE` trigger does not fire on it and that TRUNCATE
   belongs implicitly to the owner (the production app-pool role), and adopts a
   `BEFORE TRUNCATE ... FOR EACH STATEMENT` `ENABLE ALWAYS` trigger. tasks 1.5 lists both triggers
   and marks the TRUNCATE one REQUIRED; tasks 5.5b specifies the owner/superuser connection and
   says why `helio_app_test` would prove nothing; the persistence-spec requirement text now reads
   "every UPDATE, every DELETE, and every TRUNCATE" with a matching scenario. Genuinely fixed.
2. **Positive control on the privileged pool INSERT.** tasks 5.5 now names `withSystemContext`
   explicitly and states the V38 `ALTER DEFAULT PRIVILEGES` inheritance risk; the spec scenario is
   rewritten to "INSERT succeeds on the privileged pool the write path uses". I re-confirmed the
   premise: `RlsPrivilegedDmlSpec` beforeAll (backend/src/test/.../RlsPrivilegedDmlSpec.scala:88-90)
   deliberately does not re-grant to `helio_privileged`. Genuinely fixed.
3. **Read signatures pinned.** design.md Decision 2 pins
   `findByActor(callerUserId, actorUserId)` / `findByResource(callerUserId, resourceType, resourceId)`
   with an explicit "never derived from the filter arguments"; tasks 3.3 repeats it as a MUST; the
   spec adds the requirement text and the "The RLS context user is the caller, not the filter
   argument" scenario; test 6.2 adds the `findByActor(callerA, actorB)` -> EMPTY case. Genuinely
   fixed. (`UserId` exists at domain/model/model.scala:12; note `DbContext.withUserContext` takes
   a `String`, so the callsite passes `callerUserId.value` — trivia, not a defect.)
4. **Which red.** tasks 5.6 now names the two candidate reds, pins the post-GRANT case (5.4) to the
   silent-zero-row form, and specifies the drop mechanism (`DROP TRIGGER` on the superuser
   connection in a scratch `beforeAll`, not commenting out migration lines / checksum change).
   Genuinely fixed.
5. **Rate-limit isolation.** tasks 6.5 is mechanical ("no reviewer note substitute", captured grep
   output + `files-modified.md` check); the recording spec scenario now requires "captured command
   output, not ... a reviewer's assertion". `grep -rn "reviewer note"` over tasks.md and specs/
   returns only the prohibition itself. Genuinely fixed.
6. **REVOKE grantees.** tasks 1.6 names `PUBLIC` and `helio_privileged`, adds TRUNCATE, and notes
   it does not survive a V38-style re-grant. Genuinely fixed.

**Adopted non-blocking notes introduce no new problem.** `metadata JSONB NOT NULL DEFAULT '{}'::jsonb`
is coherent with the repo's `jsonbStringType` pattern (`DataSourceRepository.scala:204/225`,
`AlertEventRepository.scala:252`): that pattern maps a jsonb column to a non-optional `String`
column type, so a NOT NULL column is exactly the shape it wants and the domain model needs no
`Option`. The deliberate `gen_random_uuid()` default is defensible (V41 precedent; V90's header
does state the newer no-DEFAULT style, and design.md records the choice knowingly). The
`restrict_violation`/23001 and first-trigger-header notes are recorded accurately.

**Independent re-check of round 1's accepted claims.** Max migration is still `V90__invite_codes.sql`
(V91 correct). V38's blanket grant + `ALTER DEFAULT PRIVILEGES`, V35's FORCE-because-owner rationale,
V42's USING-as-WITH-CHECK comment, and V74's `ON DELETE SET NULL` precedent all check out as stated.

**New finding — live PostgreSQL probe.** I built the proposed schema exactly as designed (row-level
`BEFORE UPDATE OR DELETE` trigger, `ENABLE ALWAYS`, FORCE RLS, single unscoped `audit_events_owner`
policy) in a scratch database and drove it as a non-superuser app role. Transcript:

```
SET app.current_user_id = '2222...';   -- app user owns no audit rows
UPDATE audit_events SET action='x';    -> UPDATE 0        (no error)
DELETE FROM audit_events;              -> DELETE 0        (no error)
SET app.current_user_id = '1111...';   -- app user owns a row
UPDATE audit_events SET action='y';    -> ERROR: append-only (23001)
```

The positive control in the same transcript (the loud 23001 when the row is visible) rules out a
misconfigured probe. See CR 1.

### Verdict: REFUTE

Round 1's six items are all genuinely closed and the design is materially stronger. But the probe
above shows the mechanism as currently designed does not deliver the ticket's headline acceptance
criterion on the app pool for the rows that matter most, and the design's own test plan would not
catch it. One substantive revision, one cheap clarity revision.

### Change Requests

1. **RLS filters rows out before the trigger can fire, so the app pool gets the exact silent
   zero-row outcome the ticket forbids.** Decision 3 creates one policy,
   `CREATE POLICY audit_events_owner ON audit_events USING (...)` with no `FOR` clause — i.e.
   `FOR ALL`. Under `FORCE ROW LEVEL SECURITY` the USING qual is applied to UPDATE and DELETE as
   part of the scan, so rows the app user does not own are never selected for modification and the
   `BEFORE ... FOR EACH ROW` trigger never runs. Postgres reports `UPDATE 0` / `DELETE 0` and
   success (probe transcript above). This is falsified for exactly the two row classes the design
   itself calls out in Decision 3: NULL-actor system rows (every `source='system'` row, including
   the HEL-495 trip events of Decision 4) and any other user's rows. It contradicts
   ticket AC ("must FAIL LOUDLY ... not silently affect zero rows ... must hold for the app pool"),
   the persistence spec's "WHEN **any connection** issues an UPDATE ... THEN the statement raises a
   database error", and Decision 1's own ridicule of the silent-zero-row mode.
   It is also self-concealing: tasks 5.2 as written ("insert an audit row, UPDATE on the app pool")
   is satisfied by inserting a row owned by the app-pool context user, which passes while the
   general claim is false — evidence-shaped non-evidence.
   Verified fix (probed in the same scratch DB, all three assertions confirmed): scope the owner
   policy to reads and let mutations through to the trigger —
   ```sql
   CREATE POLICY audit_events_owner  ON audit_events FOR SELECT USING (actor_user_id = current_setting('app.current_user_id')::uuid);
   CREATE POLICY audit_events_update ON audit_events FOR UPDATE USING (true);
   CREATE POLICY audit_events_delete ON audit_events FOR DELETE USING (true);
   ```
   With this, app-pool SELECT scoping is unchanged (`count = 0` for a non-owner) while UPDATE and
   DELETE against non-owned and NULL-actor rows both raise 23001. Note the side effect to record:
   narrowing the owner policy to `FOR SELECT` removes the V42-style USING-as-WITH-CHECK gating of
   app-pool INSERT — harmless here because Decision 2 puts every insert on the privileged pool and
   the repository exposes no app-pool write, but it must be stated rather than discovered.
   Required revisions:
   - design.md Decision 3: state the RLS-filters-before-trigger interaction, adopt the split
     policies, and record the lost-WITH-CHECK consequence. Decision 1 should cross-reference it,
     since RLS is currently described as having "no mutation-blocking role" when in fact it
     silently *pre-empts* the mutation-blocking mechanism.
   - tasks.md 1.7: create the three policies as above rather than the single `FOR ALL` policy.
   - tasks.md 5.2: require the app-pool UPDATE/DELETE assertions to cover **a row the app-pool
     context user does not own AND a NULL-actor row**, not only a self-owned row. This is the case
     that must be seen red against the single-`FOR ALL`-policy variant (red = `UPDATE 0`/`DELETE 0`),
     and it belongs in the 5.6 transcript alongside the trigger-dropped red.
   - `specs/audit-event-persistence/spec.md`: add a scenario making the row class explicit, e.g.
     "UPDATE/DELETE of a row invisible to the app-pool caller still fails loudly" (given a NULL-actor
     row and an app-pool connection for an unrelated user, the statement raises a database error and
     does not report zero rows).

2. **The `AuditEvent` model's identity field is unspecified, and the query ticket inherits the
   ambiguity.** tasks 2.1 adds `AuditEventId`, `append` returns `Future[AuditEventId]`, and
   `findByActor`/`findByResource` return `Seq[AuditEvent]` — but tasks 2.2's field list ("actor user
   id, actor token id, source, action, resource type, resource id, metadata, created at") has no
   `id`, so a competent implementer could reasonably build an `AuditEvent` with no identity, making
   read results unable to expose the id the later query/UI ticket will need for paging or linking.
   Say explicitly in tasks 2.2 (and in the persistence spec's `AuditEventRepository` requirement)
   whether `AuditEvent` carries the `AuditEventId` and, given the `gen_random_uuid()` DB default,
   how construction-before-insert is expressed (Slick `returning` on an id-less insert projection,
   or an `Option[AuditEventId]`/separate pre-persist type). Same for `created_at`, which has the
   same DB-default-versus-model tension.

### Non-blocking notes

- `DbContext.withUserContext(userId: String)` — the pinned `callerUserId: UserId` signatures will
  pass `.value` at the callsite, matching `PipelineRepository.scala:29`. No action needed.
- Round 1's suggestion to rename the self-scoping read method was not adopted. Still fine: Decision 3
  documents the semantics, and CR 1's split policies do not change them.
- `ApiTokenRepository.scala:153` uses `column[UUID]("id", O.PrimaryKey)` — a good precedent for the
  Slick mapping of the new UUID columns if the executor wants one.
