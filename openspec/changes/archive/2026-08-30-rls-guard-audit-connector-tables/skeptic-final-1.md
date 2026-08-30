## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed `e6ff6edd` (on `3dbcab81`) against `main`. Every statement below comes from a command
I ran myself in this worktree. The evaluator reports (`evaluation-2.md`, `evaluation-3.md`) were
read only as claims; nothing here is derived from them.

### What I verified (with evidence)

**Scope.** `git diff main...HEAD --name-only` = exactly 3 files: the spec
`backend/src/test/scala/com/helio/infrastructure/persistence/RlsPolicyGuardSpec.scala`, plus
`tasks.md` and `files-modified.md`. No `frontend/**` files, no production code, no migrations.
The UI/design-judgment section of the final gate is therefore **not applicable** and was skipped
deliberately, not omitted.

**AC1 — both tables in `rlsTables` with accurate comments.** Read the current file. Present:
`"audit_events" -> Some(Set("audit_events_owner","audit_events_update","audit_events_delete"))`
under a `// V91 ... (HEL-471)` comment, and `"connector_credentials" -> None` under
`// V92 ... single policy, V35 pattern (HEL-536)`. The stale "pre-existing gap" note on the
`connectors` entry is gone. Comments cross-checked against the migrations themselves:
`V91__audit_events.sql` really does create exactly those three policy names plus
`ENABLE`+`FORCE ROW LEVEL SECURITY`; `V92__connector_credentials.sql` really does create exactly
one policy `connector_credentials_owner` plus `ENABLE`+`FORCE`. Comments are accurate. **Met.**

**AC2 — full RLS set re-derived and reconciled.** I re-derived it independently from the migration
directory rather than trusting task 1.1:
`grep -rhi "ENABLE ROW LEVEL SECURITY" | sed .. | sort -u` yields 27 distinct table names.
`rlsTables` has exactly those 27 keys — no table in the migrations missing from the map, and no
map key absent from the migrations. **Met, zero residual drift.**

**AC3 — `audit_events` assertion is meaningful given the 3-policy split.** Not papered over. The
entry uses the exact-name-set branch, and the code comment states why (`count > 0` stays green if
`audit_events_update`/`audit_events_delete` are dropped while `audit_events_owner` survives) and
correctly records that the append-only guarantee is trigger-carried, not RLS-carried — which
matches `V91__audit_events.sql`'s own header. I confirmed the exactness is real, not decorative,
by mutation (below). **Met.**

**AC4 — non-vacuousness proven.** I did not accept the executor's or evaluator's claim here. I ran
**three independent mutations** of my own, restoring the tree after each:

1. *Probe non-vacuousness.* Neutered `checkPolicies`' exact-match branch to `if (true) Right(())`.
   Result: `"fails when a required policy is missing" *** FAILED *** Expected the guard to fail
   after dropping audit_events_update: false was not equal to true` — 84 succeeded, 1 failed.
   The probe is genuinely bound to the shipped assertion and detects it being weakened.
2. *Shipped loop vs. a real migration regression.* Deleted the `CREATE POLICY audit_events_delete`
   statement from `V91__audit_events.sql`. Result: the **shipped per-table case** failed —
   `audit_events has exactly the expected policies ... *** FAILED *** ... expected policies
   Set(owner, update, delete) but found Set(owner, update)` (2 failed). This is the decisive
   check: a future migration silently dropping one of three policies now turns the suite red.
3. *`None`-branch coverage for the newly added table.* Removed
   `CREATE POLICY connector_credentials_owner` and the `FORCE ROW LEVEL SECURITY` line from
   `V92__connector_credentials.sql`. Result: `connector_credentials has relforcerowsecurity = true`
   and `connector_credentials has at least one policy` both **FAILED** (2 failed). The new
   `connector_credentials` entry is not a vacuous pass either.

   After each mutation I restored via `git checkout` and re-confirmed a clean tracked tree
   (`git status --porcelain` shows only untracked change-dir docs).

**AC5 — mechanical same-PR enforcement recorded as follow-up, not done.** Honestly represented.
`tasks.md` task 3.1 is **unchecked** (`- [ ]`) and annotated "ticket text handed to orchestrator
via commit body — orchestrator to file". `design.md` D4 records it as out of scope per the
ticket's own last AC. The cycle-1 commit body carries the full spinoff ticket text (including a
concrete proposed mechanism: a CI check diffing new `ENABLE ROW LEVEL SECURITY` migrations against
the allowlist) and states plainly "Deferred to the orchestrator to file — no Linear tool access
from this session." `files-modified.md` also records the un-checking as a deliberate cycle-2
correction. This is a correctly-deferred item, **not a defect** — the only outstanding action is
the orchestrator filing the spinoff at Delivery.

**Gates re-run by me (not read from a report).**
- `sbt "testOnly com.helio.infrastructure.persistence.RlsPolicyGuardSpec"` → **85/85 passed**
  (was 79 on main's shape; +6 = 2 new tables x 3 cases, minus/plus the probe test).
- `sbt test` (full backend) → **3851 succeeded, 0 failed, 244 suites, 0 aborted**.
- `node scripts/check-scala-quality.mjs` → `clean (146 soft warning(s))`, exit 0. All warnings are
  pre-existing soft line-budget notes on unrelated files.
- `node scripts/check-openspec-hygiene.mjs` → `openspec/ is clean`, exit 0.

**Iron Laws.** `verification-before-completion`: satisfied — every claim above is backed by output
I read. `systematic-debugging`: this is a guard-gap closure, not a bug fix with a runtime root
cause; the ticket itself states nothing is currently exposed, and I confirmed that independently
(both tables really do carry `ENABLE`+`FORCE` and their policies in V91/V92). The regression guard
added is failable-by-mutation, which I proved three ways — it is a genuine guard, not a green
check that proves nothing.

**Design/quality judgment on the code itself.** The cycle-2 DRY refactor is real and load-bearing:
`checkRowSecurity`/`checkForceRowSecurity`/`checkPolicies` are each called by both the per-table
loop and (for `checkPolicies`) the probe, so mutation 1 above propagated from the helper into the
probe exactly as the design intends. The probe's second EmbeddedPostgres is properly scoped with
nested `try/finally` and never touches the shared `beforeAll` instance — I confirmed the other 84
cases stayed green alongside it. The `Either[String, Unit]` return shape carries a useful failure
message that surfaced verbatim in my mutation runs.

### Verdict: CONFIRM

Ships. All five acceptance criteria trace to concrete evidence; the guard is proven red-capable by
my own mutations rather than by assertion; the full backend suite and the repo's quality gates are
green; and the one incomplete task (3.1) is honestly and visibly deferred rather than falsely
claimed.

### Non-blocking notes

- The class-level comment says `Some(expectedPolicyNames)` is for "tables where more than one
  policy exists and an exact name-set match is needed". Read as a conjunction it is accurate, but a
  future maintainer could read it as "every multi-policy table uses `Some`", which is not true today:
  `dashboards` (4), `panels` (4), `pipelines` (5 created, 2 dropped) and `resource_permissions` (8)
  all have multiple live policies and are mapped `None`. The cycle-1 commit body is more plainly
  wrong on this point — "tables with more than one policy (only `audit_events` today)". Worth a
  one-line clarification, and arguably worth extending `Some(...)` coverage to those four tables in
  a later ticket; both are out of this ticket's scope (AC3 names only `audit_events`).
- `files-modified.md`'s cycle-1 paragraph still refers to "the shared `checkTable` logic", a helper
  that no longer exists after the cycle-2 split. The cycle-2 section immediately below corrects it,
  so the document is not misleading in aggregate, but the stale name is a small wart.
- Two evaluators were dispatched for cycle 2 (`evaluation-2.md` and `evaluation-3.md` both evaluate
  `e6ff6edd` and both reach PASS). Not a code issue; flagged for the orchestrator as a duplicate
  dispatch. The second evaluator handled it correctly by not overwriting the first.
