## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Ticket: HEL-471. Change: `audit-event-append-only-store`. Branch head `666da5d7` (worktree clean apart
from the untracked change dir).

Round 3 set the condition that round 4 show the fix **probed, not asserted**. This report is built on a
live Postgres probe of the designed schema. Every claim below is derived from a transcript I produced
myself; no conclusion is taken from design.md's prose.

---

### 1. The probe: how it was built

Scratch database `hel471_probe4` on the local PostgreSQL 18.4 instance (not the shared dev DB's schema,
not Flyway — a standalone DB dropped at the end). The schema was transcribed **literally** from
tasks 1.2–1.7 and design.md Decisions 1 and 3: the table + both indexes + the `source` CHECK, the
`restrict_violation` (23001) raising function, all **three** triggers (`BEFORE UPDATE OR DELETE ... FOR
EACH STATEMENT`, `... FOR EACH ROW`, `BEFORE TRUNCATE ... FOR EACH STATEMENT`), each promoted with
`ALTER TABLE ... ENABLE ALWAYS TRIGGER`, the `REVOKE UPDATE, DELETE, TRUNCATE`, `ENABLE`/`FORCE ROW
LEVEL SECURITY`, and the three policies (`audit_events_owner FOR SELECT`, `audit_events_update FOR
UPDATE USING (true)`, `audit_events_delete FOR DELETE USING (true)`), plus V38-equivalent grants.

`\d audit_events` confirmed the built object matches the design (3 policies, "forced row security
enabled", 3 triggers listed under **"Triggers firing always"**).

Four principals were exercised, matching the real topology:
- `sk_owner` — **owns the table**; this is the production app pool (`DB_USER` owns the tables).
- `sk_app` — non-owner with full DML; this is the test harness's `helio_app_test`.
- `sk_priv` — `BYPASSRLS`; this is `helio_privileged`.
- `matt` — superuser.

Seed rows covering the three row classes design.md calls out: actor A, actor B (other user), and a
NULL-actor `source='system'` row.

### 2. Attack transcript — mutation paths

App pool (`sk_app`, `app.current_user_id` = A). All eleven raised `ERROR: 23001: audit_events is
append-only`:

| statement form | result |
|---|---|
| targeted UPDATE, row the caller owns | 23001 |
| targeted UPDATE, **other user's** row | 23001 |
| targeted UPDATE, **NULL-actor** row | 23001 |
| untargeted column-free `UPDATE audit_events SET action='x'` | 23001 |
| targeted DELETE, other user's row | 23001 |
| untargeted `DELETE FROM audit_events` | 23001 |
| `UPDATE ... RETURNING id` | 23001 |
| `DELETE ... RETURNING id` | 23001 |
| UPDATE matching **zero** rows (`WHERE id='9999...'`) | 23001 |
| DELETE matching zero rows | 23001 |
| `UPDATE ... WHERE false` | 23001 |

Exotic mutation forms (same role) — all 23001:

| form | result |
|---|---|
| data-modifying CTE `WITH u AS (UPDATE ... RETURNING id) SELECT ...` | 23001 |
| data-modifying CTE `WITH d AS (DELETE ... RETURNING id) SELECT ...` | 23001 |
| UPDATE through an auto-updatable **VIEW** over the table | 23001 |
| DELETE through the same view | 23001 |
| `UPDATE audit_events a SET ... FROM targets t WHERE a.id=t.id` (join) | 23001 |
| `DELETE FROM audit_events a USING targets t WHERE a.id=t.id` (join) | 23001 |
| `INSERT ... ON CONFLICT (id) DO UPDATE` on a genuinely conflicting key | 23001 |
| `MERGE ... WHEN MATCHED THEN UPDATE` (not on the requested list; probed anyway) | 23001 |
| `MERGE ... WHEN MATCHED THEN DELETE` | 23001 |
| `TRUNCATE` / `TRUNCATE CASCADE` | 42501 permission denied (role lacks TRUNCATE — as design.md predicts, which is exactly why task 5.5b requires the owner connection) |

Table **owner** (`sk_owner` — the production app-pool role, and the one design.md identifies as the
TRUNCATE exposure):

| form | result |
|---|---|
| targeted UPDATE | 23001 |
| targeted DELETE of the NULL-actor row | 23001 |
| `TRUNCATE audit_events` | **23001** |
| `TRUNCATE audit_events CASCADE` | **23001** |
| owner re-`GRANT`s UPDATE/DELETE/TRUNCATE to itself, then UPDATEs | **23001** (the revoke is genuinely not load-bearing) |
| `MERGE ... WHEN MATCHED THEN UPDATE` | 23001 |

Privileged pool (`sk_priv`, BYPASSRLS): with task 1.6's revoke applied, UPDATE / DELETE / CTE-DELETE /
TRUNCATE all return **42501 permission denied** (loud, but from the revoke). After a V38-style blanket
re-`GRANT UPDATE, DELETE`, the same statements return **23001** — i.e. the trigger fires for the
BYPASSRLS role too. See CR 1: this ordering contradicts task 5.3 as literally written.

Superuser: `UPDATE` → 23001, `TRUNCATE` → 23001.

`session_replication_role = 'replica'` (superuser session, the only kind that can set it — `sk_owner`
got `42501 permission denied to set parameter`): `UPDATE` → **23001**, `TRUNCATE` → **23001**.
`ENABLE ALWAYS` does what Decision 1 claims.

### 3. Positive controls

| check | result |
|---|---|
| privileged-pool INSERT (the pool `append` uses) | **succeeds** |
| app-pool SELECT with ctx=A | returns **only A's rows** (2 of 4) |
| privileged-pool SELECT | sees all 4, incl. the NULL-actor row |
| `source` CHECK with `'bogus'` | 23514 check-constraint violation |
| app-pool INSERT (`sk_app`) | **42501 "new row violates row-level security policy"** — Decision 3's "denied outright" is correct |
| **owner** INSERT (`sk_owner`) | **also 42501** — Decision 3's claim that this holds "for the non-owner app role and the table owner alike" is correct |

Decision 3's corrected wording is therefore verified, including the part that a previous draft got wrong.

### 4. The load-bearing claim, falsified on purpose (task 5.6b's red)

Dropped **only** `audit_events_no_mutate_stmt`, leaving the row-level trigger, the TRUNCATE trigger and
all three policies in place, then re-ran as `sk_app` with ctx=A:

| statement | result |
|---|---|
| targeted UPDATE of the **NULL-actor** row | **silent success, zero rows** (no error) |
| targeted DELETE of the **other user's** row | **silent success, zero rows** (no error) |
| targeted UPDATE of the caller's **own** row | 23001 (row-level trigger fires) |
| untargeted column-free UPDATE | 23001 |
| owner `TRUNCATE` | 23001 (separate trigger, unaffected) |

Recreating the statement-level trigger restored 23001 on the NULL-actor row.

This is decisive on three counts, and all three were previously only asserted:
1. The statement-level trigger **is** the load-bearing mechanism; without it the design produces exactly
   the forbidden silent `UPDATE 0`/`DELETE 0`.
2. Design.md/tasks 5.6b prescribe **precisely the right red** — and it is a red that genuinely fails.
3. The self-concealing trap design.md warns about is real: the same drop leaves the caller's-own-row
   case **green**. A test covering only row class (a) would pass against a broken design. Tasks 5.2's
   three-row-class requirement is not belt-and-braces; it is the difference between evidence and
   non-evidence.

I also confirmed the residual risk is stated honestly and not understated: `sk_owner` can
`ALTER TABLE audit_events DISABLE TRIGGER ALL; DELETE FROM audit_events;` and wipe the table (count → 0).
That is DDL, is exactly what design.md's "Residual risk, stated plainly" paragraph claims, and the
narrower claim design.md actually makes ("no DML statement from any pool can alter or remove an existing
audit row") survives every probe above.

### 5. Perimeter searched, and the absence of findings

**I found no DML evasion.** The perimeter I searched: targeted / untargeted / zero-matching / always-false
UPDATE and DELETE; `RETURNING` variants; data-modifying CTEs in both directions; auto-updatable views;
`FROM`/`USING` joins; `ON CONFLICT DO UPDATE`; `MERGE` with matched UPDATE and matched DELETE (an
addition of mine, since MERGE is a distinct executor path on PG15+); `TRUNCATE` and `TRUNCATE CASCADE`;
across four principals (non-owner app role, table owner, BYPASSRLS role, superuser); with and without a
blanket re-GRANT; and under `session_replication_role='replica'`. Every one of these either raised 23001
or was refused outright with 42501. The absence of findings here is a measured result, not silence.

Known gaps in the perimeter, stated rather than hidden: I did not probe `pg_restore`/logical-replication
apply, direct catalog or heap manipulation, or `pg_dump --data-only` round-trips; all of these require
DDL/superuser-level access or out-of-band tooling and fall inside the residual risk design.md already
concedes. Probe ran on PG 18.4; CI/prod run 14/16 — the trigger, `ENABLE ALWAYS`, and FORCE-RLS
semantics used here are all long-standing and unchanged across those versions, but `MERGE` (15+) is the
one probed form that simply does not exist on 14.

### 6. Fresh re-read outside the enforcement sub-area

- **Domain model (2.1/2.2).** Bounded correctly: the executor must pick one of two named identity
  models and document it, and is forbidden the "no identity at all" outcome that would break the query
  ticket. Spec pins that read results carry id + `created_at`. Consistent.
- **Repository signatures (3.x / spec).** `append(event)`, `findByActor(callerUserId, actorUserId)`,
  `findByResource(callerUserId, resourceType, resourceId)` are pinned identically in design.md, tasks,
  and the spec delta, with the "context user is never a filter argument" rule and its falsifying test
  (6.2). No drift between the three artifacts. Task 3.4 forbids a mutation surface; spec has the
  matching scenario.
- **AuditService failure isolation (4.2 / 6.3 / spec).** Both the failed-`Future` and the
  synchronous-throw cases are required, with the reason the second is not covered by a bare `.recover`
  written down, and a red required. Sound.
- **Scope discipline vs HEL-495 (Decision 4 / 6.5).** Mechanical `git diff | grep -i` check with
  captured output, plus a `files-modified.md` check. No import or call site is planned. Verified there is
  no rate-limit reference anywhere in the current change dir.
- **Migration numbering (Decision 5 / 1.1).** `ls db/migration | sort -V | tail -3` on this worktree
  gives `V88 / V89 / V90__invite_codes.sql`; `V91` is correct, and task 1.1 still requires re-verifying
  against a fresh `origin/main`. Correct.
- **Harness assumption verified at source, not taken from prose.** `RlsPrivilegedDmlSpec.scala:89`
  does carry the comment that `helio_privileged`'s grants come from V38 and are deliberately not
  re-granted — design.md's Testing-strategy item 4 is accurate.
- **Collateral check.** I grepped the whole test tree for global "delete/truncate every table" cleanup
  helpers that a newly-immutable table would break. There are none — every cleanup names an explicit
  table list. No existing suite is collaterally broken by this table.

Two items in this area are wrong or missing; they are CR 1 and CR 2 below. They are **not** enforcement-
mechanism defects.

---

### Verdict: REFUTE

To be unambiguous about what this REFUTE does and does not mean: **the enforcement design is converged**
(see the labelled section below), and neither change request touches it. Both are localized test-plan
corrections, each a paragraph. I am blocking rather than filing them as notes because both produce
*false or fragile evidence* in exactly the area this ticket exists to make trustworthy, and one of them
fails silently rather than loudly.

### Change Requests

1. **tasks.md 5.3 asserts an SQLSTATE the privileged pool cannot produce.** Task 5.3 requires that on the
   privileged pool "UPDATE and DELETE both raise SQLSTATE 23001". But task 1.6 revokes UPDATE/DELETE from
   `helio_privileged`, and `RlsPrivilegedDmlSpec.scala:89` deliberately does not re-grant. Probed: with
   the revoke in place the privileged pool gets **42501 permission denied** — the statement never reaches
   the trigger; after a blanket re-GRANT it gets 23001. So 5.3 as written cannot pass.
   This matters beyond a wrong constant: design.md Testing-strategy item 6 and task 5.6 both state that a
   `permission denied` demonstrates the *revoke*, not the trigger. An executor who "fixes" 5.3 by
   loosening it to "any database error" would satisfy the letter of the spec scenario while destroying
   the distinction the whole test plan is built on.
   Required: amend task 5.3 to state the two-phase form explicitly — (a) assert the revoked privileged
   role fails **42501**, recorded as the revoke's defence-in-depth working, and (b) re-`GRANT UPDATE,
   DELETE` to `helio_privileged` and assert the same statements then raise **23001**, recorded as the
   proof the trigger binds a BYPASSRLS role. Say explicitly that loosening to "any error" is not an
   acceptable resolution. Mirror the same distinction in design.md's Testing-strategy item 2, which
   currently says only "the same two assertions repeated on the privileged pool".

2. **No artifact addresses the fact that the test table can never be cleaned up.** Every other spec in
   this repo cleans between runs with `DELETE`/`TRUNCATE` over a named table list. On `audit_events`
   both are now impossible by construction, and all worktrees share one dev Postgres — a hazard this
   repo has already been bitten by. Nothing in design.md or tasks.md says how the new specs handle this.
   Left to improvise, the likely outcomes are exactly the silent ones: `findByActor` "newest-first" and
   `findByResource` "only events for that resource" (tasks 6.1/6.2) asserted against rows accumulated by
   previous runs, or an absolute-count/"sees all three rows" assertion in 6.2 that passes or fails on
   run history rather than on behaviour.
   Required: record a decision in design.md (and reflect it in tasks 5.1 / 6.1 / 6.2) covering both
   halves — (a) **isolation**: every assertion must be scoped by per-run-unique `actor_user_id` /
   `resource_type` / `resource_id` values, with no absolute `count(*)`, no "returns all rows", and no
   "table is empty" assertion anywhere; and (b) **teardown**, if any: the only mechanism that works is
   `ALTER TABLE audit_events DISABLE TRIGGER ALL` + `DELETE` + re-`ENABLE ALWAYS` on the owner/superuser
   connection (I probed this: it succeeds and empties the table). If that is adopted it must be stated
   that it runs strictly in `afterAll`, never in `beforeEach`, and never inside the same connection or
   transaction as an immutability assertion — a suite that disables the guard it is proving is one
   ordering mistake away from a vacuous green. If it is *not* adopted, say so and rely on (a) alone.

### Convergence judgement (explicitly labelled, as requested)

**Yes — the enforcement design is converged, and the remaining risk in that sub-area is ordinary
implementation risk.**

The basis for saying so is that round 4 no longer rests on reasoning about Postgres semantics. The
designed schema was built and attacked, and the specific mechanism-level claims that rounds 1–3 kept
getting wrong are now each individually confirmed by observation: the statement-level trigger fires
before the scan and is indifferent to RLS visibility, row matching, statement form, pool, ownership and
`session_replication_role`; the row-level trigger is genuinely only defence-in-depth and genuinely does
*not* cover the non-owned and NULL-actor cases; the revoke is genuinely not load-bearing (the owner
re-granted to itself and still got 23001); TRUNCATE genuinely needs its own trigger and the owner —
the production app-pool role — genuinely is the exposed principal; and Decision 3's corrected
"INSERT is denied outright, for the owner too" is accurate. Equally important, the *red* the test plan
prescribes was reproduced and is a real, failing red, and the self-concealing green it warns about is
also real.

I found no evasion across the perimeter in §5. The two change requests are test-hygiene corrections in
the surrounding plan, not another iteration on the mechanism. I would expect round 5 to be a short
confirmation of two paragraph-level edits, not a fourth reconsideration of how append-only is enforced.

### Non-blocking notes

- proposal.md says the read policy follows "the `V35`/`V42` convention" while design.md Decision 3 is at
  pains to explain the `FOR ALL` shape of that convention is actively wrong here. The proposal means the
  *predicate* convention, but a reader arriving at the proposal first gets the opposite steer. One
  clause ("following V35/V42's direct-owner predicate, but restricted to `FOR SELECT` — see Decision 3")
  would remove it.
- Several existing harness bases (`ApiTokenAuthSpec:118`, `PipelineApplyProposalSpecBase:133`,
  `ApplyProposalSpecBase:108`, and others) grant `TRUNCATE` to `helio_privileged`, so design.md's
  "`V38` grants only SELECT/INSERT/UPDATE/DELETE, never TRUNCATE" is true of V38 but not of every test
  environment. It changes nothing — I probed superuser `TRUNCATE` and it raises 23001 — but the
  migration header comment should not lean on the absence of the grant as if it were a guarantee.
- `MERGE ... WHEN MATCHED THEN UPDATE/DELETE` is blocked (probed). Worth one line in the migration
  header comment, since MERGE is the one mutation path a future reader is most likely to assume slips
  past a `BEFORE UPDATE OR DELETE` trigger.

_Probe artifacts: scratch DB `hel471_probe4` on the local PostgreSQL 18.4 instance; scripts in this
session's scratchpad (`schema.sql`, `seed.sql`, `run.sh`). The scratch DB is dropped after this report;
no shared dev-DB schema, no `flyway_schema_history`, and no worktree file other than this report were
touched._
