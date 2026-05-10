# pipeline-filter-op Specification

## Purpose
TBD - created by archiving change pipeline-filter-rows. Update Purpose after archive.
## Requirements
### Requirement: applyFilter evaluates structured conditions with a combinator
`InProcessPipelineEngine.applyFilter` SHALL accept config shape
`{"combinator":"AND"|"OR","conditions":[...]}` and keep only rows that satisfy the conditions
according to the combinator. An empty `conditions` array SHALL pass all rows.

#### Scenario: Empty conditions array passes all rows
- **WHEN** filter config is `{"combinator":"AND","conditions":[]}`
- **THEN** all input rows are returned unchanged

#### Scenario: AND combinator requires all conditions to pass
- **WHEN** filter config has `"combinator":"AND"` with two conditions and a row satisfies only one
- **THEN** that row is excluded from the result

#### Scenario: OR combinator requires at least one condition to pass
- **WHEN** filter config has `"combinator":"OR"` with two conditions and a row satisfies only one
- **THEN** that row is included in the result

### Requirement: applyFilter supports equality and inequality operators
The filter step SHALL support operators `=` and `!=` for string and numeric equality checks.

#### Scenario: = operator keeps matching rows
- **WHEN** a condition is `{"field":"dept","operator":"=","value":"eng"}`
- **THEN** only rows where `dept` equals `"eng"` are returned

#### Scenario: != operator excludes matching rows
- **WHEN** a condition is `{"field":"dept","operator":"!=","value":"eng"}`
- **THEN** rows where `dept` equals `"eng"` are excluded

### Requirement: applyFilter supports numeric comparison operators
The filter step SHALL support operators `>`, `>=`, `<`, `<=`. The field value and condition
value SHALL both be coerced to Double for comparison. Coercion failure SHALL result in no-match.

#### Scenario: > operator keeps rows where field is greater
- **WHEN** a condition is `{"field":"age","operator":">","value":"25"}`
- **THEN** only rows where the numeric value of `age` is greater than 25 are returned

#### Scenario: >= operator keeps rows where field is greater or equal
- **WHEN** a condition is `{"field":"age","operator":">=","value":"25"}`
- **THEN** rows where `age` equals 25 are included

#### Scenario: < operator keeps rows where field is less
- **WHEN** a condition is `{"field":"age","operator":"<","value":"30"}`
- **THEN** only rows where the numeric value of `age` is less than 30 are returned

#### Scenario: <= operator keeps rows where field is less or equal
- **WHEN** a condition is `{"field":"age","operator":"<=","value":"30"}`
- **THEN** rows where `age` equals 30 are included

### Requirement: applyFilter supports contains operator for substring matching
The `contains` operator SHALL check whether the string representation of the field value
contains the condition value as a substring. The check SHALL be case-sensitive.

#### Scenario: contains keeps rows where field contains substring
- **WHEN** a condition is `{"field":"name","operator":"contains","value":"ali"}`
- **THEN** only rows where the string value of `name` contains `"ali"` are returned

### Requirement: applyFilter supports is null and is not null operators
The `is null` operator SHALL keep rows where the field is absent or null.
The `is not null` operator SHALL keep rows where the field is present and non-null.
These operators are unary — the `value` field in the condition is ignored.

#### Scenario: is null keeps rows with absent or null field
- **WHEN** a condition is `{"field":"score","operator":"is null"}` and some rows lack `score`
- **THEN** only those rows are returned

#### Scenario: is not null keeps rows with non-null field
- **WHEN** a condition is `{"field":"score","operator":"is not null"}` and some rows lack `score`
- **THEN** those rows are excluded

### Requirement: applyFilter treats missing fields as null
When a row does not contain a field referenced by a condition, that field's value SHALL be
treated as null for the purpose of evaluation.

#### Scenario: Missing field treated as null
- **WHEN** a condition is `{"field":"nonexistent","operator":"=","value":"x"}` and no row has that field
- **THEN** no rows are returned (null != "x")

### Requirement: PipelineAnalyzeService treats filter as identity
`PipelineAnalyzeService.inferOutputSchema` for `op="filter"` SHALL return the input schema
unchanged (filter does not add, remove, or rename fields).

#### Scenario: Filter step does not alter output schema
- **WHEN** `analyze` is called with a filter step
- **THEN** the step's `outputSchema` equals its `inputSchema`

