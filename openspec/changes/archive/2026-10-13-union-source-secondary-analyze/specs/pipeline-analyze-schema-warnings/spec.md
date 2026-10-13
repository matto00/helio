## MODIFIED Requirements

### Requirement: Missing referenced field warns
For an enabled step with no `validationError`, the system SHALL emit one `field-not-in-input-schema` warning per distinct input field name the step's config references that is not present in that step's projected input schema, for every step kind whose analyze validation does not already report that reference as an unknown-field `validationError`. A reference the step kind treats as "no field" (an empty value, or a documented wildcard) SHALL NOT warn. No such warning SHALL be emitted when the step's projected input is not known to be name-complete: an input is not name-complete when it derives (through any parent or lane input) from a root with an empty source schema, from a `join` or `union` whose secondary input schema could not be resolved, from a step with a `validationError`, or from a step whose output column names depend on the data and are not projected (such as `pivot`); a step whose output column names are wholly determined by its own config (aggregate, groupby) without a `validationError` restores name-completeness for its descendants. The message SHALL state that the field was not found in the step's inferred input schema (not that it does not exist), and SHALL list the available field names (bounded in length).

#### Scenario: Aggregate over a missing column
- **WHEN** an aggregate step `count(amount)` follows a step whose projected output is `(category, total)`
- **THEN** analyze returns a `field-not-in-input-schema` warning for the aggregate step naming `amount` and the available fields `category, total`
- **AND** the aggregate step's `validationError` is absent

#### Scenario: Reference already reported as an error does not also warn
- **WHEN** a step kind already reports an unknown field as its `validationError`
- **THEN** no `field-not-in-input-schema` warning is emitted for that step

#### Scenario: Reference to a column from an unresolved union secondary does not warn
- **WHEN** a `union` whose secondary input is a source whose schema analyze does not resolve is followed by a step referencing a column only that source carries
- **THEN** no `field-not-in-input-schema` warning is emitted for that step

#### Scenario: A union with a resolved source secondary is name-complete
- **WHEN** a `union` whose `source`-kind secondary's inferred schema resolves is followed by a step referencing one column only that source carries and one column neither input carries
- **THEN** no warning is emitted for the source-only column, and a `field-not-in-input-schema` warning is emitted for the column neither input carries

#### Scenario: Reference under an unresolvable join secondary does not warn
- **WHEN** a `join` whose source secondary input has no resolvable schema is followed by a step referencing a right-side column
- **THEN** no `field-not-in-input-schema` warning is emitted for that step

#### Scenario: Reference under an empty root schema does not warn
- **WHEN** a root with an empty source schema feeds a column-adding step followed by a step referencing a source column
- **THEN** no `field-not-in-input-schema` warning is emitted for that step

#### Scenario: Reference to a pivoted column does not warn
- **WHEN** a `pivot` step is followed by a step referencing a column the pivot produces from the data (e.g. `sales_2024`)
- **THEN** no `field-not-in-input-schema` warning is emitted for that step

#### Scenario: Disabled step does not warn
- **WHEN** a step referencing a missing field is disabled
- **THEN** no warning is emitted for it
