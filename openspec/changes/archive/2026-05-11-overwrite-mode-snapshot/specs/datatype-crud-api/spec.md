## ADDED Requirements

### Requirement: GET /api/data-types/:id/rows returns the current row snapshot
The backend SHALL expose `GET /api/data-types/:id/rows` returning the most recent pipeline-run snapshot for the specified DataType as `{ rows: [...], rowCount: N }`. Rows SHALL be returned in ascending `row_index` order. If no snapshot exists the response SHALL be `{ rows: [], rowCount: 0 }`. If the DataType id is unknown the response SHALL be 404.

#### Scenario: Returns rows in index order
- **WHEN** a snapshot with 3 rows exists and `GET /api/data-types/:id/rows` is called
- **THEN** the response is `200 OK` with exactly those 3 rows in insertion order

#### Scenario: Empty snapshot returns rowCount 0
- **WHEN** `GET /api/data-types/:id/rows` is called for a DataType with no stored rows
- **THEN** the response is `200 OK` with `{ rows: [], rowCount: 0 }`

#### Scenario: Unknown DataType returns 404
- **WHEN** `GET /api/data-types/:id/rows` is called with an id that does not match any DataType
- **THEN** the response is `404 Not Found`
