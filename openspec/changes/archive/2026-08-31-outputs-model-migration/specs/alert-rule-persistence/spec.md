## MODIFIED Requirements

### Requirement: AlertRule domain model and schema
The system SHALL define an `AlertRule` domain model with `id: AlertRuleId`, `ownerId: UserId`,
`targetOutputId: OutputId`, `metric: String`, `condition: JsValue`, `name: String`,
`enabled: Boolean`, `severity` (one of `info`/`warning`/`critical`), `createdAt`, and `updatedAt`.
A Flyway migration SHALL alter the `alert_rules` table's target column from
`target_data_type_id` to `target_output_id TEXT NOT NULL REFERENCES outputs(id) ON DELETE
CASCADE`, preserving the `condition` column's `jsonb` type and the owner FK to `users(id)`.

#### Scenario: Migration creates the table
- **WHEN** Flyway applies the alert-rules migration to a fresh database
- **THEN** an `alert_rules` table exists with columns for owner, target output, metric,
  jsonb condition, name, enabled, severity, created_at, and updated_at

#### Scenario: Migration retargets the table
- **WHEN** the outputs-model migration runs against a database with existing `alert_rules` rows
- **THEN** every rule's `target_output_id` resolves to the lowest-position Output on the node the
  rule's prior `target_data_type_id` migrated to, and the `target_data_type_id` column no longer
  exists

#### Scenario: condition persists arbitrary jsonb
- **WHEN** a rule is inserted with `condition = { "comparator": "gt", "threshold": 5, "window": "1h" }`
- **THEN** the stored `condition` value round-trips unchanged, including unknown/extra keys added
  by future condition kinds
