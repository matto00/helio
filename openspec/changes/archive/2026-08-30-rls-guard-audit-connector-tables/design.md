## Context

`RlsPolicyGuardSpec` (`backend/src/test/scala/com/helio/infrastructure/persistence/RlsPolicyGuardSpec.scala`)
loops `rlsTables: Set[String]` and, per table, asserts three pg_catalog facts:
`pg_class.relrowsecurity = true`, `pg_class.relforcerowsecurity = true`, and
`COUNT(*) FROM pg_policies WHERE tablename = $t > 0`. It is a structural guard, not a
row-visibility enforcement test (its own header, D2/D3) — it runs against an
EmbeddedPostgres instance migrated once in `beforeAll` and queries catalog metadata,
which is role-independent, so this design does not touch the dev/CI
BYPASSRLS-superuser gap (HEL-286) at all. See proposal.md for the "why" (allowlist gap
on `audit_events`/`connector_credentials`).

## Goals / Non-Goals

**Goals:**
- Close the two known allowlist gaps with accurate comments.
- Re-derive the RLS-enabled table set from migration history and reconcile.
- Determine whether the existing 3-assertion shape is meaningful for `audit_events`
  and document the answer.
- Prove the guard is non-vacuous with a reproducible break-it probe.

**Non-Goals:**
- No new row-visibility (non-superuser) RLS test infrastructure.
- No migration or policy changes — the policies themselves are correct today.
- No change to `audit_events`'s append-only trigger mechanism.

## Decisions

**D1 — Re-derivation method.** `grep -rl "ENABLE ROW LEVEL SECURITY" backend/src/main/resources/db/migration`
lists every migration that enables RLS on a table. Cross-checked against `rlsTables`
during Planning: V35 (6 tables), V36 (3), V42, V46, V54, V60, V61, V62, V75, V77, V79,
V80, V81, V82, V84, V88, V90, V93 are already present; only V91 (`audit_events`) and
V92 (`connector_credentials`) are missing. No further gaps exist — confirmed by
enumerating every `ENABLE ROW LEVEL SECURITY` occurrence and matching 1:1 against
`rlsTables` plus these two additions. The executor must re-run this grep against its
own worktree (not trust this design doc) before editing, in case a table landed on
`main` between Planning and Execution.

**D2 — `audit_events`'s 3-assertion shape IS meaningful, with one documented caveat.**
The existing per-table loop asserts `relrowsecurity`, `relforcerowsecurity`, and
`policy count > 0`. For `audit_events`:
- `relrowsecurity`/`relforcerowsecurity` are meaningful exactly as for every other
  table — if `FORCE ROW LEVEL SECURITY` were dropped, this assertion goes red. This is
  NOT vacuous for `audit_events`: the migration's own header explains that a
  non-FORCE table would let `helio_privileged`'s BYPASSRLS-independent superuser-owner
  path skip RLS on UPDATE/DELETE, defeating the RLS half of the defence-in-depth
  posture (the trigger is still primary, but this assertion still guards a real,
  separately-regressable property).
- `policy count > 0` is weaker for `audit_events` than for a single-policy table: it
  passes as soon as any of the three policies (`audit_events_owner`,
  `audit_events_update`, `audit_events_delete`) exists, so it would NOT catch, e.g.,
  `audit_events_update` being silently dropped while `audit_events_owner` remains —
  even though dropping `_update` changes the read-scoping story for administrators
  (accepted separately from the append-only guarantee, which the trigger — not this
  spec — protects). This is the honest limitation the ticket asks to surface rather
  than paper over.
- **Chosen fix:** extend the per-table assertion, but ONLY for tables with more than
  one policy (currently only `audit_events`), to assert the full expected policy-name
  set (`audit_events_owner`, `audit_events_update`, `audit_events_delete`), not just a
  non-zero count. Implemented as a `Map[String, Option[Set[String]]]` alongside (or
  replacing) `rlsTables: Set[String]` — `None` for the ordinary single/unspecified-name
  case (existing tables keep exactly today's `count > 0` behavior, zero behavior
  change for 20+ existing entries), `Some(expectedPolicyNames)` for `audit_events`
  only. This is additive and minimal: no other table's assertion shape changes.
- Alternative considered and rejected: leave `policy count > 0` as-is and just add a
  code comment noting the gap. Rejected per the ticket's own AC #3 — "a green entry
  that does not actually check the append-only guarantee would be worse than the
  honest gap it replaces" — the ticket explicitly asks for either a meaningful
  assertion or an explicit documented limitation; since a precise, cheap fix exists
  (assert the name set), a bare comment would be settling for a strictly worse outcome
  the ticket already flagged as unacceptable.

**D3 — Non-vacuousness probe.** Add a dedicated test, `"fails when a required policy is
missing (regression-guard sanity check)"`, that runs against a SEPARATE, second
EmbeddedPostgres+Flyway instance (not the shared `beforeAll` one, to avoid mutating
state other tests depend on), issues `DROP POLICY audit_events_update ON
audit_events;`, then asserts that re-running this spec's own per-table check logic
(refactored into a small private method reused by both the main loop and this probe)
returns `false`/fails for `audit_events` under the new name-set assertion. This is a
real, in-repo, CI-reproducible red/green proof (not a manual, undocumented "I checked
locally" claim) — satisfies AC #4 durably instead of only at review time.

**D4 — Same-PR enforcement, mechanical.** Out of scope per the ticket's own last AC
bullet ("record it as a follow-up rather than expanding this ticket") — filed as a
spinoff ticket during Delivery.

## Risks / Trade-offs

- [Risk] The `Map[String, Option[Set[String]]]` refactor touches every existing
  `rlsTables` entry's declaration site → Mitigation: mechanical, comment-preserving
  rename (`"foo"` becomes `"foo" -> None`); no assertion behavior changes for existing
  entries, verified by the full suite staying green.
- [Risk] The second EmbeddedPostgres instance in D3 slows the suite → Mitigation:
  single instance, single test, teardown in the test's own scope; acceptable given
  this spec already boots one full EmbeddedPostgres+Flyway per run.

## Gate-Chain Implications Checklist

Not applicable — this change touches only a backend test file and does not modify
`.husky/**` or any script a pre-commit hook invokes.
