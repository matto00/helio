## ADDED Requirements

### Requirement: A run's HTTP response stays within the per-run share without changing its content

A response that carries a run result (`POST /api/pipelines/:id/run`, with or without `dry=true`,
`POST /api/pipelines/apply-proposal` and `POST /api/proposals/apply`) SHALL be written incrementally, so the response
body is never held as one fully rendered text. The heap a manual run holds, measured from before the run until the
last byte of its response is written, SHALL stay at or under the 192 MB per-run share on the certified shapes,
including the 200-row long-text shape and a row of exactly the maximum rendered row width. The response body SHALL be
byte-for-byte the compact JSON the endpoint returned before this change: the same fields, rows, counts and status.

#### Scenario: Long-text run response stays within the share
- **WHEN** a real or dry manual run of the 200-row long-text shape succeeds and its response is fully written
- **THEN** the measured heap peak over the run and the response write is at or under 192 MB

#### Scenario: Widest allowed row stays within the share
- **WHEN** a manual run whose finished row renders to exactly the maximum rendered row width succeeds and its response
  is fully written
- **THEN** the measured heap peak over the run and the response write is at or under 192 MB

#### Scenario: Response content is unchanged
- **WHEN** any of the listed endpoints succeeds
- **THEN** the body parses to the same JSON value, and is the same bytes, as the compact rendering of the response
  object, with `rows` holding every terminal row and `rowCount` its size
- **AND** the body is sent as a chunked stream rather than as one buffered entity
