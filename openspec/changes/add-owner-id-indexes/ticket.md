# HEL-130 — Add missing database indexes on owner_id and foreign key columns

## Description

Every query that filters by `owner_id` (dashboards, data_sources, data_types) currently does a full table scan because no index exists on those columns. Similarly, `panels.type_id` and `user_sessions.expires_at` are used in frequent queries with no index.

## Tasks

* Add a new Flyway migration `V17__add_owner_indexes.sql` with:

```sql
CREATE INDEX idx_dashboards_owner_id   ON dashboards(owner_id);
CREATE INDEX idx_data_sources_owner_id ON data_sources(owner_id);
CREATE INDEX idx_data_types_owner_id   ON data_types(owner_id);
CREATE INDEX idx_panels_type_id        ON panels(type_id);
CREATE INDEX idx_user_sessions_expires_at ON user_sessions(expires_at);
```

## Context

* `dashboards.owner_id` — filtered in `DashboardRepository.scala` line 55
* `data_sources.owner_id` — filtered in `DataSourceRepository.scala` line 40
* `data_types.owner_id` — filtered in `DataTypeRepository.scala` line 47
* `panels.type_id` — used by `DataTypeRepository.isBoundToAnyPanel()` (raw SQL, full scan)
* `user_sessions.expires_at` — filtered alongside `token` in `UserSessionRepository.scala` line 25

No code changes required — migration only.

## Acceptance Criteria

* A new Flyway migration file `V17__add_owner_indexes.sql` exists in `backend/src/main/resources/db/migration/`
* The migration contains all five CREATE INDEX statements listed above
* The backend compiles and existing tests pass
