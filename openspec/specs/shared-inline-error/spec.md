## Purpose
Shared `InlineError` component rendering a small error message, used across forms and,
as of HEL-539, as a compact intent-error banner with an optional retry action.

## Requirements

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
### Requirement: InlineError banner variant supports a kind and retry action
The `InlineError` component's `banner` variant SHALL accept a `kind` prop (`"error" | "forbidden" |
"not-found"`, default `"error"`) and an optional `onRetry` callback. When rendered, the `banner` variant
SHALL pair an icon (matching `kind`) with the message text — color SHALL NOT be the sole signal. The
component SHALL render a Retry action invoking `onRetry` only when `kind === "error"` and `onRetry` is
provided; it SHALL NOT render a Retry action when `kind` is `"forbidden"` or `"not-found"`, even if
`onRetry` is passed.

#### Scenario: Banner variant with kind="error" and onRetry renders a retry action
- **WHEN** `InlineError` is rendered with `variant="banner"`, `kind="error"`, and an `onRetry` callback
- **THEN** an icon-paired message is rendered alongside a Retry action that invokes `onRetry`

#### Scenario: Banner variant with kind="forbidden" never renders a retry action
- **WHEN** `InlineError` is rendered with `variant="banner"`, `kind="forbidden"`, and an `onRetry` callback
- **THEN** an icon-paired message is rendered with no Retry action, regardless of `onRetry` being provided

#### Scenario: Banner variant with kind="not-found" never renders a retry action
- **WHEN** `InlineError` is rendered with `variant="banner"`, `kind="not-found"`, and an `onRetry` callback
- **THEN** an icon-paired message is rendered with no Retry action, regardless of `onRetry` being provided

#### Scenario: Text variant is unaffected
- **WHEN** `InlineError` is rendered with `variant="text"` (the default), with or without `kind`/`onRetry`
- **THEN** it renders exactly as it did before this change — no icon, no retry action

### Requirement: InlineError banner supports suppressing its own alert role when nested
The `InlineError` component's `banner` variant SHALL accept an `announced` prop (default `true`). When
`announced={false}`, the component SHALL NOT render `role="alert"` on its own element, so a parent
surface that already owns an enclosing `role="alert"` region does not produce two nested, independently
announced alert regions.

#### Scenario: Default announced banner carries role="alert"
- **WHEN** `InlineError` is rendered with `variant="banner"` and no `announced` prop
- **THEN** the rendered element carries `role="alert"`, matching pre-existing behavior

#### Scenario: announced=false omits the alert role
- **WHEN** `InlineError` is rendered with `variant="banner"` and `announced={false}`
- **THEN** the rendered element does not carry `role="alert"`

### Requirement: InlineError banner supports an icon-only retry action for compact surfaces
The `InlineError` component's `banner` variant SHALL accept a `retryVariant` prop (`"button" | "icon-only"`,
default `"button"`). When `"icon-only"`, the Retry action SHALL render as an icon-only control with a
required accessible name, for use inside a surface too small for a labeled button.

#### Scenario: Default retry variant renders a labeled button
- **WHEN** `InlineError` is rendered with `variant="banner"`, `kind="error"`, and an `onRetry` callback,
  with no `retryVariant` prop
- **THEN** the Retry action renders as a labeled button

#### Scenario: icon-only retry variant renders an accessible icon-only control
- **WHEN** `InlineError` is rendered with `variant="banner"`, `kind="error"`, an `onRetry` callback, and
  `retryVariant="icon-only"`
- **THEN** the Retry action renders as an icon-only control with an accessible name

