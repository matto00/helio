# chart-preview-row-limit Specification

## Purpose
TBD - created by archiving change chart-preview-row-limit. Update Purpose after archive.
## Requirements
### Requirement: Preview endpoint accepts optional row limit
The `GET /api/data-sources/:id/preview` endpoint SHALL accept an optional `?limit=N` query
parameter (integer, 1–500 inclusive). When provided, the endpoint SHALL return at most N
rows of CSV data. When omitted, the default of 10 rows SHALL apply. Values outside the
1–500 range SHALL be clamped to the nearest bound (1 or 500) rather than rejected with an
error.

#### Scenario: limit param returns requested row count
- **WHEN** `GET /api/data-sources/:id/preview?limit=200` is called for a CSV source with
  more than 200 rows
- **THEN** the response contains exactly 200 rows

#### Scenario: default limit is 10 when param omitted
- **WHEN** `GET /api/data-sources/:id/preview` is called without a `limit` param
- **THEN** the response contains at most 10 rows (existing behaviour)

#### Scenario: limit capped at 500
- **WHEN** `GET /api/data-sources/:id/preview?limit=9999` is called
- **THEN** the response contains at most 500 rows

#### Scenario: limit=1 returns a single row
- **WHEN** `GET /api/data-sources/:id/preview?limit=1` is called for a source with data
- **THEN** the response contains exactly 1 row

#### Scenario: static data source ignores limit param
- **WHEN** `GET /api/data-sources/:id/preview?limit=200` is called for a static data source
- **THEN** the response returns all rows defined in the source config (limit is not applied)

#### Scenario: large CSV does not time out at limit=500
- **WHEN** `GET /api/data-sources/:id/preview?limit=500` is called for a CSV source with
  thousands of rows
- **THEN** the response is returned without timeout or memory error

