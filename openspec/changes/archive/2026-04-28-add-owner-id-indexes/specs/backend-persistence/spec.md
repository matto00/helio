## ADDED Requirements

### Requirement: Hot filter columns are indexed
The database SHALL have B-tree indexes on `dashboards.owner_id`, `data_sources.owner_id`, `data_types.owner_id`, `panels.type_id`, and `user_sessions.expires_at` so that queries filtering on these columns use index scans rather than full table scans.

#### Scenario: Indexes exist after migration
- **WHEN** the backend starts and Flyway applies V17 or later
- **THEN** indexes `idx_dashboards_owner_id`, `idx_data_sources_owner_id`, `idx_data_types_owner_id`, `idx_panels_type_id`, and `idx_user_sessions_expires_at` exist in the database

#### Scenario: Migration is idempotent via Flyway history
- **WHEN** the backend restarts after V17 has already been applied
- **THEN** Flyway skips V17 and the indexes remain intact
