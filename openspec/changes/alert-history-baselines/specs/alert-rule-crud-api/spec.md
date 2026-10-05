## ADDED Requirements

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

## MODIFIED Requirements

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
