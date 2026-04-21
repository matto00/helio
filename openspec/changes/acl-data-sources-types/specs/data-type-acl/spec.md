## ADDED Requirements

### Requirement: GET /api/types returns only the authenticated user's data types
`GET /api/types` SHALL filter results to only include data types owned by the authenticated user.

#### Scenario: User sees only their own types
- **WHEN** two users each have created data types and user A calls `GET /api/types`
- **THEN** only user A's types are returned in `items`

#### Scenario: Empty list when user has no types
- **WHEN** an authenticated user has created no data types
- **THEN** `GET /api/types` returns `{"items": []}`

### Requirement: GET /api/types/:id enforces ownership
`GET /api/types/:id` SHALL return `404 Not Found` when the type does not exist or belongs to another user.

#### Scenario: Owner retrieves their type
- **WHEN** the owner calls `GET /api/types/:id`
- **THEN** the response is `200 OK` with the data type

#### Scenario: Non-owner receives 404
- **WHEN** a non-owner calls `GET /api/types/:id`
- **THEN** the response is `404 Not Found`

### Requirement: PATCH /api/types/:id enforces ownership
`PATCH /api/types/:id` SHALL return `403 Forbidden` when the type exists but belongs to another user.

#### Scenario: Owner can patch their type
- **WHEN** the owner calls `PATCH /api/types/:id`
- **THEN** the update is applied and the updated type is returned

#### Scenario: Non-owner cannot patch another user's type
- **WHEN** a non-owner calls `PATCH /api/types/:id`
- **THEN** the response is `403 Forbidden`

### Requirement: DELETE /api/types/:id enforces ownership
`DELETE /api/types/:id` SHALL return `403 Forbidden` when the type exists but is owned by another user.

#### Scenario: Owner can delete their unbound type
- **WHEN** the owner calls `DELETE /api/types/:id` for a type not bound to any panel
- **THEN** the type is deleted and the response is `204 No Content`

#### Scenario: Non-owner cannot delete another user's type
- **WHEN** a non-owner calls `DELETE /api/types/:id`
- **THEN** the response is `403 Forbidden`

### Requirement: POST /api/data-sources sets owner_id on the created DataType
When a `DataType` is created as part of `POST /api/data-sources`, the `owner_id` SHALL be set to the
same authenticated user's ID that owns the parent `DataSource`.

#### Scenario: DataType created via data-source upload is owned by the uploader
- **WHEN** user A uploads a CSV via `POST /api/data-sources`
- **THEN** the created `DataType` has `owner_id` equal to user A's ID
- **THEN** `GET /api/types` for user B does not include that type

### Requirement: Panels with a cross-user type binding are treated as unbound on read
When a panel's `typeId` refers to a `DataType` owned by a different user, the panel SHALL be returned
with `typeId = null` in the API response (treated as unbound). No error is raised.

#### Scenario: Cross-user type binding reads as unbound
- **WHEN** a panel has `typeId` pointing to a type owned by another user
- **THEN** the panel response includes `typeId: null`
- **THEN** no error is returned

#### Scenario: Same-user type binding reads normally
- **WHEN** a panel has `typeId` pointing to a type owned by the same user
- **THEN** the panel response includes the correct `typeId` value
