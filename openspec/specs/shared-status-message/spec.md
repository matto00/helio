## Purpose
Shared `StatusMessage` component rendering a loading or failed status block for a
data-backed list, used consistently across list-level fetch states.

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
## Requirements
### Requirement: StatusMessage renders an alert role and retry action on its failed state, without changing its box metrics
The `StatusMessage` component's `failed` state SHALL carry `role="alert"` and SHALL pair an icon with the
message text — color SHALL NOT be the sole signal. The component SHALL accept an optional `onRetry`
callback; when `status="failed"` and `onRetry` is provided, it SHALL render a Retry action invoking
`onRetry`. This change SHALL NOT alter the `failed` state's existing box metrics (padding, type size,
border radius) — those SHALL remain identical to the `loading` state's metrics, since both are rendered in
the same slot of the same element and must stay visually paired on state transition. The `loading`/`idle`/
`succeeded` states are otherwise unaffected.

#### Scenario: Failed status carries an alert role and icon, with unchanged box metrics
- **WHEN** `StatusMessage` is rendered with `status="failed"`
- **THEN** the rendered element carries `role="alert"` and pairs an icon with the message text
- **AND** its padding, type size, and border radius match the `loading` state's, unchanged from before
  this change

#### Scenario: Failed status with onRetry renders a retry action
- **WHEN** `StatusMessage` is rendered with `status="failed"` and an `onRetry` callback
- **THEN** a Retry action is rendered that invokes `onRetry` when activated

#### Scenario: Failed status without onRetry renders no retry action
- **WHEN** `StatusMessage` is rendered with `status="failed"` and no `onRetry`
- **THEN** no retry action is rendered, matching pre-existing behavior

#### Scenario: Non-failed states are unaffected
- **WHEN** `StatusMessage` is rendered with `status="loading"`, `"idle"`, or `"succeeded"`
- **THEN** it renders identically to its pre-existing behavior, with no role or retry action added

