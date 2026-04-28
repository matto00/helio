## Why

Queries filtering by `owner_id` on dashboards, data_sources, and data_types tables — as well as queries on `panels.type_id` and `user_sessions.expires_at` — perform full table scans because no indexes exist on these columns. Adding indexes is a low-risk, zero-code-change performance improvement that becomes increasingly impactful as data volume grows.

## What Changes

- Add Flyway migration `V17__add_owner_indexes.sql` with five `CREATE INDEX` statements covering the hot filter columns identified in the repository layer.

## Capabilities

### New Capabilities

None — this is a database schema-only migration with no new API surface or behavior.

### Modified Capabilities

- `backend-persistence`: The persistence layer gains five new indexes on hot filter columns; query plans improve but observable behavior (API contracts, data shapes) is unchanged.

## Impact

- `backend/src/main/resources/db/migration/V17__add_owner_indexes.sql` — new file
- No Scala source changes required
- No frontend changes required
- No API contract changes

## Non-goals

- Query tuning beyond adding the five indexes called out in the ticket
- Composite indexes or partial indexes
- Analyzing or indexing any other columns
