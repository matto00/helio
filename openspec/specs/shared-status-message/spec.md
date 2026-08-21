## Purpose
Shared `StatusMessage` component rendering a failed status block, with an optional retry action, for a
data-backed list — used consistently across list-level fetch failures. Loading is not rendered by this
component: each surface renders a shape-matched skeleton for its initial-load state instead.

## Requirements
### Requirement: StatusMessage renders an error state
The `StatusMessage` component SHALL render a styled block with a distinct error style when `status` is `"failed"`.

#### Scenario: Error message shown with error styling
- **WHEN** `StatusMessage` is rendered with `status="failed"` and a `message` string
- **THEN** the message is displayed with error-colored text

### Requirement: StatusMessage renders nothing for other statuses
The `StatusMessage` component SHALL accept a `status` prop of `"idle" | "succeeded" | "failed"` and
SHALL render nothing when `status` is not `"failed"`. `"loading"` SHALL NOT be assignable to the prop, so
that a call site attempting to render a loading state through this component fails to compile instead of
silently rendering an empty region.

#### Scenario: Idle status produces no output
- **WHEN** `StatusMessage` is rendered with `status="idle"` or `status="succeeded"`
- **THEN** nothing is rendered

#### Scenario: A loading status is not assignable
- **WHEN** a call site passes `status="loading"`
- **THEN** the code fails to type-check

### Requirement: DashboardList uses StatusMessage for fetch state
`DashboardList` SHALL use `StatusMessage` for its error state, and SHALL render skeleton placeholders
from the shared `Skeleton` primitive for its initial-load state, rather than routing loading through
`StatusMessage`.

#### Scenario: DashboardList loading state
- **WHEN** the dashboard list is loading and holds no items
- **THEN** skeleton rows are rendered in place of the list, and no `StatusMessage` loading block appears

#### Scenario: DashboardList error state
- **WHEN** the dashboard list fails to load
- **THEN** `StatusMessage` with `status="failed"` and the error message is rendered

### Requirement: PanelList uses StatusMessage for fetch state
`PanelList` SHALL use `StatusMessage` for its error state, and SHALL render panel-card-shaped skeleton
placeholders from the shared `Skeleton` primitive for its initial-load state, rather than routing loading
through `StatusMessage`.

#### Scenario: PanelList loading state
- **WHEN** the panel list is loading for a selected dashboard and holds no panels
- **THEN** panel-card-shaped skeleton placeholders are rendered, and no `StatusMessage` loading block
  appears

#### Scenario: PanelList error state
- **WHEN** the panel list fails to load
- **THEN** `StatusMessage` with `status="failed"` and the error message is rendered

### Requirement: StatusMessage renders an alert role and retry action on its failed state, without changing its box metrics
The `StatusMessage` component's `failed` state SHALL carry `role="alert"` and SHALL pair an icon with the
message text — color SHALL NOT be the sole signal. The component SHALL accept an optional `onRetry`
callback; when `status="failed"` and `onRetry` is provided, it SHALL render a Retry action invoking
`onRetry`. This change SHALL NOT alter the `failed` state's existing box metrics (padding, type size,
border radius), which SHALL remain as they are, since the surrounding surface's skeleton state is sized
to sit in the same slot without collapsing it. The `idle`/`succeeded` states are otherwise unaffected.

#### Scenario: Failed status carries an alert role and icon, with unchanged box metrics
- **WHEN** `StatusMessage` is rendered with `status="failed"`
- **THEN** the rendered element carries `role="alert"` and pairs an icon with the message text
- **AND** its padding, type size, and border radius are unchanged from before this change

#### Scenario: Failed status with onRetry renders a retry action
- **WHEN** `StatusMessage` is rendered with `status="failed"` and an `onRetry` callback
- **THEN** a Retry action is rendered that invokes `onRetry` when activated

#### Scenario: Failed status without onRetry renders no retry action
- **WHEN** `StatusMessage` is rendered with `status="failed"` and no `onRetry`
- **THEN** no retry action is rendered, matching pre-existing behavior

#### Scenario: Non-failed states are unaffected
- **WHEN** `StatusMessage` is rendered with `status="idle"` or `"succeeded"`
- **THEN** it renders nothing, with no role or retry action added

