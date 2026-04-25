## Purpose
API contract for DataType and DataSource CRUD operations exposed by the backend.
## Requirements
### Requirement: List all DataTypes
The backend SHALL expose `GET /api/types` returning all registered DataTypes as a JSON array sorted by `created_at` descending.

#### Scenario: Empty registry returns empty list
- **WHEN** `GET /api/types` is called with no registered types
- **THEN** the response is 200 with `{ "items": [] }`

#### Scenario: Returns all registered types
- **WHEN** one or more DataTypes exist
- **THEN** the response is 200 with all types in the `items` array

### Requirement: Get single DataType
The backend SHALL expose `GET /api/types/:id` returning the full DataType including all fields.

#### Scenario: Found
- **WHEN** `GET /api/types/:id` is called with a valid id
- **THEN** the response is 200 with the full DataType object

#### Scenario: Not found
- **WHEN** `GET /api/types/:id` is called with an unknown id
- **THEN** the response is 404

### Requirement: Update DataType
The backend SHALL expose `PATCH /api/types/:id` accepting an optional `name` and optional `fields` array. Both `name` and `fields` SHALL be updated if provided; version SHALL be incremented on every successful update.

#### Scenario: Name updated
- **WHEN** `PATCH /api/types/:id` is called with `{ "name": "New Name" }`
- **THEN** the response is 200 with the updated DataType and incremented version

#### Scenario: Not found returns 404
- **WHEN** `PATCH /api/types/:id` is called with an unknown id
- **THEN** the response is 404

### Requirement: Delete DataType
The backend SHALL expose `DELETE /api/types/:id`. If no panel is bound to the type, the type SHALL be deleted and 204 returned. If one or more panels are bound, the delete SHALL be rejected with 409.

#### Scenario: Delete unbound type
- **WHEN** `DELETE /api/types/:id` is called for a type with no bound panels
- **THEN** the response is 204 and the type no longer exists

#### Scenario: Delete bound type returns 409
- **WHEN** `DELETE /api/types/:id` is called for a type that has at least one panel bound to it
- **THEN** the response is 409 with a descriptive error message

#### Scenario: Not found returns 404
- **WHEN** `DELETE /api/types/:id` is called with an unknown id
- **THEN** the response is 404

### Requirement: List all DataSources
The backend SHALL expose `GET /api/data-sources` returning all registered DataSources as a JSON array sorted by `created_at` descending.

#### Scenario: Returns all sources
- **WHEN** `GET /api/data-sources` is called
- **THEN** the response is 200 with a `{ "items": [] }` envelope

### Requirement: Rename DataSource via PATCH
The backend SHALL expose `PATCH /api/data-sources/:id` accepting an optional `name` field. If provided and non-empty, the DataSource name SHALL be updated. The endpoint SHALL be ACL-guarded (owner-only). The updated DataSource object SHALL be returned with 200.

#### Scenario: Rename succeeds
- **WHEN** PATCH /api/data-sources/:id is called with `{ "name": "New Name" }`
- **THEN** the response is 200 with the updated DataSource reflecting the new name

#### Scenario: Not found returns 404
- **WHEN** PATCH /api/data-sources/:id is called with an unknown id
- **THEN** the response is 404

#### Scenario: Empty name is rejected
- **WHEN** PATCH /api/data-sources/:id is called with `{ "name": "" }`
- **THEN** the response is 400 with a descriptive error message

