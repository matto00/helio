## ADDED Requirements

### Requirement: SQL source type is accepted in data_sources
The `source_type` column in the `data_sources` table SHALL accept the value `"sql"` in addition
to the existing `rest_api`, `csv`, and `static` values.

#### Scenario: SQL source type is accepted
- **WHEN** a `DataSource` with `source_type = "sql"` is inserted via `DataSourceRepository.insert`
- **THEN** `DataSourceRepository.findById` returns the record with `source_type = "sql"`
