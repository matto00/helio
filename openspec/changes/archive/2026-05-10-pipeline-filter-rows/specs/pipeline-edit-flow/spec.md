## ADDED Requirements

### Requirement: Pipeline editor registers the filter op type with correct seed config
The pipeline editor's `OP_TYPES` registry SHALL include an entry for `"filter"` (it already does).
When a new filter step is created, the step config SHALL be initialized to
`'{"combinator":"AND","conditions":[]}'`. When a filter step card is expanded, the editor
SHALL render the `FilterConfig` component instead of the generic placeholder.

#### Scenario: New filter step is seeded with structured combinator config
- **WHEN** the user adds a new step with `op: "filter"`
- **THEN** the initial persisted config is `{"combinator":"AND","conditions":[]}`

#### Scenario: Filter step card renders FilterConfig component
- **WHEN** a pipeline step with `op: "filter"` has its card expanded
- **THEN** the `FilterConfig` component is rendered in the step-card body

### Requirement: FilterConfig renders condition rows with field, operator, and value controls
`FilterConfig` SHALL render one row per condition in the config, each containing:
a field dropdown (options from the step's `analyzeSchema`), an operator dropdown
(all 9 supported operators), and a value input (hidden for unary operators).

#### Scenario: Renders one row per condition
- **WHEN** FilterConfig receives conditions `[{field:"age",operator:">",value:"18"}]`
- **THEN** one condition row is rendered with the correct field, operator, and value

#### Scenario: Value input hidden for unary operators
- **WHEN** a condition's operator is `"is null"` or `"is not null"`
- **THEN** no value input is rendered for that condition row

#### Scenario: Value input visible for binary operators
- **WHEN** a condition's operator is `"="`, `"!="`, `">"`, `">="`, `"<"`, `"<="`, or `"contains"`
- **THEN** a value input is rendered for that condition row

### Requirement: FilterConfig renders a top-level AND/OR combinator toggle
`FilterConfig` SHALL render a control that lets the user switch between `"AND"` and `"OR"`
combinators. The current combinator SHALL be reflected in the toggle's state.

#### Scenario: AND combinator selected by default on empty config
- **WHEN** FilterConfig receives config `{"combinator":"AND","conditions":[]}`
- **THEN** the AND option is visually active / selected

#### Scenario: Switching combinator calls onChange with updated config
- **WHEN** the user switches the combinator from AND to OR
- **THEN** `onChange` is called with the updated config where `combinator` is `"OR"`

### Requirement: FilterConfig adapts value input type to field schema type
`FilterConfig` SHALL render `type="number"` for condition value inputs when the selected field has
a numeric type (`number`, `integer`, `long`, `double`, `float`). For all other field types the
value input SHALL be `type="text"`.

#### Scenario: Numeric field type renders number input
- **WHEN** the analyze schema reports a field as type `"integer"` and the user selects that field
- **THEN** the value input for that condition has `type="number"`

#### Scenario: String field type renders text input
- **WHEN** the analyze schema reports a field as type `"string"` and the user selects that field
- **THEN** the value input for that condition has `type="text"`

### Requirement: FilterConfig allows adding and removing conditions
`FilterConfig` SHALL render an "Add condition" button that appends a blank condition row.
Each condition row SHALL have a remove button that deletes that condition from the list.

#### Scenario: Add condition appends a blank row
- **WHEN** the user clicks "Add condition"
- **THEN** a new blank condition row is appended and `onChange` is called with the updated config

#### Scenario: Remove button deletes the condition
- **WHEN** the user clicks the remove button on a condition row
- **THEN** that condition is removed and `onChange` is called with the updated config

### Requirement: FilterConfig hydrates from persisted config on reload
When `PipelineDetailPage` loads persisted steps from Redux, the filter step config SHALL be parsed
and passed to `FilterConfig` as structured props, so the UI reflects the last-saved state.

#### Scenario: Conditions hydrated from persisted config
- **WHEN** a filter step is loaded with config `{"combinator":"OR","conditions":[{...}]}`
- **THEN** FilterConfig renders that condition and shows OR as the active combinator
