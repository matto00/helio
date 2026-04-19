## ADDED Requirements

### Requirement: Dashboards and panels have an owner
Every dashboard and panel SHALL have an `owner_id` column (FK → `users.id`) that is non-nullable. The value is set at creation time from the authenticated user's ID and never changed thereafter.

#### Scenario: Dashboard creation sets owner_id
- **WHEN** an authenticated user sends `POST /api/dashboards`
- **THEN** the new dashboard row in the database has `owner_id` equal to the authenticated user's ID

#### Scenario: Panel creation sets owner_id
- **WHEN** an authenticated user sends `POST /api/panels`
- **THEN** the new panel row in the database has `owner_id` equal to the authenticated user's ID

### Requirement: GET /api/dashboards returns only the caller's dashboards
`GET /api/dashboards` SHALL return only dashboards whose `owner_id` matches the authenticated user's ID. Dashboards owned by other users SHALL NOT appear in the response.

#### Scenario: User sees only their dashboards
- **WHEN** user A and user B each own at least one dashboard and user A sends `GET /api/dashboards`
- **THEN** the response includes only user A's dashboards
- **AND** user B's dashboards are absent from the response

#### Scenario: User with no dashboards receives empty list
- **WHEN** an authenticated user who owns no dashboards sends `GET /api/dashboards`
- **THEN** the response is `200 OK` with `{"items": []}`

### Requirement: Cross-user resource access returns 403
Any request that targets a specific dashboard or panel owned by a different user SHALL be rejected with `403 Forbidden`. This applies to GET by ID (panels via dashboard), PATCH, DELETE, duplicate, and export endpoints.

#### Scenario: PATCH another user's dashboard returns 403
- **WHEN** user A sends `PATCH /api/dashboards/:id` where the dashboard is owned by user B
- **THEN** the server responds with `403 Forbidden`
- **AND** the response body is `{"error": "Forbidden"}`

#### Scenario: DELETE another user's dashboard returns 403
- **WHEN** user A sends `DELETE /api/dashboards/:id` where the dashboard is owned by user B
- **THEN** the server responds with `403 Forbidden`

#### Scenario: GET panels for another user's dashboard returns 403
- **WHEN** user A sends `GET /api/dashboards/:id/panels` where the dashboard is owned by user B
- **THEN** the server responds with `403 Forbidden`

#### Scenario: PATCH another user's panel returns 403
- **WHEN** user A sends `PATCH /api/panels/:id` where the panel is owned by user B
- **THEN** the server responds with `403 Forbidden`

#### Scenario: DELETE another user's panel returns 403
- **WHEN** user A sends `DELETE /api/panels/:id` where the panel is owned by user B
- **THEN** the server responds with `403 Forbidden`

#### Scenario: Duplicate another user's dashboard returns 403
- **WHEN** user A sends `POST /api/dashboards/:id/duplicate` where the dashboard is owned by user B
- **THEN** the server responds with `403 Forbidden`

#### Scenario: Export another user's dashboard returns 403
- **WHEN** user A sends `GET /api/dashboards/:id/export` where the dashboard is owned by user B
- **THEN** the server responds with `403 Forbidden`

### Requirement: Duplicated and imported resources are owned by the caller
When a dashboard (and its panels) are duplicated or imported, the resulting copies SHALL have `owner_id` set to the authenticated user performing the operation, not the original owner.

#### Scenario: Duplicate sets new owner
- **WHEN** user A duplicates their own dashboard
- **THEN** the new dashboard and all copied panels have `owner_id` equal to user A's ID

#### Scenario: Import sets owner to caller
- **WHEN** user A imports a dashboard snapshot
- **THEN** the created dashboard and panels have `owner_id` equal to user A's ID

### Requirement: Existing resources are assigned to the system user on migration
The Flyway migration that adds `owner_id` SHALL insert a system user (fixed UUID `00000000-0000-0000-0000-000000000001`) and backfill all existing dashboard and panel rows whose `owner_id` is NULL to that system user's ID.

#### Scenario: Pre-existing dashboards are assigned to system user after migration
- **WHEN** the database has dashboards with no owner before migration runs
- **THEN** after migration all those dashboards have `owner_id = '00000000-0000-0000-0000-000000000001'`

#### Scenario: Demo seed data is assigned to system user
- **WHEN** the backend seeds demo data against an empty database
- **THEN** all seeded dashboards and panels have `owner_id` equal to the system user's ID
