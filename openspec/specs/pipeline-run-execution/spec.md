# pipeline-run-execution Specification

## Purpose
TBD - created by archiving change pipeline-step-execution. Update Purpose after archive.
## Requirements
### Requirement: POST /api/pipelines/:id/run executes steps and returns a result
The backend SHALL expose `POST /api/pipelines/:id/run` that fetches the pipeline's steps ordered
ascending by `position`, applies each step in sequence to an in-memory row set loaded from the
pipeline's source DataSource, and returns the result. For non-dry runs the response SHALL be
`200 OK` with `{ rows: [...], rowCount: N }`. `pipelines.last_run_status` SHALL be set to
`"succeeded"` and `pipelines.last_run_at` SHALL be set to the current timestamp on success.
On step execution failure the response SHALL be `422 Unprocessable Entity` with an error message,
and `last_run_status` SHALL be set to `"failed"`.

#### Scenario: Run with no steps returns source rows unchanged
- **WHEN** `POST /api/pipelines/:id/run` is called on a pipeline that has no steps
- **THEN** the response is `200 OK` with all source rows returned and `last_run_status` is `"succeeded"`

#### Scenario: Run with multiple steps applies them in position order
- **WHEN** `POST /api/pipelines/:id/run` is called on a pipeline with steps at positions 0, 1, 2
- **THEN** the response is `200 OK` with rows that reflect the cumulative output of all three steps applied in order

#### Scenario: Run with an invalid step expression returns 422
- **WHEN** a filter step contains an invalid expression and `POST /api/pipelines/:id/run` is called
- **THEN** the response is `422 Unprocessable Entity` and `last_run_status` is `"failed"`

#### Scenario: Returns 404 for unknown pipeline
- **WHEN** `POST /api/pipelines/:id/run` is called with a pipeline id that does not exist
- **THEN** the response is `404 Not Found`

### Requirement: POST /api/pipelines/:id/run?dry=true returns preview rows without side effects
When the `dry=true` query parameter is present the backend SHALL execute all pipeline steps against
the source data but SHALL NOT write results to the Type Registry and SHALL NOT update
`last_run_status` or `last_run_at`. The response SHALL be `200 OK` with
`{ rows: [...], rowCount: N }`.

#### Scenario: Dry run returns rows without updating last_run_status
- **WHEN** `POST /api/pipelines/:id/run?dry=true` is called
- **THEN** the response is `200 OK` with rows and `last_run_status` in the database remains unchanged

#### Scenario: Dry run does not write to the Type Registry
- **WHEN** `POST /api/pipelines/:id/run?dry=true` is called successfully
- **THEN** the output DataType's `fields` and `version` are unchanged after the call

### Requirement: Rename step renames one or more columns
The execution engine SHALL support the `rename` op. The step config SHALL contain a `mappings`
array of `{ from, to }` objects. Each mapping renames the `from` column to the `to` name in all
subsequent rows.

#### Scenario: Rename a single column
- **WHEN** a rename step with `mappings: [{ from: "a", to: "b" }]` is applied to rows that have column `a`
- **THEN** the result rows have column `b` with the same values, and column `a` is absent

### Requirement: Filter step removes rows not matching an expression
The execution engine SHALL support the `filter` op. The step config SHALL contain an `expression`
string (SQL-style boolean expression). Rows for which the expression evaluates to false SHALL be
excluded from the result.

#### Scenario: Filter keeps only matching rows
- **WHEN** a filter step with `expression: "age > 30"` is applied to rows where some rows have age ≤ 30
- **THEN** only rows with age > 30 are present in the result

### Requirement: Compute step adds or replaces a column with an expression value
The execution engine SHALL support the `compute` op. The config SHALL contain `column` (name of
column to write) and `expression` (SQL-style expression). The result SHALL contain the new or
updated column alongside all existing columns.

#### Scenario: Compute adds a derived column
- **WHEN** a compute step with `column: "total"` and `expression: "price * qty"` is applied
- **THEN** the result rows contain a `total` column equal to `price * qty` for each row

### Requirement: Group & aggregate step groups rows and applies an aggregation
The execution engine SHALL support the `groupby` op. The config SHALL contain `groupBy` (array of
column names), `aggColumn` (column to aggregate), and `aggFunction` (`"sum"` or `"count"`). The
result SHALL contain one row per unique group with the group key columns and an aggregated value
column named `<aggFunction>_<aggColumn>`.

#### Scenario: Groupby sum produces one row per group
- **WHEN** a groupby step with `groupBy: ["category"]`, `aggColumn: "amount"`, `aggFunction: "sum"` is applied
- **THEN** the result contains one row per unique `category` value with a `sum_amount` column

### Requirement: Cast step changes the data type of a column
The execution engine SHALL support the `cast` op. The config SHALL contain `column` (name) and
`dataType` (`"string"`, `"integer"`, `"long"`, `"double"`, `"boolean"`). Values SHALL be coerced
to the target type; rows where coercion fails SHALL use `null`.

#### Scenario: Cast string column to integer
- **WHEN** a cast step with `column: "qty"` and `dataType: "integer"` is applied to rows with string values like `"5"`
- **THEN** the result rows have `qty` as integer values

### Requirement: Join step merges two data sources on a key column
The execution engine SHALL support the `join` op with inner and left join semantics. The config
SHALL contain `rightDataSourceId` (id of the right-hand DataSource), `joinKey` (column present in
both sources), and `joinType` (`"inner"` or `"left"`). The result SHALL contain all columns from
both sources (right-side duplicate key column excluded).

#### Scenario: Inner join returns only matching rows
- **WHEN** a join step with `joinType: "inner"` is applied and some left-side rows have no match in the right source
- **THEN** only rows with a matching `joinKey` in both sources appear in the result

#### Scenario: Left join retains all left rows
- **WHEN** a join step with `joinType: "left"` is applied and some left-side rows have no match
- **THEN** all left-side rows appear in the result with null values for right-side columns where no match exists

### Requirement: Successful non-dry run writes schema snapshot to Type Registry
After a successful non-dry run the backend SHALL update the output DataType record
(`pipelines.output_data_type_id`) with the inferred field schema derived from the result row keys.
All inferred field types SHALL default to `"string"`. The DataType's `version` SHALL be incremented.

#### Scenario: Output DataType fields reflect run result schema
- **WHEN** `POST /api/pipelines/:id/run` succeeds and the result has columns `["name", "total"]`
- **THEN** the output DataType's `fields` contain entries for `name` and `total` with `dataType: "string"`

#### Scenario: Output DataType version increments after run
- **WHEN** a non-dry run completes successfully
- **THEN** the output DataType's `version` is one higher than before the run

### Requirement: Select step retains only specified columns during pipeline execution
The execution engine SHALL support the `select` op during pipeline runs. The step config SHALL
contain a `fields` array of column name strings. The engine SHALL retain only those columns in each
row and drop all others. Field names absent from a row SHALL be silently omitted.

#### Scenario: Select op applied during a pipeline run
- **WHEN** `POST /api/pipelines/:id/run` is called and the pipeline has a select step with `fields: ["id", "name"]`
- **THEN** the response rows contain only `id` and `name`; all other columns are absent

#### Scenario: Select with unknown field name does not error
- **WHEN** a select step references a field not present in any row and `POST /api/pipelines/:id/run` is called
- **THEN** the response is `200 OK` and the unknown field is silently absent from all result rows

