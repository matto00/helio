# alert-rule-crud-api Specification

## Purpose
REST CRUD contract for alert rule definitions (`/api/alert-rules`), including request/response
shapes, owner-scoping and authorization behavior, and validation of the target DataType.

## Requirements

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
The backend SHALL expose `POST /api/alert-rules` accepting `{ targetOutputId, metric, condition,
severity, enabled, name }`. The created rule SHALL round-trip through a subsequent fetch unchanged,
including arbitrary/unknown keys inside `condition`, except that `baseline`, `n` and `mode` are reserved
condition keys validated per "Baseline condition validation" (a malformed use is rejected with `400`).

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

### Requirement: Baseline condition validation
`POST /api/alert-rules` and `PATCH /api/alert-rules/:id` SHALL reject with `400` a `condition` that carries a
`baseline` key (including `"baseline": null`) unless: `baseline` is `"previous"` or `"rolling_avg"`; `mode` is present and is `"abs"` or `"pct"`;
for `rolling_avg`, `n` is an integer from 1 to 100; for `previous`, `n` is absent. A `condition` without `baseline`
that carries `n` or `mode` SHALL also be rejected with `400`, since those keys would otherwise be silently ignored.
The existing `comparator`/`threshold` validation applies unchanged, and other unknown keys still pass through.

#### Scenario: Unknown baseline kind
- **WHEN** a rule is created with `condition = { baseline: "median", mode: "abs", comparator: "gt", threshold: 1 }`
- **THEN** the response is `400` and no rule is stored

#### Scenario: rolling_avg without a valid n
- **WHEN** a rule is created or updated with `baseline: "rolling_avg"` and `n` missing, `0`, `101`, `2.5` or a string
- **THEN** the response is `400`

#### Scenario: Well-formed baseline condition round-trips
- **WHEN** a rule is created with `condition = { baseline: "rolling_avg", n: 5, mode: "pct", comparator: "lt",
  threshold: -20 }`
- **THEN** the response is `201` and the stored condition round-trips unchanged
