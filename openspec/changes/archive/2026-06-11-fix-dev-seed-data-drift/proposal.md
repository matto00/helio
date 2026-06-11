## Why

The local dev DB has drifted from what `DemoData` seeding expects: six pre-V15 DataType rows carry `owner_id IS NULL`, and ProfitAgg's output DataType is owned by a non-matt user, both of which silently scrub panel-to-DataType bindings and cause the ProfitAgg pipeline to return 422 on run-submit. This blocks the natural Playwright reproduction path for any P0/P1 investigation in the Panel ↔ DataType ↔ Pipeline surface.

## What Changes

- **DemoData.scala** is updated so that all seeded DataTypes and DataSources are re-owned by the first registered user on startup, ensuring the seed always agrees with the ACL model regardless of when `owner_id` columns were introduced.
- A one-shot **dev-DB repair SQL script** (`backend/scripts/repair-dev-db.sql`) backfills all `owner_id IS NULL` DataType rows to matt's user ID and corrects ProfitAgg's output DataType owner; intended for existing installations whose DB pre-dates V15.
- **`backend/README.md`** gains a "Dev DB repair" section documenting the repair script and the DemoData re-seeding procedure.

## Capabilities

### New Capabilities

- `dev-db-repair`: One-shot SQL repair script + documentation for fixing NULL-owner DataType rows and wrong-owner ProfitAgg output in an existing dev DB.

### Modified Capabilities

- `backend-persistence`: DemoData seed logic change — seeded rows now always assign `owner_id` to the first registered user rather than leaving it unset.

## Impact

- `backend/src/main/scala/com/helio/api/DemoData.scala` — ownership assignment at seed time
- `backend/scripts/repair-dev-db.sql` — new file (dev-only; not run by Flyway)
- `backend/README.md` — dev DB repair documentation

## Non-goals

- Production data migration
- ACL enforcement changes on `GET /api/types/:id/rows` or `PATCH /api/panels/:id`
- Any change to existing Flyway migration files (V14/V15 are historical)
