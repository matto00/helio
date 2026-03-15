## ADDED Requirements

### Requirement: InlineError renders an error string
The `InlineError` component SHALL render a small error message when given a non-empty string.

#### Scenario: Error string displayed
- **WHEN** `InlineError` is rendered with a non-null `error` string
- **THEN** the error text is visible

### Requirement: InlineError renders nothing when error is absent
The `InlineError` component SHALL render nothing when `error` is null or undefined.

#### Scenario: Null error produces no output
- **WHEN** `InlineError` is rendered with `error={null}`
- **THEN** nothing is rendered

### Requirement: All four components use InlineError for form errors
`DashboardList`, `PanelList`, `DashboardAppearanceEditor`, and `PanelAppearanceEditor` SHALL use `InlineError` instead of their own inline `<p>` elements for form-level errors.

#### Scenario: Create form error in DashboardList
- **WHEN** dashboard creation fails
- **THEN** `InlineError` displays the error below the create form

#### Scenario: Create form error in PanelList
- **WHEN** panel creation fails
- **THEN** `InlineError` displays the error below the create form

#### Scenario: Save error in DashboardAppearanceEditor
- **WHEN** saving dashboard appearance fails
- **THEN** `InlineError` displays the error below the save button

#### Scenario: Save error in PanelAppearanceEditor
- **WHEN** saving panel appearance fails
- **THEN** `InlineError` displays the error below the save button
