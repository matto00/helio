## Why

`ProductEventRollupServiceSpec`'s V114 tests anchor the fixture to a hard-coded day (2026-10-03) but compute their
expected signup count from every row of `users` (`400 + otherUsers`). A `users` row whose `created_at` comes from the
wall clock after the fixture pin is counted as expected, while the rollup tick (`tickAt(2026-10-03T12:00Z)`) can never
see a signup dated after 2026-10-03. The spec is green today only because no such row exists. A probe with three
`newUser()` rows inside the body fails `404 was not equal to 407` on 2026-10-08 and would pass before 2026-10-03.
The ticket's observed `403 vs 402` sighting was a different defect, already fixed by HEL-1360 (see ticket.md).

## What Changes

- `withHistoricalUsers` captures the roster of non-backfill users it pins (exact ids, taken at pin time) and the V114
  tests' expected counts become `400 + roster.size`, with raw signup-row counts scoped to roster + backfill users.
  No whole-table `users` count remains in an expected value.
- A permanent "late user" guard: one non-backfill user created after the pin with a literal `created_at` after
  2026-10-03. It is the wall-clock hazard made deterministic: every run exercises it, independent of today's date.
  Reverting the roster scoping makes the spec fail on every run.
- No expected value is loosened; equalities stay exact.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Test-fixture-only change with no product behavior change (`skip_specs: true`).

## Impact

- `backend/src/test/scala/com/helio/services/telemetry/ProductEventRollupServiceSpec.scala` only.
- No production code, migration, harness or schema change. V114 untouched (Flyway checksums it).

## Non-goals

- Re-fixing the `bf`-prefix collision (HEL-1360, merged).
- Changing `ProductTelemetryDbHarness` (`newUser()`'s `now()`, random UUIDs): shared by other specs; the defect is
  this spec's whole-table expectation.
- Injecting a clock into the service: it already takes an injected `Clock` and every `tickAt` instant is literal.
