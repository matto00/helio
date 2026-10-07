## Why

`ProductEventRollupServiceSpec` "V114 backfilled history / roll up in ONE tick" fails about 0.78% of runs with
`403 was not equal to 402` (spec line 85). The ticket's original time-of-day diagnosis is refuted (see ticket.md).
The real cause is a fixture-identity collision. The spec tells its ~400 backfill users apart from every other user
by the email pattern `bf%@t.local`. The shared harness gives its own users `<random UUID>@t.local` emails, so a
harness UUID that starts with `bf` (1/256 per user, two users) is miscounted as a backfill user, and the fixture
cleanup also deletes it.

## What Changes

- The backfill fixture users get an email form that no harness or UUID-shaped email can match. The `otherUsers`
  count and the `withHistoricalUsers` cleanup both select on that form.
- A permanent decoy user with a `bf`-prefixed, harness-shaped email (`bf<uuid>@t.local`) is part of the fixture.
  Every run exercises the collision deterministically instead of 0.78% of runs.
- No expected value or assertion tolerance changes. `400 + otherUsers` stays an exact equality.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This is a test-fixture-only change with no product behavior change (`skip_specs: true`).

## Impact

- `backend/src/test/scala/com/helio/services/telemetry/ProductEventRollupServiceSpec.scala` only.
- No production code, migration, schema or API change. V114 is untouched (Flyway checksums it).

## Non-goals

- Pinning any clock. The clock in this test is already pinned and is not the cause.
- Changing `ProductTelemetryDbHarness`'s random-UUID user generation. Other specs rely on it, and the defect is the
  spec's ambiguous selector, not the randomness.
