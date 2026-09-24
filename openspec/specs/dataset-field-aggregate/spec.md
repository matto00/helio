# dataset-field-aggregate Specification

## Purpose
Defines a read-only endpoint that returns a `dataset`-kind source's current, server-computed
aggregate for one declared field, so a writing panel can reconcile an optimistic value against real
persisted state without waiting on any downstream pipeline.

## Requirements

### Requirement: A dataset's field aggregate is available via a dedicated read endpoint

The system SHALL expose `GET /api/data-sources/:id/rows/aggregate?field=<sourceField>&op=sum` for a
`dataset`-kind source, returning `200` with the requested field's aggregate computed over every row
currently stored for that source (`{"field": "<sourceField>", "op": "sum", "value": <number>}`). Only
`op=sum` is supported at this time; an unsupported `op` value SHALL be rejected with `400`. The
aggregate SHALL be computed fresh on every request — it is never cached or pre-materialized — so the
response always reflects every row committed before the request was received, including rows written
by other users.

#### Scenario: Aggregate reflects every persisted row
- **WHEN** a dataset source has three rows with a `delta` of `1`, `2`, and `3` for the same field
- **THEN** `GET .../rows/aggregate?field=delta&op=sum` returns `{"field": "delta", "op": "sum",
  "value": 6}`

#### Scenario: Aggregate reflects a write from a different user
- **WHEN** a second user with write access appends a row to a shared dataset after the first user's
  last read
- **THEN** the first user's next aggregate request includes that row's contribution

#### Scenario: Unsupported operation is rejected
- **WHEN** the request names an `op` other than `sum`
- **THEN** the response is `400` and no aggregate is computed

#### Scenario: Non-numeric field is rejected
- **WHEN** the requested `field` is declared with a non-numeric type
- **THEN** the response is `400` naming the field as non-aggregable

### Requirement: The aggregate endpoint enforces the same ownership rule as every other dataset row route

`GET /api/data-sources/:id/rows/aggregate` SHALL return `404 Not Found` when the source does not exist
or is not owned by (or shared with, for a caller who is not the owner but has been granted access to
a dashboard using it) the requesting caller — the identical ACL check `GET .../rows` already applies,
never a privileged/system-context query. `400 Bad Request` SHALL be returned when the source is not a
`dataset`-kind source, or when `field` does not name a field the source declares.

#### Scenario: Non-owner cannot read another user's aggregate
- **WHEN** a user who does not own or have access to a dataset source requests its field aggregate
- **THEN** the response is `404 Not Found`

#### Scenario: Non-dataset source is rejected
- **WHEN** the endpoint is called for a `csv`-kind source
- **THEN** the response is `400 Bad Request`

#### Scenario: Undeclared field is rejected
- **WHEN** the `field` query parameter does not match any field the source declares
- **THEN** the response is `400 Bad Request` naming the field as undeclared
