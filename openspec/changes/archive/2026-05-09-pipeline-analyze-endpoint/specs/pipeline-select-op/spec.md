## MODIFIED Requirements

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
