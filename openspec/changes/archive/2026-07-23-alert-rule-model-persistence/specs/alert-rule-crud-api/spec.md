## ADDED Requirements

### Requirement: List alert rules
The backend SHALL expose `GET /api/alert-rules` returning the authenticated user's alert rules as
`{ "items": [...] }`.

#### Scenario: Empty list
- **WHEN** `GET /api/alert-rules` is called and the user has no rules
- **THEN** the response is 200 with `{ "items": [] }`

#### Scenario: Returns only the caller's rules
- **WHEN** `GET /api/alert-rules` is called and rules exist for the caller and for other users
- **THEN** the response includes only rules owned by the calling user

### Requirement: Create alert rule
The backend SHALL expose `POST /api/alert-rules` accepting `{ targetDataTypeId, metric, condition,
severity, enabled, name }`. The created rule SHALL round-trip through a subsequent fetch unchanged,
including arbitrary/unknown keys inside `condition`.

#### Scenario: Successful create
- **WHEN** `POST /api/alert-rules` is called with a valid body targeting a DataType the caller owns
- **THEN** the response is 201 with the created rule, and a subsequent `GET` of that rule returns
  the same `targetDataTypeId`, `metric`, `condition` (including any extra keys), `severity`,
  `enabled`, and `name`

#### Scenario: Absent optional fields normalize at the boundary
- **WHEN** `POST /api/alert-rules` is called with `enabled` omitted from the request body
- **THEN** the service normalizes the absent field to its default rather than erroring, since
  spray-json omits `None` options on the wire

#### Scenario: Non-existent target DataType is rejected
- **WHEN** `POST /api/alert-rules` is called with a `targetDataTypeId` that does not exist
- **THEN** the response is 404 or 422

#### Scenario: Non-owned target DataType is rejected
- **WHEN** `POST /api/alert-rules` is called with a `targetDataTypeId` owned by a different user
- **THEN** the response is 404 or 422

### Requirement: Get single alert rule
The backend SHALL expose `GET /api/alert-rules/:id` returning the full rule if owned by the caller.

#### Scenario: Found and owned
- **WHEN** `GET /api/alert-rules/:id` is called for a rule owned by the caller
- **THEN** the response is 200 with the full rule

#### Scenario: Not found
- **WHEN** `GET /api/alert-rules/:id` is called with an unknown id
- **THEN** the response is 404

#### Scenario: Owned by another user
- **WHEN** `GET /api/alert-rules/:id` is called for a rule owned by a different user
- **THEN** the response is 403 or 404 (not the rule contents)

### Requirement: Update alert rule
The backend SHALL expose `PATCH /api/alert-rules/:id` accepting any subset of `{ metric,
condition, severity, enabled, name }` and applying only the provided fields, owner-scoped.

#### Scenario: Partial update applies only provided fields
- **WHEN** `PATCH /api/alert-rules/:id` is called with `{ "enabled": false }`
- **THEN** the response is 200 with `enabled: false` and all other fields unchanged

#### Scenario: Update on non-owned rule is rejected
- **WHEN** `PATCH /api/alert-rules/:id` is called for a rule owned by a different user
- **THEN** the response is 403 or 404 and no mutation occurs

#### Scenario: Not found
- **WHEN** `PATCH /api/alert-rules/:id` is called with an unknown id
- **THEN** the response is 404

### Requirement: Delete alert rule
The backend SHALL expose `DELETE /api/alert-rules/:id`, owner-scoped.

#### Scenario: Successful delete
- **WHEN** `DELETE /api/alert-rules/:id` is called for a rule owned by the caller
- **THEN** the response is 204 and the rule no longer exists

#### Scenario: Delete on non-owned rule is rejected
- **WHEN** `DELETE /api/alert-rules/:id` is called for a rule owned by a different user
- **THEN** the response is 403 or 404 and the rule is not deleted

#### Scenario: Not found
- **WHEN** `DELETE /api/alert-rules/:id` is called with an unknown id
- **THEN** the response is 404
