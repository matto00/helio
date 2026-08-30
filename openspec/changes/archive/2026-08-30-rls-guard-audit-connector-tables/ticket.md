# HEL-842: RlsPolicyGuardSpec is missing audit_events and connector_credentials

## Description

> Row 0b of the Pipelines & Outputs remodel (HEL-903) — parallel with 0a (HEL-330).

`backend/src/test/scala/com/helio/infrastructure/persistence/RlsPolicyGuardSpec.scala` maintains an explicit `rlsTables` allowlist as a regression guard. Its own header states the contract: when a migration adds an RLS-protected table, the table must be added to this set in the same PR so the spec keeps passing.

Two tables slipped that contract:

* `audit_events` (V91, HEL-471) — not in the allowlist
* `connector_credentials` (V92, HEL-536) — not in the allowlist

Verified against `main`: the allowlist jumps from `// V90 — invite_codes` straight to `// V93 — connectors`, with only a comment (not a Set entry) noting the connector_credentials gap.

### This is a guard gap, not a live exposure

Both tables really are protected today, confirmed in the migrations:

* `V91__audit_events.sql` — `ENABLE ROW LEVEL SECURITY` + `FORCE ROW LEVEL SECURITY`, with a deliberate three-policy split (`audit_events_owner` SELECT / `audit_events_update` USING(true) / `audit_events_delete` USING(true)) rather than a single `FOR ALL` policy, because under `FORCE` an unscoped policy's `USING` qual would be applied to the append-only path this table needs to protect. The true append-only guarantee is carried by BEFORE STATEMENT triggers, not RLS — the UPDATE/DELETE policies are USING(true), i.e. non-scoping/permissive.
* `V92__connector_credentials.sql` — `ENABLE` + `FORCE ROW LEVEL SECURITY` with a single `connector_credentials_owner` policy on the V35/V37 owner-only pattern.

So nothing is currently exposed. What is missing is the regression guard: a future migration or refactor could drop or weaken either policy and no test would fail.

## Acceptance Criteria

- [ ] `audit_events` and `connector_credentials` are both in `rlsTables` with accurate comments
- [ ] The full set of RLS-enabled tables is re-derived from the migration history and reconciled against `rlsTables`, with any further gaps closed in the same PR
- [ ] For `audit_events`, the spec's assertion is confirmed to be meaningful given its three-policy split — or the limitation is documented explicitly rather than papered over with a passing entry
- [ ] A deliberately-broken probe demonstrates the guard actually fails when a policy is missing (e.g. temporarily drop a policy locally and confirm the spec goes red), proving these entries are not vacuous
- [ ] Consider whether the same-PR contract can be enforced mechanically rather than by convention — if that is a larger change, record it as a follow-up rather than expanding this ticket

## Prior Art / Context

RLS policies never actually execute in dev/CI in the row-filtering sense because both connect as a superuser (BYPASSRLS) — that gap caused a real prod outage (HEL-286, V40 recursion fix). `RlsPolicyGuardSpec` is explicitly a *structural* guard (checks `pg_class.relrowsecurity`/`relforcerowsecurity`/`pg_policies` metadata, which is role-independent), not an enforcement test — see its own header comment (D2/D3, "does NOT verify correctness of individual policy predicates"). This ticket's job is to close the allowlist gap and prove the guard is non-vacuous by breaking it locally, not to add real non-superuser row-visibility testing (that is a different, larger effort).
