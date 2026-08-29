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
The filter step SHALL support operators `=` and `!=`.

When the row's value for the referenced field is a numeric value and the condition value parses as a
number, the comparison SHALL be numeric, so that a stored number matches any condition value denoting
the same number regardless of how either side is textually written (`0`, `0.0`, `00`, `0e0`).

When the row's value is not numeric — including a string that happens to look like a number — the
comparison SHALL be an exact string comparison of the row value's textual form against the condition
value. A string-typed row value SHALL NOT be numerically coerced.

When the condition value does not parse as a number, the comparison SHALL be an exact string
comparison, whatever the row value's type.

A null (or absent) row value SHALL never satisfy `=`, and SHALL always satisfy `!=`, for any condition
value. `!=` SHALL be the exact negation of `=` for every non-null row value.

#### Scenario: = operator keeps matching rows
- **WHEN** a condition is `{"field":"dept","operator":"=","value":"eng"}`
- **THEN** only rows where `dept` equals `"eng"` are returned

#### Scenario: != operator excludes matching rows
- **WHEN** a condition is `{"field":"dept","operator":"!=","value":"eng"}`
- **THEN** rows where `dept` equals `"eng"` are excluded

#### Scenario: = matches a numeric row value written differently in the condition
- **WHEN** a row's `years_exp` is the number `0` and a condition is `{"field":"years_exp","operator":"=","value":"0"}`
- **THEN** that row is returned

#### Scenario: = still matches when the condition value carries a decimal point
- **WHEN** a row's `years_exp` is the number `0` and a condition is `{"field":"years_exp","operator":"=","value":"0.0"}`
- **THEN** that row is returned

#### Scenario: = does not match a different number
- **WHEN** a row's `years_exp` is the number `3` and a condition is `{"field":"years_exp","operator":"=","value":"0"}`
- **THEN** that row is excluded

#### Scenario: = on a non-numeric string column keeps string semantics
- **WHEN** a row's `position` is the string `"WR"` and a condition is `{"field":"position","operator":"=","value":"WR"}`
- **THEN** that row is returned

#### Scenario: A numeric-looking string column is compared as a string, not a number
- **WHEN** a row's `player_id` is the string `"007"` and a condition is `{"field":"player_id","operator":"=","value":"7"}`
- **THEN** that row is excluded

#### Scenario: A numeric-looking string column still matches its exact textual value
- **WHEN** a row's `player_id` is the string `"007"` and a condition is `{"field":"player_id","operator":"=","value":"007"}`
- **THEN** that row is returned

#### Scenario: A non-numeric condition value against a numeric row value does not match
- **WHEN** a row's `years_exp` is the number `0` and a condition is `{"field":"years_exp","operator":"=","value":"zero"}`
- **THEN** that row is excluded

#### Scenario: != excludes rows the numeric comparison matches
- **WHEN** a row's `years_exp` is the number `0` and a condition is `{"field":"years_exp","operator":"!=","value":"0"}`
- **THEN** that row is excluded

#### Scenario: != keeps rows whose numeric value differs
- **WHEN** a row's `years_exp` is the number `3` and a condition is `{"field":"years_exp","operator":"!=","value":"0"}`
- **THEN** that row is returned

#### Scenario: A null row value never satisfies =
- **WHEN** a row's `years_exp` is null or absent and a condition is `{"field":"years_exp","operator":"=","value":"0"}`
- **THEN** that row is excluded

#### Scenario: A null row value always satisfies !=
- **WHEN** a row's `years_exp` is null or absent and a condition is `{"field":"years_exp","operator":"!=","value":"0"}`
- **THEN** that row is returned

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
contains the condition value as a substring. The check SHALL be case-sensitive. `contains` is a
textual operator by definition and SHALL NOT numerically coerce either side; a numeric row value is
matched against its textual form.

#### Scenario: contains keeps rows where field contains substring
- **WHEN** a condition is `{"field":"name","operator":"contains","value":"ali"}`
- **THEN** only rows where the string value of `name` contains `"ali"` are returned

#### Scenario: contains is not numerically coerced
- **WHEN** a row's `years_exp` is the number `10` and a condition is `{"field":"years_exp","operator":"contains","value":"1"}`
- **THEN** that row is returned, because the textual form contains `"1"`

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
