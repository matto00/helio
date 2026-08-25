# datatype-row-snapshot Specification

## Purpose
TBD - created by archiving change overwrite-mode-snapshot. Update Purpose after archive.
## Requirements
### Requirement: DataType row snapshot is persisted after a successful non-dry run
The backend SHALL atomically replace all rows in `data_type_rows` for the output DataType with the new
pipeline output after a successful non-dry pipeline run, UNLESS the run is blocked by an error-severity
assertion failure (see `pipeline-assert-fail-policy`), in which case `data_type_rows` SHALL be left
completely unchanged — the previously-persisted snapshot remains the current one. When the replacement
does occur, it SHALL be atomic: the DELETE and bulk INSERT SHALL execute within a single database
transaction so that the old snapshot survives if the INSERT fails.

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

#### Scenario: Run blocked by an error-severity assertion does not modify snapshot
- **WHEN** a non-dry run's `assert` step has an error-severity rule that fails
- **THEN** `data_type_rows` for the output DataType is byte-for-byte unchanged from before the run —
  neither deleted nor replaced

### Requirement: Stored snapshot rows are retrievable via GET /api/data-types/:id/rows
The backend SHALL expose `GET /api/data-types/:id/rows` returning the current snapshot as `{ rows: [...], rowCount: N }` where each element is the JSONB row object. If no snapshot exists the response SHALL be `{ rows: [], rowCount: 0 }`. This SHALL hold regardless of the magnitude of any numeric field stored in a row — a numeric value whose plain-decimal expansion is well beyond spray-json's default 100-character parser limit (e.g. a value near the maximum representable `double precision`, ~309 digits) SHALL round-trip to the exact same value it was written with, not throw a parse error and not silently truncate or corrupt the value.

#### Scenario: Returns stored rows
- **WHEN** a successful run has previously stored rows for a DataType and `GET /api/data-types/:id/rows` is called
- **THEN** the response is `200 OK` with `{ rows: [...], rowCount: N }` matching the stored snapshot

#### Scenario: Returns empty for DataType with no snapshot
- **WHEN** `GET /api/data-types/:id/rows` is called for a DataType that has never had a run
- **THEN** the response is `200 OK` with `{ rows: [], rowCount: 0 }`

#### Scenario: Returns 404 for unknown DataType
- **WHEN** `GET /api/data-types/:id/rows` is called with a DataType id that does not exist
- **THEN** the response is `404 Not Found`

#### Scenario: Large-magnitude numeric value round-trips exactly
- **WHEN** a row containing a numeric value whose Postgres `jsonb::text` plain-decimal expansion exceeds 100 characters (e.g. a value near `1.7976931348623157e308`) has been stored via `overwriteRows`
- **THEN** `listRows`/`GET /api/data-types/:id/rows` returns that row with the numeric value exactly equal to the value originally written, with no exception thrown

#### Scenario: Negative large-magnitude numeric value round-trips exactly
- **WHEN** a row containing a negative numeric value whose plain-decimal expansion exceeds 100 characters has been stored
- **THEN** it is returned with the exact same negative value, sign preserved

#### Scenario: High-precision decimal value round-trips exactly
- **WHEN** a row containing a numeric value with many significant decimal digits (not merely a large integer part) has been stored
- **THEN** it is returned with full precision preserved, no rounding or truncation

#### Scenario: Small-magnitude value with a long fractional expansion round-trips exactly
- **WHEN** a row containing a numeric value whose magnitude is small but whose plain-decimal expansion is long on the fraction side (many leading zeros after the decimal point, e.g. a value near `5e-324`) has been stored
- **THEN** it is returned with the exact same value, proving the fix is not scoped only to large-integer-part values (Postgres `jsonb` numerics are arbitrary-precision, not bounded by `double precision`)

#### Scenario: Ordinary small numeric value continues to round-trip unchanged
- **WHEN** a row containing an ordinary small numeric value (well under the character-length boundary) has been stored
- **THEN** it continues to round-trip exactly as before this change, proving the fix does not change behavior for the common case

