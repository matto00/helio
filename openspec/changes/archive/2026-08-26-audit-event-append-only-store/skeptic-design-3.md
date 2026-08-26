# Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold review. Every claim below is grounded in the worktree artifacts or in a live PostgreSQL 18
probe I built and drove myself in a throwaway database (`skeptic471`, since dropped). I did not
rely on round 2's transcript; I rebuilt the schema from design.md Decision 1 + Decision 3 as
currently written and re-derived the behaviour.

## What I verified (with evidence)

### Round 2 CR 2 — `AuditEvent` identity / `created_at` — GENUINELY CLOSED

tasks.md 2.2 now names the tension explicitly ("both have DB defaults (`gen_random_uuid()` /
`now()`) while `append` returns `Future[AuditEventId]`"), forces a documented choice between the
two viable shapes (id-carrying + Slick `returning` on an id-less pre-persist projection, versus
`Option`-typed and populated on read), and forbids the failure mode ("Do not leave `AuditEvent`
without any identity"). `specs/audit-event-persistence/spec.md` carries the matching normative
sentence in the `AuditEventRepository access` requirement: "`AuditEvent` as returned by the read
operations SHALL carry its `AuditEventId` and its `created_at`, so the later audit-query capability
can page and link by id without a model change." The ambiguity is gone and the query ticket's
inherited contract is pinned. Closed.

### Round 2 CR 1 — the three-policy split — CLOSED IN THE ARTIFACTS, BUT ONLY PARTIALLY CORRECT IN POSTGRES

The artifacts do say what round 2 asked: design.md Decision 3 adopts the split, records the
lost-`USING`-as-`WITH CHECK` consequence and cross-references Decision 1; tasks 1.7 creates three
policies and forbids `FOR ALL`; tasks 5.2 requires all three row classes (owned / other-user /
NULL-actor); tasks 5.6b captures the silent-zero-row red against the `FOR ALL` variant; the spec
adds the "UPDATE or DELETE of a row invisible to the app-pool caller still fails loudly" scenario
and strengthens the RLS requirement. Textually complete.

**Probe.** I built exactly the designed schema — row-level `BEFORE UPDATE OR DELETE` trigger raising
`restrict_violation`, `ENABLE ALWAYS`, statement-level `BEFORE TRUNCATE` trigger, `ENABLE`/`FORCE ROW
LEVEL SECURITY`, and the three policies verbatim from Decision 3 — seeded three rows via a BYPASSRLS
role (owned by user 1, owned by user 2, NULL-actor `system`), and drove it as a non-owner app role
and as the table owner with `app.current_user_id` set to an unrelated user 3:

```
SET app.current_user_id='3333…';
SELECT count(*) FROM audit_events;                          ->  0            (read scoping intact)
UPDATE audit_events SET action='x';                         ->  ERROR 23001  (loud — as designed)
UPDATE audit_events SET action='x' WHERE source='ui';       ->  UPDATE 0     (SILENT)
DELETE FROM audit_events;                                   ->  ERROR 23001  (loud — as designed)
DELETE FROM audit_events WHERE source='system';             ->  DELETE 0     (SILENT)
DELETE FROM audit_events WHERE id=(SELECT id … LIMIT 1);     ->  DELETE 0     (SILENT)
```

Reproduced on a second run, and reproduced as `sk_owner` — the role class the production app pool
actually connects as (`UPDATE 0` / `DELETE 0` there too). This is a stable, reproduced result, not a
flaky reading.

**Mechanism.** The split fixes only the column-free statement. Postgres applies `SELECT` policies
*in addition to* the `UPDATE`/`DELETE` policy whenever the statement references table columns (a
`WHERE`, or a `RETURNING`). `USING (true)` on the UPDATE/DELETE policies therefore does not make the
rows scannable; `audit_events_owner`'s `FOR SELECT` qual still filters out the other-user and
NULL-actor rows, the row-level trigger still never fires, and Postgres still reports the exact silent
zero-row outcome the ticket AC forbids. Round 2's probe used `UPDATE audit_events SET action='x'`
with no `WHERE` — the one form that happens to escape the SELECT-policy coupling — which is why the
fix looked complete. Every statement a test or an attacker would realistically write has a `WHERE`.

Consequence for the plan as written: tasks 5.2(b)/(c) and the new spec scenario are satisfiable by a
no-`WHERE` statement and would go green while the general claim ("any connection issuing an UPDATE
raises a database error") remains false for targeted statements. That is the same
evidence-shaped-non-evidence trap the brief names, one level deeper.

**Verified fix (probed, same scratch DB).** Add a **statement-level** `BEFORE UPDATE OR DELETE …
FOR EACH STATEMENT` trigger calling the same raising function, `ENABLE ALWAYS`. A statement-level
BEFORE trigger fires before any scan, so it is completely independent of RLS row visibility:

```
app pool,  UPDATE … WHERE source='ui';        -> ERROR 23001
app pool,  DELETE … WHERE id=gen_random_uuid(); -> ERROR 23001   (zero matching rows: still loud)
priv pool, UPDATE … WHERE source='ui';        -> ERROR 23001
priv pool, INSERT …                            -> INSERT 0 1     (write path intact)
app pool as user 1, SELECT action …            -> 1 row: owned.by.one   (read scoping intact)
owner,     TRUNCATE audit_events;              -> ERROR 23001
```

This closes the whole class rather than one instance: it removes the dependence of the append-only
guarantee on RLS row visibility that generated both the round-2 and the round-3 finding.

### Second, independent probe finding — Decision 3's recorded consequence is factually wrong

design.md Decision 3 states that narrowing the owner policy to `FOR SELECT` "removes the V42-style
`USING`-as-`WITH CHECK` gating of app-pool INSERT" (tasks 1.7 repeats it). That understates what
actually happens. With the three policies as written there is **no policy applying to INSERT at
all**, and under `FORCE ROW LEVEL SECURITY` a command with no permissive policy is denied outright:

```
app role, SET app.current_user_id='1111…';
INSERT … VALUES ('1111…','ui','self.insert');  -> ERROR: new row violates row-level security policy
owner role, same INSERT                        -> ERROR: new row violates row-level security policy
```

App-pool INSERT is not "ungated", it is impossible. The direction of the error is fail-safe and
consistent with Decision 2 (all writes on the privileged pool), so this is not a functional defect —
but it is a wrong statement about the mechanism in the binding design document, in the exact
sub-area two prior rounds have already had to correct, and the later query/instrumentation tickets
will inherit it.

### What else I checked and found clean

- Ticket ACs traced: append-only-loud-on-both-pools (CR 1 above), `AuditService` failure isolation
  (tasks 4.2 / 6.3 cover both the failed-`Future` and synchronous-throw arms, with a required red),
  migration/columns/indexes (tasks 1.2–1.3 match the ticket's column list and the spec), repository
  coverage (6.1), `sbt compile test` (7.1).
- Migration numbering: `V90__invite_codes.sql` is still the max; `V91` correct, and tasks 1.1 makes
  the executor re-verify anyway.
- `ENABLE ALWAYS` rationale (`session_replication_role='replica'`) is correct.
- `ERRCODE='restrict_violation'` / SQLSTATE 23001 raises and is assertable — observed in every probe
  transcript above.
- TRUNCATE: the statement-level `BEFORE TRUNCATE` trigger fires for the **table owner** — probed,
  `ERROR 23001`. tasks 5.5b correctly insists the test run on the owner/superuser connection.
- Privileged-pool INSERT positive control (tasks 5.5) is a real, necessary control and its premise
  holds.
- Decision 4 scope isolation is mechanical (tasks 6.5 captured grep), not a reviewer note.
- Read signatures (`callerUserId` never derived from a filter argument) remain pinned in design.md
  Decision 2, tasks 3.3, and the spec, with the falsifying `findByActor(callerA, actorB) -> EMPTY`
  case in 6.2.
- No `TODO`/`TBD`/deferred decision remains in design.md or tasks.md; every AC maps to at least one
  task; no task exceeds the ticket's scope (no route/directive instrumentation anywhere).

## Convergence judgement (requested explicitly)

**Not yet converged as of this round's artifacts — but the specific fix above is the one that should
converge it, and I can say why rather than hoping.**

The honest read of the clustering pattern: rounds 1, 2 and 3 each found a defect in the same
sub-area, and they are not three unrelated defects. Rounds 2 and 3 share one root cause — *the
append-only guarantee was made to depend on a row being visible to the scan*. Round 2 found one
symptom (the `FOR ALL` policy filtering the scan); round 3 found the second symptom of the identical
cause (the SELECT policy still filtering the scan whenever the statement references a column). The
round-2 fix treated the symptom, so a third symptom of the same cause was predictable. Round 1's
TRUNCATE finding is a sibling: a mutation path the row-level trigger did not cover.

That is why I am not simply saying "expect more findings". The statement-level trigger is a
*cause-level* fix: it makes the guarantee unconditional on RLS, on row visibility, on which rows
match, and on which role is connected. After it lands, the trigger fires before the planner does
anything, and I could not construct a DML statement that evades it — I tried column-free UPDATE and
DELETE, `WHERE` on an indexed column, `WHERE` on a non-matching id, both pools, both the non-owner
app role and the table owner, and TRUNCATE. All raise. The residual risk then genuinely is ordinary
implementation risk (does the executor write the trigger, does the test assert 23001, is the red
captured), which the executor and the final gate will catch.

Two caveats that keep this a judgement rather than a guarantee: (a) the design's own accuracy about
Postgres semantics has now been wrong twice in this sub-area, which is a signal about the authoring
process, not just the artifact — so I would want round 4 to show the fix *probed*, not merely
asserted, before treating it as settled; and (b) once the statement-level trigger exists, the
`FOR UPDATE`/`FOR DELETE` permissive policies are no longer load-bearing for the guarantee, and
tasks 5.6b's red (reverting to `FOR ALL`) will no longer go red — the plan must be re-derived
around the new mechanism rather than layered on top of the old one, or it will contain a check that
cannot fail. That is CR 3.

## Verdict: REFUTE

## Change Requests

1. **Make the append-only guarantee independent of RLS row visibility: add a statement-level
   `BEFORE UPDATE OR DELETE` trigger.** The three-policy split does not deliver the ticket AC for any
   statement containing a `WHERE` or `RETURNING` — Postgres applies `SELECT` policies alongside the
   UPDATE/DELETE policy when the statement references table columns, so other-user and NULL-actor
   rows are still filtered out of the scan and the result is still `UPDATE 0` / `DELETE 0` with no
   error (probe transcript above, reproduced, and reproduced as the table owner).
   - design.md Decision 1: adopt `CREATE TRIGGER … BEFORE UPDATE OR DELETE ON audit_events FOR EACH
     STATEMENT EXECUTE FUNCTION …` + `ALTER TABLE … ENABLE ALWAYS TRIGGER …` as the **load-bearing**
     mechanism, and state the reason in mechanism terms: a statement-level BEFORE trigger fires
     before the scan, so it is unaffected by which rows RLS makes visible and by whether any row
     matches at all. Keep or drop the row-level trigger as defence-in-depth, but say which is
     load-bearing.
   - design.md Decision 3: correct the claim that the `FOR SELECT`/`FOR UPDATE`/`FOR DELETE` split is
     what "lets every mutation reach the trigger" — it does so only for column-free statements.
   - tasks 1.5: add the statement-level UPDATE/DELETE trigger alongside the existing TRUNCATE one.
   - `specs/audit-event-persistence/spec.md`: the "UPDATE or DELETE of a row invisible to the
     app-pool caller still fails loudly" scenario must require the statement to be **targeted**
     (e.g. `WHERE id = <that row's id>`), not a bare table-wide UPDATE — otherwise the scenario is
     satisfiable by the one statement form that already worked.

2. **Correct Decision 3's recorded consequence: app-pool INSERT is denied outright, not merely
   un-gated.** With no policy applying to INSERT under `FORCE ROW LEVEL SECURITY`, every app-pool
   INSERT fails with "new row violates row-level security policy" — probed for both the non-owner app
   role and the table owner, including a row the caller owns. Restate this in design.md Decision 3 and
   tasks 1.7 as "app-pool INSERT becomes impossible (fail-safe, and consistent with Decision 2's
   privileged-pool-only write path)" rather than "the `USING`-as-`WITH CHECK` gating is removed", so
   the query/instrumentation tickets inherit the true contract. If any future app-pool insert is
   intended, an explicit `FOR INSERT WITH CHECK` policy is required — say so.

3. **Re-derive the red-transcript plan around the new mechanism so no check is unfalsifiable.**
   Once CR 1 lands, tasks 5.6b's red (revert to the single `FOR ALL` policy and observe
   `UPDATE 0`/`DELETE 0`) will no longer go red, because the statement-level trigger raises before
   the policy matters — a check that cannot fail, which this ticket's brief forbids. Replace it with
   a red that targets the load-bearing mechanism: drop **the statement-level trigger only** (leaving
   the row-level trigger and the three policies in place) and observe the silent `UPDATE 0`/`DELETE 0`
   on a **targeted** UPDATE/DELETE against a NULL-actor row and an other-user row. Update tasks 5.2
   to require targeted (`WHERE`-bearing) statements for all three row classes, and update 5.6 so the
   drop mechanism names which trigger is dropped for which red.

## Non-blocking notes

- With CR 1 in place the `audit_events_update` / `audit_events_delete` permissive policies are no
  longer needed for the guarantee. Keeping them is harmless and arguably clearer (mutations reach the
  row-level trigger too); dropping them is also fine. Either way, design.md should no longer describe
  them as what makes the guarantee hold.
- My probe environment was PostgreSQL 18 (the local dev server). The SELECT-policy-applies-to-
  column-referencing-UPDATE behaviour is long-standing documented Postgres semantics, not
  version-specific, but the executor's capture will run against the same shared dev instance anyway.
- The scratch database `skeptic471` and its three roles were dropped after the probe; no shared dev
  state was touched.
