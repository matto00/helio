## ADDED Requirements

### Requirement: Dashboard and panel data persists across restarts
The backend SHALL store dashboard and panel data in PostgreSQL so that all data survives a backend restart.

#### Scenario: Data survives restart
- **WHEN** dashboards and panels exist and the backend is restarted
- **THEN** all dashboards and panels are available after restart with their original data intact

### Requirement: Schema managed by Flyway
The backend SHALL apply database migrations automatically on startup using Flyway.

#### Scenario: Fresh database is initialised
- **WHEN** the backend starts against a database with no schema
- **THEN** Flyway applies all pending migrations before accepting requests

### Requirement: Demo data seeds on empty database only
The backend SHALL seed demo dashboards and panels when the database is empty on startup.

#### Scenario: Empty database receives seed data
- **WHEN** the backend starts and the dashboards table is empty
- **THEN** demo dashboards and panels are inserted

#### Scenario: Non-empty database is not reseeded
- **WHEN** the backend starts and the dashboards table has at least one row
- **THEN** no demo data is inserted

### Requirement: Repository layer isolates all database access
The backend SHALL route all dashboard and panel reads and writes through repository classes, with no direct database access in route handlers or other layers.

#### Scenario: Dashboard created via repository
- **WHEN** a POST /api/dashboards request is handled
- **THEN** the new dashboard is written to PostgreSQL via DashboardRepository and the persisted record is returned

#### Scenario: Panel created via repository
- **WHEN** a POST /api/panels request is handled
- **THEN** the new panel is written to PostgreSQL via PanelRepository and the persisted record is returned
