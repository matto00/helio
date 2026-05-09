# pipeline-select-op Specification

## Purpose
TBD - created by archiving change select-fields-op. Update Purpose after archive.
## Requirements
### Requirement: Select op retains only specified fields from each row
The execution engine SHALL support the `select` op. The step config SHALL contain a `fields` array
of column name strings. For each row, only the columns whose names appear in `fields` SHALL be
present in the output. Columns not in `fields` SHALL be dropped. If a field name in `fields` does
not exist in a row, it SHALL be silently omitted (no error).

#### Scenario: Select a subset of fields
- **WHEN** a select step with `fields: ["id", "name"]` is applied to rows that have columns `id`, `name`, and `value`
- **THEN** the result rows contain only `id` and `name`; `value` is absent from every row

#### Scenario: Field not present in row is ignored
- **WHEN** a select step with `fields: ["id", "missing_col"]` is applied to rows that only have `id`
- **THEN** the result rows contain only `id`; no error is raised

#### Scenario: Select all fields is a no-op
- **WHEN** a select step with `fields: ["a", "b", "c"]` is applied to rows that have exactly `a`, `b`, `c`
- **THEN** the result rows are identical to the input rows

#### Scenario: Select with empty fields list produces empty rows
- **WHEN** a select step with `fields: []` is applied to any rows
- **THEN** each output row is an empty map (`{}`)

### Requirement: Frontend select op renders a field checklist in the step-card config UI
When a pipeline step has `op: "select"` and the step card is expanded, the frontend SHALL render a
checklist of available column names derived from the analyze endpoint's `inputSchema` for that step.
Each checkbox SHALL correspond to one column name. Checked columns are included in `fields`;
unchecked columns are excluded. If the analyze response returns an empty `inputSchema`, the UI SHALL
render an empty checklist (no prompt to run the pipeline first).

#### Scenario: Checklist shows columns from analyze inputSchema
- **WHEN** a select step card is expanded and the analyze response contains an `inputSchema` with
  fields `["a", "b", "c"]` for that step
- **THEN** the step-card body shows three checkboxes labelled `a`, `b`, and `c`

#### Scenario: Empty inputSchema renders empty checklist, no run prompt
- **WHEN** a select step card is expanded and the analyze response returns an empty `inputSchema` for that step
- **THEN** the step-card body shows an empty checklist; no message prompting the user to run the pipeline is shown

#### Scenario: Toggling a checkbox updates the step config
- **WHEN** the user unchecks column `b` in the select field checklist
- **THEN** `fields` in the step config no longer includes `b`

