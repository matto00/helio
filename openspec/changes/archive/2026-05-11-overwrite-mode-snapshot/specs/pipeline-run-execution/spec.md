## MODIFIED Requirements

### Requirement: Successful non-dry run writes schema snapshot to Type Registry
After a successful non-dry run the backend SHALL update the output DataType record (`pipelines.output_data_type_id`) with the inferred field schema derived from the result row keys. Field types SHALL be inferred from the actual runtime values in the first result row: `Boolean` values → `"boolean"`, integer/long values → `"integer"`, float/double values → `"double"`, all other values → `"string"`. The DataType's `version` SHALL be incremented.

#### Scenario: Output DataType fields reflect run result schema
- **WHEN** `POST /api/pipelines/:id/run` succeeds and the result has columns `["name", "total"]`
- **THEN** the output DataType's `fields` contain entries for `name` and `total` with `dataType: "string"`

#### Scenario: Output DataType version increments after run
- **WHEN** a non-dry run completes successfully
- **THEN** the output DataType's `version` is one higher than before the run

#### Scenario: Numeric column inferred as integer type
- **WHEN** a non-dry run produces rows where a column's first-row value is an Int or Long
- **THEN** the output DataType's field for that column has `dataType: "integer"`

#### Scenario: Floating-point column inferred as double type
- **WHEN** a non-dry run produces rows where a column's first-row value is a Float or Double
- **THEN** the output DataType's field for that column has `dataType: "double"`
