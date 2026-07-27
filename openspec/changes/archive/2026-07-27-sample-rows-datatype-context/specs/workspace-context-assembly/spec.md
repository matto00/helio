## ADDED Requirements

### Requirement: Bounded sample rows per pipeline-output DataType
Each `dataTypes[]` entry SHALL carry a `sampleRows` field: up to 5 rows read from the DataType's latest
pipeline-run snapshot, each row limited to the first 40 of the DataType's declared *Structured-category*
columns (in field order) — `Content`-category columns (`string-body`/`binary-ref`, HEL-217) SHALL be
excluded from `sampleRows` entirely — with any remaining cell value exceeding 200 characters truncated. A
DataType with no run snapshot, or a source-companion DataType (never written to the snapshot), SHALL
report `sampleRows: []`, never an error.

#### Scenario: Pipeline-output DataType with a run snapshot reports sample rows
- **GIVEN** a pipeline-output DataType whose producing pipeline has run successfully and written more
  than 5 rows to its snapshot
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `dataTypes[].sampleRows` contains exactly 5 rows, drawn from the snapshot in
  row order

#### Scenario: DataType with no run snapshot reports an empty array
- **GIVEN** a pipeline-output DataType whose pipeline has never run successfully
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `dataTypes[].sampleRows` is `[]`

#### Scenario: Source-companion DataType reports an empty array without a row query
- **GIVEN** a source-companion DataType (`sourceId` present)
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `dataTypes[].sampleRows` is `[]`

### Requirement: Sample-row size caps enforced by construction
Sample rows SHALL be bounded independently of workspace or DataType size: at most 5 rows (bounded at the
database query via `LIMIT`), at most the first 40 declared Structured-category columns per row, and at
most 200 characters per cell value (oversized values truncated to a `"…[truncated]"`-suffixed string),
regardless of how many rows, columns, or how large any individual stored value actually is. Content-
category column values SHALL be excluded from the database query itself (not fetched then discarded), so
that a Content field's stored size never affects the cost of assembling `sampleRows`.

#### Scenario: Oversized cell value is truncated
- **GIVEN** a DataType snapshot row containing a string value longer than 200 characters in a
  Structured-category column
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** the corresponding `sampleRows[].<column>` value is truncated to at most 200 characters plus
  the `"…[truncated]"` marker

#### Scenario: Wide DataType caps sample-row columns
- **GIVEN** a DataType with more than 40 declared Structured-category fields
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** each entry in the corresponding `dataTypes[].sampleRows` contains keys for at most the first
  40 of that DataType's declared Structured-category fields, in field order

#### Scenario: Content-category field value never appears in sample rows
- **GIVEN** a pipeline-output DataType with a `string-body` (or `binary-ref`) column whose stored value
  exceeds 200 characters
- **WHEN** `GET /api/workspace/context` is called by that DataType's owner
- **THEN** no entry in the corresponding `dataTypes[].sampleRows` contains a key for that column

### Requirement: Sample rows are owner-scoped
Sample rows SHALL only be readable by the DataType's owner, via the same ownership check
(`findByIdOwned`) the existing `GET /api/types/:id/rows` endpoint already performs — no new code path
bypasses this check.

#### Scenario: A caller never sees another user's sample rows
- **GIVEN** user A owns a pipeline-output DataType with a run snapshot, and user B owns a distinct
  pipeline-output DataType with its own run snapshot
- **WHEN** user B calls `GET /api/workspace/context`
- **THEN** the response's `dataTypes[]` entries contain only user B's own sample rows, never user A's
