## ADDED Requirements

### Requirement: StatusMessage renders a loading state
The `StatusMessage` component SHALL render a styled block with a loading message when `status` is `"loading"`.

#### Scenario: Loading message shown
- **WHEN** `StatusMessage` is rendered with `status="loading"`
- **THEN** a non-empty message is displayed indicating content is loading

### Requirement: StatusMessage renders an error state
The `StatusMessage` component SHALL render a styled block with a distinct error style when `status` is `"failed"`.

#### Scenario: Error message shown with error styling
- **WHEN** `StatusMessage` is rendered with `status="failed"` and a `message` string
- **THEN** the message is displayed with error-colored text

### Requirement: StatusMessage renders nothing for other statuses
The `StatusMessage` component SHALL render nothing when `status` is not `"loading"` or `"failed"`.

#### Scenario: Idle status produces no output
- **WHEN** `StatusMessage` is rendered with `status="idle"` or `status="succeeded"`
- **THEN** nothing is rendered

### Requirement: DashboardList uses StatusMessage for fetch state
`DashboardList` SHALL use `StatusMessage` instead of its own inline `<p>` block for loading and error states.

#### Scenario: DashboardList loading state
- **WHEN** the dashboard list is loading
- **THEN** `StatusMessage` with `status="loading"` is rendered

#### Scenario: DashboardList error state
- **WHEN** the dashboard list fails to load
- **THEN** `StatusMessage` with `status="failed"` and the error message is rendered

### Requirement: PanelList uses StatusMessage for fetch state
`PanelList` SHALL use `StatusMessage` instead of its own inline `<p>` block for loading and error states.

#### Scenario: PanelList loading state
- **WHEN** the panel list is loading
- **THEN** `StatusMessage` with `status="loading"` is rendered

#### Scenario: PanelList error state
- **WHEN** the panel list fails to load
- **THEN** `StatusMessage` with `status="failed"` and the error message is rendered
