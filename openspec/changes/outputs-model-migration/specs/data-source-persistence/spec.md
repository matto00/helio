## ADDED Requirements

### Requirement: DataSource carries an inferred schema
The system SHALL persist `data_sources.inferred_schema JSONB`, written by
`upsertInferredSchema`, and expose it on the `DataSource` domain model as
`inferredSchema: Vector[SchemaField]`.

#### Scenario: Companion-type schema migrates onto its source
- **WHEN** the outputs-model migration runs
- **THEN** every source's companion-type field schema is copied into that
  source's `inferred_schema`, and the companion type row is deleted

#### Scenario: Refreshing a source updates its inferred schema in place
- **WHEN** a source is refreshed (CSV, SQL, or REST) and its shape changes
- **THEN** `upsertInferredSchema` overwrites `inferred_schema` with the newly
  inferred fields, with no separate companion-type record created
