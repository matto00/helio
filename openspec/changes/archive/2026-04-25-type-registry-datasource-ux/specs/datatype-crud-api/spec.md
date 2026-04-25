## ADDED Requirements

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
