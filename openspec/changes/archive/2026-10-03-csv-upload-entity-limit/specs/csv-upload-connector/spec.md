## ADDED Requirements

### Requirement: CSV uploads are bounded by byte, row and cell limits
The CSV upload routes (`POST /api/data-sources/infer`, `POST /api/data-sources` multipart) SHALL accept request bodies up to the CSV byte limit plus multipart overhead, and SHALL reject a CSV exceeding the byte limit, the row limit, or the cell limit with 413 and an `ErrorResponse` whose message names the limits. No such request SHALL produce a 500. The default limits are 15 MiB, 50,000 rows and 300,000 cells (rows x columns); this deliberately narrows the ticket's "up to 50 MiB succeeds" acceptance criterion to "up to 15 MiB AND within 50,000 rows / 300,000 cells", because the run path holds the whole file in memory and larger files exhaust a 1 GiB instance (see design.md measurements). The limits SHALL also be enforced on URL import, refresh, and when a stored CSV is previewed, run or used by the first-run builder, failing with the same clear error instead of exhausting memory.

#### Scenario: Upload between 8 MiB and the byte limit succeeds
- **WHEN** a CSV of 12 MiB within the row and cell limits is uploaded to infer and then create
- **THEN** both return success

#### Scenario: Upload over the byte limit returns 413
- **WHEN** a CSV larger than the byte limit plus margin is uploaded
- **THEN** the response is 413 with an `ErrorResponse` naming the byte limit

#### Scenario: Upload over the row or cell limit returns 413
- **WHEN** a CSV within the byte limit but over the row or cell limit is uploaded, imported by URL, or refreshed
- **THEN** the response is 413 naming the row and cell limits

#### Scenario: Stored oversize CSV fails clearly at run time
- **WHEN** a pipeline run, preview or first-run build reads a stored CSV over the limits
- **THEN** it fails with the limits error and does not exhaust memory

### Requirement: The CSV limits are exposed by the backend
`GET /api/data-sources/csv-limits` SHALL return `{maxBytes, maxRows, maxCells}` for an authenticated caller and clients SHALL derive their pre-checks from it.

#### Scenario: Limits endpoint
- **WHEN** an authenticated user calls `GET /api/data-sources/csv-limits`
- **THEN** the response is 200 with the three limits

### Requirement: Concurrent CSV uploads are capped
The backend SHALL bound concurrent CSV upload requests per instance and respond 429 with `Retry-After` when the cap is reached.

#### Scenario: Cap reached
- **WHEN** more CSV uploads are in flight than the cap
- **THEN** the extra request receives 429 with a `Retry-After` header

### Requirement: Schema inference and preview read only a head prefix
Schema inference and row preview SHALL NOT materialize every line of the file.

#### Scenario: Large file inference
- **WHEN** inference runs on a file within the limits
- **THEN** only the sampled head lines are split
