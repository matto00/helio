## ADDED Requirements

### Requirement: GET /api/data-sources returns only the authenticated user's sources
The system SHALL filter `GET /api/data-sources` results to only include data sources owned by the
authenticated user. Data sources owned by other users SHALL NOT appear in the response.

#### Scenario: User sees only their own sources
- **WHEN** two users each have created data sources and user A calls `GET /api/data-sources`
- **THEN** only user A's sources are returned in `items`

#### Scenario: Empty list when user has no sources
- **WHEN** an authenticated user has created no data sources
- **THEN** `GET /api/data-sources` returns `{"items": []}`

### Requirement: GET /api/data-sources/:id enforces ownership
`GET /api/data-sources/:id` SHALL return `404 Not Found` when the data source does not exist or is owned
by a different user than the requester.

#### Scenario: Owner retrieves their source
- **WHEN** the owner calls `GET /api/data-sources/:id`
- **THEN** the response is `200 OK` with the source

#### Scenario: Non-owner receives 404
- **WHEN** a user calls `GET /api/data-sources/:id` for a source owned by another user
- **THEN** the response is `404 Not Found`

### Requirement: DELETE /api/data-sources/:id enforces ownership
`DELETE /api/data-sources/:id` SHALL return `403 Forbidden` when the source exists but is owned by a
different user. It SHALL return `404 Not Found` when the source does not exist.

#### Scenario: Owner can delete their source
- **WHEN** the owner calls `DELETE /api/data-sources/:id`
- **THEN** the source is deleted and the response is `204 No Content`

#### Scenario: Non-owner cannot delete another user's source
- **WHEN** a non-owner calls `DELETE /api/data-sources/:id` for a source owned by another user
- **THEN** the response is `403 Forbidden`

### Requirement: POST /api/data-sources sets owner_id from the authenticated user
When a data source is created via `POST /api/data-sources`, the `owner_id` SHALL be set to the
authenticated user's ID.

#### Scenario: Created source is owned by the creating user
- **WHEN** user A calls `POST /api/data-sources`
- **THEN** the created source's `owner_id` equals user A's ID
- **THEN** `GET /api/data-sources` for user A includes the new source
- **THEN** `GET /api/data-sources` for user B does not include the new source

### Requirement: /api/data-sources/:id/preview and /refresh enforce ownership
`GET /api/data-sources/:id/preview` and `POST /api/data-sources/:id/refresh` SHALL enforce ownership
in the same manner as `DELETE` — `403 Forbidden` for a source owned by another user, `404` if not found.

#### Scenario: Owner can preview their source
- **WHEN** the owner calls `GET /api/data-sources/:id/preview`
- **THEN** the response is `200 OK` with preview data

#### Scenario: Non-owner is denied preview
- **WHEN** a non-owner calls `GET /api/data-sources/:id/preview`
- **THEN** the response is `403 Forbidden`
