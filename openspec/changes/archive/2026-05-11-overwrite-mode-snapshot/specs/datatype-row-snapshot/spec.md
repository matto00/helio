## ADDED Requirements

### Requirement: DataType row snapshot is persisted after a successful non-dry run
After a successful non-dry pipeline run the backend SHALL atomically replace all rows in `data_type_rows` for the output DataType with the new pipeline output. The replacement SHALL be atomic: the DELETE and bulk INSERT SHALL execute within a single database transaction so that the old snapshot survives if the INSERT fails.

#### Scenario: First run populates snapshot
- **WHEN** `POST /api/pipelines/:id/run` succeeds and no prior snapshot exists
- **THEN** `data_type_rows` contains exactly the pipeline output rows for the DataType, indexed 0..N-1

#### Scenario: Second run replaces snapshot
- **WHEN** a second successful non-dry run produces different rows than the first
- **THEN** `data_type_rows` contains only the new rows; previous rows are gone

#### Scenario: Run producing zero rows clears snapshot
- **WHEN** a non-dry run succeeds but produces 0 rows
- **THEN** all rows in `data_type_rows` for that DataType are deleted and no new rows are inserted

#### Scenario: Dry run does not modify snapshot
- **WHEN** `POST /api/pipelines/:id/run?dry=true` is called successfully
- **THEN** `data_type_rows` for the DataType is unchanged

### Requirement: Stored snapshot rows are retrievable via GET /api/data-types/:id/rows
The backend SHALL expose `GET /api/data-types/:id/rows` returning the current snapshot as `{ rows: [...], rowCount: N }` where each element is the JSONB row object. If no snapshot exists the response SHALL be `{ rows: [], rowCount: 0 }`.

#### Scenario: Returns stored rows
- **WHEN** a successful run has previously stored rows for a DataType and `GET /api/data-types/:id/rows` is called
- **THEN** the response is `200 OK` with `{ rows: [...], rowCount: N }` matching the stored snapshot

#### Scenario: Returns empty for DataType with no snapshot
- **WHEN** `GET /api/data-types/:id/rows` is called for a DataType that has never had a run
- **THEN** the response is `200 OK` with `{ rows: [], rowCount: 0 }`

#### Scenario: Returns 404 for unknown DataType
- **WHEN** `GET /api/data-types/:id/rows` is called with a DataType id that does not exist
- **THEN** the response is `404 Not Found`
