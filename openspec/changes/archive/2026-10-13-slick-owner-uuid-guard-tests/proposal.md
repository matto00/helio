## Why

HEL-1347 (V119) left three loose ends: the Slick `data_sources.owner_id` column is still `Option[UUID]` although the
database column is NOT NULL (so the code carries a dead ownerless branch and `UserId("")` fallbacks); V119's pre-delete
guard has no dedicated test for its `lookup` and `union` clauses (removing `'lookup'` left every test green); and
`V119OwnerFkMigrationSpec` is a ~414-line file mixing four scenario groups. The guard pattern will be reused, so its
tests must actually pin each clause.

## What Changes

- `DataSourceRepository`: `owner_id` column and `DataSourceRow.ownerId` become `UUID`; drop the empty-owner fallbacks.
- `findAllRestApiRawInternal` returns a non-optional owner; `RestSourceConnectorMigration` loses its unreachable
  ownerless skip branch and the comments describing it.
- V119 guard tests: add dedicated lookup and union abort tests so each of the six reference kinds (pipeline root,
  join, lookup, union, upsertsource target, form panel) has its own test, each proven red by mutation.
- Split `V119OwnerFkMigrationSpec` into a shared harness plus per-seam specs.
- No migration, no API, schema or frontend change. Behaviour-preserving (SQL parity evidence).

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `user-reference-integrity`: the V119 requirement's guard scenarios are stated per reference kind (lookup and union
  were covered by the requirement text but by no scenario).

## Impact

- Backend only: `DataSourceRepository.scala`, `RestSourceConnectorMigration.scala`, possibly callers that read
  `DataSourceRow.ownerId` (compile-driven), and tests (`V119*Spec`, `RestSourceConnectorMigrationSpec`).
- No production data touched; no deploy-time effect.

## Non-goals

- Changing V119 itself or adding a migration (V131 is reserved by #994).
- Touching `docs/user-reference-inventory.md` (modified by parked #994).
- Changing the `DataSource` domain ADT (`ownerId: UserId` already non-optional).
