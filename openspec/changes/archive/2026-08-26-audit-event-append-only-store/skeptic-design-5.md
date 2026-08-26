## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Scope of this round, per the brief and per round 4's own convergence judgement: verify the two
round-4 change requests are correctly applied and internally consistent across proposal.md /
design.md / tasks.md / both spec deltas. The enforcement mechanism itself was declared converged in
round 4 on the basis of a built-and-attacked scratch schema, and I am deliberately **not**
re-litigating it. I read it for consistency with the edits, not to reopen it.

### What I verified (with evidence)

**CR-1 — tasks 5.3 two-phase form.** Read `tasks.md` §5.3. It now states both phases explicitly:
(a) "with the revoke in place, assert UPDATE/DELETE fail with SQLSTATE **42501** (permission denied),
recorded as the defence-in-depth revoke working"; (b) "then `GRANT UPDATE, DELETE ON audit_events TO
helio_privileged` and assert the same statements raise SQLSTATE **23001**". It carries the required
refusal clause verbatim in intent: "Loosening this to 'any database error' is NOT an acceptable
resolution — it collapses the permission-denied vs trigger distinction the entire test plan is built
on." It also names *why* a single-assertion form cannot pass (task 1.6's revoke + `RlsPrivilegedDmlSpec`
not re-granting). Correctly applied.

**CR-1 mirror in design.md.** Read `design.md` Testing-strategy item 2. It no longer says "the same
two assertions repeated"; it now says "in two explicit phases — not 'the same two assertions
repeated'", enumerates 42501 → then-GRANT → 23001 with the same recorded meanings, and repeats the
"loosening to 'any database error' is NOT acceptable" clause. Design and tasks agree; no daylight
between them.

**CR-2 — Decision 6 exists and is complete.** Read `design.md` "Decision 6 — Test isolation, given
that the audit table can never be cleaned". It covers both halves the CR required:
(a) mandatory per-run-unique `actor_user_id` / `resource_type` / `resource_id` scoping, with the
forbidden list stated explicitly — absolute `count(*)`, "returns all rows", "table is empty";
(b) teardown restricted to `DISABLE TRIGGER ALL` + `DELETE` + re-`ENABLE ALWAYS` on the
owner/superuser connection, `afterAll`-only, never `beforeEach`, never on the same connection or
transaction as an immutability assertion — with "omit it entirely" named as the recommended default
and the reason given (6(a) makes it unnecessary for correctness). The shared-dev-Postgres hazard and
the specific silent failure modes are both stated.

**CR-2 — reflected in tasks.** New `tasks.md` §5.1b restates the mandate, the forbidden-assertion
list, "Default to NO teardown", and the full teardown ordering constraint. §6.1 now ends "All scoped
to per-run-unique actor/resource values per 5.1b — assert on the run's OWN rows, never on the table's
total contents." §6.2 now reads "privileged pool sees all three OF THIS RUN'S rows (filter by the
run-unique values — do NOT assert the privileged pool returns three rows in total, which depends on
run history)". This is exactly the assertion round 4 flagged as the likely silent one, and it is now
closed at the point an executor would write it.

**Non-blocking note 1 (proposal wording).** `proposal.md` now reads "following `V35`/`V42`'s
direct-owner *predicate*, but restricted to `FOR SELECT` — the `FOR ALL` shape those migrations use is
actively wrong for this table … see design.md Decision 3". The opposite-steer risk is gone. Adopted.

**Non-blocking note 2 (harness TRUNCATE grant).** `tasks.md` §1.6 now carries: "several test harness
bases DO grant TRUNCATE to `helio_privileged`, so the migration comment must not lean on the absence
of that grant as if it were a guarantee — the TRUNCATE trigger is what guarantees it." That is
precisely where the note asked for it (the migration comment's content). Adopted.

**Non-blocking note 3 (MERGE) — NOT adopted.** `grep -rni "merge" proposal.md design.md tasks.md
specs/` returns **zero hits** across all five artifacts. The brief I was given stated "tasks 1.8 notes
MERGE is covered"; that is not the case in the files. This was a non-blocking note in round 4 and
remains non-blocking, so it does not change the verdict — but the record should be accurate rather
than carry a false "adopted" claim. See notes below.

**Cross-artifact consistency sweep.** Re-read both spec deltas in full against Decision 6's
forbidden-assertion list, which is the specific conflict the brief asked me to sanity-check.
- `audit-event-persistence` "A user reads only their own audit rows" — negative/own-scoped, satisfiable
  run-scoped. No conflict.
- "System-authored rows are not visible on the app pool" — negative. No conflict.
- "findByResource returns events for that resource" ("only events for that resource are returned") —
  negative, and §6.1 pins the run-unique scoping. No conflict.
- "The privileged pool sees all audit rows" — the one scenario whose surface wording is table-wide.
  Assessed below; it does not rise to a blocker because tasks §6.2 already gives the executor the
  run-scoped form in bold, explicitly forbidding the total-count reading. Non-blocking note.
- The append-only scenarios ("the row is unchanged", "the row still exists", "does NOT report zero
  rows affected") are all single-row and identity-scoped; none depends on table totals.

Design ↔ tasks ↔ spec agree on: the statement-level trigger as sole load-bearing mechanism (D1 /
1.5 / persistence "must not depend on a row being visible to the scan"); the three-policy split as
defence-in-depth only, with the explicit "does NOT by itself make mutations reach a trigger"
correction present in all three (D3 / 1.7 / RLS requirement); INSERT denied outright on the app pool
(D3 / 1.7 / RLS requirement); pinned read signatures with `callerUserId` never derived from a filter
argument (D2 / 3.3 / repository requirement + the "RLS context user is the caller" scenario, which
6.2's `findByActor(callerA, actorB)` → EMPTY case tests). No contradiction found.

### Verdict: CONFIRM

Both round-4 change requests are applied faithfully and consistently in every artifact that had to
move, two of three notes are adopted, and the one gap I found (MERGE) is a documentation nicety that
cannot produce false evidence or a broken implementation. Nothing here meets the bar for spending the
last round of the budget and escalating to a human.

### Non-blocking notes

- **Spec scenario "The privileged pool sees all audit rows" vs Decision 6's forbidden list.** The
  scenario's `THEN` ("rows for every actor, including NULL-actor system rows, are returned") reads
  table-wide, while Decision 6 forbids "returns all rows" assertions. `tasks.md` §6.2 already resolves
  this for the executor, so implementation risk is low — but the spec delta is the artifact that
  survives archive into `openspec/specs/`, and a future reader will not have §6.2 in hand. Suggested
  edit, if the executor is touching the file anyway: add a `GIVEN` and scope the `THEN`, e.g.
  "**GIVEN** audit rows exist for two distinct actors and one NULL actor, all created by this run …
  **THEN** all of those rows are returned, including the NULL-actor row" — which states the same
  behaviour without an assertion on the table's total contents. Purely a wording change; no design
  consequence.
- **MERGE line.** Round 4 probed `MERGE ... WHEN MATCHED THEN UPDATE/DELETE` and confirmed it raises
  23001, and suggested one line in the migration header comment because MERGE is the mutation path a
  future reader is most likely to assume slips past a `BEFORE UPDATE OR DELETE` trigger. That line is
  absent from every artifact. Worth adding to `tasks.md` §1.8's header-comment list.
- **Ordering coupling inside task 5.3.** Phase (b)'s `GRANT UPDATE, DELETE ON audit_events TO
  helio_privileged` persists for the rest of the suite, so phase (a)'s 42501 assertion is only valid
  before it. The task's "then" implies the order, and the failure mode if it were ever reordered is a
  loud failing assertion rather than a vacuous green, so this is not a correctness risk — but stating
  "(a) must run before (b) in the same suite; (b)'s GRANT is not revoked afterwards" at the callsite
  would make it robust to a future test being inserted between them.
- **Procedural, not about the change:** `scripts/concertino/next-report-number.sh` and
  `persist-evidence.sh` do not exist in this worktree's `scripts/concertino/` (it carries only
  `assert-phase.sh`, `cleanup.sh`, `setup-worktree.sh`, `start-servers.sh`, `lib`, `README.md`). I ran
  them from the main checkout at `/home/matt/Development/helio/scripts/concertino/`, same repo and
  same canonical scripts. Not a blocker; noted so the path discrepancy is not mistaken for a skipped
  step.
