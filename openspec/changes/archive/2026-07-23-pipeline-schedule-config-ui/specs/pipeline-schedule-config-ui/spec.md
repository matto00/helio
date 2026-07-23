## ADDED Requirements

### Requirement: Schedule bar shows current schedule state
The pipeline detail page SHALL render a schedule bar between the bound-type bar and the river
view, showing: "No schedule set" with a "Set schedule" button when the pipeline has no schedule,
or the schedule's kind/expression, enabled state, and next-run time (formatted as a local
date/time) with an "Edit schedule" button when one exists.

#### Scenario: No schedule set
- **WHEN** `GET /api/pipelines/:id/schedule` resolves to no schedule (404)
- **THEN** the schedule bar shows "No schedule set" and a "Set schedule" button, and no next-run
  time is displayed

#### Scenario: Schedule exists and is enabled
- **WHEN** the pipeline has a schedule with `enabled: true` and a non-null `nextRunAt`
- **THEN** the schedule bar shows the schedule's expression and the next-run time

#### Scenario: Schedule exists but has no computed next run yet
- **WHEN** the pipeline has a schedule with `enabled: true` and `nextRunAt: null`
- **THEN** the schedule bar shows the schedule's expression without a next-run time, and does not
  render an error

### Requirement: User can set a new schedule
The user SHALL be able to open a schedule dialog and create a schedule for a pipeline with no
existing schedule by choosing a kind (interval or cron), entering an expression, choosing a
timezone, and saving. On save, the frontend SHALL call `PUT /api/pipelines/:id/schedule`.

#### Scenario: Interval schedule created via friendly picker
- **WHEN** the user selects kind "interval", enters a number and unit (e.g. 15 / minutes), and
  saves
- **THEN** `PUT /api/pipelines/:id/schedule` is called with `expression: "15m"` and the schedule
  bar reflects the new schedule after the call resolves

#### Scenario: Cron schedule created
- **WHEN** the user selects kind "cron", enters a 5-field cron expression, and saves
- **THEN** `PUT /api/pipelines/:id/schedule` is called with that expression and the schedule bar
  reflects the new schedule after the call resolves

### Requirement: User can edit an existing schedule
The user SHALL be able to open the schedule dialog for an existing schedule pre-filled with its
current kind, expression, enabled state, and timezone, change any field, and save via
`PUT /api/pipelines/:id/schedule`.

#### Scenario: Editing an existing schedule pre-fills the form
- **WHEN** the user opens the schedule dialog for a pipeline with an existing schedule
- **THEN** the kind, expression, enabled toggle, and timezone fields are pre-filled with the
  schedule's current values

#### Scenario: Saving an edit persists the change
- **WHEN** the user changes the expression and saves
- **THEN** `PUT /api/pipelines/:id/schedule` is called with the updated fields and the schedule
  bar reflects the new expression after the call resolves

### Requirement: User can enable or disable a schedule
The schedule bar and dialog SHALL each provide a way to toggle `enabled` without altering the
`kind`/`expression`/`timezone` fields, persisted via `PUT /api/pipelines/:id/schedule`.

#### Scenario: Disabling from the bar
- **WHEN** the user toggles the enabled control on the schedule bar
- **THEN** `PUT /api/pipelines/:id/schedule` is called with `enabled: false` and the same
  `kind`/`expression`/`timezone` as before

### Requirement: User can clear a schedule
The schedule dialog SHALL provide a "Clear schedule" action that calls
`DELETE /api/pipelines/:id/schedule`. After a successful delete, the schedule bar SHALL return to
the "No schedule set" state.

#### Scenario: Clearing an existing schedule
- **WHEN** the user clicks "Clear schedule" in the dialog for a pipeline with an existing schedule
- **THEN** `DELETE /api/pipelines/:id/schedule` is called and, after it resolves, the schedule bar
  shows "No schedule set"

### Requirement: Invalid expressions and timezones are surfaced inline
When `PUT /api/pipelines/:id/schedule` responds with 400, the schedule dialog SHALL display the
response's `message` field as an inline error near the offending field's input, and SHALL NOT
close the dialog or clear the user's entered values.

#### Scenario: Invalid cron expression shows inline error
- **WHEN** the user saves a cron schedule and the backend responds 400 with a message identifying
  the malformed field
- **THEN** that message is displayed inline in the dialog and the dialog remains open with the
  user's input intact

#### Scenario: Invalid timezone shows inline error
- **WHEN** the user saves a schedule with a timezone the backend rejects as not a valid IANA zone
  id
- **THEN** the backend's error message is displayed inline in the dialog

### Requirement: Backward compatible — no schedule renders as today
Pipelines without a schedule SHALL render the pipeline editor exactly as before this change,
aside from the added schedule bar's "No schedule set" state.

#### Scenario: Existing editor layout unaffected
- **WHEN** a pipeline with no schedule is opened in the editor
- **THEN** the bound-source bar, bound-type bar, river view, and footer render unchanged, and the
  schedule bar shows only "No schedule set" with a "Set schedule" button
