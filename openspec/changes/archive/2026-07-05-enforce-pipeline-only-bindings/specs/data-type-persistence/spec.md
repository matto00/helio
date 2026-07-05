## ADDED Requirements

### Requirement: Companion DataTypes are internal source-schema records
A DataType with a non-null `source_id` (companion type, auto-created at source registration) SHALL serve
only as the source's schema record — feeding pipeline analyze, source preview computed fields, refresh
upserts, and source schema display. Companion types SHALL NOT be offered as panel binding targets; only
pipeline-output DataTypes (`source_id IS NULL`) are user-facing registry entries.

#### Scenario: Source registration still creates a companion type
- **WHEN** a data source is registered (CSV, static, REST, or SQL)
- **THEN** a companion DataType with `source_id = <source id>` is created carrying the inferred schema

#### Scenario: Companion types remain resolvable by source
- **WHEN** `DataTypeRepository.findBySourceId` is called for a registered source
- **THEN** the companion DataType is returned for analyze/preview/refresh consumers

### Requirement: One-time migration converts panel-bound companion types (V41)
A Flyway migration (V41) SHALL, for each DataType with `source_id IS NOT NULL` bound by at least one panel
(`panels.type_id`): create a zero-step pass-through pipeline from the companion's source to that DataType,
set the DataType's `source_id` to NULL, and insert a replacement companion DataType (new id, same
name/fields/computed_fields, `version = 1`, same `owner_id`) for the source. Panel bindings and
`data_type_rows` snapshots SHALL be left untouched. Companion types with no bound panels are unchanged.

#### Scenario: Bound companion type becomes a pipeline output
- **WHEN** V41 runs against a database where a panel binds a DataType with `source_id` set
- **THEN** that DataType afterwards has `source_id = NULL`, a pipeline exists with it as
  `output_data_type_id` and the original source as `source_data_source_id`, and the panel's `type_id` is
  unchanged

#### Scenario: Source retains exactly one companion type
- **WHEN** V41 converts a source's panel-bound companion type
- **THEN** a new companion DataType with the same schema exists for that source

#### Scenario: Unbound companion types are untouched
- **WHEN** V41 runs against a companion DataType with no bound panels
- **THEN** the row is unchanged
