## Why

During the HEL-272 RLS epic, a prod-breaking bug shipped past 809 passing tests because
`DbContext` tests used `new DbContext(db, db)` — both pools pointed at the same EmbeddedPostgres
superuser datasource, making the `helio_privileged` role's DML privileges invisible to CI.
We need a test that proves `helio_privileged` can actually INSERT/UPDATE/DELETE on every ACL'd
table, and that `withUserContext` via a non-superuser role is genuinely RLS-filtered.

## What Changes

- Add `RlsPrivilegedDmlSpec`: a new integration test that creates a real two-role topology
  (non-superuser app pool + `helio_privileged` privileged pool, NO superuser shortcut for either)
  and asserts that `withSystemContext` can perform full DML (INSERT, UPDATE, DELETE) on all nine
  ACL'd tables from both V35 and V36.
- The new spec specifically closes the V38 regression class: if `helio_privileged` ever loses
  table-level GRANT, the INSERT assertion fails immediately.
- `withUserContext` coverage: assert the non-superuser app pool is RLS-filtered and fail-closed
  (missing session var raises an error, not silent empty result) for key tables.
- The existing `DbContextSpec`, `RlsOwnerTablesSpec`, and `RlsSharingAwareTablesSpec` are NOT
  changed — they remain valid for their stated purposes.

## Capabilities

### New Capabilities

- `rls-privileged-dml-coverage`: Integration test suite verifying `helio_privileged` DML
  capability and `withUserContext` RLS-filtering across all nine ACL'd tables.

### Modified Capabilities

(none — no existing spec requirement changes)

## Impact

- **Backend test** (`backend/src/test/scala/com/helio/infrastructure/`): new `RlsPrivilegedDmlSpec.scala`.
- No production code changes; no API changes; no frontend changes.
- CI test count increases; run time increases marginally (one additional EmbeddedPostgres instance).

## Non-goals

- Changing how `DbContext` is constructed in production or existing tests.
- Adding a boot-level smoke test (noted in ticket as "consider" — deferred to a follow-up).
- Modifying Flyway migrations (V38 already grants the necessary permissions).
