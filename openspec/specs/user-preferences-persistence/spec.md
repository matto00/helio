# user-preferences-persistence Specification

## Purpose
Database schema and repository for per-user preferences: global preferences (accent color) stored
as a TEXT/JSONB column on the `users` table, and per-dashboard zoom levels stored in a separate
`user_dashboard_zoom` join table.

## Requirements

### Requirement: user_preferences TEXT column on users table
The database SHALL have a nullable `preferences` TEXT column on the `users` table to store per-user
global preferences encoded as JSON (e.g. `accentColor`).

#### Scenario: Migration adds preferences column
- **WHEN** Flyway migration V18 runs on an existing database
- **THEN** the `users` table gains a nullable `preferences` TEXT column
- **AND** existing rows remain with NULL in the preferences column

#### Scenario: preferences column accepts null
- **WHEN** a new user row is inserted without a preferences value
- **THEN** the insert succeeds with NULL in the preferences column

### Requirement: user_dashboard_zoom table for per-dashboard zoom
The database SHALL have a `user_dashboard_zoom` table with columns `user_id` (UUID FK → users.id),
`dashboard_id` (UUID FK → dashboards.id), and `zoom_level` (DOUBLE PRECISION NOT NULL), with a
composite primary key of `(user_id, dashboard_id)`.

#### Scenario: Migration creates user_dashboard_zoom table
- **WHEN** Flyway migration V18 runs
- **THEN** the `user_dashboard_zoom` table exists with the correct schema and FK constraints

#### Scenario: Zoom level upsert
- **WHEN** a zoom level is written for a user/dashboard pair that already has a row
- **THEN** the existing row is updated with the new zoom_level (ON CONFLICT DO UPDATE)

#### Scenario: Zoom level insert
- **WHEN** a zoom level is written for a user/dashboard pair with no existing row
- **THEN** a new row is inserted with the given zoom_level

### Requirement: UserPreferenceRepository reads and writes preferences
The system SHALL have a `UserPreferenceRepository` class that exposes:
- `getPreferences(userId): Future[UserPreferencesData]` — returns `accentColor` (from TEXT column) and
  a map of `dashboardId → zoomLevel` (from `user_dashboard_zoom`).
- `upsertGlobalPrefs(userId, accentColor): Future[Unit]` — updates the preferences TEXT column on `users`.
- `upsertDashboardZoom(userId, dashboardId, zoomLevel): Future[Unit]` — upserts the join table.

#### Scenario: getPreferences returns defaults when no data exists
- **WHEN** `getPreferences` is called for a user with no saved preferences
- **THEN** it returns `accentColor = None` and an empty zoom map

#### Scenario: upsertGlobalPrefs persists accent color
- **WHEN** `upsertGlobalPrefs(userId, "#3b82f6")` is called
- **THEN** the `users.preferences` column is updated to contain `{ "accentColor": "#3b82f6" }`

#### Scenario: upsertDashboardZoom persists zoom level
- **WHEN** `upsertDashboardZoom(userId, dashboardId, 1.25)` is called
- **THEN** the corresponding row in `user_dashboard_zoom` has zoom_level = 1.25

### Requirement: GET /api/auth/me returns preferences
The `GET /api/auth/me` response SHALL include a `preferences` field on the user object containing
`accentColor: Option[String]` and `zoomLevels: Map[String, Double]` (keys are dashboard IDs as strings).

#### Scenario: Authenticated user with saved preferences gets them on /me
- **WHEN** a client sends `GET /api/auth/me` with a valid session token
- **AND** the user has a saved `accentColor` and at least one dashboard zoom level
- **THEN** the response body contains `user.preferences.accentColor` and `user.preferences.zoomLevels`

#### Scenario: Authenticated user with no preferences gets empty object
- **WHEN** a client sends `GET /api/auth/me` and no preferences have been saved
- **THEN** the response body contains `user.preferences` with `accentColor: null` and `zoomLevels: {}`
