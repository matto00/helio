## ADDED Requirements

### Requirement: Limit op truncates rows to N
The system SHALL support a `"limit"` pipeline step that caps the output to the first N rows.
Config shape: `{"count": <int>}`. The output schema SHALL equal the input schema (pass-through).
When `count` is missing, zero, or negative, the engine SHALL return all rows (safe no-op).

#### Scenario: Limit to N rows
- **WHEN** a limit step with `{"count": 2}` is applied to 5 rows
- **THEN** only the first 2 rows are returned

#### Scenario: Count exceeds row count
- **WHEN** a limit step with `{"count": 100}` is applied to 3 rows
- **THEN** all 3 rows are returned

#### Scenario: Count is zero or negative
- **WHEN** a limit step with `{"count": 0}` or `{"count": -1}` is applied
- **THEN** all rows are returned (no-op)

#### Scenario: Schema pass-through
- **WHEN** the analyze endpoint processes a limit step
- **THEN** `outputSchema` equals `inputSchema` and `validationError` is None

### Requirement: Limit op UI config component
The system SHALL provide a `LimitConfig` component with a numeric input for the row count.
The input SHALL have `min=1` and SHALL display an error/validation message when N <= 0.
The component SHALL call `onChange` with the serialized config JSON on every valid change.

#### Scenario: User enters valid row count
- **WHEN** user types `50` into the row count input
- **THEN** onChange is called with `'{"count":50}'`

#### Scenario: User enters invalid row count
- **WHEN** user types `0` or a negative number
- **THEN** the input is visually marked invalid and onChange is not called with an invalid value

### Requirement: Limit op is available in PipelineDetailPage
The system SHALL include a "Limit rows" entry in the op-type dropdown of the pipeline editor.
Selecting it SHALL create a step with initial config `{"count":100}`.
The step card body SHALL render `LimitConfig` when the step op is `"limit"`.

#### Scenario: Adding a limit step
- **WHEN** user selects "Limit rows" from the op dropdown
- **THEN** a new step is created with op `"limit"` and config `{"count":100}`

#### Scenario: Editing a limit step
- **WHEN** the step card for a limit step is expanded
- **THEN** `LimitConfig` is rendered with the current count value
