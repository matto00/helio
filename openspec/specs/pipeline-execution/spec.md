# pipeline-execution Specification

## Purpose
Defines how a pipeline run derives its output DataType's schema from the rows it produced — key union across all rows, order-independent type widening, canonical field types, and the nullability rule panels and agents depend on when binding to that data.

## Requirements

### Requirement: Pipeline-output schema is derived from all output rows

A pipeline run SHALL derive its output DataType's schema from the complete set of rows the run produced, not from any single row.

#### Scenario: A column absent from the first row is present in the schema

- **GIVEN** a pipeline whose output rows are sparse maps
- **AND** the first output row does not contain the column `rec`
- **AND** at least one later output row does contain `rec`
- **WHEN** the run succeeds and the output DataType's schema is written
- **THEN** the schema's fields SHALL include `rec`
- **AND** `rec` SHALL be reported as a column by the panel-capabilities report for that DataType

#### Scenario: The schema does not depend on row order

- **GIVEN** two runs producing the same set of output rows in different orders
- **WHEN** each run's output DataType schema is derived
- **THEN** both schemas SHALL contain the same field names with the same types

### Requirement: Pipeline-output column types are widened across all rows

A column's inferred type SHALL be the widening of the types of every non-null value that column takes across all output rows.

#### Scenario: A column with a non-integral value anywhere is float

- **GIVEN** output rows where a column holds an integral value in the first row
- **AND** holds a non-integral value in a later row
- **WHEN** the output DataType's schema is derived
- **THEN** that column's type SHALL be `float`, not `integer`

### Requirement: An explicit null does not change a column's inferred type

A JSON null present in a column SHALL NOT contribute to that column's inferred type. A column holding numeric values on some rows and an explicit null on others SHALL infer as numeric.

#### Scenario: A numeric column containing an explicit null stays numeric

- **GIVEN** output rows where a column holds integral numbers on some rows
- **AND** holds an explicit JSON null on another row
- **WHEN** the output DataType's schema is derived
- **THEN** that column's type SHALL be `integer`, not `string`
- **AND** that column SHALL remain eligible for a numeric panel slot

#### Scenario: A column that is null on every row infers as string

- **GIVEN** output rows where a column holds an explicit JSON null on every row
- **WHEN** the output DataType's schema is derived
- **THEN** that column's type SHALL be `string`

### Requirement: Pipeline-output schemas use only canonical field types

Every field written to a pipeline-output DataType SHALL carry one of the canonical `DataFieldType` wire values. The inference path SHALL NOT emit a type string outside that set.

#### Scenario: A fractional column is bindable

- **GIVEN** a pipeline whose first output row holds a non-integral value for a column
- **WHEN** the run succeeds and the output DataType's schema is written
- **THEN** that column's type SHALL be `float`
- **AND** the panel-capabilities report SHALL include that column rather than omitting it as an unrecognised type

### Requirement: Pipeline-output fields are nullable

Every field of a pipeline-output DataType SHALL be marked nullable, because output rows are sparse and any column may be absent from any row.

#### Scenario: A column present on every row is still nullable

- **GIVEN** output rows in which a column is present and non-null on every row
- **WHEN** the output DataType's schema is derived
- **THEN** that column SHALL still be marked nullable
