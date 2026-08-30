## Why

`RlsPolicyGuardSpec`'s `rlsTables` allowlist is a regression guard: it fails if a new
RLS-protected table is added to the schema without a corresponding entry. Two tables —
`audit_events` (V91) and `connector_credentials` (V92) — slipped this contract and are
not in the allowlist today. Both are, in fact, correctly RLS-protected in their
migrations; the gap is purely in the guard, so a future policy regression on either
table would go undetected.

## What Changes

- Add `audit_events` and `connector_credentials` to `rlsTables` with comments matching
  the file's existing style (migration version, ticket, ownership shape).
- Re-derive the full RLS-enabled table set from migration history (`ENABLE ROW LEVEL
  SECURITY` occurrences) and reconcile it against `rlsTables`; close any further gaps
  found in the same change.
- Assess whether the spec's existing per-table assertions (`relrowsecurity`,
  `relforcerowsecurity`, `>=1 policy`) are meaningful for `audit_events`'s three-policy,
  deny-oriented (`USING (true)`) split, and document the answer in the spec itself if
  the shape needs adjusting or a caveat.
- Add a documented, reproducible manual probe procedure (or a temporary local
  assertion) proving the guard actually goes red when a policy is dropped, and record
  the evidence that it does.
- Record, as a spinoff ticket rather than in-scope work, whether the same-PR
  allowlist/migration contract can be enforced mechanically.

## Capabilities

### New Capabilities

(none — this is a test-only regression-guard fix, no user-facing or API behavior
changes)

### Modified Capabilities

(none — see Non-goals; `skip_specs: true` is set in this change's `.openspec.yaml`)

## Impact

- `backend/src/test/scala/com/helio/infrastructure/persistence/RlsPolicyGuardSpec.scala`
  only. No migration, route, or schema changes.

## Non-goals

- Does not add real non-superuser RLS row-visibility testing (the dev/CI
  BYPASSRLS-superuser gap from HEL-286) — this spec is a structural metadata guard by
  design (see its own header), not a row-visibility enforcement test; that is a
  separate, larger effort.
- Does not change any policy predicate or migration.
