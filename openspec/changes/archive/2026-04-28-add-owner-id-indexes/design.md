## Context

The Helio backend uses Flyway for schema migrations (`backend/src/main/resources/db/migration/`). Migrations are applied automatically on startup in version order. The next available version is V17. All five target columns (`dashboards.owner_id`, `data_sources.owner_id`, `data_types.owner_id`, `panels.type_id`, `user_sessions.expires_at`) exist in the schema but have no indexes today.

## Goals / Non-Goals

**Goals:**
- Add five B-tree indexes to eliminate full table scans on the hot filter columns
- Deliver as a single Flyway migration with zero Scala/frontend code changes

**Non-Goals:**
- Composite or partial indexes
- Analyzing query plans or adding EXPLAIN annotations
- Any other table or column

## Decisions

**Single migration file:** All five indexes go into one file `V17__add_owner_indexes.sql`. They are independent and small; splitting serves no purpose.

**Standard B-tree indexes:** PostgreSQL defaults to B-tree for `CREATE INDEX`, which is optimal for equality and range filters on the target columns. No `USING` clause is needed.

**`CREATE INDEX` (not `CREATE INDEX IF NOT EXISTS`):** Flyway tracks which migrations have already run via `flyway_schema_history`; idempotency guards at the SQL level are unnecessary and would mask accidental re-application.

**No `CONCURRENTLY`:** The migration runs at startup before the server accepts traffic, so table locking during index creation is not a concern in any deployment scenario.

## Risks / Trade-offs

- [Risk] Migration takes longer on a large production table → Mitigation: indexes are on integer/UUID columns and will be fast even at tens of millions of rows; operator can schedule a maintenance window if needed.
- [Risk] Index name collision if a previous manual index was created → Mitigation: standard Flyway failure behavior (startup refuses) will surface the conflict immediately.

## Migration Plan

1. Add `V17__add_owner_indexes.sql` to `backend/src/main/resources/db/migration/`.
2. On next backend startup Flyway applies V17 automatically.
3. Rollback: drop the five indexes manually if needed (no data is altered).

## Planner Notes

Self-approved: pure infrastructure migration, no API or behavior changes. No ESCALATION required.
