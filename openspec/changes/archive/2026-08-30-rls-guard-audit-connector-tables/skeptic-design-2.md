## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

- **Round-1 CR#1 (tasks.md 2.2 contradicted D3's probe) is fixed.** tasks.md:14 now
  scopes the manual allowlist-scoping check to `connector_credentials`, explicitly
  states it measures *allowlist scoping* as "distinct from D3's non-vacuousness probe",
  and carries an explicit parenthetical forbidding the use of `audit_events` with the
  correct reason (the D3 probe reads `audit_events`'s expected-name set from the same
  map). It also requires restoring the entry and recording evidence.
- **CR#1 wording checked against ground truth, not the narrative.** 2.2 says "only
  `connector_credentials`'s own three assertions are skipped". I read
  `backend/src/test/scala/com/helio/infrastructure/persistence/RlsPolicyGuardSpec.scala`:
  the per-table loop emits exactly three `in` cases per table (`relrowsecurity`,
  `relforcerowsecurity`, `>=1 policy`). "Three" is accurate even though
  `connector_credentials` maps to `None` (task 1.4).
- **Round-1 CR#2 (ticket AC #5 unowned) is fixed.** tasks.md:18 adds a `### Follow-up`
  section, task 3.1: file a spinoff Linear ticket for the mechanical migration↔`rlsTables`
  same-PR contract (design D4) and record its id in the PR body. AC #5 explicitly allows
  a follow-up rather than in-scope work.
- **AC coverage trace (all five):** AC1→tasks 1.3/1.4; AC2→task 1.1 (+ D1);
  AC3→tasks 1.2/1.5/1.7 (+ D2); AC4→task 1.6 (+ D3); AC5→task 3.1 (+ D4).
- **D1's re-derivation claim independently reproduced.** Extracting every
  `ALTER TABLE … ENABLE ROW LEVEL SECURITY` target from
  `backend/src/main/resources/db/migration` yields 27 distinct tables; `rlsTables` in the
  spec today lists 25. The set difference is exactly `audit_events` and
  `connector_credentials`. No third gap exists. Task 1.1 still correctly requires the
  executor to re-run this itself rather than trust the doc.
- **D2/D3 policy names verified against the migrations.** `grep "CREATE POLICY"` on
  V91–V93 returns exactly `audit_events_owner`, `audit_events_update`,
  `audit_events_delete` (three, matching task 1.3's `Some(Set(...))` verbatim) and
  `connector_credentials_owner` (single, matching task 1.4's `None`). No misnamed or
  invented policy in the plan.
- **No placeholders / contradictions found.** No TODO/TBD in any artifact. Proposal,
  design, and tasks agree on the `Map[String, Option[Set[String]]]` shape, the D3
  second-EmbeddedPostgres probe, and the test-file-only blast radius. `skip_specs: true`
  is justified (no capability delta; test-only change).
- **Scope drift check:** impact is confined to one test file; the two non-goals (no
  non-superuser row-visibility testing, no migration/policy edits) match the ticket's
  own "Prior Art / Context" framing.

### Verdict: CONFIRM

### Non-blocking notes

- proposal.md still describes AC4 as "a documented, reproducible **manual** probe
  procedure (or a temporary local assertion)", whereas design D3 (correctly) upgrades
  this to a permanent in-repo, CI-reproducible test. The design narrows the proposal
  rather than contradicting it, but a one-line proposal touch-up would remove the
  ambiguity for a future reader.
- Task 1.6 asserts the probe "now fails for `audit_events`". The executor should ensure
  the probe asserts a *failure of the shared per-table check helper* (D3's stated shape),
  not merely that the dropped policy is absent from `pg_policies` — the latter would be a
  self-fulfilling check that proves nothing about the guard.
