## MODIFIED Requirements

### Requirement: Create alert rule
The backend SHALL expose `POST /api/alert-rules` accepting `{ targetOutputId, metric, condition,
severity, enabled, name }`. The created rule SHALL round-trip through a subsequent fetch unchanged,
including arbitrary/unknown keys inside `condition`.

#### Scenario: Successful create
- **WHEN** `POST /api/alert-rules` is called with a valid body targeting an Output the caller
  can access (owner or pipeline grantee)
- **THEN** the response is 201 with the created rule, and a subsequent `GET` of that rule returns
  the same `targetOutputId`, `metric`, `condition` (including any extra keys), `severity`,
  `enabled`, and `name`

#### Scenario: Absent optional fields normalize at the boundary
- **WHEN** `POST /api/alert-rules` is called with `enabled` omitted from the request body
- **THEN** the service normalizes the absent field to its default rather than erroring, since
  spray-json omits `None` options on the wire

#### Scenario: Non-existent target DataType is rejected
- **WHEN** `POST /api/alert-rules` is called with a `targetOutputId` that does not exist
- **THEN** the response is 404 or 422

#### Scenario: Non-owned target DataType is rejected
- **WHEN** `POST /api/alert-rules` is called with a `targetOutputId` the caller has no
  ownership or grant on
- **THEN** the response is 404 or 422
