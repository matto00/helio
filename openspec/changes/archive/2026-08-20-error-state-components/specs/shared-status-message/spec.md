## ADDED Requirements

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
